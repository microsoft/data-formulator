# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Shared context builders for agent prompts.

Extracted from DataAgent so that both DataAgent and InteractiveExploreAgent
can construct tiered context (primary/other tables, focused thread,
peripheral threads) from the same code.
"""

import logging
from typing import Any

from data_formulator.agents.agent_utils import generate_data_summary
from data_formulator.datalake.parquet_utils import normalize_dtype_to_app_type

logger = logging.getLogger(__name__)


def build_focused_thread_context(focused_thread: list[dict[str, Any]]) -> str:
    """Build Tier 2: detailed focused thread context.

    Each step includes user question, agent reasoning, chart type +
    encodings, created table metadata, and agent summary.
    """
    lines = ["[FOCUSED THREAD]"]
    for i, step in enumerate(focused_thread, 1):
        lines.append(f"\nStep {i}:")
        if step.get("user_question"):
            lines.append(f"  User: {step['user_question']}")
        if step.get("agent_thinking"):
            lines.append(f"  Agent thinking: {step['agent_thinking']}")
        if step.get("display_instruction"):
            lines.append(f"  Visualization: {step['display_instruction']}")
        # Table info
        table_name = step.get("table_name", "")
        columns = step.get("columns", [])
        row_count = step.get("row_count", 0)
        if table_name:
            col_str = ", ".join(columns[:15])
            if len(columns) > 15:
                col_str += f", ... ({len(columns)} total)"
            lines.append(f"  Created: {table_name} ({row_count:,} rows: {col_str})")
        # Chart info — skip empty or "Auto" (unresolved trigger stub)
        chart_type = step.get("chart_type", "")
        encodings = step.get("encodings", {})
        if chart_type and chart_type != "Auto":
            enc_str = ", ".join(f"{k}: {v}" for k, v in encodings.items() if v)
            lines.append(f"  Chart: {chart_type}" + (f" ({enc_str})" if enc_str else ""))
        elif encodings:
            enc_str = ", ".join(f"{k}: {v}" for k, v in encodings.items() if v)
            if enc_str:
                lines.append(f"  Encodings: {enc_str}")
        if step.get("agent_summary"):
            lines.append(f"  Summary: {step['agent_summary']}")
    return "\n".join(lines)


def build_peripheral_thread_context(other_threads: list[dict[str, Any]]) -> str:
    """Build Tier 3: minimal peripheral thread context.

    One line per step, just display_instruction + chart type.
    """
    lines = ["[OTHER THREADS]"]
    for thread in other_threads:
        source = thread.get("source_table", "")
        leaf = thread.get("leaf_table", "")
        step_count = thread.get("step_count", 0)
        steps = thread.get("steps", [])
        lines.append(f"\nThread from {source} → {leaf} ({step_count} steps):")
        for step_line in steps:
            lines.append(f"  - {step_line}")
    return "\n".join(lines)


def build_lightweight_table_context(
    input_tables: list[dict[str, Any]],
    workspace: Any,
    primary_tables: list[str] | None = None,
) -> str:
    """Build lightweight table context: name, filename, columns+types, row count.

    When ``primary_tables`` is provided, tables are grouped into
    [PRIMARY TABLE(S)] and [OTHER AVAILABLE TABLES] sections.
    The agent can use ``inspect_source_data`` to get details on demand.
    """
    def _table_section(table: dict[str, Any]) -> str:
        table_name = table['name']
        try:
            df = workspace.read_data_as_df(table_name)
            data_file_path = workspace.get_relative_data_file_path(table_name)
            num_rows = len(df)

            col_info = []
            for col in df.columns:
                dtype = normalize_dtype_to_app_type(str(df[col].dtype))
                col_info.append(f"{col}({dtype})")

            lines = [
                f"Table: {table_name} (file: {data_file_path}, {num_rows:,} rows)",
                f"  Columns: {', '.join(col_info)}",
            ]

            # Sample rows so LLM can see actual data without calling tools
            try:
                sample = df.head(3).to_string(index=False, max_colwidth=40)
                lines.append(f"  Sample (first 3 rows):\n{sample}")
            except Exception:
                pass

            # Basic numeric stats to reduce exploratory tool calls
            numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
            if numeric_cols:
                stats_parts = []
                for col in numeric_cols[:8]:
                    stats_parts.append(
                        f"    {col}: min={df[col].min()}, max={df[col].max()}, "
                        f"mean={df[col].mean():.2f}"
                    )
                lines.append("  Numeric stats:\n" + "\n".join(stats_parts))

            return "\n".join(lines)
        except Exception as e:
            logger.warning(f"Could not read table {table_name}: {e}")
            from data_formulator.error_handler import collect_stream_warning
            collect_stream_warning(
                f"Table '{table_name}' schema unavailable",
                detail=str(e),
                message_code="TABLE_SCHEMA_FAILED",
            )
            return f"Table: {table_name} (error reading schema)"

    load_hint = (
        "\nTo load a table in code: pd.read_parquet('file.parquet') or "
        "duckdb.sql(\"SELECT * FROM read_parquet('file.parquet')\")\n"
        "Use the exact filename shown above."
    )

    if primary_tables:
        primary_names = set(primary_tables)
        primary_tables_list = [t for t in input_tables if t['name'] in primary_names]
        other_tables_list = [t for t in input_tables if t['name'] not in primary_names]

        sections = []
        if primary_tables_list:
            header = "[PRIMARY TABLE]" if len(primary_tables_list) == 1 else "[PRIMARY TABLES]"
            primary_parts = [_table_section(t) for t in primary_tables_list]
            sections.append(header + "\n\n" + "\n\n".join(primary_parts))
        if other_tables_list:
            other_parts = [_table_section(t) for t in other_tables_list]
            sections.append("[OTHER AVAILABLE TABLES]\n\n" + "\n\n".join(other_parts))
        return "\n\n".join(sections) + "\n" + load_hint

    sections = [_table_section(table) for table in input_tables]
    return "\n\n".join(sections) + "\n" + load_hint


def handle_inspect_source_data(
    table_names: list[str],
    input_tables: list[dict[str, Any]],
    workspace: Any,
) -> str:
    """Handle an inspect_source_data tool call.

    Returns a data summary string for the requested tables.
    Detail level adapts automatically to the number of tables:
      - ≤3 tables → Level 2 (full schema + sample rows + column descriptions)
      - >3 tables → Level 1 (schema overview only, no sample rows)

    If a table cannot be read (e.g. not found in workspace), the error
    is included in the summary instead of crashing the entire request.
    """
    tables_to_inspect = [
        t for t in input_tables
        if t.get("name") in table_names
    ]
    if tables_to_inspect:
        include_samples = len(tables_to_inspect) <= 3
        char_limit = 5000 if include_samples else 3000
        try:
            content = generate_data_summary(
                tables_to_inspect,
                workspace=workspace,
                include_data_samples=include_samples,
            )
        except (FileNotFoundError, KeyError) as exc:
            logger.warning("Could not generate data summary: %s", exc)
            from data_formulator.error_handler import collect_stream_warning
            collect_stream_warning(
                f"Could not read table data for inspection: {exc}",
                message_code="TABLE_INSPECT_FAILED",
            )
            content = f"Error reading table data: some tables could not be found in the workspace. Available tables may have changed."
    else:
        content = f"No tables found matching: {table_names}"
        char_limit = 3000

    return content[:char_limit] + "..." if len(content) > char_limit else content


def handle_search_data_tables(
    query: str,
    scope: str,
    workspace: Any,
    user_home: str | None = None,
) -> str:
    """Handle a search_data_tables tool call.

    Combines workspace metadata search (layer 1) and disk catalog cache
    search (layer 2) into a single Level 0 result set.

    Args:
        user_home: Path to the user's home directory (``get_user_home(identity)``).
            Catalog cache files live under ``<user_home>/catalog_cache/``.

    Returns a text summary suitable for LLM consumption.  Results are
    capped to keep context usage low (~3K tokens).
    """
    if not query or not query.strip():
        return "Please provide a search keyword."

    results: list[dict[str, Any]] = []

    # ── Layer 1: workspace metadata search ───────────────────────────
    if scope in ("workspace", "all"):
        try:
            ws_meta = workspace.get_metadata()
            if ws_meta:
                ws_hits = ws_meta.search_tables(query, limit=50)
                for hit in ws_hits:
                    results.append({
                        "source": "workspace",
                        "name": hit["name"],
                        "description": (hit.get("description") or "")[:120],
                        "matched_columns": hit.get("matched_columns", []),
                        "column_count": hit.get("column_count", 0),
                        "status": "imported",
                    })
        except Exception:
            logger.debug("Workspace search failed", exc_info=True)

    # ── Layer 2: disk catalog cache search ───────────────────────────
    if scope in ("connected", "all") and user_home:
        try:
            from data_formulator.datalake.catalog_cache import search_catalog_cache
            imported_names = {r["name"] for r in results}
            cache_hits = search_catalog_cache(
                user_home,
                query,
                limit_per_source=20,
                exclude_tables=imported_names,
            )
            for hit in cache_hits:
                results.append({
                    "source": hit.get("source_id", "connected"),
                    "name": hit["name"],
                    "description": (hit.get("description") or "")[:120],
                    "matched_columns": hit.get("matched_columns", []),
                    "column_count": hit.get("column_count", 0),
                    "status": "not imported",
                })
        except Exception:
            logger.debug("Catalog cache search failed", exc_info=True)

    if not results:
        return f"No tables found matching '{query}'."

    lines = [f"Search results for '{query}' ({len(results)} matches):\n"]
    for i, r in enumerate(results, 1):
        line = f"{i}. [{r['source']}] {r['name']}"
        if r["description"]:
            line += f" — {r['description']}"
        if r["matched_columns"]:
            line += f"  (matched columns: {', '.join(r['matched_columns'][:5])})"
        line += f"  [{r['status']}]"
        lines.append(line)

    text = "\n".join(lines)
    return text[:3000] + "\n..." if len(text) > 3000 else text
