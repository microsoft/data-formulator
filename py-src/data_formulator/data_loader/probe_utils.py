"""Shared building blocks for the connector ``probe`` capability (design 37).

A probe is a bounded, single-table SPJQ read (Select–Project–Aggregate, *no
join*) the data-loading agent runs to size a slice and pick real filter values.
Every loader implements its **own** ``probe`` using its backend's native query
API — Postgres/MySQL/MSSQL/BigQuery compile SQL, Kusto compiles KQL, Mongo
builds an aggregation pipeline, file/object sources read the files into DuckDB.

This module holds only the *reusable* pieces so a loader can one-line the common
path instead of reimplementing it:

* :func:`compile_probe_sql` — SPJQ query object → a single SQL SELECT, dialect
  aware (quoting + ``LIMIT``/``TOP``). Shared by every SQL backend **and** the
  DuckDB read-and-compute path.
* :func:`probe_via_native_sql` — the whole SQL-family path in one call: clamp,
  compile, run the loader's native executor, shape the result (exact).
* :func:`run_probe_on_duckdb` — the file/object path: read the source into
  DuckDB and compute there.
* :func:`shape_probe_payload` — turn a result table into the wire payload,
  row-cap aware.

Backends whose native language isn't SQL (Kusto, Mongo) build their own query
with a small local compiler and finish with :func:`shape_probe_payload`.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Callable, TYPE_CHECKING

import pyarrow as pa

if TYPE_CHECKING:
    from data_formulator.data_loader.external_data_loader import ExternalDataLoader

logger = logging.getLogger(__name__)

# --- Row caps (design 37 §4.2) ---------------------------------------------
# Hard cap on rows a single probe returns to the agent. Deliberately small:
# probe results become input tokens on the next turn, so we never dump a large
# table into the model's context. Bulk data goes via the load path, not probe.
PROBE_MAX_ROWS = 500
# Default output rows when a probe omits an explicit limit.
PROBE_DEFAULT_ROWS = 100
# Upper bound on rows the DuckDB read-and-compute path scans from the source.
# For file sources this is set large enough to read the whole file (exact);
# for a thin sample fallback it bounds the sample (approximate).
PROBE_SCAN_ROWS = 100_000

# Aggregate operators the probe vocabulary accepts (design 37 §4.2).
_PROBE_AGG_OPS = frozenset({"count", "count_distinct", "sum", "avg", "min", "max"})

# Source-agnostic filter vocabulary (design 13) → SQL operators. Probe filters
# arrive as ``{column, op, value}`` in this vocabulary; unknown ops are dropped.
_FILTER_OP_TO_SQL = {
    "EQ": "=",
    "NEQ": "!=",
    "GT": ">",
    "GTE": ">=",
    "LT": "<",
    "LTE": "<=",
    "LIKE": "LIKE",
    "ILIKE": "ILIKE",
    "IN": "IN",
    "NOT_IN": "NOT IN",
    "IS_NULL": "IS NULL",
    "IS_NOT_NULL": "IS NOT NULL",
    "BETWEEN": "BETWEEN",
}

# Reject identifiers that could carry injection even after quote-doubling.
_DANGEROUS_IDENT_RE = re.compile(r"[;\x00]|--|/\*")


# ---------------------------------------------------------------------------
# SQL dialects
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SqlDialect:
    """How a SQL backend differs when compiling a probe.

    ``open_quote``/``close_quote`` bracket an identifier (``"``/``"`` for ANSI,
    ``` `` ```/``` `` ``` for MySQL, ``[``/``]`` for SQL Server). ``limit_style``
    is ``"suffix"`` for ``… LIMIT N`` or ``"top"`` for ``SELECT TOP N …``.
    ``ilike`` is ``"native"`` when the backend has an ``ILIKE`` operator, else
    ``"lower_like"`` to emulate it with ``LOWER(col) LIKE LOWER(val)``.
    """

    name: str = "ansi"
    open_quote: str = '"'
    close_quote: str = '"'
    limit_style: str = "suffix"  # "suffix" | "top"
    ilike: str = "native"        # "native" | "lower_like"


ANSI = SqlDialect(name="ansi")
DUCKDB = SqlDialect(name="duckdb")
POSTGRES = SqlDialect(name="postgres")
MYSQL = SqlDialect(name="mysql", open_quote="`", close_quote="`", ilike="lower_like")
MSSQL = SqlDialect(
    name="mssql", open_quote="[", close_quote="]",
    limit_style="top", ilike="lower_like",
)
BIGQUERY = SqlDialect(
    name="bigquery", open_quote="`", close_quote="`", ilike="lower_like",
)
ATHENA = SqlDialect(name="athena", ilike="lower_like")  # Trino: "…" quoting, LIMIT


# ---------------------------------------------------------------------------
# Small shared helpers
# ---------------------------------------------------------------------------

def clamp_probe_limit(limit: Any) -> int:
    """Clamp a probe ``limit`` into ``[1, PROBE_MAX_ROWS]`` with a default."""
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = PROBE_DEFAULT_ROWS
    if n <= 0:
        n = PROBE_DEFAULT_ROWS
    return min(n, PROBE_MAX_ROWS)


def quote_ident(name: str, dialect: SqlDialect = ANSI) -> str:
    """Quote a SQL identifier for ``dialect``, escaping the close-quote char.

    Works for symmetric quotes (``"col"`` → ``"col"``, embedded ``"`` doubled)
    and bracket quoting (``[col]``, embedded ``]`` doubled). Rejects names with
    semicolons, null bytes, or SQL comment sequences.
    """
    if not name or _DANGEROUS_IDENT_RE.search(name):
        raise ValueError(f"Invalid identifier: {name!r}")
    escaped = name.replace(dialect.close_quote, dialect.close_quote * 2)
    return f"{dialect.open_quote}{escaped}{dialect.close_quote}"


def probe_filters_to_source_filters(
    filters: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Normalise probe ``filters`` (``{column, op, value}``) into the
    ``source_filters`` shape (``{column, operator, value}``) understood by
    loader ``fetch_data_as_arrow`` implementations. Unknown ops are dropped.
    """
    out: list[dict[str, Any]] = []
    for f in filters or []:
        if not isinstance(f, dict):
            continue
        col = f.get("column")
        op = (f.get("op") or f.get("operator") or "").upper().strip()
        if not col or op not in _FILTER_OP_TO_SQL:
            continue
        out.append({"column": col, "operator": op, "value": f.get("value")})
    return out


