# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A polite arXiv client: its API for search and metadata, its HTML and PDF for full text.

arXiv asks automated clients for at most one request every three seconds over a single connection,
and blocks clients that burst or do not identify themselves. Every request here goes through one
connection, spaced at least ``MIN_INTERVAL`` apart, with a descriptive User-Agent; it retries
server errors and timeouts with backoff, retries the API's known "results but no entries" glitch,
and caches responses on disk so repeated work does not reach arXiv.

When arXiv throttles (HTTP 429 "Rate exceeded."), it usually sends no ``Retry-After``, answers
slowly or not at all for a while, and every further request keeps the limit in place. So a 429
without a short ``Retry-After`` is not retried: the client stops asking for ``RATE_LIMIT_COOLDOWN``
and says so at once (cached answers still come back); each further 429 in a row doubles the
cooldown, up to ``MAX_COOLDOWN``. One call never retries past ``CALL_BUDGET``.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import httpx
from mcp.server.mcpserver.exceptions import ToolError

API_URL = "https://export.arxiv.org/api/query"
ABS_URL = "https://arxiv.org/abs/{id}"
HTML_URL = "https://arxiv.org/html/{id}"
PDF_URL = "https://export.arxiv.org/pdf/{id}"
MIN_INTERVAL = 3.0
RETRIES = 4
MAX_WAIT = 60.0
RETRY_STATUSES = {500, 502, 503, 504}
RATE_LIMIT_COOLDOWN = 120.0  # how long to stop asking after a 429 that names no shorter wait…
MAX_COOLDOWN = 900.0         # …doubling for each 429 in a row, up to this
CALL_BUDGET = 120.0          # the most one call spends waiting for and retrying arXiv
READ_TIMEOUT = 30.0

# How long cached responses stay fresh.
TTL_SEARCH = 24 * 3600
TTL_RECENT = 3600
TTL_PAPER = 7 * 24 * 3600
TTL_VERSIONED = None  # a specific version never changes

_NS = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom",
       "opensearch": "http://a9.com/-/spec/opensearch/1.1/"}
_ID = re.compile(r"(?:arxiv:|https?://(?:export\.)?arxiv\.org/(?:abs|pdf|html)/)?"
                 r"(?P<id>\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)(?:\.pdf)?/?$", re.I)


class ArxivError(ToolError):
    """A failure the agent should read. The MCP SDK shows a ``ToolError``'s message to the model;
    any other exception reaches it only as "Error executing tool <name>"."""


def normalize_id(value: str) -> str:
    """An arXiv identifier from an id, ``arXiv:`` reference or abs/pdf/html URL (version kept if given)."""
    text = str(value or "").strip()
    if text.lower().startswith("https://doi.org/10.48550/arxiv."):
        text = text[len("https://doi.org/10.48550/arxiv."):]
    elif text.lower().startswith("10.48550/arxiv."):
        text = text[len("10.48550/arxiv."):]
    match = _ID.search(text)
    if not match:
        raise ArxivError(f"Not an arXiv identifier: {value!r}. Use an id like 2309.10305 or an arxiv.org link.")
    return match.group("id")


@dataclass
class Response:
    status: int
    content: bytes
    headers: dict[str, str] = field(default_factory=dict)
    url: str = ""


