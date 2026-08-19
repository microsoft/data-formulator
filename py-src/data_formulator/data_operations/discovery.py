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

    def list_data(self, args: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.datalake.catalog_cache import (
            list_path_children,
            list_sources_summary,
        )

        user_home = getattr(self.workspace, "user_home", None)
        if not user_home:
            return {"sources": []}
        snapshots = ensure_catalogs_current(user_home)

        source_id = (args.get("source_id") or "").strip()
        if not source_id:
            try:
                sources = list_sources_summary(user_home)
            except Exception:
                logger.debug("list_data: list_sources_summary failed", exc_info=True)
                return {"sources": []}
            try:
                from data_formulator.data_connector import list_available_connector_ids
                summarized_ids = {
                    source.get("source_id") or source.get("id")
                    for source in sources
                }
                sources.extend({
                    "source_id": source_id,
                    "table_count": 0,
                    "is_hierarchical": False,
                    "connected": True,
                    "catalog_status": "not_cached",
                } for source_id in list_available_connector_ids() if source_id not in summarized_ids)
            except Exception:
                logger.debug("list_data: available connector inventory failed", exc_info=True)
            # A retained catalog is storage, not connection state. Do not offer
            # sources that are definitively unavailable to the current identity.
            sources = [
                source for source in sources
                if not (source.get("source_id") or source.get("id"))
                or _source_is_discoverable(source.get("source_id") or source.get("id"))
            ]
            try:
                for source in sources:
                    sid = source.get("source_id") or source.get("id")
                    if sid in snapshots and (
                        snapshots[sid].listing_freshness != "fresh"
                        or snapshots[sid].metadata_freshness != "fresh"
                        or snapshots[sid].last_refresh_error
                    ):
                        source["freshness"] = _freshness_payload(snapshots[sid])
            except Exception:
                logger.debug("list_data: freshness annotation failed", exc_info=True)
            return {"sources": sources}

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
                filter=args.get("filter"),
            )
            if source_id in snapshots:
                result["freshness"] = _freshness_payload(snapshots[source_id])
            return result
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
        snapshots = ensure_catalogs_current(user_home)
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
                    f"No tables matched query={query!r} scope={scope_raw!r}. "
                    "Try a broader pattern, alternation (a|b), or list_data to browse."
                ),
            }

        return {
            "results": results[:limit],
            "query": query,
            "scope": scope_raw,
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