def _lit(v: Any) -> str:
    """Escape a value as a SQL literal (single-quoted, injection-safe)."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("\x00", "").replace("'", "''")
    return f"'{s}'"


def _contains_lit(v: Any) -> str:
    """Escape a value as a ``%value%`` LIKE literal."""
    s = str(v).replace("\x00", "").replace("'", "''")
    return f"'%{s}%'"


def _compile_where(filters: list[dict[str, Any]], dialect: SqlDialect) -> str:
    """Compile probe ``filters`` into a dialect-aware ``WHERE`` clause."""
    parts: list[str] = []
    for f in filters or []:
        if not isinstance(f, dict):
            continue
        col = f.get("column")
        op = _FILTER_OP_TO_SQL.get((f.get("op") or "").upper().strip())
        if not col or op is None:
            continue
        try:
            qcol = quote_ident(str(col), dialect)
        except ValueError:
            continue
        val = f.get("value")

        if op in ("IS NULL", "IS NOT NULL"):
            parts.append(f"{qcol} {op}")
        elif op in ("IN", "NOT IN"):
            vals = val if isinstance(val, (list, tuple)) else [val]
            if not vals:
                continue
            parts.append(f"{qcol} {op} ({', '.join(_lit(v) for v in vals)})")
        elif op == "BETWEEN":
            if isinstance(val, (list, tuple)) and len(val) == 2:
                parts.append(f"{qcol} BETWEEN {_lit(val[0])} AND {_lit(val[1])}")
        elif op == "ILIKE" and dialect.ilike == "lower_like":
            parts.append(f"LOWER({qcol}) LIKE LOWER({_contains_lit(val)})")
        elif op == "ILIKE":
            parts.append(f"{qcol} ILIKE {_contains_lit(val)}")
        else:
            parts.append(f"{qcol} {op} {_lit(val)}")

    if not parts:
        return ""
    return "WHERE " + " AND ".join(parts)


# ---------------------------------------------------------------------------
# SQL compiler (shared by every SQL backend and the DuckDB path)
# ---------------------------------------------------------------------------

def compile_probe_sql(
    query: dict[str, Any],
    out_limit: int,
    *,
    relation: str = "t",
    dialect: SqlDialect = ANSI,
) -> str:
    """Compile a probe SPJQ ``query`` (design 37 §4.2) into a single SELECT.

    ``relation`` is the already-qualified/quoted table expression (or a DuckDB
    ``read_parquet(...)`` scan). Only bare columns and a fixed set of aggregate
    ops are emitted — never raw expressions. Filters are always applied here so
    the result is correct regardless of what a loader pushed down. Raises
    ``ValueError`` on an invalid aggregate op.
    """
    columns = query.get("columns") or []
    group_by = query.get("group_by") or []
    aggregates = query.get("aggregates") or []
    order_by = query.get("order_by") or []
    filters = query.get("filters") or []

    def q(name: Any) -> str:
        return quote_ident(str(name), dialect)

    select_parts: list[str] = [q(g) for g in group_by]

    for agg in aggregates:
        if not isinstance(agg, dict):
            continue
        op = (agg.get("op") or "").lower().strip()
        if op not in _PROBE_AGG_OPS:
            raise ValueError(f"unsupported aggregate op: {op!r}")
        col = agg.get("column")
        alias = agg.get("as") or (f"{op}_{col}" if col else op)
        qalias = q(alias)
        if op == "count" and not col:
            expr = "count(*)"
        elif op == "count_distinct":
            if not col:
                raise ValueError("count_distinct requires a column")
            expr = f"count(DISTINCT {q(col)})"
        elif op == "count":
            expr = f"count({q(col)})"
        else:
            if not col:
                raise ValueError(f"aggregate {op} requires a column")
            expr = f"{op}({q(col)})"
        select_parts.append(f"{expr} AS {qalias}")

    if not select_parts:
        select_parts = [q(c) for c in columns] if columns else ["*"]

    select_list = ", ".join(select_parts)
    if dialect.limit_style == "top":
        sql = f"SELECT TOP {int(out_limit)} {select_list} FROM {relation}"
    else:
        sql = f"SELECT {select_list} FROM {relation}"

    where = _compile_where(filters, dialect)
    if where:
        sql += f" {where}"

    if group_by:
        sql += " GROUP BY " + ", ".join(q(g) for g in group_by)

    order_parts: list[str] = []
    for o in order_by:
        if not isinstance(o, dict):
            continue
        col = o.get("column")
        if not col:
            continue
        direction = "DESC" if str(o.get("dir", "")).lower() == "desc" else "ASC"
        order_parts.append(f"{q(col)} {direction}")
    if order_parts:
        sql += " ORDER BY " + ", ".join(order_parts)

    if dialect.limit_style != "top":
        sql += f" LIMIT {int(out_limit)}"
    return sql


# ---------------------------------------------------------------------------
# Result shaping
# ---------------------------------------------------------------------------

def shape_probe_payload(
    result: pa.Table,
    out_limit: int,
    *,
    exact: bool,
    extra_note: str | None = None,
) -> dict[str, Any]:
    """Shape a probe result table into the wire payload (row-cap aware)."""
    rows = result.to_pylist()
    note_bits: list[str] = []
    if extra_note:
        note_bits.append(extra_note)
    if len(rows) >= out_limit:
        note_bits.append(f"output capped at {out_limit} rows")
    return {
        "rows": rows,
        "columns": list(result.column_names),
        "row_count": len(rows),
        "exact": exact,
        "compiled_note": "; ".join(note_bits) or None,
    }


# ---------------------------------------------------------------------------
# One-line shared paths
# ---------------------------------------------------------------------------

def probe_via_native_sql(
    query: dict[str, Any],
    *,
    relation: str,
    dialect: SqlDialect,
    execute: Callable[[str], pa.Table],
) -> dict[str, Any]:
    """Run a probe by compiling to SQL and executing on the source engine.

    ``relation`` is the already-qualified/quoted table expression, ``execute``
    runs a SQL string against the loader's native connection and returns Arrow.
    The source does the filtering/grouping/aggregation over the whole table, so
    the result is exact. Returns the wire payload or ``{error}``.
    """
    q = query or {}
    out_limit = clamp_probe_limit(q.get("limit"))
    try:
        sql = compile_probe_sql(q, out_limit, relation=relation, dialect=dialect)
    except ValueError as exc:
        return {"error": f"invalid probe query: {exc}"}
    try:
        result = execute(sql)
    except Exception as exc:
        logger.debug("probe sql failed: %s", sql, exc_info=True)
        return {"error": f"probe failed: {exc}"}
    return shape_probe_payload(result, out_limit, exact=True)


def run_probe_on_duckdb(
    loader: "ExternalDataLoader",
    path: list[str],
    query: dict[str, Any],
    *,
    source_table: str | None = None,
    scan_size: int = PROBE_SCAN_ROWS,
) -> dict[str, Any]:
    """Read the source data into DuckDB and compute the probe there.

    The native operation for a file/object source *is* reading the file, so this
    fetches up to ``scan_size`` rows via ``loader.fetch_data_as_arrow`` (pushing
    filters down when the loader supports them), registers the Arrow table in
    DuckDB and runs the compiled SPJQ. For file sources ``scan_size`` is large
    enough to read the whole file (exact); as a thin sample fallback it bounds
    the sample (``exact=false`` when the cap is hit). Correctness never depends
    on filter pushdown: the WHERE is always re-applied in DuckDB.

    ``source_table`` overrides the identifier passed to ``fetch_data_as_arrow``
    when a loader joins its ``path`` differently than dotted segments.
    """
    import duckdb

    if not path:
        return {"error": "probe requires a non-empty table path"}
    q = query or {}
    if source_table is None:
        source_table = ".".join(str(p) for p in path if p not in (None, ""))
    out_limit = clamp_probe_limit(q.get("limit"))

    import_options: dict[str, Any] = {"size": scan_size}
    src_filters = probe_filters_to_source_filters(q.get("filters"))
    if src_filters:
        import_options["source_filters"] = src_filters

    try:
        arrow = loader.fetch_data_as_arrow(source_table, import_options)
    except Exception as exc:
        logger.debug("probe fetch failed for %s", source_table, exc_info=True)
        return {"error": f"probe fetch failed: {exc}"}

    scanned = arrow.num_rows
    capped = scanned >= scan_size

    try:
        sql = compile_probe_sql(q, out_limit, relation="t", dialect=DUCKDB)
    except ValueError as exc:
        return {"error": f"invalid probe query: {exc}"}

    try:
        con = duckdb.connect()
        try:
            con.register("t", arrow)
            result = con.execute(sql).fetch_arrow_table()
        finally:
            con.close()
    except Exception as exc:
        logger.debug("probe compute failed: %s", sql, exc_info=True)
        return {"error": f"probe compute failed: {exc}"}

    note = None
    if capped:
        note = (
            f"scanned first {scanned} source rows only; "
            "result computed over that sample (approximate)"
        )
    return shape_probe_payload(result, out_limit, exact=not capped, extra_note=note)
