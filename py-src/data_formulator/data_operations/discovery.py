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


def ensure_catalogs_current(user_home: Any) -> dict[str, Any]:
    """Apply source policies and return current snapshots, including stale ones."""
    if not user_home:
        return {}
    snapshots: dict[str, Any] = {}
    try:
        from data_formulator.data_connector import (
            _ADMIN_CONNECTOR_IDS,
            connector_is_available,
            list_available_connector_ids,
        )
        from data_formulator.datalake.catalog_cache import list_cached_sources
        from data_formulator.datalake.connector_preferences import connector_is_enabled
        from data_formulator.datalake.catalog_refresh import ensure_catalog_freshness

        source_ids = (
            set(list_cached_sources(user_home))
            | set(_ADMIN_CONNECTOR_IDS)
            | set(list_available_connector_ids())
        )
        source_ids = {
            source_id for source_id in source_ids
            if connector_is_enabled(user_home, source_id)
            and connector_is_available(source_id) is not False
        }
        for source_id in source_ids:
            snapshot = ensure_catalog_freshness(Path(user_home), source_id)
            if snapshot is not None:
                snapshots[source_id] = snapshot
    except Exception:
        logger.debug("Catalog freshness setup failed", exc_info=True)
    return snapshots


def ensure_no_auth_catalogs_cached(user_home: Any) -> None:
    """Backward-compatible alias for callers migrated from catalog bootstrap."""
    ensure_catalogs_current(user_home)


