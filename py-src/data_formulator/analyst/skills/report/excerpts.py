# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Report excerpts, checked against the sources they quote.

A report quotes a source in an excerpt block::

    :::excerpt{source="files/paper.pdf" page=4 title="Madaan et al. 2023"}
    The exact words from the source.
    :::

After ``write_report`` delivers, each excerpt whose ``source`` is a session file
(``files/``, ``scratch/``, ``session/``) is looked up in that file's text. The
comparison keeps only letters and digits, so Markdown, spacing, and PDF line
breaks don't matter; ``…`` marks omitted text. The results go to the agent in the
action's observation (the reader sees only the source, which opens near the quote).
"""

from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from data_formulator.analyst import session_fs

OPENER = re.compile(r"^(:{3,})\s*([A-Za-z][\w-]*)\s*(?:\{(.*)\})?\s*$")
CLOSER = re.compile(r"^:{3,}\s*$")
ATTR = re.compile(r"""([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))""")
EXCERPT_NAMES = {"excerpt", "quote"}
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_CITE = re.compile(r"\[\^[^\]\s]+\]")
_ELLIPSIS = re.compile(r"\[?(?:\.\.\.|…)\]?")
_WORD = re.compile(r"\w+")

MIN_SEGMENT = 8          # shorter pieces between ellipses are too common to check
SHINGLE = 4              # words per shingle for the near-match test
CLOSE_SHARE = 0.9        # share of the quote found, in order, in the closest passage for a near match
PDF_MAX_PAGES = 80
SNIPPET_CHARS = 320


@dataclass
class Excerpt:
    line: int
    attrs: dict[str, str]
    text: str


@dataclass
class ExcerptCheck:
    excerpt: Excerpt
    status: str                      # verified | close | not_found | unchecked
    reason: str | None = None        # why unchecked, or where it was found instead
    closest: str | None = None       # the nearest passage when not found


def parse_attrs(text: str | None) -> dict[str, str]:
    if not text:
        return {}
    return {match.group(1).lower(): next(group for group in match.groups()[1:] if group is not None)
            for match in ATTR.finditer(text)}


def find_excerpts(markdown: str) -> list[Excerpt]:
    """The excerpt blocks of a Markdown report, with their attributes and inner text."""
    excerpts: list[Excerpt] = []
    stack: list[tuple[str, int, dict[str, str], list[str]]] = []

    def close(frame: tuple[str, int, dict[str, str], list[str]]) -> None:
        name, line, attrs, lines = frame
        if name in EXCERPT_NAMES:
            excerpts.append(Excerpt(line, attrs, "\n".join(lines).strip()))

    for number, line in enumerate(markdown.splitlines(), start=1):
        stripped = line.strip()
        opener = OPENER.match(stripped)
        if opener:
            stack.append((opener.group(2).lower(), number, parse_attrs(opener.group(3)), []))
        elif CLOSER.match(stripped) and stack:
            close(stack.pop())
        else:
            for frame in stack:
                frame[3].append(line)
    while stack:
        close(stack.pop())
    return sorted(excerpts, key=lambda excerpt: excerpt.line)


def _plain(text: str) -> str:
    return unicodedata.normalize("NFKC", html.unescape(_LINK.sub(r"\1", _CITE.sub("", text)))).lower()


def compact(text: str) -> str:
    """Letters and digits only, lowercased: the form excerpts are compared in."""
    return "".join(ch for ch in _plain(text) if ch.isalnum())


def _segments(text: str) -> list[str]:
    pieces = [compact(piece) for piece in _ELLIPSIS.split(text)]
    return [piece for piece in pieces if len(piece) >= MIN_SEGMENT]


def _contains_in_order(haystack: str, segments: list[str]) -> bool:
    position = 0
    for segment in segments:
        found = haystack.find(segment, position)
        if found < 0:
            return False
        position = found + len(segment)
    return True


def _shingles(words: list[str]) -> set[tuple[str, ...]]:
    return {tuple(words[i:i + SHINGLE]) for i in range(len(words) - SHINGLE + 1)}


def _near(quote: str, source: str) -> tuple[float, str | None]:
    """The source passage that shares the most wording with the quote, and the share of the quote
    (letters and digits, in order) found in it: 0..1."""
    quote_words = _WORD.findall(_plain(_ELLIPSIS.sub(" ", quote)))
    if len(quote_words) < SHINGLE:
        return 0.0, None
    wanted = _shingles(quote_words)
    plain = _plain(source)
    spans = [(match.start(), match.end(), match.group()) for match in _WORD.finditer(plain)]
    words = [word for _, _, word in spans]
    hits = [i for i in range(len(words) - SHINGLE + 1) if tuple(words[i:i + SHINGLE]) in wanted]
    if not hits:
        return 0.0, None
    width = len(quote_words) + SHINGLE
    best_start, best_count, left = hits[0], 0, 0
    for right, position in enumerate(hits):
        while position - hits[left] > width:
            left += 1
        if right - left + 1 > best_count:
            best_start, best_count = hits[left], right - left + 1
    first = max(best_start - SHINGLE, 0)
    start = spans[first][0]
    end = spans[min(best_start + width, len(spans) - 1)][1]
    passage = plain[start:end]
    wanted_text = compact(_ELLIPSIS.sub(" ", quote))
    matcher = SequenceMatcher(None, wanted_text, compact(passage), autojunk=False)
    share = sum(block.size for block in matcher.get_matching_blocks()) / max(len(wanted_text), 1)
    snippet = " ".join(passage.split())
    return share, snippet[:SNIPPET_CHARS] + ("…" if len(snippet) > SNIPPET_CHARS else "")


def _pdf_pages(files: Any, path: str) -> list[str]:
    reader = session_fs.pdf_reader(files._raw(path))
    return [(page.extract_text() or "") for page in reader.pages[:PDF_MAX_PAGES]]


def _page_number(value: str | None) -> int | None:
    match = re.search(r"\d+", value or "")
    return int(match.group()) if match else None


def check_excerpt(excerpt: Excerpt, files: Any) -> ExcerptCheck:
    source = (excerpt.attrs.get("source") or "").strip()
    segments = _segments(excerpt.text)
    if not source:
        return ExcerptCheck(excerpt, "unchecked", "it names no source")
    if re.match(r"https?://", source, re.I):
        return ExcerptCheck(excerpt, "unchecked", "its source is a web link; cite the session file you read to have it checked")
    if not segments:
        return ExcerptCheck(excerpt, "unchecked", "it is too short to check")
    try:
        if session_fs.kind_of(source) == "PDF":
            pages = _pdf_pages(files, source)
            page = _page_number(excerpt.attrs.get("page"))
            if page and 1 <= page <= len(pages):
                around = "\n".join(pages[max(page - 2, 0):page + 1])
                if _contains_in_order(compact(around), segments):
                    return ExcerptCheck(excerpt, "verified")
            for number, text in enumerate(pages, start=1):
                if _contains_in_order(compact(text), segments):
                    where = f"found on page {number}" + (f", not page {page}" if page else "")
                    return ExcerptCheck(excerpt, "verified", where if page else None)
            text = "\n".join(pages)
        else:
            text = files.text(source)
    except FileNotFoundError:
        return ExcerptCheck(excerpt, "unchecked", f"{source} does not exist")
    except ValueError as error:
        return ExcerptCheck(excerpt, "unchecked", f"{source} could not be read: {error}")
    if _contains_in_order(compact(text), segments):
        return ExcerptCheck(excerpt, "verified")
    share, closest = _near(excerpt.text, text)
    if share >= CLOSE_SHARE:
        return ExcerptCheck(excerpt, "close", "close to the source wording, not exact", closest)
    return ExcerptCheck(excerpt, "not_found", None, closest)


def check_report_excerpts(markdown: str, files: Any) -> list[ExcerptCheck]:
    return [check_excerpt(excerpt, files) for excerpt in find_excerpts(markdown)]


def _preview(text: str, limit: int = 70) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[:limit].rstrip() + "…"


def summarize_checks(checks: list[ExcerptCheck]) -> str | None:
    """The observation line for the agent; None when the report has no excerpts."""
    if not checks:
        return None
    problems = [check for check in checks if check.status != "verified" or check.reason]
    counts = {status: sum(check.status == status for check in checks)
              for status in ("verified", "close", "not_found", "unchecked")}
    summary = ", ".join(f"{count} {label}" for status, label in
                        (("verified", "match their sources"), ("close", "are close but not exact"),
                         ("not_found", "were not found in their sources"), ("unchecked", "could not be checked"))
                        if (count := counts[status]))
    lines = [f"[EXCERPTS] {len(checks)} excerpt(s): {summary}."]
    for check in problems:
        head = f'- line {check.excerpt.line} ("{_preview(check.excerpt.text)}")'
        source = check.excerpt.attrs.get("source")
        if check.status == "not_found":
            lines.append(f"{head} is not in {source}"
                         + (f'; the closest passage is: "{check.closest}"' if check.closest else ""))
        elif check.status == "close":
            lines.append(f"{head} is close to {source} but not exact"
                         + (f'; the source reads: "{check.closest}"' if check.closest else ""))
        elif check.status == "unchecked":
            lines.append(f"{head} was not checked: {check.reason}")
        else:
            lines.append(f"{head} was {check.reason}")
    if counts["not_found"] or counts["close"]:
        lines.append("An excerpt must be the source's exact words (mark omissions with …). "
                     "Tell the user which excerpts are not verbatim in your reply.")
    return "\n".join(lines)
