# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Formats, table rows and search over the session's files (design-docs/65).

``SessionFiles`` (session_files.py) lists the session's paths; this module knows what is behind each one:
a table (a session table's parquet file, or a parquet, Excel or CSV file), a PDF, or text. It renders table
rows as flat tables, reads PDF pages, and searches every kind of content with one rule: every word of the
query must appear in the same row, line, name or description ("a quoted phrase" exactly, or a regex).
"""

from __future__ import annotations

import fnmatch
import io
import json
import logging
import math
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any, Callable, Iterable

if TYPE_CHECKING:
    import pandas as pd

    from data_formulator.analyst.session_files import SessionFiles

logger = logging.getLogger(__name__)

ROW_LIMIT = 200            # rows per read
READ_BUDGET = 20_000       # characters per read item
READ_CELL = 300            # characters per cell when reading rows
SEARCH_CELL = 120          # characters per cell in search results
SNIPPET = 160              # characters around a match in a long cell or description
WIDE_ROW = 600             # a rendered search row wider than this gets a column window
MAX_INDEX_COLUMNS = 3
SAMPLE_VALUES = 6
PDF_WHOLE_PAGES = 10       # a PDF this short is read whole
PDF_FIRST_PAGES = 5        # else its first pages, with a notice
PDF_MAX_PAGES = 20         # pages per read
PDF_MAX_CHARS = 200_000    # extracted text searched per PDF
SEARCH_TEXT_BYTES = 20_000_000

TABLE_SUFFIXES = (".parquet", ".xlsx", ".xls", ".csv")
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".svg", ".heic")
BINARY_SUFFIXES = (".zip", ".gz", ".tar", ".7z", ".doc", ".pptx", ".ppt", ".odt", ".rtf", ".epub",
                   ".feather", ".arrow", ".sqlite", ".db", ".pkl", ".npy", ".npz", ".bin", ".exe", ".so", ".dll")
_ID_NAME = re.compile(r"(^|[_\s])(id|code|key|iso\d*)$|^id[_\s]|^name$|^title$", re.IGNORECASE)

# What each kind of path accepts in read_file, and what the warning says when a parameter does not fit.
PARAMS_BY_KIND: dict[str, tuple[str, ...]] = {
    "table": ("rows", "columns"), "Excel": ("rows", "columns", "sheet"), "data file": ("rows", "columns"),
    "CSV": ("offset", "limit", "rows", "columns"), "PDF": ("pages",),
}
UNIT_PARAMS = ("offset", "limit", "rows", "columns", "sheet", "pages")


def kind_of(path: str) -> str:
    """What a session path holds: table, chart, report, thread, reference, index, workflow, schedules, PDF, Excel,
    data file, CSV, Word, app, image, binary, or text."""
    lower = path.lower()
    if lower.startswith("sources/"):
        return "source" if lower.count("/") <= 1 or lower.endswith("/") else "source table"
    if lower.startswith("workflows/"):
        return "schedules" if lower == "workflows/schedules.json" else "workflow"
    if lower.startswith("session/"):
        folder = lower[len("session/"):].split("/", 1)[0]
        return {"tables": "table", "charts": "chart", "reports": "report", "threads": "thread",
                "references": "reference", "index.md": "index"}.get(folder, "text")
    suffix = PurePosixPath(lower).suffix
    if lower.endswith((".app.jsx", ".html")):
        return "app"
    if suffix == ".pdf":
        return "PDF"
    if suffix in (".xlsx", ".xls"):
        return "Excel"
    if suffix == ".parquet":
        return "data file"
    if suffix == ".csv":
        return "CSV"
    if suffix == ".docx":
        return "Word"
    if suffix in IMAGE_SUFFIXES:
        return "image"
    if suffix in BINARY_SUFFIXES:
        return "binary"
    return "text"


def parse_range(value: Any, unit: str) -> tuple[int, int | None]:
    """``"10-20"`` / ``"10"`` / ``"10-"`` / ``10`` -> (first, last or None), 1-based and inclusive."""
    text = str(value).strip()
    match = re.fullmatch(r"(\d+)\s*(?:-\s*(\d*))?", text)
    if not match:
        raise ValueError(f'{unit} is a range such as "1-50" or "120"')
    first = int(match.group(1))
    last = int(match.group(2)) if match.group(2) else (None if "-" in text else first)
    if first < 1 or (last is not None and last < first):
        raise ValueError(f'{unit} is a range of positive numbers such as "1-50"')
    return first, last


# ── matching ──────────────────────────────────────────────────────────────


class Matcher:
    """Every word must appear (case-insensitive, any order); "a quoted phrase" exactly; or a regex."""

    def __init__(self, query: str, regex: bool = False):
        if not isinstance(query, str) or not query.strip():
            raise ValueError("query is required")
        self.query = query.strip()
        self.regex = bool(regex)
        if self.regex:
            try:
                self.pattern = re.compile(self.query, re.IGNORECASE)
            except re.error as error:
                raise ValueError(f"Invalid regular expression: {error}") from None
            self.terms: list[str] = []
        else:
            self.terms = [phrase or word for phrase, word in re.findall(r'"([^"]+)"|(\S+)', self.query.casefold())]
            self.terms = [term for term in self.terms if term]
            if not self.terms:
                raise ValueError("query is required")
            # A word matches at the start of a word ("school" matches "schools", not "without" for "out");
            # phrases and words in other scripts match anywhere.
            self._word_start = {term: re.compile(r"(?<![a-z0-9])" + re.escape(term))
                                for term in self.terms if re.fullmatch(r"[a-z0-9]+", term)}

    def matches(self, text: Any) -> bool:
        text = "" if text is None else str(text)
        if self.regex:
            return bool(self.pattern.search(text))
        folded = text.casefold()
        return all(self._found(term, folded) for term in self.terms)

    def _found(self, term: str, folded: str) -> bool:
        pattern = self._word_start.get(term)
        return bool(pattern.search(folded)) if pattern is not None else term in folded

    def touches(self, text: Any) -> bool:
        """Some word appears (to tell which cells of a matching row matched)."""
        text = "" if text is None else str(text)
        if self.regex:
            return bool(self.pattern.search(text))
        folded = text.casefold()
        return any(self._found(term, folded) for term in self.terms)

    def first_position(self, text: str) -> int:
        if self.regex:
            found = self.pattern.search(text)
            return found.start() if found else -1
        folded = text.casefold()
        positions = []
        for term in self.terms:
            pattern = self._word_start.get(term)
            found = pattern.search(folded) if pattern is not None else None
            position = found.start() if found else (folded.find(term) if pattern is None else -1)
            if position >= 0:
                positions.append(position)
        return min(positions) if positions else -1

    def sql(self, columns: list[str]) -> tuple[str, list[Any]]:
        """A DuckDB condition that a row matches, with its parameters."""
        cells = [f'CAST("{column.replace(chr(34), chr(34) * 2)}" AS VARCHAR)' for column in columns]
        if not cells:
            return "FALSE", []
        if self.regex:
            return "(" + " OR ".join(f"coalesce(regexp_matches({cell}, ?), FALSE)" for cell in cells) + ")", \
                ["(?i)" + self.query] * len(cells)
        hay = "lower(concat_ws(' ', " + ", ".join(cells) + "))"
        conditions, parameters = [], []
        for term in self.terms:
            if term in self._word_start:
                # The substring test is cheap and rules out most rows before the word-start regex runs.
                conditions.append(f"(contains({hay}, ?) AND regexp_matches({hay}, ?))")
                parameters += [term, "(^|[^a-z0-9])" + re.escape(term)]
            else:
                conditions.append(f"contains({hay}, ?)")
                parameters.append(term)
        return "(" + " AND ".join(conditions) + ")", parameters


# ── cells and tables ─────────────────────────────────────────────────────


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        if math.isnan(value):
            return ""
        return format(value, ".10g")
    try:
        import pandas as pd
        if value is pd.NaT or (not isinstance(value, (str, bytes, list, dict, tuple)) and pd.isna(value)):
            return ""
    except (TypeError, ValueError):
        pass
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return " ".join(str(value).split())


def clip(text: str, limit: int, around: int = -1) -> str:
    if len(text) <= limit:
        return text
    if around < 0:
        return text[:limit - 1] + "…"
    start = max(min(around - limit // 3, len(text) - limit + 1), 0)
    return ("…" if start else "") + text[start:start + limit - 2] + "…"


def render_table(columns: list[str], rows: list[tuple[int, dict[str, Any]]], cell_limit: int,
                 matcher: Matcher | None = None, budget: int | None = None) -> tuple[str, int]:
    """A flat table, header once, every value in every row; returns (text, rows rendered)."""
    def escape(text: str) -> str:
        return text.replace("|", "\\|")

    lines = ["| row | " + " | ".join(escape(str(column)) for column in columns) + " |"]
    used, count = len(lines[0]), 0
    for number, record in rows:
        cells = []
        for column in columns:
            text = cell_text(record.get(column))
            around = matcher.first_position(text) if matcher is not None and len(text) > cell_limit else -1
            cells.append(escape(clip(text, cell_limit, around)))
        line = f"| {number} | " + " | ".join(cells) + " |"
        if budget is not None and count and used + len(line) + 1 > budget:
            break
        lines.append(line)
        used += len(line) + 1
        count += 1
    return "\n".join(lines), count


@dataclass
class TableSource:
    """A table behind a path: a session table's parquet file, or a parquet, Excel or CSV file."""

    path: str
    name: str = ""
    display: str = ""
    description: str = ""
    column_descriptions: dict[str, str] = field(default_factory=dict)
    python_file: str = ""
    code: str = ""                       # the code that derived it, searched with the table
    parquet: Path | None = None
    frame: Callable[[], "pd.DataFrame"] | None = None
    sheet: str | None = None
    _columns: list[str] | None = None
    _count: int | None = None

    @property
    def has_rows(self) -> bool:
        return self.parquet is not None or self.frame is not None

    def connect(self):
        """(connection, FROM clause, row-number column) with a 0-based row position column."""
        import duckdb
        con = duckdb.connect()
        if self.parquet is not None:
            path = str(self.parquet).replace("'", "''")
            return con, f"read_parquet('{path}', file_row_number=true)", "file_row_number"
        import numpy as np
        frame = self.frame() if self.frame is not None else None
        if frame is None:
            raise ValueError(f"{self.path} has no readable rows")
        frame = frame.reset_index(drop=True)
        frame.columns = [str(column) for column in frame.columns]
        con.register("source_frame", frame.assign(__df_row=np.arange(len(frame))))
        return con, "source_frame", "__df_row"

    def columns(self) -> list[str]:
        if self._columns is None:
            con, source, row_column = self.connect()
            try:
                names = [row[0] for row in con.execute(f"DESCRIBE SELECT * FROM {source}").fetchall()]
            finally:
                con.close()
            self._columns = [name for name in names if name != row_column]
        return self._columns

    def row_count(self) -> int:
        if self._count is None:
            con, source, _ = self.connect()
            try:
                self._count = int(con.execute(f"SELECT count(*) FROM {source}").fetchone()[0])
            finally:
                con.close()
        return self._count

    def _select(self, columns: list[str]) -> str:
        return ", ".join('"' + column.replace('"', '""') + '"' for column in columns)

    def read_rows(self, rows: Any, columns: list[str] | None = None) -> dict[str, Any]:
        """Rows ``rows`` ("1790-1800"), optionally only ``columns``, as a flat table."""
        first, last = parse_range(rows, "rows")
        names = self.columns()
        if columns:
            if not isinstance(columns, list) or not all(isinstance(column, str) for column in columns):
                raise ValueError("columns is a list of column names")
            unknown = [column for column in columns if column not in names]
            if unknown:
                raise ValueError(f"Unknown columns: {unknown}; columns: {names}")
            names = list(columns)
        total = self.row_count()
        last = min(last if last is not None else first + ROW_LIMIT - 1, first + ROW_LIMIT - 1, total)
        if first > total:
            return {"rows": f"{first}-", "total_rows": total, "content": "",
                    "note": f"The table has {total:,} rows."}
        con, source, row_column = self.connect()
        try:
            result = con.execute(
                f"SELECT {row_column}, {self._select(names)} FROM {source} "
                f"WHERE {row_column} BETWEEN ? AND ? ORDER BY {row_column}", [first - 1, last - 1])
            records = [(int(row[0]) + 1, dict(zip(names, row[1:]))) for row in result.fetchall()]
        finally:
            con.close()
        text, shown = render_table(names, records, READ_CELL, budget=READ_BUDGET)
        end = first + shown - 1
        result: dict[str, Any] = {"rows": f"{first}-{end}", "total_rows": total, "content": text}
        if end < total:
            result["more"] = f'Read on with rows="{end + 1}-{min(end + ROW_LIMIT, total)}".'
        return result

    def sample(self, count: int = 5) -> dict[str, Any]:
        return self.read_rows(f"1-{max(1, min(count, self.row_count() or 1))}")


def table_source(files: "SessionFiles", path: str, sheet: str | None = None) -> TableSource | None:
    """The table behind ``path``, or None when it is not a table."""
    import pandas as pd
    kind = kind_of(path)
    workspace = files.workspace
    if workspace is None:
        return None
    if kind == "table":
        name = PurePosixPath(path).name[:-len(".json")] if path.endswith(".json") else PurePosixPath(path).name
        metadata = workspace.get_table_metadata(name)
        layer = files.layer
        if metadata is None:
            # A session table without stored data: still searchable by name, columns and code.
            table = next((table for table in layer.tables if layer.table_name(table) == name), None) \
                if layer is not None else None
            if table is None:
                return None
            return TableSource(path, name=name, display=str(table.get("displayId") or name),
                               code=layer.table_code(name),
                               _columns=[column["name"] for column in layer.table_columns(table)], _count=0)
        view = files.session_view(path) or {}
        source = TableSource(path, name=name, display=str(view.get("name") or name),
                             description=str(getattr(metadata, "description", "") or ""),
                             column_descriptions={column.name: column.description
                                                  for column in getattr(metadata, "columns", None) or []
                                                  if getattr(column, "description", None)})
        try:
            source.python_file = workspace.get_relative_data_file_path(name)
        except Exception:
            source.python_file = ""
        source.code = layer.table_code(name) if layer is not None else ""
        try:
            source.parquet = Path(workspace.local_parquet_file(name))
        except (ValueError, FileNotFoundError, OSError, AttributeError):
            source.frame = lambda: workspace.read_data_as_df(name)
        return source
    if not path.startswith("files/") or kind not in ("data file", "Excel", "CSV"):
        return None
    name = path[len("files/"):]
    item = workspace.get_metadata().files.get(name)
    if item is None:
        return None
    source = TableSource(path, name=name, display=str(item.display_name or name), python_file=path, sheet=sheet)
    local = workspace.local_workspace_file(name) if hasattr(workspace, "local_workspace_file") else None
    if kind == "data file" and local is not None:
        source.parquet = Path(local)
        return source

    def load() -> "pd.DataFrame":
        content = workspace.read_workspace_file(name)[1]
        if kind == "data file":
            return pd.read_parquet(io.BytesIO(content))
        if kind == "CSV":
            return pd.read_csv(io.BytesIO(content), low_memory=False)
        workbook = pd.ExcelFile(io.BytesIO(content))
        if sheet is not None and sheet not in workbook.sheet_names:
            raise ValueError(f"Unknown sheet: {sheet}; sheets: {workbook.sheet_names}")
        return pd.read_excel(workbook, sheet_name=sheet or workbook.sheet_names[0])

    source.frame = load
    return source


def excel_sheets(content: bytes) -> list[dict[str, Any]]:
    import pandas as pd
    workbook = pd.ExcelFile(io.BytesIO(content))
    sheets = []
    for name in workbook.sheet_names:
        frame = pd.read_excel(workbook, sheet_name=name)
        sheets.append({"sheet": name, "rows": len(frame), "columns": [str(column) for column in frame.columns]})
    return sheets


# ── PDFs ──────────────────────────────────────────────────────────────────


def pdf_reader(content: bytes):
    from pypdf import PdfReader
    try:
        return PdfReader(io.BytesIO(content))
    except Exception as exc:
        raise ValueError("PDF could not be parsed") from exc


def read_pdf(content: bytes, pages: Any = None) -> dict[str, Any]:
    reader = pdf_reader(content)
    total = len(reader.pages)
    if pages is None:
        first, last = 1, total if total <= PDF_WHOLE_PAGES else PDF_FIRST_PAGES
    else:
        first, last = parse_range(pages, "pages")
        last = min(last if last is not None else first + PDF_MAX_PAGES - 1, first + PDF_MAX_PAGES - 1, total)
        if first > total:
            raise ValueError(f"The PDF has {total} pages.")
    parts = [f"--- page {number} ---\n{(reader.pages[number - 1].extract_text() or '').strip()}"
             for number in range(first, last + 1)]
    result: dict[str, Any] = {"pages": f"{first}-{last}", "total_pages": total, "content": "\n\n".join(parts)}
    if last < total:
        result["more"] = (f'PARTIAL view: pages {first}-{last} of {total}. Read more with pages="{last + 1}-'
                          f'{min(last + PDF_MAX_PAGES, total)}", or use search to find the page you need.')
    return result


def pdf_lines(content: bytes) -> Iterable[tuple[int, str]]:
    extracted = 0
    for number, page in enumerate(pdf_reader(content).pages, start=1):
        text = page.extract_text() or ""
        extracted += len(text)
        for line in text.splitlines():
            yield number, line
        if extracted >= PDF_MAX_CHARS:
            return


# ── search ────────────────────────────────────────────────────────────────


@dataclass
class Section:
    path: str
    header: str
    order: tuple
    count: int = 0                       # rows or lines that match
    matched_in: list[str] = field(default_factory=list)
    source: TableSource | None = None
    positions: list[int] = field(default_factory=list)   # 0-based rows, or (line, text) for text
    lines: list[tuple[str, str]] = field(default_factory=list)
    matched_columns: list[str] = field(default_factory=list)
    column_samples: str = ""
    shown: int = 0
    note: str = ""


# Folders outside the session are searched only when a path names them.
NAMED_ONLY = ("workflows/",)


def _selected(path: str, scopes: list[str]) -> bool:
    if not scopes:
        return not path.startswith(NAMED_ONLY)
    for scope in scopes:
        scope = scope.strip().lstrip("/")
        if not scope:
            return True
        if any(char in scope for char in "*?["):
            if fnmatch.fnmatch(path, scope) or fnmatch.fnmatch(path, scope.rstrip("/") + "/*"):
                return True
        elif path.startswith(scope):
            return True
    return False


def _table_section(source: TableSource, matcher: Matcher, limit: int) -> Section | None:
    columns = source.columns()
    matched_in: list[str] = []
    for label, text in (("name", source.name), ("UI name", source.display)):
        if text and matcher.matches(text) and "name" not in " ".join(matched_in):
            matched_in.append(f'{label} "{text}"')
    if source.description and matcher.matches(source.description):
        text = " ".join(source.description.split())
        matched_in.append(f'description "{clip(text, SNIPPET, matcher.first_position(text))}"')
    column_hits = [column for column in columns
                   if matcher.matches(column) or matcher.matches(source.column_descriptions.get(column, ""))]
    code_lines = [(f"code line {number}", line) for number, line in enumerate(source.code.splitlines(), start=1)
                  if matcher.matches(line)]
    count, positions, samples = 0, [], ""
    if source.has_rows:
        count, positions, samples = _row_hits(source, matcher, columns, column_hits, limit)
    if not (matched_in or column_hits or count or code_lines):
        return None
    # Tables matched by name, description, column name or code come before tables matched only by rows.
    priority = 0 if matched_in or column_hits or code_lines else 1
    if code_lines:
        matched_in.append(f"code ({len(code_lines)} {'line' if len(code_lines) == 1 else 'lines'})")
    if column_hits:
        matched_in.append("column names: " + ", ".join(column_hits))
    total = source.row_count() if source.has_rows else 0
    shape = f"{total:,} {'row' if total == 1 else 'rows'}" if source.has_rows else "no stored rows"
    ui = f' "{source.display}"' if source.display and source.display not in (
        PurePosixPath(source.path).name, PurePosixPath(source.path).stem) else ""
    header = (f"## {source.path}{ui} — table, {shape}"
              + (f" (Python: {source.python_file})" if source.python_file and source.python_file != source.path else ""))
    # Smaller tables first: codebooks and lookups before the large tables they describe.
    return Section(source.path, header, (0, priority, total, count), count=count, matched_in=matched_in,
                   source=source, positions=positions, matched_columns=column_hits, column_samples=samples,
                   lines=code_lines[:SAMPLE_VALUES])


def _row_hits(source: TableSource, matcher: Matcher, columns: list[str], column_hits: list[str],
              limit: int) -> tuple[int, list[int], str]:
    """(matching rows, their first positions, sample values of hit columns when no row matches)."""
    condition, parameters = matcher.sql(columns)
    con, from_sql, row_column = source.connect()
    try:
        count = int(con.execute(f"SELECT count(*) FROM {from_sql} WHERE {condition}", parameters).fetchone()[0])
        positions = [int(row[0]) for row in con.execute(
            f"SELECT {row_column} FROM {from_sql} WHERE {condition} ORDER BY {row_column} LIMIT ?",
            [*parameters, max(limit, 1)]).fetchall()] if count else []
        samples = ""
        if column_hits and not count:
            parts = []
            for column in column_hits[:3]:
                quoted = '"' + column.replace('"', '""') + '"'
                distinct = con.execute(f"SELECT approx_count_distinct({quoted}) FROM {from_sql}").fetchone()[0]
                values = [cell_text(row[0]) for row in con.execute(
                    f"SELECT {quoted} FROM {from_sql} WHERE {quoted} IS NOT NULL GROUP BY {quoted} "
                    f"ORDER BY min({row_column}) LIMIT {SAMPLE_VALUES}"
                ).fetchall()]
                parts.append(f'"{column}" — sample values (~{distinct:,} distinct): '
                             + ", ".join(clip(value, 40) for value in values) + (", …" if distinct > len(values) else ""))
            samples = "\n".join(parts)
    finally:
        con.close()
    return count, positions, samples


def _row_columns(source: TableSource, records: list[tuple[int, dict]], matcher: Matcher,
                 matched_columns: list[str]) -> tuple[list[str], list[str]]:
    """Columns shown for a table's matching rows: all of them, or index + matched + a window when wide."""
    columns = source.columns()
    widths = {column: max((len(clip(cell_text(record.get(column)), SEARCH_CELL)) for _, record in records),
                          default=0) + len(column) for column in columns}
    if sum(widths.values()) + 3 * len(columns) <= WIDE_ROW:
        return columns, []
    hit = [column for column in columns if column in matched_columns
           or any(matcher.touches(record.get(column)) for _, record in records)]
    index = [column for column in columns if _ID_NAME.search(column)]
    if columns[0] not in index and widths[columns[0]] <= 40 + len(columns[0]):
        index = [columns[0], *index]
    keep = list(dict.fromkeys([*index[:MAX_INDEX_COLUMNS], *hit]))
    used = sum(widths[column] + 3 for column in keep)
    positions = [columns.index(column) for column in hit] or [0]
    low, high = min(positions), max(positions)
    grow_left = grow_right = True
    while grow_left or grow_right:
        if grow_right:
            if high + 1 < len(columns) and used + widths[columns[high + 1]] + 3 <= WIDE_ROW:
                high += 1
                if columns[high] not in keep:
                    keep.append(columns[high])
                    used += widths[columns[high]] + 3
            else:
                grow_right = False
        if grow_left:
            if low - 1 >= 0 and used + widths[columns[low - 1]] + 3 <= WIDE_ROW:
                low -= 1
                if columns[low] not in keep:
                    keep.append(columns[low])
                    used += widths[columns[low]] + 3
            else:
                grow_left = False
    shown = [column for column in columns if column in keep]
    return shown, [column for column in columns if column not in keep]


def _fetch(source: TableSource, positions: list[int]) -> list[tuple[int, dict]]:
    if not positions:
        return []
    columns = source.columns()
    con, from_sql, row_column = source.connect()
    try:
        placeholders = ", ".join("?" for _ in positions)
        result = con.execute(
            f"SELECT {row_column}, {source._select(columns)} FROM {from_sql} "
            f"WHERE {row_column} IN ({placeholders}) ORDER BY {row_column}", positions)
        return [(int(row[0]) + 1, dict(zip(columns, row[1:]))) for row in result.fetchall()]
    finally:
        con.close()


def _text_section(files: "SessionFiles", path: str, kind: str, matcher: Matcher, limit: int) -> Section | None:
    lines: list[tuple[str, str]] = []
    count = 0
    if kind == "PDF":
        content = files.workspace.read_workspace_file(path[len("files/"):])[1]
        for page, line in pdf_lines(content):
            if matcher.matches(line):
                count += 1
                if len(lines) < limit:
                    lines.append((f"page {page}", line))
    else:
        for number, line in files.iter_lines(path, max_bytes=SEARCH_TEXT_BYTES):
            if matcher.matches(line):
                count += 1
                if len(lines) < limit:
                    lines.append((f"line {number}", line))
    name_hit = matcher.matches(PurePosixPath(path).name)
    if not count and not name_hit:
        return None
    ui = files.display_name(path)
    label = {"reference": "connected-source reference (cached metadata only; use probe_data with its source_id "
                          "and table_key for remote rows)", "PDF": "PDF"}.get(kind, kind)
    header = f"## {path}" + (f' "{ui}"' if ui and ui != PurePosixPath(path).name else "") + f" — {label}"
    group = {"files": 2, "session": 3, "scratch": 4, "workflows": 5}.get(path.split("/", 1)[0], 6)
    section = Section(path, header, (group, 0 if name_hit else 1, count), count=count, lines=lines)
    if name_hit:
        section.matched_in.append("file name")
    if count:
        section.matched_in.append(f"{count} {'line' if count == 1 else 'lines'}")
    return section


def search(files: "SessionFiles", query: str, path: Any = None, regex: bool = False, max_results: int = 20) -> str:
    """Search the session: tables (names, columns, every row), files and session items (lines)."""
    matcher = Matcher(query, regex)
    if not isinstance(max_results, int) or not 1 <= max_results <= 100:
        raise ValueError("max_results must be between 1 and 100")
    scopes = [path] if isinstance(path, str) else list(path or [])
    sections: list[Section] = []
    errors: list[str] = []
    from data_formulator.analyst.session_files import roots_of
    for entry in files.entries(roots_of(scopes)):
        if entry.path == "session/index.md" or not _selected(entry.path, scopes):
            continue
        kind = kind_of(entry.path)
        try:
            if kind in ("table", "data file", "Excel", "CSV"):
                sheets = [None]
                if kind == "Excel":
                    sheets = [sheet["sheet"] for sheet in excel_sheets(
                        files.workspace.read_workspace_file(entry.path[len("files/"):])[1])]
                for sheet in sheets:
                    source = table_source(files, entry.path, sheet=sheet)
                    if source is None:
                        continue
                    section = _table_section(source, matcher, max_results)
                    if section is not None:
                        if sheet is not None:
                            section.header = section.header.replace(" — table,", f" — Excel sheet \"{sheet}\",")
                            section.path = f"{entry.path}#{sheet}"
                        sections.append(section)
            elif kind in ("image", "binary"):
                continue
            else:
                section = _text_section(files, entry.path, kind, matcher, max_results)
                if section is not None:
                    sections.append(section)
        except Exception as exc:  # one unreadable item does not stop the search
            logger.debug("search skipped %s", entry.path, exc_info=True)
            errors.append(f"{entry.path}: {str(exc)[:160]}")
    more_tables = 0
    sources = files.sources
    if sources.available and (not scopes or any(
            isinstance(scope, str) and scope.strip().lstrip("/").startswith("sources") for scope in scopes)):
        try:
            found, more_tables = sources.search_sections(matcher, scopes, max_results)
            sections += found
        except Exception as exc:
            logger.debug("catalog search failed", exc_info=True)
            errors.append(f"sources/: {str(exc)[:160]}")
    if not sections:
        where = ", ".join(scopes) if scopes else "the session and connected-source catalogs"
        how = ("the pattern must match a line or a table cell" if matcher.regex else
               "every word must appear in one row, line, name or description; try fewer or different words")
        return f'No matches for "{matcher.query}" in {where} ({how}).' + (
            "\nCould not search: " + "; ".join(errors) if errors else "")

    sections.sort(key=lambda section: section.order)
    # Share the row and line budget: small result sets get all of theirs first. Catalog tables
    # (sources/) come last and get what the session leaves.
    remaining = max_results
    for in_catalog in (False, True):
        with_hits = sorted((section for section in sections
                            if section.count and section.path.startswith("sources/") == in_catalog),
                           key=lambda section: section.count)
        for index, section in enumerate(with_hits):
            share = max(remaining // max(len(with_hits) - index, 1), 1 if remaining else 0)
            section.shown = min(section.count, share, remaining)
            remaining -= section.shown

    out = [f'Search "{matcher.query}" ({"regex" if matcher.regex else "every word, any order"}): '
           f"{len(sections)} {'item' if len(sections) == 1 else 'items'} match."]
    for section in sections:
        out += ["", section.header]
        if section.source is not None:
            parts = list(section.matched_in)
            if section.count:
                parts.append(f"{section.count:,} {'row' if section.count == 1 else 'rows'}")
            out.append("Matched in: " + " · ".join(parts))
            if section.column_samples:
                out.append(section.column_samples)
            for locator, text in section.lines:
                out.append(f"- {locator}: {clip(' '.join(text.split()), 300)}")
            if section.shown:
                records = _fetch(section.source, section.positions[:section.shown])
                columns, hidden = _row_columns(section.source, records, matcher, section.matched_columns)
                table, _ = render_table(columns, records, SEARCH_CELL, matcher)
                out.append(table)
                if hidden:
                    out.append(f"(… {len(hidden)} more columns: " + ", ".join(hidden[:12])
                               + (", …" if len(hidden) > 12 else "") + ")")
            if section.count > section.shown:
                out.append(f"… {section.shown} of {section.count:,} rows shown; read rows with read_file "
                           f"(rows=\"…\") or narrow the search.")
        else:
            out.append("Matched in: " + " · ".join(section.matched_in))
            if section.note:
                out.append(section.note)
            for locator, text in section.lines[:section.shown]:
                folded = " ".join(text.split())
                out.append(f"- {locator}: {clip(folded, 300, matcher.first_position(folded))}")
            if section.count > section.shown:
                out.append(f"… {section.shown} of {section.count} shown")
    if more_tables:
        out += ["", f"… {more_tables} more connected-source tables match; search with path [\"sources/\"] to see them."]
    if errors:
        out += ["", "Could not search: " + "; ".join(errors[:5])]
    return "\n".join(out)
