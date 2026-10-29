# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The Research toolkit's MCP server: search, track and read arXiv papers.

Started by Data Formulator over stdio (``python -m data_formulator.tool_packs.research``). Lists come
back as JSON tables the agent can load with ``create_data``; full texts come back as Markdown (from
arXiv's HTML) or the PDF, which Data Formulator saves to scratch for the agent to read.
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import re
from pathlib import Path
from typing import Any, Literal

from mcp.server import MCPServer
from mcp.types import BlobResourceContents, EmbeddedResource, TextContent, TextResourceContents, ToolAnnotations

from .arxiv import (HTML_URL, PDF_URL, TTL_PAPER, TTL_RECENT, TTL_SEARCH, TTL_VERSIONED, ArxivError, Client, Response,
                    normalize_id)

MAX_LIMIT = 100
MAX_DETAILS = 20
MAX_PERIODS = 20
MAX_FULL_TEXTS = 5

INSTRUCTIONS = """\
Search, track and read arXiv papers (arXiv's own API; no citation counts).
- Lists (search_papers, recent_papers) return a JSON table; load a large one with create_data from the saved file, then chart it.
- count_papers counts submissions per year or month for trends; it takes a few seconds per period.
- For overviews and comparisons, abstracts are usually enough: paper_details reads them for up to 20 ids in one call
  (or pass include_abstracts to a search). Fetch full texts only for the few papers you need in depth.
- get_full_text saves up to 5 papers per call (Markdown, else PDF) to scratch; read them from there. Ask for several at
  once rather than one call per paper.
- Cite papers by arXiv id and link. arXiv limits request rates, so avoid needless repeat calls."""

READ_ONLY = ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True)

_client: Client | None = None


def client() -> Client:
    global _client
    if _client is None:
        _client = Client()
    return _client


# -- query building --

_FIELDS = re.compile(r"\b(ti|au|abs|co|jr|cat|rn|id|all|submittedDate):", re.I)


def _day(value: str, end: bool) -> str:
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
        return day.strftime("%Y%m%d")
    raise ArxivError(f"Use a date like 2024, 2024-05 or 2024-05-17, not {value!r}.")


def _terms(text: str, field: str) -> list[str]:
    words = [word for word in re.findall(r'"[^"]+"|[^\s"]+', text) if word.upper() not in {"AND", "OR", "ANDNOT"}]
    return [f"{field}:{word}" for word in words]


def build_query(query: str = "", title: str = "", author: str = "", category: str = "",
                date_from: str = "", date_to: str = "") -> str:
    """An arXiv ``search_query``: free text (or arXiv's own syntax), title, author, category and dates."""
    parts: list[str] = []
    if query.strip():
        parts.append(f"({query.strip()})" if _FIELDS.search(query) or re.search(r"\b(AND|OR|ANDNOT)\b", query)
                     else " AND ".join(_terms(query, "all")))
    if title.strip():
        parts.append(" AND ".join(_terms(title, "ti")))
    if author.strip():
        parts.append(f'au:"{author.strip()}"' if " " in author.strip() else f"au:{author.strip()}")
    if category.strip():
        categories = [item for item in re.split(r"[\s,]+", category.strip()) if item]
        parts.append("(" + " OR ".join(f"cat:{item}" for item in categories) + ")" if len(categories) > 1 else f"cat:{categories[0]}")
    if date_from or date_to:
        start = _day(date_from, False) if date_from else "19910101"
        end = _day(date_to, True) if date_to else dt.date.today().strftime("%Y%m%d")
        parts.append(f"submittedDate:[{start}0000 TO {end}2359]")
    if not parts:
        raise ArxivError("Give a query, title, author or category.")
    return " AND ".join(parts)


def _row(paper: dict[str, Any], abstracts: bool) -> dict[str, Any]:
    authors = paper["authors"]
    row = {
        "id": paper["id"],
        "title": paper["title"],
        "first_author": authors[0] if authors else None,
        "authors": ", ".join(authors[:5]) + (f" et al. ({len(authors)} authors)" if len(authors) > 5 else ""),
        "published": paper["published"],
        "updated": paper["updated"],
        "year": paper["year"],
        "primary_category": paper["primary_category"],
        "categories": ", ".join(paper["categories"]),
        "url": paper["url"],
    }
    if abstracts:
        row["abstract"] = paper["abstract"]
    return row


def _bounded(limit: int) -> int:
    return max(1, min(MAX_LIMIT, int(limit)))


# -- tools --

app = MCPServer("research", instructions=INSTRUCTIONS)


