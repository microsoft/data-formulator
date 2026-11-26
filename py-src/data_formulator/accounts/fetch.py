# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""``api_fetch``: one GET from a service the user signed in to (or a built-in one), as the user (design-docs/72).

The request must start at https on one of the spec's ``send_to`` hosts. The secret goes with it the way the spec says
(a bearer token, a header, a query parameter, HTTP basic), and with each redirect that stays on those hosts; a redirect
elsewhere (where a service keeps its files) is followed without it. For a service the agent proposed, and for every
host off the spec's own, the host must resolve to public addresses only, so no request reaches this computer's network.

The body is saved to scratch for sandboxed Python to read; the agent gets the status, type, size, saved path and a
preview. The secret is scrubbed from all of it, including a saved text body that echoes it. A refusal that signing in
would fix says so (``needs_signin``), so the agent can offer the user a sign-in.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import re
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit

import httpx

from data_formulator.accounts.specs import SignInSpec, host_of, https_url, resolves_publicly, secret_values

MAX_BYTES = 200 * 1024 * 1024
MAX_REDIRECTS = 5
PREVIEW_CHARS = 3000
ERROR_BODY_BYTES = 64 * 1024
TIMEOUT = httpx.Timeout(60.0, connect=10.0)
USER_AGENT = "DataFormulator/1.0 (+https://github.com/microsoft/data-formulator)"
SCRUBBED = "[secret removed]"
_NAME = re.compile(r"[^A-Za-z0-9._-]+")
_TEXT_TYPES = ("json", "text", "xml", "csv", "yaml", "javascript")


class FetchError(ValueError):
    pass


def _scrub(text: str, secrets: list[str]) -> str:
    for value in secrets:
        if value:
            text = text.replace(value, SCRUBBED)
    return text


def _cut(text: str, limit: int, secrets: list[str], more: str = "") -> str:
    """Scrub, then cut to ``limit`` characters; a cut that ends inside a secret drops the part it kept."""
    text = _scrub(text, secrets)
    if len(text) <= limit:
        return text
    head = text[:limit]
    for value in secrets:
        for size in range(min(len(value) - 1, len(head)), 3, -1):
            if head.endswith(value[:size]):
                head = head[:-size] + SCRUBBED
                break
    return head + more


def check_url(spec: SignInSpec, url: str) -> str:
    url = str(url or "").strip()
    if not https_url(url) or host_of(url) not in spec.send_to:
        raise FetchError(f"api_fetch reaches {spec.name} only at https on {', '.join(spec.send_to)}; not {url[:200]!r}.")
    return url


def _file_name(url: str, content_type: str, requested: str | None) -> str:
    if requested:
        name = _NAME.sub("_", Path(str(requested)).name).strip("._")[:120]
        if name:
            return name
    parts = urlsplit(url)
    stem = _NAME.sub("_", parts.path.strip("/").replace("/", "_")).strip("._")[-80:] or "response"
    digest = hashlib.sha256(url.encode()).hexdigest()[:8]
    suffix = Path(stem).suffix
    if not suffix:
        kind = content_type.split(";")[0].strip()
        suffix = ".json" if "json" in kind else (mimetypes.guess_extension(kind) or ".bin") if kind else ".bin"
    else:
        stem = stem[: -len(suffix)]
    return f"{stem}-{digest}{suffix}"


def _is_text(content_type: str) -> bool:
    return any(kind in content_type.lower() for kind in _TEXT_TYPES)


def _preview(data: bytes, content_type: str, secrets: list[str], limit: int = PREVIEW_CHARS) -> str | None:
    """A short text preview of a body's start, with the secret scrubbed before it is cut."""
    if not _is_text(content_type):
        return None
    text = data.decode("utf-8", errors="replace")
    if "json" in content_type.lower():
        try:
            text = json.dumps(json.loads(text), ensure_ascii=False)
        except ValueError:
            pass
    # The start of a longer body may itself end inside a secret: the cut below handles that too.
    return _cut(text, limit, secrets, "… [more in the file]")


