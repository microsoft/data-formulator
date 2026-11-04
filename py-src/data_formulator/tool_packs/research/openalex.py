# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""OpenAlex, for finding arXiv papers: keyword, title, author and date search, citation counts, and counts over time.

OpenAlex indexes arXiv (as one of its sources) with the rest of the scholarly record. It answers up to 10 requests a
second, or 30 with a free key, from a daily budget: without a key $0.10 a day, shared by everyone on this computer's
network address, with a free key $1 a day (a search or a count costs $0.001). So searching here spares arXiv's own API,
which allows one request every three seconds, for what only arXiv has: its categories, papers from the last few days
(OpenAlex lists them a few days later), and the papers themselves.

Requests are cached on disk like arXiv's. A per-second 429 is retried; a spent daily budget is reported at once, so the
caller can search arXiv instead. A key whose email is not yet confirmed (403 ``key_not_activated``) is set aside and
the call goes on without it.
"""

from __future__ import annotations

import datetime as dt
import json
import random
import re
import time
from typing import Any, Callable

import httpx
from mcp.server.mcpserver.exceptions import ToolError

from .arxiv import ArxivError, normalize_id
from data_formulator.tool_packs.cache import DiskCache, Response

WORKS_URL = "https://api.openalex.org/works"
ARXIV_SOURCE = "S4306400194"  # "arXiv (Cornell University)"
TTL_SEARCH = 24 * 3600
RETRIES = 3
MAX_WAIT = 10.0
READ_TIMEOUT = 30.0
SELECT = ("id,doi,title,publication_date,publication_year,cited_by_count,authorships,locations,primary_topic,"
          "abstract_inverted_index")


class OpenAlexError(ToolError):
    """A failure the agent should read (see ``ArxivError``)."""


class Client:
    """OpenAlex's works API, cached, with the user's key when one is set."""

    def __init__(self, cache_dir=None, api_key: str | None = None, *, transport: httpx.BaseTransport | None = None,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        self.api_key = (api_key or "").strip() or None
        self._cache = DiskCache(cache_dir)
        self._sleep = sleep
        self._http = httpx.Client(headers={"User-Agent": "DataFormulator-Research/1.0 (+https://github.com/microsoft/data-formulator)"},
                                  follow_redirects=True, transport=transport, timeout=httpx.Timeout(READ_TIMEOUT, connect=10.0))

    def get(self, params: dict[str, Any], ttl: float | None = TTL_SEARCH) -> dict[str, Any]:
        # The key goes in a header, so it never reaches the cache or a logged URL.
        url = str(httpx.URL(WORKS_URL, params=params))
        if (hit := self._cache.get(url, ttl)) is not None:
            return json.loads(hit.content)
        last_error = "no response"
        for attempt in range(RETRIES):
            headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
            try:
                reply = self._http.get(url, headers=headers)
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                reply = None
            if reply is not None:
                if reply.status_code == 200:
                    self._cache.put(url, Response(200, reply.content, dict(reply.headers), url))
                    return reply.json()
                body = _error_body(reply)
                if reply.status_code == 403 and self.api_key and "not_activated" in body:
                    self.api_key = None  # its owner has not clicked the activation link yet
                    continue
                if reply.status_code == 429:
                    if _budget_spent(reply, body):
                        raise OpenAlexError(
                            "OpenAlex's daily budget for this computer is spent"
                            + (" (with this key)." if self.api_key else
                               " (without a key it is $0.10 a day, shared on this network; a free key at "
                               "https://openalex.org/settings/api gives $1 a day).")
                            + " It resets at midnight UTC.")
                    last_error = "HTTP 429"
                elif reply.status_code >= 500:
                    last_error = f"HTTP {reply.status_code}"
                else:
                    raise OpenAlexError(f"OpenAlex answered HTTP {reply.status_code}: {body[:300]}")
            if attempt < RETRIES - 1:
                wait = _retry_after(reply) if reply is not None else None
                self._sleep(min(MAX_WAIT, wait if wait is not None else 2 ** attempt) + random.uniform(0, 0.5))
        raise OpenAlexError(f"OpenAlex did not respond after {RETRIES} tries ({last_error}).")

    def search(self, *, query: str = "", title: str = "", author: str = "", date_from: str = "", date_to: str = "",
               sort: str = "relevance", limit: int = 25, offset: int = 0) -> tuple[int, int, list[dict[str, Any]]]:
        """arXiv papers matching; returns (total, the offset of the first one returned, papers)."""
        per_page = max(1, min(100, int(limit)))
        page = max(0, int(offset)) // per_page + 1
        params: dict[str, Any] = {"filter": works_filter(query, title, author, date_from, date_to), "select": SELECT,
                                  "per_page": per_page, "page": page}
        if sort in SORTS:
            params["sort"] = SORTS[sort]
        data = self.get(params)
        papers = [paper for paper in (work_to_paper(work) for work in data.get("results") or []) if paper]
        return int((data.get("meta") or {}).get("count") or 0), (page - 1) * per_page, papers

    def count(self, *, query: str = "", title: str = "", author: str = "", date_from: str = "", date_to: str = "",
              by_year: bool = False) -> int | dict[str, int]:
        """How many arXiv papers match: one number, or by publication year."""
        params: dict[str, Any] = {"filter": works_filter(query, title, author, date_from, date_to)}
        if by_year:
            params["group_by"] = "publication_year"
            data = self.get(params)
            return {str(group.get("key")): int(group.get("count") or 0) for group in data.get("group_by") or []}
        params["per_page"] = 1
        params["select"] = "id"
        return int((self.get(params).get("meta") or {}).get("count") or 0)

    def close(self) -> None:
        self._http.close()


SORTS = {"newest": "publication_date:desc", "cited": "cited_by_count:desc"}


def _clean(text: str) -> str:
    # A comma separates OpenAlex filters and a colon ends a filter's name, so neither may sit in a value.
    return " ".join(re.sub(r"[,:]", " ", text).split())


def parse_day(value: str, end: bool) -> dt.date:
    """A day from 2024, 2024-05 or 2024-05-17: the first day of the period, or with ``end`` its last."""
    text = str(value).strip()
    for pattern, fill in (("%Y-%m-%d", None), ("%Y-%m", "month"), ("%Y", "year")):
        try:
            day = dt.datetime.strptime(text, pattern).date()
        except ValueError:
            continue
        if end and fill == "month":
            day = (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
        elif end and fill == "year":
            day = day.replace(month=12, day=31)
        return day
    raise ArxivError(f"Use a date like 2024, 2024-05 or 2024-05-17, not {value!r}.")


def works_filter(query: str = "", title: str = "", author: str = "", date_from: str = "", date_to: str = "") -> str:
    """The ``filter`` for arXiv papers: any work with a copy on arXiv, by words in the title and abstract (not the full
    text, whose passing mentions bring up famous papers), title words, author name and dates. Results come by relevance."""
    parts = [f"locations.source.id:{ARXIV_SOURCE}"]
    if query.strip():
        parts.append(f"title_and_abstract.search:{_clean(query)}")
    if title.strip():
        parts.append(f"title.search:{_clean(title)}")
    if author.strip():
        parts.append(f"raw_author_name.search:{_clean(author)}")
    if date_from:
        parts.append(f"from_publication_date:{parse_day(date_from, False).isoformat()}")
    if date_to:
        parts.append(f"to_publication_date:{parse_day(date_to, True).isoformat()}")
    return ",".join(parts)


def arxiv_id_of(work: dict[str, Any]) -> str | None:
    """The work's arXiv id (no version), from its arXiv copy or its arXiv DOI."""
    urls = [location.get(key) for location in work.get("locations") or [] for key in ("landing_page_url", "pdf_url")]
    for candidate in [*urls, work.get("doi")]:
        if candidate and "arxiv" in candidate.lower():
            try:
                return re.sub(r"v\d+$", "", normalize_id(candidate))
            except ArxivError:
                continue
    return None