class Client:
    """One connection to arXiv, spaced, retried and cached."""

    def __init__(self, cache_dir: Path | None = None, email: str | None = None, *,
                 transport: httpx.BaseTransport | None = None, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic, min_interval: float = MIN_INTERVAL) -> None:
        contact = f"; mailto:{email}" if email else ""
        self.user_agent = f"DataFormulator-Research/1.0 (+https://github.com/microsoft/data-formulator{contact})"
        self.cache_dir = cache_dir
        self.min_interval = min_interval
        self._sleep, self._clock = sleep, clock
        self._lock = threading.Lock()
        self._last = -1e9
        self._blocked_until = -1e9
        self._cooldown = RATE_LIMIT_COOLDOWN
        self._http = httpx.Client(headers={"User-Agent": self.user_agent}, follow_redirects=True, transport=transport,
                                  timeout=httpx.Timeout(READ_TIMEOUT, connect=10.0), limits=httpx.Limits(max_connections=1))

    # -- cache --

    def _cache_path(self, url: str) -> Path | None:
        if not self.cache_dir:
            return None
        return self.cache_dir / hashlib.sha256(url.encode()).hexdigest()[:40]

    def _cached(self, url: str, ttl: float | None) -> Response | None:
        path = self._cache_path(url)
        if not path or not path.exists():
            return None
        try:
            meta = json.loads(path.with_suffix(".json").read_text())
            if ttl is not None and time.time() - meta["at"] > ttl:
                return None
            return Response(200, path.read_bytes(), meta.get("headers", {}), meta.get("url", url))
        except (OSError, ValueError, KeyError):
            return None

    def _store(self, url: str, response: Response) -> None:
        path = self._cache_path(url)
        if not path:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(response.content)
            keep = {key: value for key, value in response.headers.items() if key.lower() == "content-type"}
            path.with_suffix(".json").write_text(json.dumps({"at": time.time(), "url": response.url, "headers": keep}))
        except OSError:
            pass

    # -- requests --

    def _wait_turn(self) -> None:
        wait = self._last + self.min_interval - self._clock()
        if wait > 0:
            self._sleep(wait)

    def get(self, url: str, params: dict[str, Any] | None = None, *, ttl: float | None = TTL_SEARCH,
            accept: Callable[[Response], bool] | None = None, use_cache: bool = True) -> Response:
        """GET ``url`` politely. ``accept`` may reject a 200 response as a glitch worth retrying."""
        full = str(httpx.URL(url, params=params or {}))
        if use_cache and (hit := self._cached(full, ttl)) is not None:
            return hit
        last_error = "no response"
        with self._lock:
            if (remaining := self._blocked_until - self._clock()) > 0:
                raise ArxivError(_rate_limited(remaining))
            deadline = self._clock() + CALL_BUDGET
            tries = 0
            for attempt in range(RETRIES):
                self._wait_turn()
                tries += 1
                retry_after: float | None = None
                try:
                    reply = self._http.get(full)
                    response = Response(reply.status_code, reply.content, dict(reply.headers), str(reply.url))
                except httpx.HTTPError as exc:
                    response = None
                    last_error = f"{type(exc).__name__}: {exc}"
                finally:
                    self._last = self._clock()
                if response is not None:
                    if response.status == 200 and (accept is None or accept(response)):
                        self._cooldown = RATE_LIMIT_COOLDOWN
                        self._store(full, response)
                        return response
                    if response.status == 200:
                        last_error = "arXiv returned an empty page"
                    elif response.status == 429:
                        retry_after = _retry_after(response.headers.get("retry-after") or response.headers.get("Retry-After"))
                        if retry_after is None or retry_after > MAX_WAIT:
                            self._blocked_until = self._clock() + (retry_after or self._cooldown)
                            self._cooldown = min(self._cooldown * 2, MAX_COOLDOWN)
                            raise ArxivError(_rate_limited(self._blocked_until - self._clock()))
                        last_error = "HTTP 429"
                    elif response.status in RETRY_STATUSES:
                        last_error = f"HTTP {response.status}"
                        retry_after = _retry_after(response.headers.get("retry-after") or response.headers.get("Retry-After"))
                    else:
                        raise ArxivError(f"arXiv answered HTTP {response.status} for {full}.")
                if attempt < RETRIES - 1:
                    backoff = retry_after if retry_after is not None else self.min_interval * (2 ** attempt)
                    wait = min(MAX_WAIT, backoff) + random.uniform(0, 1)
                    # No attempt starts that could not finish (wait, then a full read timeout) in budget.
                    if self._clock() + wait + READ_TIMEOUT > deadline:
                        break
                    self._sleep(wait)
        raise ArxivError(f"arXiv did not respond after {tries} tries ({last_error}). It may be busy; try again in a minute.")

    # -- API --

    def query(self, *, search_query: str | None = None, id_list: list[str] | None = None, start: int = 0,
              max_results: int = 25, sort_by: str | None = None, sort_order: str = "descending",
              ttl: float | None = TTL_SEARCH) -> tuple[int, list[dict[str, Any]]]:
        """Run an API query; returns (total results, papers)."""
        params: dict[str, Any] = {"start": start, "max_results": max(1, max_results)}
        if search_query:
            params["search_query"] = search_query
        if id_list:
            params["id_list"] = ",".join(id_list)
        if sort_by:
            params.update(sortBy=sort_by, sortOrder=sort_order)

        def complete(response: Response) -> bool:
            # The API sometimes reports results but sends no entries; ask again.
            try:
                total, entries = parse_feed(response.content)
            except ArxivError:
                return True
            return bool(entries) or total <= start

        response = self.get(API_URL, params, ttl=ttl, accept=complete)
        return parse_feed(response.content)

    def close(self) -> None:
        self._http.close()