def _request(spec: SignInSpec, secret: dict[str, str] | None, url: str, client: httpx.Client,
             resolve: Callable[[str], bool] | None):
    """Open ``url`` (following redirects by hand); returns the final URL and the open response's context manager."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        host = host_of(current)
        own = host in spec.send_to
        if (not own or not spec.verified) and not (resolve or resolves_publicly)(host):
            raise FetchError(f"{host} does not resolve to a public address; not fetched.")
        headers: dict[str, str] = {}
        target = spec.auth.apply(current, headers, secret) if secret and own else current
        response = client.send(client.build_request("GET", target, headers=headers), stream=True)
        if response.is_redirect and response.headers.get("location"):
            following = urljoin(current, response.headers["location"])
            response.close()
            if urlsplit(following).scheme != "https":
                raise FetchError(f"{spec.name} redirected to a non-https address; not followed.")
            current = following
            continue
        return current, response
    raise FetchError(f"{spec.name} redirected more than {MAX_REDIRECTS} times; not followed.")


def api_fetch(url: str, *, spec: SignInSpec, scratch_root: Path, secret: dict[str, str] | None = None,
              login: str | None = None, save_as: str | None = None, transport: httpx.BaseTransport | None = None,
              resolve: Callable[[str], bool] | None = None) -> dict[str, Any]:
    """Fetch ``url`` from the spec's service; returns the observation for the agent (no secret in it, ever)."""
    url = check_url(spec, url)
    secrets = secret_values(secret or {})
    result: dict[str, Any] = {"service": spec.id, "url": url, "signed_in_as": (login or "yes") if secret else None}
    with httpx.Client(transport=transport, timeout=TIMEOUT, follow_redirects=False,
                      headers={"User-Agent": USER_AGENT}) as client:
        try:
            final, response = _request(spec, secret, url, client, resolve)
        except httpx.HTTPError as exc:
            return {**result, "error": f"Could not reach {spec.name} ({type(exc).__name__}). Try again shortly."}
        try:
            observation = _finish(spec, url, final, response, result, scratch_root, save_as, bool(secret), secrets)
        except httpx.HTTPError as exc:
            observation = {**result, "error": f"{spec.name} stopped answering ({type(exc).__name__}). Try again shortly."}
        finally:
            response.close()
    return json.loads(_scrub(json.dumps(observation, ensure_ascii=False, default=str), secrets))