def _freshness_payload(snapshot: Any) -> dict[str, Any]:
    return {
        "listing": snapshot.listing_freshness,
        "metadata": snapshot.metadata_freshness,
        "listing_age_seconds": snapshot.listing_age_seconds,
        "metadata_age_seconds": snapshot.metadata_age_seconds,
        "last_refresh_error": snapshot.last_refresh_error,
    }


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

    @staticmethod
    def _connected_source_inventory(
        user_home: Any,
        snapshots: dict[str, Any],
    ) -> list[dict[str, Any]]:
        from data_formulator.datalake.catalog_cache import list_sources_summary

        try:
            sources = list_sources_summary(user_home)
        except Exception:
            logger.debug("connected source inventory failed", exc_info=True)
            sources = []
        try:
            from data_formulator.data_connector import list_available_connector_ids
            summarized_ids = {source.get("source_id") for source in sources}
            sources.extend({
                "source_id": source_id,
                "table_count": 0,
                "is_hierarchical": False,
                "connected": True,
                "catalog_status": "not_cached",
            } for source_id in list_available_connector_ids() if source_id not in summarized_ids)
        except Exception:
            logger.debug("available connector inventory failed", exc_info=True)

        sources = [
            source for source in sources
            if not source.get("source_id")
            or _source_is_discoverable(source["source_id"])
        ]
        for source in sources:
            source_id = source.get("source_id")
            snapshot = snapshots.get(source_id)
            if snapshot and (
                snapshot.listing_freshness != "fresh"
                or snapshot.metadata_freshness != "fresh"
                or snapshot.last_refresh_error
            ):
                source["freshness"] = _freshness_payload(snapshot)
        return sorted(sources, key=lambda source: source.get("source_id", ""))

    def list_data(self, args: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.datalake.catalog_cache import (
            list_path_children,
            list_sources_summary,
        )

        user_home = getattr(self.workspace, "user_home", None)
        if not user_home:
            return {"path": [], "items": [], "total_count": 0, "truncated": False}
        snapshots = ensure_catalogs_current(user_home)

        source_id = (args.get("source_id") or "").strip()
        if not source_id:
            sources = self._connected_source_inventory(user_home, snapshots)
            items = [{
                "type": "source",
                "name": source["source_id"],
                "path": [source["source_id"]],
                **{key: value for key, value in source.items() if key != "source_id"},
            } for source in sources]
            return {
                "path": [],
                "items": items,
                "total_count": len(items),
                "truncated": False,
            }

        from data_formulator.datalake.connector_preferences import connector_is_enabled
        if not connector_is_enabled(user_home, source_id) or not _source_is_discoverable(source_id):
            return {"error": f"Source '{source_id}' is disconnected."}

        from data_formulator.datalake.catalog_cache import list_cached_sources
        if source_id not in set(list_cached_sources(user_home)):
            try:
                from data_formulator.data_connector import resolve_live_loader
                from data_formulator.datalake.catalog_refresh import ensure_catalog_freshness
                resolve_live_loader(source_id)
                snapshot = ensure_catalog_freshness(user_home, source_id)
                if snapshot is not None:
                    snapshots[source_id] = snapshot
            except Exception as exc:
                logger.debug("list_data: catalog bootstrap failed", exc_info=True)
                return {"error": f"Source '{source_id}' is connected but its catalog could not be loaded: {exc}"}

        path = args.get("path") or []
        if not isinstance(path, list):
            return {"error": "path must be an array of strings"}

        try:
            result = list_path_children(
                user_home,
                source_id,
                path=path,
                filter_by=args.get("filter_by"),
                limit=args.get("limit") or 100,
                start_after=args.get("start_after"),
            )
            if source_id in snapshots:
                result["freshness"] = _freshness_payload(snapshots[source_id])
            return result
        except Exception as exc:
            logger.debug("list_data: list_path_children failed", exc_info=True)
            return {"error": f"list_data failed: {exc}"}

    def summarize_data_sources(self, args: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.datalake.catalog_cache import summarize_catalog_sources

        user_home = getattr(self.workspace, "user_home", None)
        if not user_home:
            return {"sources": []}
        snapshots = ensure_catalogs_current(user_home)
        inventory = self._connected_source_inventory(user_home, snapshots)
        try:
            cached = {
                source["source_id"]: source
                for source in summarize_catalog_sources(user_home)
            }
        except Exception:
            logger.debug("summarize_data_sources: catalog summary failed", exc_info=True)
            cached = {}

        sources: list[dict[str, Any]] = []
        for source in inventory:
            source_id = source["source_id"]
            summary = cached.get(source_id, {
                "source_id": source_id,
                "table_count": source.get("table_count", 0),
                "folder_count": 0,
                "max_depth": 0,
                "top_level": [],
                "sample_tables": [],
                "omitted": {"top_level": 0, "tables": 0},
            })
            if source.get("catalog_status"):
                summary["catalog_status"] = source["catalog_status"]
            if source.get("freshness"):
                summary["freshness"] = source["freshness"]
            sources.append(summary)
        return {"sources": sources}

    def find_data(self, args: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.datalake.catalog_cache import (
            CatalogSearchError,
            find_catalog_cache,
            list_cached_sources,
        )

        query = (args.get("query") or "").strip() or None
        source_id = (args.get("source_id") or "").strip()
        path = args.get("path") or []
        if not isinstance(path, list):
            return {"error": "path must be an array of strings"}
        path = [str(segment) for segment in path]
        if path and not source_id:
            return {"error": "path requires source_id"}

        filter_by = (args.get("filter_by") or "").strip() or None
        if filter_by not in {None, "folder", "table"}:
            return {"error": "filter_by must be 'folder' or 'table'"}

        fields = args.get("fields") or None
        limit = args.get("limit")
        try:
            limit = max(1, min(int(limit), 500)) if limit else 100
        except (TypeError, ValueError):
            limit = 100

        search_workspace = not source_id
        source_ids = [source_id] if source_id else None

        user_home = getattr(self.workspace, "user_home", None)
        snapshots = ensure_catalogs_current(user_home)
        results: list[dict[str, Any]] = []
        workspace_truncated = False

        if search_workspace and filter_by != "folder":
            try:
                if query:
                    metadata = self.workspace.get_metadata()
                    workspace_hits = (
                        metadata.search_tables(query, limit=min(limit + 1, 501))
                        if metadata else []
                    )
                    workspace_truncated = len(workspace_hits) > limit
                    for hit in workspace_hits[:limit]:
                        results.append({
                            "type": "table",
                            "source": "workspace",
                            "name": hit["name"],
                            "path": [hit["name"]],
                            "description": (hit.get("description") or "")[:120],
                            "matched_columns": hit.get("matched_columns", []),
                            "status": "imported",
                        })
                else:
                    workspace_tables = self.workspace.list_tables()
                    workspace_truncated = len(workspace_tables) > limit
                    for table in workspace_tables[:limit]:
                        name = table if isinstance(table, str) else table.get("name", "")
                        if name:
                            results.append({
                                "type": "table",
                                "source": "workspace",
                                "name": name,
                                "path": [name],
                                "status": "imported",
                            })
            except Exception:
                logger.debug("find_data: workspace search failed", exc_info=True)

        catalog_truncated = False
        if user_home:
            try:
                if source_ids is None:
                    source_ids = [
                        source_id for source_id in list_cached_sources(user_home)
                        if _source_is_discoverable(source_id)
                    ]
                else:
                    source_ids = [
                        source_id for source_id in source_ids
                        if _source_is_discoverable(source_id)
                    ]
                imported_names = {result["name"] for result in results}
                cache_hits, catalog_truncated = find_catalog_cache(
                    user_home,
                    query,
                    source_ids=source_ids,
                    limit=limit,
                    exclude_tables=imported_names,
                    filter_by=filter_by,
                    fields=fields,
                    path_prefix=path,
                )
                for hit in cache_hits:
                    hit["source"] = hit.get("source_id", "connected")
                    if hit["type"] == "table":
                        hit["status"] = "not imported"
                    results.append(hit)
            except CatalogSearchError as exc:
                return {"error": str(exc)}
            except Exception:
                logger.debug("find_data: catalog search failed", exc_info=True)

        if not results:
            try:
                known = sorted(
                    source_id
                    for source_id in (list_cached_sources(user_home) or [])
                    if _source_is_discoverable(source_id)
                ) if user_home else []
            except Exception:
                known = []
            return {
                "results": [],
                "valid_source_ids": known,
                "catalog_freshness": {
                    source_id: _freshness_payload(snapshot)
                    for source_id, snapshot in snapshots.items()
                },
                "note": (
                    f"No data matched query={query!r} in the requested scope. "
                    "Try a broader pattern or use list_data to browse immediate children."
                ),
                "truncated": False,
            }

        truncated = workspace_truncated or catalog_truncated or len(results) > limit
        return {
            "results": results[:limit],
            "query": query,
            "source_id": source_id or None,
            "path": path,
            "filter_by": filter_by,
            "truncated": truncated,
            "catalog_freshness": {
                source_id: _freshness_payload(snapshot)
                for source_id, snapshot in snapshots.items()
            },
        }

    def describe_data(self, args: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.agents.context import handle_read_catalog_metadata

        source_id = args.get("source_id", "")
        table_key = args.get("table_key", "")
        user_home = getattr(self.workspace, "user_home", None)
        if user_home:
            from data_formulator.datalake.connector_preferences import connector_is_enabled
            if not connector_is_enabled(user_home, source_id) or not _source_is_discoverable(source_id):
                return {"error": f"Source '{source_id}' is disconnected."}
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