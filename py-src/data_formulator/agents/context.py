# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Shared context helpers for agents: workspace metadata lookups and catalog column formatting.
The analyst's view of the session is the session layer (analyst/session_layer, design-docs/61)."""

import logging
from typing import Any

from data_formulator.agents.agent_utils import _format_import_options

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
