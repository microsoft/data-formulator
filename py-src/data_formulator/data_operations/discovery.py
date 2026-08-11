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


class DataDiscoveryService:
    """Read-only catalog discovery shared by data-loading entry points."""

    def __init__(self, workspace: Any):
        self.workspace = workspace

    def list_data(self, args: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.datalake.catalog_cache import (
            list_path_children,
            list_sources_summary,
        )

        user_home = getattr(self.workspace, "user_home", None)
        if not user_home:
            return {"sources": []}

        source_id = (args.get("source_id") or "").strip()
        if not source_id:
            try:
                sources = list_sources_summary(user_home)
            except Exception:
                logger.debug("list_data: list_sources_summary failed", exc_info=True)
                return {"sources": []}
            # Mark unreachable sources so the agent steers around them instead
            # of proposing a load that can only fail.
            try:
                from data_formulator.data_connector import connector_is_available
                for source in sources:
                    sid = source.get("source_id") or source.get("id")
                    if sid and connector_is_available(sid) is False:
                        source["connected"] = False
            except Exception:
                logger.debug("list_data: availability check failed", exc_info=True)
            return {"sources": sources}

        path = args.get("path") or []
        if not isinstance(path, list):
            return {"error": "path must be an array of strings"}

        try:
            return list_path_children(
                user_home,
                source_id,
                path=path,
                filter=args.get("filter"),
            )
        except Exception as exc:
            logger.debug("list_data: list_path_children failed", exc_info=True)
            return {"error": f"list_data failed: {exc}"}

    def find_data(self, args: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.datalake.catalog_cache import (
            CatalogSearchError,
            list_cached_sources,
            search_catalog_cache,
        )

        query = (args.get("query") or "").strip()
        if not query:
            return {"error": "query is required"}

        scope_raw = (args.get("scope") or "all").strip()
        exclude = args.get("exclude") or None
        fields = args.get("fields") or None
        limit = args.get("limit")
        try:
            limit = max(1, min(int(limit), 200)) if limit else 50
        except (TypeError, ValueError):
            limit = 50

        search_workspace = False
        source_ids: list[str] | None = None
        path_prefix: list[str] | None = None

        if scope_raw == "all":
            search_workspace = True
        elif scope_raw == "workspace":
            search_workspace = True
            source_ids = []
        elif scope_raw == "connected":
            pass
        elif ":" in scope_raw:
            source_id, _, path_str = scope_raw.partition(":")
            source_ids = [source_id.strip()] if source_id.strip() else []
            path_prefix = [segment for segment in path_str.split("/") if segment]
        else:
            source_ids = [scope_raw]

        user_home = getattr(self.workspace, "user_home", None)
        results: list[dict[str, Any]] = []

        if search_workspace:
            try:
                metadata = self.workspace.get_metadata()
                if metadata:
                    for hit in metadata.search_tables(query, limit=min(limit, 50)):
                        results.append({
                            "source": "workspace",
                            "name": hit["name"],
                            "description": (hit.get("description") or "")[:120],
                            "matched_columns": hit.get("matched_columns", []),
                            "status": "imported",
                        })
            except Exception:
                logger.debug("find_data: workspace search failed", exc_info=True)

        if source_ids != [] and user_home:
            try:
                imported_names = {result["name"] for result in results}
                cache_hits = search_catalog_cache(
                    user_home,
                    query,
                    source_ids=source_ids,
                    limit_per_source=min(limit, 50),
                    exclude_tables=imported_names,
                    exclude_pattern=exclude,
                    fields=fields,
                    path_prefix=path_prefix,
                )
                for hit in cache_hits[:limit]:
                    results.append({
                        "source": hit.get("source_id", "connected"),
                        "source_id": hit.get("source_id", ""),
                        "table_key": hit.get("table_key", ""),
                        "name": hit["name"],
                        "description": (hit.get("description") or "")[:120],
                        "matched_columns": hit.get("matched_columns", []),
                        "status": "not imported",
                    })
            except CatalogSearchError as exc:
                return {"error": str(exc)}
            except Exception:
                logger.debug("find_data: catalog search failed", exc_info=True)

        if not results:
            try:
                known = sorted(list_cached_sources(user_home) or []) if user_home else []
            except Exception:
                known = []
            return {
                "results": [],
                "valid_source_ids": known,
                "note": (
                    f"No tables matched query={query!r} scope={scope_raw!r}. "
                    "Try a broader pattern, alternation (a|b), or list_data to browse."
                ),
            }

        return {"results": results[:limit], "query": query, "scope": scope_raw}

    def describe_data(self, args: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.agents.context import handle_read_catalog_metadata

        source_id = args.get("source_id", "")
        table_key = args.get("table_key", "")
        return {
            "result": handle_read_catalog_metadata(
                source_id,
                table_key,
                self.workspace,
            )
        }

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
            result = loader.probe(path, query)
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