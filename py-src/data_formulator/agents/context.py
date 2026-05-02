# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Shared context builders for agent prompts.

Extracted from DataAgent so that both DataAgent and InteractiveExploreAgent
can construct tiered context (primary/other tables, focused thread,
peripheral threads) from the same code.
"""

import logging
from typing import Any

from data_formulator.agents.agent_utils import (
    build_catalog_metadata_lookups,
    format_dataframe_sample_with_budget,
    generate_data_summary,
    get_field_summary,
)
from data_formulator.datalake.parquet_utils import normalize_dtype_to_app_type

logger = logging.getLogger(__name__)

TABLE_SAMPLE_MAX_ROWS = 5
TABLE_SAMPLE_CHAR_LIMIT = 1000


def _get_workspace_metadata_lookups(workspace: Any) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    """Return table and column descriptions from workspace metadata."""
    table_descs: dict[str, str] = {}
    col_descs: dict[str, dict[str, str]] = {}
    try:
        ws_meta = workspace.get_metadata()
        if not ws_meta:
            return table_descs, col_descs
        for tname, tmeta in ws_meta.tables.items():
            if tmeta.description:
                table_descs[tname] = tmeta.description
            table_cols = {}
            for col in tmeta.columns or []:
                if col.description:
                    table_cols[col.name] = col.description
            if table_cols:
                col_descs[tname] = table_cols
    except Exception:
        logger.debug("Could not read workspace metadata for agent context", exc_info=True)
    return table_descs, col_descs


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
    """Build compact table context with schema, metadata, value samples, and rows.

    When ``primary_tables`` is provided, tables are grouped into
    [PRIMARY TABLE(S)] and [OTHER AVAILABLE TABLES] sections.
    """
    table_desc_cache, col_desc_cache = _get_workspace_metadata_lookups(workspace)
    table_extra_cache: dict[str, list[str]] = {}
    col_meta_cache: dict[str, dict[str, dict]] = {}
    catalog_table_descs, catalog_col_descs, catalog_extras, catalog_col_metas = build_catalog_metadata_lookups(
        workspace,
    )
    table_desc_cache.update(catalog_table_descs)
    for table_name, descs in catalog_col_descs.items():
        col_desc_cache.setdefault(table_name, {}).update(descs)
    table_extra_cache.update(catalog_extras)
    col_meta_cache.update(catalog_col_metas)

    def _table_section(table: dict[str, Any]) -> str:
        table_name = table['name']
        try:
            df = workspace.read_data_as_df(table_name)
            data_file_path = workspace.get_relative_data_file_path(table_name)
            num_rows = len(df)
            description = table.get("attached_metadata", "") or table_desc_cache.get(table_name, "")
            column_descriptions = col_desc_cache.get(table_name, {})

            col_metas = col_meta_cache.get(table_name, {})
            col_info = []
            for col in df.columns:
                dtype = normalize_dtype_to_app_type(str(df[col].dtype))
                vn = col_metas.get(col, {}).get("verbose_name")
                col_text = f"{col}"
                if vn:
                    col_text += f"[{vn}]"
                col_text += f"({dtype})"
                if column_descriptions.get(col):
                    col_text += f": {column_descriptions[col]}"
                col_info.append(col_text)

            lines = [
                f"Table: {table_name} (file: {data_file_path}, {num_rows:,} rows)",
                f"  Columns: {', '.join(col_info)}",
            ]

            if description:
                lines.append(f"  Description: {description}")
            extra_lines = table_extra_cache.get(table_name, [])
            for extra in extra_lines:
                lines.append(f"  {extra}")

            if len(df.columns) > 0:
                field_lines = [
                    "    " + get_field_summary(
                        col,
                        df,
                        field_sample_size=7,
                        max_val_chars=80,
                        column_description=column_descriptions.get(col),
                        verbose_name=col_metas.get(col, {}).get("verbose_name"),
                        expression=col_metas.get(col, {}).get("expression"),
                        source_description=col_metas.get(col, {}).get("source_description"),
                        user_description=col_metas.get(col, {}).get("user_description"),
                    )
                    for col in df.columns
                ]
                lines.append("  Field value samples:\n" + "\n".join(field_lines))

            # Sample rows so LLM can see actual data without calling tools
            try:
                sample, displayed_rows, sample_truncated = format_dataframe_sample_with_budget(
                    df,
                    max_rows=TABLE_SAMPLE_MAX_ROWS,
                    max_chars=TABLE_SAMPLE_CHAR_LIMIT,
                    index=False,
                    max_colwidth=40,
                )
                if sample:
                    suffix = " (truncated to fit context budget)" if sample_truncated else ""
                    lines.append(f"  Sample (first {displayed_rows} rows{suffix}):\n{sample}")
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
            logger.warning("Could not read table %s: %s", table_name, type(e).__name__)
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
    Every table includes at most 5 sample rows, bounded by 1000 characters
    per table so wide tables do not cut off later schema or metadata content.

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
                tables_to_inspect,
                workspace=workspace,
                include_data_samples=True,
                row_sample_size=TABLE_SAMPLE_MAX_ROWS,
                sample_char_limit=TABLE_SAMPLE_CHAR_LIMIT,
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

    return content


def handle_search_data_tables(
    query: str,
    scope: str,
    workspace: Any,
) -> str:
    """Handle a search_data_tables tool call.

    Combines workspace metadata search (layer 1) and disk catalog cache
    search (layer 2) into a single Level 0 result set.

    The user home directory is resolved from ``workspace.user_home``
    automatically; catalog cache files live under ``<user_home>/catalog_cache/``.

    Returns a text summary suitable for LLM consumption.  Results are
    capped to keep context usage low (~3K tokens).
    """
    user_home = getattr(workspace, "user_home", None)
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
            from data_formulator.datalake.catalog_cache import (
                search_catalog_cache, list_cached_sources,
            )
            from data_formulator.datalake.catalog_annotations import load_annotations
            from pathlib import Path

            ann_by_source: dict[str, Any] = {}
            for sid in list_cached_sources(user_home):
                ann = load_annotations(Path(user_home), sid)
                if ann:
                    ann_by_source[sid] = ann

            imported_names = {r["name"] for r in results}
            cache_hits = search_catalog_cache(
                user_home,
                query,
                limit_per_source=20,
                exclude_tables=imported_names,
                annotations_by_source=ann_by_source or None,
            )
            for hit in cache_hits:
                results.append({
                    "source": hit.get("source_id", "connected"),
                    "source_id": hit.get("source_id", ""),
                    "table_key": hit.get("table_key", ""),
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
        if r.get("source_id") and r.get("table_key"):
            line += f"  {{source_id: {r['source_id']}, table_key: {r['table_key']}}}"
        lines.append(line)

    text = "\n".join(lines)
    return text[:3000] + "\n..." if len(text) > 3000 else text


def handle_read_catalog_metadata(
    source_id: str,
    table_key: str,
    workspace: Any = None,
) -> str:
    """Handle a read_catalog_metadata tool call.

    Reads the cached catalog entry and overlays user annotations to
    produce a merged metadata view for the LLM.  Returns a text
    summary safe for LLM consumption (no credentials or internal paths).

    The user home directory is resolved from ``workspace.user_home``.
    """
    if not source_id or not table_key:
        return "Both source_id and table_key are required."

    user_home = getattr(workspace, "user_home", None) if workspace else None
    if not user_home:
        return "Cannot read catalog metadata: user home not available."

    from pathlib import Path
    from data_formulator.datalake.catalog_cache import load_catalog
    from data_formulator.datalake.catalog_annotations import load_annotations
    from data_formulator.datalake.catalog_merge import merge_table_metadata

    catalog = load_catalog(Path(user_home), source_id)
    if not catalog:
        return f"No cached catalog found for source '{source_id}'."

    target = None
    for t in catalog:
        if t.get("table_key") == table_key:
            target = t
            break

    if target is None:
        return f"Table with key '{table_key}' not found in source '{source_id}'."

    annotations = load_annotations(Path(user_home), source_id)
    ann_entry = (annotations or {}).get("tables", {}).get(table_key)
    merged = merge_table_metadata(target, ann_entry)
    meta = merged.get("metadata", {})

    # Build LLM-friendly text output with field whitelist
    lines = [f"## {merged.get('name', table_key)}"]
    lines.append(f"Source: {source_id}")
    lines.append(f"Table key: {table_key}")

    if merged.get("path"):
        lines.append(f"Path: {' > '.join(merged['path'])}")

    status = meta.get("source_metadata_status", "not_synced")
    lines.append(f"Metadata status: {status}")

    for field in ("schema", "database", "row_count"):
        val = meta.get(field)
        if val:
            lines.append(f"{field}: {val}")

    display_desc = meta.get("display_description", "")
    if display_desc:
        lines.append(f"\nDescription: {display_desc}")

    src_desc = meta.get("source_description", "")
    usr_desc = meta.get("user_description", "")
    if src_desc and usr_desc and src_desc != usr_desc:
        lines.append(f"Source description: {src_desc}")
        lines.append(f"User annotation: {usr_desc}")

    notes = meta.get("notes", "")
    if notes:
        lines.append(f"Notes: {notes}")

    tags = meta.get("tags")
    if tags:
        lines.append(f"Tags: {', '.join(tags)}")

    columns = meta.get("columns", [])
    if columns:
        lines.append(f"\nColumns ({len(columns)}):")
        for col in columns[:50]:
            cname = col.get("name", "?")
            ctype = col.get("type", "")
            src_cdesc = col.get("source_description", "")
            usr_cdesc = col.get("user_description", "")
            cdesc = col.get("display_description", col.get("description", ""))
            vname = col.get("verbose_name", "")
            expr = col.get("expression", "")
            line = f"  - {cname}"
            if vname:
                line += f" [{vname}]"
            if ctype:
                line += f" ({ctype})"
            if src_cdesc and usr_cdesc and src_cdesc != usr_cdesc:
                line += f": source: {src_cdesc} | user: {usr_cdesc}"
            elif cdesc:
                line += f": {cdesc}"
            if expr:
                line += f"  [calc: {expr}]"
            lines.append(line)
        if len(columns) > 50:
            lines.append(f"  ... and {len(columns) - 50} more columns")

    text = "\n".join(lines)
    return text[:4000] + "\n..." if len(text) > 4000 else text