def _retry_after(value: str | None) -> float | None:
    try:
        return max(0.0, float(value)) if value else None
    except ValueError:
        return None


def _rate_limited(seconds: float) -> str:
    return (f"arXiv is rate-limiting requests from this computer (HTTP 429 \"Rate exceeded.\"). Wait about "
            f"{max(1, round(seconds))} seconds before asking arXiv again: every request meanwhile, from this tool or a "
            "script, keeps the limit in place. Queries answered before are still served from the cache.")


def _text(element: ET.Element | None) -> str:
    return " ".join((element.text or "").split()) if element is not None else ""


def parse_feed(content: bytes) -> tuple[int, list[dict[str, Any]]]:
    """Parse an API Atom feed into (total results, papers)."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise ArxivError(f"arXiv sent an unreadable answer ({exc}).") from None
    total = int(_text(root.find("opensearch:totalResults", _NS)) or 0)
    papers = []
    for entry in root.findall("atom:entry", _NS):
        entry_id = _text(entry.find("atom:id", _NS))
        if _text(entry.find("atom:title", _NS)) == "Error" and "api/errors" in entry_id:
            raise ArxivError(f"arXiv rejected the query: {_text(entry.find('atom:summary', _NS))}")
        versioned = entry_id.rsplit("/abs/", 1)[-1]
        base = re.sub(r"v\d+$", "", versioned)
        authors = [_text(author.find("atom:name", _NS)) for author in entry.findall("atom:author", _NS)]
        primary = entry.find("arxiv:primary_category", _NS)
        categories = [item.get("term", "") for item in entry.findall("atom:category", _NS)]
        published = _text(entry.find("atom:published", _NS))
        paper = {
            "id": base,
            "version": versioned[len(base):] or None,
            "title": _text(entry.find("atom:title", _NS)),
            "authors": authors,
            "published": published[:10],
            "updated": _text(entry.find("atom:updated", _NS))[:10],
            "year": int(published[:4]) if published[:4].isdigit() else None,
            "primary_category": primary.get("term") if primary is not None else (categories[0] if categories else None),
            "categories": categories,
            "abstract": _text(entry.find("atom:summary", _NS)),
            "comment": _text(entry.find("arxiv:comment", _NS)) or None,
            "journal_ref": _text(entry.find("arxiv:journal_ref", _NS)) or None,
            "doi": _text(entry.find("arxiv:doi", _NS)) or None,
            "url": ABS_URL.format(id=base),
            "pdf_url": f"https://arxiv.org/pdf/{versioned}",
        }
        papers.append(paper)
    return total, papers
