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
                dtype = str(df[col].dtype)
                if 'int' in dtype:
                    dtype = 'int'
                elif 'float' in dtype:
                    dtype = 'float'
                elif dtype == 'object':
                    dtype = 'str'
                elif 'datetime' in dtype:
                    dtype = 'datetime'
                elif 'bool' in dtype:
                    dtype = 'bool'
                col_info.append(f"{col}({dtype})")

            return (
                f"Table: {table_name} (file: {data_file_path}, {num_rows:,} rows)\n"
                f"  Columns: {', '.join(col_info)}"
            )
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
    If a table cannot be read (e.g. not found in workspace), the error
    is included in the summary instead of crashing the entire request.
    """
    tables_to_inspect = [
        t for t in input_tables
        if t.get("name") in table_names
    ]
    if tables_to_inspect:
        try:
            content = generate_data_summary(
                tables_to_inspect, workspace=workspace
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

    return content[:500] + "..." if len(content) > 500 else content