def abstract_of(work: dict[str, Any]) -> str | None:
    """The abstract, from OpenAlex's inverted index (word → positions)."""
    index = work.get("abstract_inverted_index")
    if not index:
        return None
    words = sorted((position, word) for word, positions in index.items() for position in positions)
    return " ".join(word for _, word in words)


def work_to_paper(work: dict[str, Any]) -> dict[str, Any] | None:
    paper_id = arxiv_id_of(work)
    if not paper_id:
        return None
    authors = [(item.get("author") or {}).get("display_name") or item.get("raw_author_name") or ""
               for item in work.get("authorships") or []]
    published = work.get("publication_date") or ""
    return {
        "id": paper_id,
        "title": " ".join((work.get("title") or "").split()),
        "authors": [name for name in authors if name],
        "published": published[:10],
        "year": work.get("publication_year"),
        "cited_by": work.get("cited_by_count"),
        "topic": (work.get("primary_topic") or {}).get("display_name"),
        "abstract": abstract_of(work),
        "url": f"https://arxiv.org/abs/{paper_id}",
        "openalex_id": (work.get("id") or "").rsplit("/", 1)[-1] or None,
    }


def _error_body(reply: httpx.Response) -> str:
    try:
        return reply.text
    except Exception:
        return ""


def _budget_spent(reply: httpx.Response, body: str) -> bool:
    remaining = reply.headers.get("x-ratelimit-remaining-usd")
    try:
        if remaining is not None and float(remaining) <= 0:
            return True
    except ValueError:
        pass
    return "budget" in body.lower()


def _retry_after(reply: httpx.Response) -> float | None:
    value = reply.headers.get("retry-after")
    try:
        return max(0.0, float(value)) if value else None
    except ValueError:
        return None