@app.tool(annotations=READ_ONLY)
def search_papers(query: str = "", title: str = "", author: str = "", category: str = "", date_from: str = "",
                  date_to: str = "", sort: Literal["relevance", "newest", "updated"] = "relevance", limit: int = 25,
                  offset: int = 0, include_abstracts: bool = False) -> dict[str, Any]:
    """Search arXiv papers. `query` is free text (all words must match) or arXiv syntax such as
    `ti:transformer AND cat:cs.CL`; `category` takes ids like cs.HC (several separated by commas);
    dates are submission dates (2024, 2024-05 or 2024-05-17). Returns up to 100 papers per call; page with `offset`."""
    search = build_query(query, title, author, category, date_from, date_to)
    sort_by = {"relevance": "relevance", "newest": "submittedDate", "updated": "lastUpdatedDate"}[sort]
    total, papers = client().query(search_query=search, start=max(0, int(offset)), max_results=_bounded(limit),
                                   sort_by=sort_by, ttl=TTL_SEARCH)
    return {"query": search, "total": total, "offset": offset, "returned": len(papers),
            "papers": [_row(paper, include_abstracts) for paper in papers]}


@app.tool(annotations=READ_ONLY)
def recent_papers(category: str, days: int = 7, query: str = "", limit: int = 50,
                  include_abstracts: bool = False) -> dict[str, Any]:
    """The newest papers in arXiv categories (e.g. cs.HC, or cs.HC,cs.AI) submitted in the last `days` days,
    optionally narrowed by free text. Newest first, up to 100."""
    today = dt.date.today()
    since = today - dt.timedelta(days=max(1, min(int(days), 90)))
    search = build_query(query, category=category, date_from=since.isoformat(), date_to=today.isoformat())
    total, papers = client().query(search_query=search, max_results=_bounded(limit), sort_by="submittedDate", ttl=TTL_RECENT)
    return {"query": search, "total": total, "returned": len(papers),
            "papers": [_row(paper, include_abstracts) for paper in papers]}


@app.tool(annotations=READ_ONLY)
def paper_details(ids: list[str]) -> dict[str, Any]:
    """Full records (abstract, all authors, categories, comment, journal reference, DOI, version, PDF link)
    for up to 20 arXiv ids or links at once."""
    wanted = list(dict.fromkeys(normalize_id(item) for item in ids))[:MAX_DETAILS]
    if not wanted:
        raise ArxivError("Give at least one arXiv id.")
    versioned = all(re.search(r"v\d+$", item) for item in wanted)
    _, papers = client().query(id_list=wanted, max_results=len(wanted), ttl=TTL_VERSIONED if versioned else TTL_PAPER)
    found = {paper["id"] for paper in papers}
    missing = [item for item in wanted if re.sub(r"v\d+$", "", item) not in found]
    return {"papers": papers, **({"not_found": missing} if missing else {})}