def _finish(spec: SignInSpec, url: str, final: str, response: httpx.Response, result: dict[str, Any],
            scratch_root: Path, save_as: str | None, signed_in: bool, secrets: list[str]) -> dict[str, Any]:
    content_type = response.headers.get("content-type", "")
    result.update(status=response.status_code, content_type=content_type or None)
    if response.status_code >= 400:
        body = b""
        for chunk in response.iter_bytes():
            body += chunk
            if len(body) >= ERROR_BODY_BYTES:
                break
        text = body[:ERROR_BODY_BYTES].decode("utf-8", errors="replace")
        result["error"] = _preview(body, content_type or "text/plain", secrets, 600) or f"HTTP {response.status_code}"
        if response.headers.get("retry-after"):
            result["retry_after"] = response.headers["retry-after"]
        hint = _refusal(spec, response.status_code, text, url, signed_in)
        if hint:
            result["needs_signin"] = {"service": spec.id, **hint}
            result["note"] = _signin_note(spec, hint)
        return result
    length = response.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BYTES:
        return {**result, "error": f"The response is {int(length) / 1e6:,.0f} MB, over api_fetch's "
                                   f"{MAX_BYTES // (1024 * 1024)} MB limit: ask for a smaller part (fewer rows, one file)."}
    folder = Path(scratch_root) / "api" / spec.id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / _file_name(url, content_type, save_as)
    size = 0
    head = b""
    # A body that echoes the secret (some services do) is saved without it, since sandboxed Python reads the file:
    # each copy becomes as many "*" bytes, so a binary format keeps its offsets. The last bytes of each chunk wait
    # for the next, so a copy split across chunks is caught too.
    masks = [(value.encode(), b"*" * len(value.encode())) for value in secrets]
    keep = max((len(value) for value, _ in masks), default=1) - 1
    pending = b""

    def masked(data: bytes) -> bytes:
        for value, mask in masks:
            data = data.replace(value, mask)
        return data

    def write(out, data: bytes) -> None:
        nonlocal head
        if len(head) < PREVIEW_CHARS * 4:
            head += data[: PREVIEW_CHARS * 4 - len(head)]
        out.write(data)

    try:
        with open(path, "wb") as out:
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise FetchError(f"The response passed api_fetch's {MAX_BYTES // (1024 * 1024)} MB limit: "
                                     "ask for a smaller part (fewer rows, one file).")
                data = masked(pending + chunk)
                if keep and len(data) <= keep:
                    pending = data
                    continue
                pending = data[len(data) - keep:] if keep else b""
                write(out, data[: len(data) - keep] if keep else data)
            write(out, masked(pending))
    except FetchError as exc:
        path.unlink(missing_ok=True)
        return {**result, "error": str(exc)}
    result.update(bytes=size, saved=f"scratch/api/{spec.id}/{path.name}")
    if host_of(final) != host_of(url):
        result["served_from"] = host_of(final)
    preview = _preview(head, content_type, secrets)
    if preview is not None:
        result["preview"] = preview
    return result


def _refusal(spec: SignInSpec, status: int, body: str, url: str, signed_in: bool) -> dict[str, Any] | None:
    if spec.refusal is not None:
        return spec.refusal(status, body, url, signed_in)
    if status in (401, 403):
        return {"reason": "rejected" if signed_in else "unauthorized"}
    if status == 429 and not signed_in:
        return {"reason": "rate_limit"}
    return None


def _signin_note(spec: SignInSpec, hint: dict[str, Any]) -> str:
    reason = hint["reason"]
    if reason == "rate_limit":
        return (f"{spec.name} is limiting anonymous requests. Signing in raises the limit to the user's own: "
                f"offer it with propose_signin if more requests are needed, or wait as long as retry_after says.")
    if reason == "terms":
        return ("Signed in, but this account cannot open it: the user must accept its terms on its page "
                "(propose_signin with that step), or it is private.")
    if reason == "rejected":
        return (f"{spec.name} refused the saved sign-in: the key may be wrong, expired or lack access. "
                "Offer a new one with propose_signin if the user needs this.")
    return (f"{spec.name} refused an anonymous request. If the user needs it, offer a sign-in with propose_signin "
            "(and any step on the service's site, such as accepting its terms).")


def probe(spec: SignInSpec, secret: dict[str, str], *, transport: httpx.BaseTransport | None = None,
          resolve: Callable[[str], bool] | None = None) -> str | None:
    """Try a key on the spec's ``check`` URL before keeping it: None when it works, else what went wrong."""
    if not spec.check:
        return None
    with httpx.Client(transport=transport, timeout=TIMEOUT, follow_redirects=False,
                      headers={"User-Agent": USER_AGENT}) as client:
        try:
            _, response = _request(spec, secret, spec.check, client, resolve)
        except httpx.HTTPError as exc:
            return f"Could not reach {host_of(spec.check)} to check the key ({type(exc).__name__}). Try again."
        except FetchError as exc:
            return str(exc)
        status = response.status_code
        response.close()
    if 200 <= status < 300:
        return None
    if status in (401, 403):
        return f"{spec.name} refused that key (HTTP {status}). Check it and try again."
    return f"The check at {host_of(spec.check)} answered HTTP {status}; the key was not kept."
