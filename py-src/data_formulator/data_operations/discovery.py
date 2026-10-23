from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_PROBE_BUDGET = 20


@dataclass
class ProbeBudget:
    remaining: int = DEFAULT_PROBE_BUDGET

    def consume(self) -> bool:
        if self.remaining <= 0:
            return False
        self.remaining -= 1
        return True


@dataclass(frozen=True)
class ProbeGuidance:
    exhausted: str
    success: str


ANALYST_PROBE_GUIDANCE = ProbeGuidance(
    exhausted=(
        "Probe budget exhausted for this turn. Summarize what you've learned "
        "and propose a data-loading option, or ask the user to continue."
    ),
    success="use a data-loading proposal to load the selected result.",
)

STANDALONE_PROBE_GUIDANCE = ProbeGuidance(
    exhausted=(
        "Probe budget exhausted for this turn. Summarize what you've learned "
        "and call propose_load_plan, or ask the user to continue."
    ),
    success="use propose_load_plan to load the full table.",
)


def _source_is_discoverable(source_id: str) -> bool:
    """Hide sources known to be disconnected; keep unknown status compatible."""
    try:
        from data_formulator.data_connector import connector_is_available
        return connector_is_available(source_id) is not False
    except Exception:
        logger.debug("Connector availability unavailable for %s", source_id, exc_info=True)
        return True


class DataDiscoveryService:
    """Read-only catalog discovery shared by data-loading entry points."""

    def __init__(self, workspace: Any):
        self.workspace = workspace

    def resolve_catalog_path(self, source_id: str, table_key: str) -> list[str] | None:
        from data_formulator.datalake.catalog_cache import load_catalog

        user_home = getattr(self.workspace, "user_home", None)
        if not user_home:
            return None
        try:
            catalog = load_catalog(Path(user_home), source_id) or []
        except Exception:
            logger.debug("probe_data: load_catalog failed", exc_info=True)
            return None
        for table in catalog:
            if table.get("table_key") != table_key:
                continue
            path = table.get("path")
            if path:
                return list(path)
            name = table.get("name")
            return [name] if name else None
        return None

    def resolve_load_table(self, source_id: str, table_key: str) -> dict[str, Any] | None:
        """Resolve model-facing catalog identity into loader and display fields."""
        from data_formulator.datalake.catalog_cache import load_catalog

        user_home = getattr(self.workspace, "user_home", None)
        if not user_home or not source_id or not table_key:
            return None
        try:
            catalog = load_catalog(Path(user_home), source_id) or []
        except Exception:
            logger.debug("load table catalog resolution failed", exc_info=True)
            return None
        for table in catalog:
            metadata = table.get("metadata") or {}
            identifiers = {
                str(table.get("table_key") or ""),
                str(metadata.get("uuid") or ""),
                str(metadata.get("dataset_id") or ""),
                str(metadata.get("_source_name") or ""),
                str(table.get("name") or ""),
            }
            if table_key not in identifiers:
                continue
            display_name = str(table.get("name") or table_key)
            source_table = metadata.get("dataset_id")
            if source_table is None:
                source_table = metadata.get("_source_name") or table_key
            source_table_name = (
                metadata.get("_source_name")
                or metadata.get("_catalogName")
                or display_name
            )
            return {
                "display_name": display_name,
                "source_table": str(source_table),
                "source_table_name": str(source_table_name),
                "row_count": metadata.get("row_count"),
                "metadata": metadata,
            }
        return None

    def probe_data(
        self,
        args: dict[str, Any],
        budget: ProbeBudget,
        guidance: ProbeGuidance = ANALYST_PROBE_GUIDANCE,
    ) -> dict[str, Any]:
        from data_formulator.data_loader.probe_utils import PROBE_MAX_ROWS

        source_id = (args.get("source_id") or "").strip()
        table_key = (args.get("table_key") or "").strip()
        query = args.get("query") or {}
        if not source_id or not table_key:
            return {"error": "source_id and table_key are required"}
        if not isinstance(query, dict):
            return {"error": "query must be an object"}
        if isinstance(query.get("order_by"), dict):
            query = {**query, "order_by": [query["order_by"]]}
        if budget.remaining <= 0:
            return {"error": guidance.exhausted}

        path = self.resolve_catalog_path(source_id, table_key)
        if path is None:
            return {"error": (
                f"table_key '{table_key}' not found in source '{source_id}'. "
                "Use find_data / describe_data to get an exact table_key first."
            )}

        try:
            from data_formulator.data_connector import resolve_live_loader
            loader = resolve_live_loader(source_id)
        except Exception as exc:
            return {"error": f"source '{source_id}' is not connected: {exc}"}

        budget.consume()
        try:
            from data_formulator.data_loader.query_runtime import execute_source_query
            if query.get("native") is not None:
                result = self._probe_native(loader, source_id, table_key, query)
            else:
                result = execute_source_query(loader, "probe", path, query)
        except Exception as exc:
            logger.debug("probe_data failed", exc_info=True)
            return {"error": f"probe failed: {exc}"}

        if isinstance(result, dict) and "error" not in result:
            result.setdefault(
                "note",
                f"probe returns at most {PROBE_MAX_ROWS} rows for inspection; "
                f"{guidance.success}",
            )
        return result

    def _probe_native(self, loader: Any, source_id: str, table_key: str, query: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.data_loader import probe_utils
        from data_formulator.data_loader.query_runtime import execute_source_query
        from .models import LoadQuery

        parsed = LoadQuery.from_dict(query)
        loader.check_native_query(parsed.native)
        resolved = self.resolve_load_table(source_id, table_key)
        if resolved is None:
            return {"error": f"table_key '{table_key}' not found in source '{source_id}'."}
        out_limit = probe_utils.clamp_probe_limit(parsed.limit)
        table = execute_source_query(
            loader, "query_data_as_arrow", source_table=resolved["source_table"],
            query=parsed.to_dict(), limit=out_limit + 1,
        )
        return probe_utils.shape_probe_payload(
            table.slice(0, out_limit), out_limit, exact=True, extra_note="native query",
        )