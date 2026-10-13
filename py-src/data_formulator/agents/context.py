# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Shared context helpers for agents: workspace metadata lookups, source inspection,
and catalog metadata. The analyst's view of the session is the session layer
(analyst/session_layer, design-docs/61)."""

import json
import logging
from typing import Any

from data_formulator.agents.agent_utils import (
    generate_data_summary,
    _format_import_options,
)
from data_formulator.data_operations.discovery import ensure_no_auth_catalogs_cached

logger = logging.getLogger(__name__)

TABLE_SAMPLE_MAX_ROWS = 5
TABLE_SAMPLE_CHAR_LIMIT = 1000



def _get_workspace_metadata_lookups(workspace: Any) -> tuple[dict[str, str], dict[str, dict[str, str]], dict[str, str]]:
    """Return table descriptions, column descriptions, and import options from workspace metadata."""
    table_descs: dict[str, str] = {}
    col_descs: dict[str, dict[str, str]] = {}
    import_opts: dict[str, str] = {}
    try:
        ws_meta = workspace.get_metadata()
        if not ws_meta:
            return table_descs, col_descs, import_opts
        for tname, tmeta in ws_meta.tables.items():
            if tmeta.description:
                table_descs[tname] = tmeta.description
            table_cols = {}
            for col in tmeta.columns or []:
                if col.description:
                    table_cols[col.name] = col.description
            if table_cols:
                col_descs[tname] = table_cols
            opts_line = _format_import_options(tmeta.import_options)
            if opts_line:
                import_opts[tname] = opts_line
    except Exception:
        logger.debug("Could not read workspace metadata for agent context", exc_info=True)
    return table_descs, col_descs, import_opts


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


def _fetch_live_metadata(source_id: str, path: list) -> dict[str, Any] | None:
    """Best-effort live ``get_metadata`` for a catalog table node.

    Resolves the connected loader for ``source_id`` within the current request
    identity and returns its live metadata dict (columns, types, row_count,
    sample_rows). Returns ``None`` on any failure — callers must degrade to the
    cache-only view. Never raises.
    """
    if not source_id or not path:
        return None
    try:
        from data_formulator.data_connector import resolve_live_loader

        loader = resolve_live_loader(source_id)
        meta = loader.get_metadata(list(path))
        return meta or None
    except Exception:
        logger.debug(
            "Live metadata fallback failed for %s/%s", source_id, path,
            exc_info=True,
        )
        return None


def handle_read_catalog_metadata(
    source_id: str,
    table_key: str,
    workspace: Any = None,
    *,
    column_offset: int = 0,
    column_query: str | None = None,
    role: str | None = None,
    relationship_offset: int | None = None,
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

    from data_formulator.datalake.connector_preferences import connector_is_enabled
    if not connector_is_enabled(user_home, source_id):
        return f"Source '{source_id}' is disconnected."

    # Surface zero-config admin connectors (e.g. sample_datasets) on first use.
    ensure_no_auth_catalogs_cached(user_home)

    from pathlib import Path
    from data_formulator.datalake.catalog_cache import load_catalog

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

    meta = target.get("metadata") or {}

    # Live fallback (design 37 §4.1 / §9.2): when the cached entry is a table
    # node whose columns were never synced (e.g. cluster-wide Kusto browse
    # skips per-DB schema for perf), fetch live schema from the connected
    # loader so the agent can actually reason about filters/aggregations.
    # Always auto — no flag. Best-effort: any failure leaves the cache-only
    # view intact. Results are NOT written back to the cache (we stay
    # agentic, design 37 §3.6).
    live_note = None
    if not meta.get("columns") and target.get("path"):
        live_meta = _fetch_live_metadata(source_id, target.get("path"))
        if live_meta and live_meta.get("columns"):
            merged = dict(meta)
            merged.update(live_meta)
            meta = merged
            live_note = "live (fetched from source; not cached)"

    # Build LLM-friendly text output with field whitelist
    lines = [f"## {target.get('name', table_key)}"]
    lines.append(f"Source: {source_id}")
    lines.append(f"Table key: {table_key}")

    if target.get("path"):
        lines.append(f"Path: {' > '.join(target['path'])}")

    status = live_note or meta.get("source_metadata_status", "not_synced")
    lines.append(f"Metadata status: {status}")

    for field in ("schema", "database", "row_count"):
        val = meta.get(field)
        if val is not None:
            lines.append(f"{field}: {val}")

    inspection = meta.get("inspection") or {}
    if inspection:
        details = {key: inspection[key] for key in (
            "schema_source", "schema_complete", "row_count_status", "sample_status",
            "sample_method", "filtered", "row_limit", "columns_omitted", "values_truncated",
        ) if key in inspection}
        lines.append("Inspection: " + json.dumps(details))
        if inspection.get("row_count_status") == "unknown":
            lines.append("Row count not collected; no full count scan was requested.")
        if inspection.get("schema_source") == "inferred":
            lines.append("Schema inferred from a bounded sample; later records may differ.")

    sample = meta.get("sample_rows")
    if sample is not None:
        sample_text = json.dumps(sample[:TABLE_SAMPLE_MAX_ROWS], default=str, ensure_ascii=False)
        sample_limit = min(TABLE_SAMPLE_CHAR_LIMIT, 500)
        shortened = len(sample_text) > sample_limit
        lines.append("Sample rows (not necessarily representative): " + sample_text[:sample_limit]
                     + ("... [sample text truncated]" if shortened else ""))

    table_desc = meta.get("description", "") or meta.get("source_description", "")
    if table_desc:
        lines.append(f"\nDescription: {table_desc}")

    header = "\n".join(lines)
    lines = [header if len(header) <= 1200 else header[:1200] + "\n[Summary truncated]"]
    columns = meta.get("columns") or []
    relationships = meta.get("relationships") or []
    if meta.get("query_model") == "semantic":
        roles = [col.get("role") for col in columns]
        lines.append(
            f"\nSemantic model: {len(columns)} fields: {roles.count('measure')} measures, "
            f"{roles.count('dimension')} dimensions, {roles.count('time_dimension')} time dimensions."
            " Select dimensions and measures in query.columns; the model groups by the selected dimensions."
        )

    if relationship_offset is not None:
        start = max(0, int(relationship_offset))
        matching = relationships
        label, cursor, filtered = "Relationships", "relationship_offset", ""
        lines.append("For fields, omit relationship_offset.")
    else:
        needle = (column_query or "").casefold().strip()
        matching = [
            col for col in columns
            if (not role or col.get("role") == role)
            and (not needle or needle in f"{col.get('name', '')} {col.get('description', '')}".casefold())
        ]
        start = max(0, int(column_offset or 0))
        filtered = " matching the filter" if needle or role else ""
        label, cursor = "Columns", "column_offset"
        if relationships and not column_offset:
            lines.append(f"Relationships: {len(relationships)} available; request relationship_offset=0.")

    if start >= len(matching):
        lines.append(f"\nNo {label.lower()}{filtered} at {cursor}={start}; {len(matching)} available.")
    else:
        budget = _CATALOG_METADATA_CHAR_LIMIT - len("\n".join(lines)) - 256
        page: list[str] = []
        for item in matching[start:start + _CATALOG_COLUMNS_PER_PAGE]:
            line = ("  - " + json.dumps(item, ensure_ascii=False) if relationship_offset is not None
                    else _format_catalog_column(item))
            if len(line) + 1 > budget:
                if page:
                    break
                marker = "... [metadata truncated]"
                line = line[:budget - len(marker) - 1] + marker
            page.append(line)
            budget -= len(line) + 1
        end = start + len(page)
        lines.append(f"\n{label} {start + 1}-{end} of {len(matching)}{filtered}:")
        lines.extend(page)
        if end < len(matching):
            lines.append(f"  Next: {cursor}={end}. Keep the same source, table, and filters.")

    return "\n".join(lines)


_CATALOG_METADATA_CHAR_LIMIT = 4000
_CATALOG_COLUMNS_PER_PAGE = 50


def _format_catalog_column(col: dict[str, Any]) -> str:
    details = [str(col[key]) for key in ("type", "role") if col.get(key)]
    if col.get("entity"):
        details.append(f"entity={col['entity']}")
    if col.get("aggregation"):
        details.append(f"aggregation={col['aggregation']}")
    if col.get("granularities"):
        details.append("granularities=" + "/".join(map(str, col["granularities"])))
    if col.get("ref"):
        details.append(f"ref={col['ref']}")
    if col.get("format"):
        details.append(f"format={col['format']}")
    line = f"  - {col.get('name', '?')}"
    if col.get("verbose_name"):
        line += f" [{col['verbose_name']}]"
    if details:
        line += f" ({', '.join(details)})"
    description = col.get("description", "") or col.get("source_description", "")
    if description:
        line += f": {description[:300]}" + ("... [description truncated]" if len(description) > 300 else "")
    if col.get("expression"):
        expression = str(col["expression"])
        line += f"  [calc: {expression[:300]}" + ("... [expression truncated]" if len(expression) > 300 else "") + "]"
    return line
