# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The GitHub toolkit's MCP server: search public GitHub repositories, code and issues, and read their READMEs and files.

Started by Data Formulator over stdio (``python -m data_formulator.tool_packs.github``). Read-only and public-only: a
private repository is never searched or read, whatever the token could reach. With the user's GitHub sign-in
(``GITHUB_TOKEN``, from the credential vault) requests count against the user's own limits (5,000 an hour; searches 30 a
minute, code search 10); without one, against this computer's anonymous ones (60 an hour; code search needs a sign-in).
Lists come back as JSON tables the agent can load with ``create_data``; answers are cached on disk.
"""

from __future__ import annotations

import argparse
import os
import re
import time
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from data_formulator.tool_packs.cache import DiskCache, Response

API = "https://api.github.com"
TTL_SEARCH = 3600
TTL_REPO = 24 * 3600
MAX_LIMIT = 50
MAX_TEXT = 60_000
READ_TIMEOUT = 30.0

INSTRUCTIONS = """\
Search and read public GitHub repositories (read-only; private repositories are out of reach).
- search_repositories, search_code and search_issues return JSON tables; load a large one with create_data, then chart it.
  Queries take GitHub's search syntax, e.g. `language:python stars:>100` or `repo:owner/name label:bug`.
- repo_details gives a repository's facts and README; read_file reads one file. Read only what the question needs.
- If a tool says GitHub is rate-limiting, wait as long as it says. If it asks for a GitHub sign-in, tell the user to
  sign in to the GitHub toolkit in Tools."""

READ_ONLY = ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True)
_REPO = re.compile(r"^(?:https?://github\.com/)?(?P<owner>[A-Za-z0-9-]{1,39})/(?P<name>[A-Za-z0-9._-]{1,100})(?:\.git)?/?$")


class GitHubError(ToolError):
    """A failure the agent should read (the MCP SDK shows a ``ToolError``'s message to the model)."""


def parse_repo(value: str) -> tuple[str, str]:
    match = _REPO.match(str(value or "").strip())
    if not match:
        raise GitHubError(f"Name a repository as owner/name (or its github.com link), not {value!r}.")
    return match.group("owner"), match.group("name")


class Client:
    """GitHub's REST API, as the signed-in user when there is a token, cached."""

    def __init__(self, cache_dir: Path | None = None, token: str | None = None, *,
                 transport: httpx.BaseTransport | None = None) -> None:
        self.token = (token or "").strip() or None
        self._cache = DiskCache(cache_dir)
        self._http = httpx.Client(base_url=API, transport=transport, follow_redirects=True,
                                  timeout=httpx.Timeout(READ_TIMEOUT, connect=10.0),
                                  headers={"User-Agent": "DataFormulator-GitHub/1.0 (+https://github.com/microsoft/data-formulator)",
                                           "X-GitHub-Api-Version": "2022-11-28"})

    def get(self, path: str, params: dict[str, Any] | None = None, *, ttl: float | None = TTL_SEARCH,
            raw: bool = False) -> Any:
        """GET an API path: its JSON, or with ``raw`` its bytes. The token goes in a header, never the cache key."""
        url = str(httpx.URL(API + path, params=params or {}))
        key = url + ("#raw" if raw else "") + ("#signed-in" if self.token else "")
        if (hit := self._cache.get(key, ttl)) is not None:
            return hit.content if raw else _json(hit.content)
        headers = {"Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            reply = self._http.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise GitHubError(f"Could not reach GitHub ({type(exc).__name__}). Try again in a moment.") from None
        if reply.status_code == 200:
            self._cache.put(key, Response(200, reply.content, dict(reply.headers), url))
            return reply.content if raw else _json(reply.content)
        raise _failure(reply, signed_in=bool(self.token))

    def close(self) -> None:
        self._http.close()


def _json(content: bytes) -> Any:
    import json

    return json.loads(content)


def _failure(reply: httpx.Response, signed_in: bool) -> GitHubError:
    message = ""
    try:
        message = str(reply.json().get("message") or "")
    except Exception:
        pass
    remaining = reply.headers.get("x-ratelimit-remaining")
    if reply.status_code in (403, 429) and (remaining == "0" or reply.headers.get("retry-after")):
        reset = reply.headers.get("x-ratelimit-reset")
        wait = reply.headers.get("retry-after") or (max(1, int(reset) - int(time.time())) if reset and reset.isdigit() else 60)
        hint = "" if signed_in else " Signing in to the GitHub toolkit (in Tools) raises the limit to the user's own."
        return GitHubError(f"GitHub is rate-limiting these requests: wait about {wait} seconds before asking again.{hint}")
    if reply.status_code == 401:
        return GitHubError("GitHub refused the sign-in (it may have been revoked). Ask the user to sign in to the GitHub "
                           "toolkit again in Tools.")
    if reply.status_code == 404:
        return GitHubError("Not found on GitHub, or not public: this toolkit reads public repositories only.")
    if reply.status_code == 422:
        return GitHubError(f"GitHub could not run that search: {message or 'invalid query'}.")
    return GitHubError(f"GitHub answered HTTP {reply.status_code}{': ' + message if message else ''}.")


_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        _client = Client(token=os.environ.get("GITHUB_TOKEN"))
    return _client


def _bounded(limit: int) -> int:
    return max(1, min(MAX_LIMIT, int(limit)))


def _search(kind: str, query: str, limit: int, page: int, sort: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {"q": query, "per_page": _bounded(limit), "page": max(1, int(page))}
    if sort:
        params.update(sort=sort, order="desc")
    return client().get(f"/search/{kind}", params)


def _repo_row(repo: dict[str, Any]) -> dict[str, Any]:
    return {
        "repository": repo.get("full_name"),
        "description": repo.get("description"),
        "stars": repo.get("stargazers_count"),
        "forks": repo.get("forks_count"),
        "open_issues": repo.get("open_issues_count"),
        "language": repo.get("language"),
        "topics": ", ".join(repo.get("topics") or []),
        "license": (repo.get("license") or {}).get("spdx_id"),
        "created": (repo.get("created_at") or "")[:10],
        "pushed": (repo.get("pushed_at") or "")[:10],
        "archived": repo.get("archived"),
        "url": repo.get("html_url"),
    }


def _public(items: list[dict[str, Any]], repo_of=lambda item: item) -> list[dict[str, Any]]:
    """Only items of public repositories, whatever the token could see."""
    return [item for item in items if not (repo_of(item) or {}).get("private")]


# -- tools --

app = MCPServer("github", instructions=INSTRUCTIONS)


@app.tool(annotations=READ_ONLY)
def search_repositories(query: str, sort: Literal["best", "stars", "updated"] = "best", limit: int = 25,
                        page: int = 1) -> dict[str, Any]:
    """Search public GitHub repositories. `query` takes GitHub's search syntax, e.g. `vega-lite language:typescript`,
    `topic:visualization stars:>500` or `user:microsoft`. Up to 50 per call; page with `page`."""
    data = _search("repositories", query, limit, page, None if sort == "best" else sort)
    repos = _public(data.get("items") or [])
    return {"query": query, "total": data.get("total_count", 0), "returned": len(repos),
            "repositories": [_repo_row(repo) for repo in repos]}


@app.tool(annotations=READ_ONLY)
def search_code(query: str, repo: str = "", language: str = "", limit: int = 25, page: int = 1) -> dict[str, Any]:
    """Search code in public GitHub repositories (needs the user's GitHub sign-in). `query` is the text or symbol, with
    GitHub qualifiers such as `path:src extension:py`; `repo` (owner/name) and `language` narrow it."""
    if not client().token:
        raise GitHubError("Code search needs a GitHub sign-in. Ask the user to sign in to the GitHub toolkit in Tools.")
    parts = [query.strip()]
    if repo.strip():
        owner, name = parse_repo(repo)
        parts.append(f"repo:{owner}/{name}")
    if language.strip():
        parts.append(f"language:{language.strip()}")
    data = _search("code", " ".join(part for part in parts if part), limit, page)
    items = _public(data.get("items") or [], lambda item: item.get("repository"))
    return {"query": " ".join(parts), "total": data.get("total_count", 0), "returned": len(items),
            "results": [{"repository": (item.get("repository") or {}).get("full_name"), "path": item.get("path"),
                         "name": item.get("name"), "url": item.get("html_url")} for item in items]}


@app.tool(annotations=READ_ONLY)
def search_issues(query: str, repo: str = "", kind: Literal["issue", "pr"] = "issue",
                  state: Literal["any", "open", "closed"] = "any",
                  sort: Literal["best", "created", "updated", "comments", "reactions"] = "best",
                  limit: int = 25, page: int = 1) -> dict[str, Any]:
    """Search issues or pull requests in public repositories. `query` takes GitHub's syntax (`label:bug`,
    `author:octocat`, `created:>2025-01-01`); `repo` (owner/name) narrows it to one repository."""
    parts = [query.strip(), "is:issue" if kind == "issue" else "is:pr"]
    if repo.strip():
        owner, name = parse_repo(repo)
        parts.append(f"repo:{owner}/{name}")
    if state != "any":
        parts.append(f"state:{state}")
    search = " ".join(part for part in parts if part)
    data = _search("issues", search, limit, page, None if sort == "best" else sort)
    items = data.get("items") or []
    return {"query": search, "total": data.get("total_count", 0), "returned": len(items),
            "results": [{"repository": (item.get("repository_url") or "").removeprefix(f"{API}/repos/"),
                         "number": item.get("number"), "title": item.get("title"), "state": item.get("state"),
                         "author": (item.get("user") or {}).get("login"),
                         "labels": ", ".join(label.get("name", "") for label in item.get("labels") or []),
                         "comments": item.get("comments"), "created": (item.get("created_at") or "")[:10],
                         "closed": (item.get("closed_at") or "")[:10] or None, "url": item.get("html_url")}
                        for item in items]}


def _public_repo(repo: str) -> dict[str, Any]:
    owner, name = parse_repo(repo)
    data = client().get(f"/repos/{owner}/{name}", ttl=TTL_REPO)
    if data.get("private"):
        raise GitHubError("Not found on GitHub, or not public: this toolkit reads public repositories only.")
    return data


def _text(content: bytes, what: str) -> str:
    if b"\0" in content[:8000]:
        raise GitHubError(f"{what} is not a text file.")
    text = content.decode("utf-8", errors="replace")
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT] + f"\n\n[… cut at {MAX_TEXT:,} of {len(text):,} characters]"


@app.tool(annotations=READ_ONLY)
def repo_details(repo: str, include_readme: bool = True) -> dict[str, Any]:
    """A public repository's facts (description, stars, language, topics, license, dates) and its README."""
    data = _public_repo(repo)
    result = {**_repo_row(data), "default_branch": data.get("default_branch"), "homepage": data.get("homepage") or None,
              "watchers": data.get("subscribers_count")}
    if include_readme:
        try:
            result["readme"] = _text(client().get(f"/repos/{data['full_name']}/readme", ttl=TTL_REPO, raw=True), "The README")
        except GitHubError:
            result["readme"] = None
    return result


@app.tool(annotations=READ_ONLY)
def read_file(repo: str, path: str, ref: str = "") -> dict[str, Any]:
    """One text file of a public repository, at `ref` (a branch, tag or commit; the default branch if empty)."""
    data = _public_repo(repo)
    parts = [part for part in str(path).strip().split("/") if part and part != "."]
    if ".." in parts:
        raise GitHubError("Give the file's path from the repository's root, without '..'.")
    clean = "/".join(parts)
    if not clean:
        raise GitHubError("Give the file's path in the repository, e.g. src/index.ts.")
    content = client().get(f"/repos/{data['full_name']}/contents/{clean}", {"ref": ref} if ref.strip() else None,
                           ttl=TTL_REPO, raw=True)
    if content[:1] in (b"[", b"{") and content.lstrip().startswith(b"[{"):
        raise GitHubError(f"{clean} is a folder, not a file.")
    return {"repository": data["full_name"], "path": clean, "ref": ref or data.get("default_branch"),
            "url": f"https://github.com/{data['full_name']}/blob/{ref or data.get('default_branch')}/{clean}",
            "text": _text(content, clean)}


def main(argv: list[str] | None = None) -> None:
    global _client
    parser = argparse.ArgumentParser(description="Data Formulator's GitHub toolkit as an MCP server.")
    parser.add_argument("--cache", default="", help="Directory for cached GitHub responses.")
    options = parser.parse_args(argv)
    # The user's GitHub sign-in, if any, comes from the credential vault as an environment variable.
    _client = Client(Path(options.cache).expanduser() if options.cache else None, os.environ.get("GITHUB_TOKEN"))
    app.run("stdio")