def _periods(by: str, date_from: str, date_to: str) -> list[tuple[str, str, str]]:
    start = dt.datetime.strptime(_day(date_from, False), "%Y%m%d").date()
    end = dt.datetime.strptime(_day(date_to, True) if date_to else dt.date.today().strftime("%Y%m%d"), "%Y%m%d").date()
    periods: list[tuple[str, str, str]] = []
    cursor = start.replace(day=1) if by == "month" else start.replace(month=1, day=1)
    while cursor <= end and len(periods) <= MAX_PERIODS:
        if by == "month":
            last = (cursor.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
            label = cursor.strftime("%Y-%m")
        else:
            last = cursor.replace(month=12, day=31)
            label = str(cursor.year)
        periods.append((label, max(cursor, start).isoformat(), min(last, end).isoformat()))
        cursor = last + dt.timedelta(days=1)
    if len(periods) > MAX_PERIODS:
        raise ArxivError(f"Count at most {MAX_PERIODS} periods at a time; narrow the dates or count by year.")
    return periods


@app.tool(annotations=READ_ONLY)
def count_papers(date_from: str, date_to: str = "", by: Literal["year", "month"] = "year", query: str = "",
                 title: str = "", author: str = "", category: str = "") -> dict[str, Any]:
    """How many arXiv papers match, per year or month of submission (up to 20 periods), for trend charts.
    Each period is one arXiv request, a few seconds apart."""
    counts = []
    for label, first, last in _periods(by, date_from, date_to):
        search = build_query(query, title, author, category, first, last)
        total, _ = client().query(search_query=search, max_results=1, ttl=TTL_SEARCH)
        counts.append({by: label, "papers": total})
    return {"by": by, "filters": {key: value for key, value in
                                  {"query": query, "title": title, "author": author, "category": category}.items() if value},
            "counts": counts}


def html_to_markdown(html: bytes) -> str | None:
    """Readable Markdown from an arXiv (LaTeXML) HTML paper, or None when the page is not a paper."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one(".ltx_page_main") or soup.select_one("article.ltx_document")
    if main is None:
        return None
    for noise in main.select("script, style, nav, .ltx_page_footer, .ltx_TOC, .ltx_note_mark, .ltx_tag_note"):
        noise.decompose()
    for math in main.find_all("math"):
        math.replace_with(f" ${math.get('alttext', '').strip()}$ ")
    blocks = main.select("h1, h2, h3, h4, h5, h6, p, figcaption, li.ltx_bibitem, table.ltx_tabular, div.ltx_abstract > p")
    chosen = set(map(id, blocks))
    lines: list[str] = []
    for block in blocks:
        if any(id(parent) in chosen for parent in block.parents):
            continue
        if block.name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            text = " ".join(block.get_text(" ").split())
            lines.append(f"{'#' * int(block.name[1])} {text}")
        elif block.name == "table":
            rows = [" | ".join(" ".join(cell.get_text(" ").split()) for cell in row.find_all(["td", "th"]))
                    for row in block.find_all("tr")]
            lines.append("\n".join(row for row in rows if row.strip()))
        elif block.name == "figcaption":
            lines.append(f"_{' '.join(block.get_text(' ').split())}_")
        elif block.name == "li":
            lines.append(f"- {' '.join(block.get_text(' ').split())}")
        else:
            lines.append(" ".join(block.get_text(" ").split()))
    # Text before the title is leftover LaTeX setup (macros, conference categories).
    first_heading = next((index for index, line in enumerate(lines) if line.startswith("# ")), 0)
    text = "\n\n".join(line for line in lines[first_heading:] if line.strip())
    return re.sub(r"\$\s*\$", "", text) or None


@app.tool(annotations=READ_ONLY)
def get_full_text(paper_ids: list[str], prefer: Literal["html", "pdf"] = "html") -> list[TextContent | EmbeddedResource]:
    """Up to 5 papers themselves: arXiv's HTML version as Markdown (math as LaTeX), or the PDF when there is no
    HTML or `prefer` is "pdf". Data Formulator saves each to scratch for reading."""
    papers = list(dict.fromkeys(normalize_id(item) for item in paper_ids))
    if not papers:
        raise ArxivError("Give at least one arXiv id.")
    if len(papers) > MAX_FULL_TEXTS:
        raise ArxivError(f"Fetch at most {MAX_FULL_TEXTS} full texts per call; read abstracts (paper_details) to choose them.")
    content: list[TextContent | EmbeddedResource] = []
    for paper in papers:
        content.extend(_full_text(paper, prefer))
    return content


def _full_text(paper: str, prefer: str) -> list[TextContent | EmbeddedResource]:
    ttl = TTL_VERSIONED if re.search(r"v\d+$", paper) else TTL_PAPER
    if prefer == "html":
        try:
            markdown = html_to_markdown(client().get(HTML_URL.format(id=paper), ttl=ttl).content)
        except ArxivError:
            markdown = None  # no HTML version: the PDF follows
        if markdown:
            return [TextContent(type="text", text=f"Full text of arXiv:{paper} ({len(markdown):,} characters, from arXiv's HTML)."),
                    EmbeddedResource(type="resource", resource=TextResourceContents(
                        uri=f"https://arxiv.org/html/{paper}", mime_type="text/markdown", text=markdown))]
    response = _pdf(paper, ttl)
    return [TextContent(type="text", text=f"PDF of arXiv:{paper} ({len(response.content):,} bytes)."),
            EmbeddedResource(type="resource", resource=BlobResourceContents(
                uri=f"https://arxiv.org/pdf/{paper}.pdf", mime_type="application/pdf",
                blob=base64.b64encode(response.content).decode()))]


def _pdf(paper: str, ttl: float | None) -> Response:
    response = client().get(PDF_URL.format(id=paper), ttl=ttl, accept=lambda reply: reply.content[:5] == b"%PDF-")
    return response


def main(argv: list[str] | None = None) -> None:
    global _client
    parser = argparse.ArgumentParser(description="Data Formulator's Research toolkit (arXiv) as an MCP server.")
    parser.add_argument("--email", default="", help="Contact address sent to arXiv with each request.")
    parser.add_argument("--cache", default="", help="Directory for cached arXiv responses.")
    options = parser.parse_args(argv)
    _client = Client(Path(options.cache).expanduser() if options.cache else None, options.email or None)
    app.run("stdio")
