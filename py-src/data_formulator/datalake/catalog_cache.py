"""Catalog cache — persist lightweight list_tables() results to disk.

Stored as JSON files under ``<workspace_root>/catalog_cache/<source_id>.json``.
Used by agents to search available data without live connections.

File format::

    {
        "source_id": "superset_prod",
        "synced_at": "2026-04-28T10:00:00Z",
        "tables": [
            {
                "table_key": "a1b2c3d4-...",
                "name": "42:monthly_orders",
                "path": ["Sales Dashboard", "monthly_orders"],
                "metadata": { ... }
            }
        ]
    }
"""

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from data_formulator.datalake.naming import safe_source_id
from data_formulator.security.path_safety import ConfinedDir

logger = logging.getLogger(__name__)

CATALOG_CACHE_DIR = "catalog_cache"
CATALOG_CACHE_SCHEMA_VERSION = 2


@dataclass(frozen=True)
class CatalogSnapshot:
    source_id: str
    tables: list[dict[str, Any]]
    listing_refreshed_at: str | None
    metadata_refreshed_at: str | None
    listing_age_seconds: int | None
    metadata_age_seconds: int | None
    listing_freshness: str
    metadata_freshness: str
    refresh_kind: str
    refresh_status: str
    last_refresh_attempt_at: str | None
    last_refresh_error: str | None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _age_and_freshness(
    value: Any,
    ttl_seconds: int | None,
    now: datetime,
) -> tuple[int | None, str]:
    timestamp = _parse_timestamp(value)
    if timestamp is None:
        return None, "unknown"
    age = max(0, int((now - timestamp).total_seconds()))
    if ttl_seconds is None:
        return age, "fresh"
    return age, "fresh" if age <= max(0, ttl_seconds) else "stale"


class CatalogSearchError(ValueError):
    """Raised when a catalog search receives a malformed query (e.g. bad regex).

    Agent tools should catch this and surface the message verbatim so the
    model can correct its query, instead of returning an empty result set.
    """


def _cache_dir(workspace_root: Path | str) -> Path:
    return Path(workspace_root) / CATALOG_CACHE_DIR


def _cache_jail(workspace_root: Path | str, *, mkdir: bool) -> ConfinedDir:
    return ConfinedDir(_cache_dir(workspace_root), mkdir=mkdir)


def _cache_filename(source_id: str) -> str:
    return f"{safe_source_id(source_id)}.json"


def _cache_file(
    workspace_root: Path | str,
    source_id: str,
    *,
    mkdir: bool = False,
) -> Path:
    return _cache_jail(workspace_root, mkdir=mkdir).resolve(_cache_filename(source_id))


def _atomic_write_payload(
    workspace_root: Path | str,
    source_id: str,
    payload: dict[str, Any],
) -> None:
    jail = _cache_jail(workspace_root, mkdir=True)
    filename = _cache_filename(source_id)
    target = jail.resolve(filename)
    temporary = jail.resolve(f".{filename}.{os.getpid()}.{uuid4().hex}.tmp")
    try:
        with open(temporary, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, default=str)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def _merge_catalog_listing(
    previous_tables: list[dict[str, Any]],
    listing_tables: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    def identity(table: dict[str, Any]) -> tuple[Any, ...]:
        return (
            table.get("table_key") or "",
            tuple(table.get("path") or []),
            table.get("name") or "",
        )

    previous_by_identity = {identity(table): table for table in previous_tables}
    merged: list[dict[str, Any]] = []
    for table in listing_tables:
        prior = previous_by_identity.get(identity(table))
        if not prior:
            merged.append(table)
            continue
        combined = {**prior, **table}
        prior_metadata = prior.get("metadata") or {}
        listing_metadata = table.get("metadata") or {}
        metadata = dict(prior_metadata)
        for key, value in listing_metadata.items():
            if value not in (None, "", [], {}):
                metadata[key] = value
        if metadata:
            combined["metadata"] = metadata
        merged.append(combined)
    return merged


def save_catalog(
    workspace_root: Path | str,
    source_id: str,
    tables: list[dict[str, Any]],
    *,
    mode: str = "replace",
    refresh_kind: str = "full",
    refresh_status: str = "complete",
) -> None:
    """Persist catalog data to disk. Best-effort — errors are logged, not raised.

    ``mode="replace"`` stores a fresh source snapshot. ``mode="seed_if_missing"``
    only writes when no cache exists, so lightweight list calls cannot downgrade
    a richer sync-catalog-metadata snapshot.
    """
    try:
        path = _cache_file(workspace_root, source_id, mkdir=True)
        if mode == "seed_if_missing" and path.exists():
            logger.debug("Catalog cache seed skipped; cache already exists: %s", path)
            return
        if mode not in ("replace", "seed_if_missing"):
            logger.debug("Unknown catalog cache save mode %s for %s", mode, source_id)
            mode = "replace"
        previous = _load_catalog_raw(workspace_root, source_id) or {}
        now = _utc_now().isoformat()
        if refresh_kind not in ("listing", "full"):
            refresh_kind = "full"
        if refresh_kind == "listing":
            tables = _merge_catalog_listing(previous.get("tables") or [], tables)
        metadata_refreshed_at = (
            now
            if refresh_kind == "full"
            else previous.get("metadata_refreshed_at") or previous.get("synced_at")
        )
        payload = {
            "schema_version": CATALOG_CACHE_SCHEMA_VERSION,
            "source_id": source_id,
            "synced_at": now,
            "listing_refreshed_at": now,
            "metadata_refreshed_at": metadata_refreshed_at,
            "refresh_kind": refresh_kind,
            "refresh_status": refresh_status,
            "last_refresh_attempt_at": now,
            "last_refresh_error": None,
            "tables": tables,
        }
        _atomic_write_payload(workspace_root, source_id, payload)
        logger.debug("Catalog cache written: %s (%d tables)", path, len(tables))
    except Exception:
        logger.debug("Failed to write catalog cache for %s", source_id, exc_info=True)


def record_catalog_refresh_failure(
    workspace_root: Path | str,
    source_id: str,
    error: str,
) -> None:
    """Record a safe refresh failure without replacing the last good tables."""
    try:
        payload = _load_catalog_raw(workspace_root, source_id)
        if not payload:
            return
        payload = dict(payload)
        payload["schema_version"] = CATALOG_CACHE_SCHEMA_VERSION
        payload["refresh_status"] = "failed"
        payload["last_refresh_attempt_at"] = _utc_now().isoformat()
        payload["last_refresh_error"] = error[:160]
        _atomic_write_payload(workspace_root, source_id, payload)
    except Exception:
        logger.debug("Failed to record catalog refresh failure for %s", source_id, exc_info=True)


def _load_catalog_raw(workspace_root: Path | str, source_id: str) -> dict[str, Any] | None:
    """Load raw catalog JSON (including original ``source_id`` key)."""
    path: Path | None = None
    try:
        path = _cache_file(workspace_root, source_id)
        if not path.exists():
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.debug("Failed to read catalog cache %s", path, exc_info=True)
        return None


def load_catalog(workspace_root: Path | str, source_id: str) -> list[dict[str, Any]] | None:
    """Load cached catalog. Returns None if not found or corrupted.

    In disabled-connectors mode, only admin source_ids (e.g.
    ``sample_datasets``) are readable — user catalogs on disk are hidden.
    """
    try:
        from flask import current_app
        disabled = bool(
            current_app.config.get('CLI_ARGS', {}).get('disable_data_connectors')
        )
    except RuntimeError:
        disabled = False
    if disabled:
        try:
            from data_formulator.data_connector import _ADMIN_CONNECTOR_IDS
            if source_id not in _ADMIN_CONNECTOR_IDS:
                return None
        except Exception:
            pass
    raw = _load_catalog_raw(workspace_root, source_id)
    if raw is None:
        return None
    return raw.get("tables", [])


def load_catalog_snapshot(
    workspace_root: Path | str,
    source_id: str,
    *,
    listing_ttl_seconds: int | None,
    metadata_ttl_seconds: int | None,
    now: datetime | None = None,
) -> CatalogSnapshot | None:
    """Load cached tables with independent listing and metadata freshness."""
    raw = _load_catalog_raw(workspace_root, source_id)
    if raw is None:
        return None
    current = (now or _utc_now()).astimezone(timezone.utc)
    legacy_synced_at = raw.get("synced_at")
    listing_refreshed_at = raw.get("listing_refreshed_at") or legacy_synced_at
    metadata_refreshed_at = raw.get("metadata_refreshed_at") or legacy_synced_at
    listing_age, listing_freshness = _age_and_freshness(
        listing_refreshed_at, listing_ttl_seconds, current,
    )
    metadata_age, metadata_freshness = _age_and_freshness(
        metadata_refreshed_at, metadata_ttl_seconds, current,
    )
    return CatalogSnapshot(
        source_id=str(raw.get("source_id") or source_id),
        tables=raw.get("tables") or [],
        listing_refreshed_at=listing_refreshed_at,
        metadata_refreshed_at=metadata_refreshed_at,
        listing_age_seconds=listing_age,
        metadata_age_seconds=metadata_age,
        listing_freshness=listing_freshness,
        metadata_freshness=metadata_freshness,
        refresh_kind=str(raw.get("refresh_kind") or "full"),
        refresh_status=str(raw.get("refresh_status") or "complete"),
        last_refresh_attempt_at=raw.get("last_refresh_attempt_at"),
        last_refresh_error=raw.get("last_refresh_error"),
    )


def delete_catalog(workspace_root: Path | str, source_id: str) -> None:
    """Remove cached catalog file. Best-effort."""
    try:
        jail = _cache_jail(workspace_root, mkdir=False)
        filename = _cache_filename(source_id)
        path = jail.resolve(filename)
        if path.exists():
            jail.unlink(filename)
            logger.debug("Catalog cache deleted: %s", path)
    except Exception:
        logger.debug(
            "Failed to delete catalog cache for %s", source_id, exc_info=True,
        )


def list_cached_sources(workspace_root: Path | str) -> list[str]:
    """Return the original source IDs that have a cached catalog.

    Each cache file stores the original (un-sanitised) ``source_id`` so that
    ``mysql:mysql`` round-trips correctly even though its filename stem is
    ``mysql--mysql``. We prefer that stored value here; consumers (agent
    context, ``load_catalog``, ``delete_catalog``) all accept the original
    id and re-apply ``safe_source_id`` internally when touching the disk.

    Falls back to the filename stem if a cache file is missing or corrupt.

    When external connectors are disabled (browser-only / hosted mode),
    only built-in admin source IDs (e.g. ``sample_datasets``) are
    returned. This keeps the agent's data-discovery tools consistent with
    the sidebar — previously-persisted user catalogs on disk stay there
    but aren't surfaced.
    """
    cache_dir = _cache_dir(workspace_root)
    if not cache_dir.exists():
        return []
    sources: list[str] = []
    for path in cache_dir.glob("*.json"):
        original: str | None = None
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                value = raw.get("source_id")
                if isinstance(value, str) and value:
                    original = value
        except Exception:
            logger.debug("Failed to read source_id from %s", path, exc_info=True)
        sources.append(original or path.stem)

    # Filter to admin-only sources when external connectors are disabled.
    try:
        from flask import current_app
        disabled = bool(
            current_app.config.get('CLI_ARGS', {}).get('disable_data_connectors')
        )
    except RuntimeError:
        disabled = False
    if disabled:
        try:
            from data_formulator.data_connector import _ADMIN_CONNECTOR_IDS
            allowed = set(_ADMIN_CONNECTOR_IDS)
            sources = [s for s in sources if s in allowed]
        except Exception:
            logger.debug("Failed to filter cached sources by admin set", exc_info=True)
    try:
        from data_formulator.datalake.connector_preferences import disabled_connector_ids
        disabled_sources = disabled_connector_ids(workspace_root)
        sources = [source for source in sources if source not in disabled_sources]
    except Exception:
        logger.debug("Failed to filter disabled cached sources", exc_info=True)
    return sources


def find_catalog_cache(
    workspace_root: Path | str,
    query: str | None = None,
    source_ids: list[str] | None = None,
    limit: int = 100,
    *,
    filter_by: str | None = None,
    fields: list[str] | None = None,
    path_prefix: list[str] | None = None,
    exclude_tables: set[str] | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """Recursively find typed catalog nodes below an exact path.

    ``query`` is an optional case-insensitive regex. Omitting it enumerates all
    selected descendants. Results are flat and include exact source paths.
    """
    node_filter = (filter_by or "").strip().lower() or None
    if node_filter not in {None, "folder", "table"}:
        raise ValueError("filter_by must be 'folder' or 'table'")

    pattern = None
    if query and query.strip():
        try:
            pattern = re.compile(query.strip(), re.IGNORECASE)
        except re.error as exc:
            raise CatalogSearchError(f"Invalid query regex: {exc}") from exc

    match_fields = set(fields or ["name", "description", "columns"])
    prefix = [str(segment) for segment in (path_prefix or [])]
    excluded_tables = exclude_tables or set()
    all_ids = source_ids if source_ids is not None else list_cached_sources(workspace_root)
    try:
        from data_formulator.datalake.connector_preferences import disabled_connector_ids
        disabled_sources = disabled_connector_ids(workspace_root)
        all_ids = [source_id for source_id in all_ids if source_id not in disabled_sources]
    except Exception:
        logger.debug("Failed to filter disabled catalog finder sources", exc_info=True)
    cap = max(1, min(int(limit or 100), 500))
    results: list[dict[str, Any]] = []

    for source_id in all_ids:
        raw = _load_catalog_raw(workspace_root, source_id)
        if not raw:
            continue
        original_source_id = raw.get("source_id", source_id)
        tables = raw.get("tables", []) or []
        normalized_tables: list[tuple[dict[str, Any], list[str]]] = []
        folder_stats: dict[tuple[str, ...], dict[str, Any]] = {}

        for table in tables:
            table_name = str(table.get("name", ""))
            raw_path = table.get("path")
            table_path = [str(segment) for segment in raw_path] if isinstance(raw_path, list) else []
            if not table_path and table_name:
                table_path = [table_name]
            normalized_tables.append((table, table_path))

            for depth in range(1, len(table_path)):
                folder_path = tuple(table_path[:depth])
                stats = folder_stats.setdefault(
                    folder_path,
                    {"children": set(), "descendant_table_count": 0},
                )
                child_type = "folder" if depth < len(table_path) - 1 else "table"
                stats["children"].add((child_type, table_path[depth]))
                stats["descendant_table_count"] += 1

        if node_filter != "table":
            for folder_path, stats in folder_stats.items():
                if len(folder_path) <= len(prefix) or list(folder_path[:len(prefix)]) != prefix:
                    continue
                name = folder_path[-1]
                if pattern is not None and pattern.search(name) is None:
                    continue
                results.append({
                    "type": "folder",
                    "source_id": original_source_id,
                    "name": name,
                    "path": list(folder_path),
                    "child_count": len(stats["children"]),
                    "descendant_table_count": stats["descendant_table_count"],
                    "score": 10 if pattern is not None else 0,
                    "match_reasons": ["folder_name"] if pattern is not None else [],
                })

        if node_filter == "folder":
            continue

        for table, table_path in normalized_tables:
            if len(table_path) <= len(prefix) or table_path[:len(prefix)] != prefix:
                continue

            table_name = str(table.get("name", ""))
            leaf_name = table_path[-1]
            if table_name in excluded_tables:
                continue

            metadata = table.get("metadata") or {}
            description = str(metadata.get("description", ""))
            score = 0
            matched_columns: list[str] = []
            match_reasons: list[str] = []
            if pattern is not None:
                if "name" in match_fields and (
                    pattern.search(leaf_name) or pattern.search(table_name)
                ):
                    score += 10
                    match_reasons.append("table_name")
                if "description" in match_fields and pattern.search(description):
                    score += 5
                    match_reasons.append("source_description")
                if "columns" in match_fields:
                    for column in metadata.get("columns", []):
                        column_name = str(column.get("name", ""))
                        column_description = str(column.get("description", ""))
                        if pattern.search(column_name):
                            score += 2
                            matched_columns.append(column_name)
                            if "column_name" not in match_reasons:
                                match_reasons.append("column_name")
                        if pattern.search(column_description):
                            score += 1
                            matched_columns.append(column_name)
                            if "source_column_description" not in match_reasons:
                                match_reasons.append("source_column_description")
                if score == 0:
                    continue

            results.append({
                "type": "table",
                "source_id": original_source_id,
                "name": leaf_name,
                "path": table_path,
                "table_key": table.get("table_key", "") or "",
                "description": description[:120],
                "matched_columns": list(dict.fromkeys(matched_columns)),
                "score": score,
                "match_reasons": match_reasons,
                "metadata_status": metadata.get("source_metadata_status", ""),
            })

    results.sort(key=lambda item: (
        -item["score"],
        item["source_id"].casefold(),
        0 if item["type"] == "folder" else 1,
        [segment.casefold() for segment in item["path"]],
        item["path"],
    ))
    return results[:cap], len(results) > cap


# ---------------------------------------------------------------------------
# Hierarchy navigation (used by the data loading agent's list_data tool)
# ---------------------------------------------------------------------------

# Directory listings default to 100 immediate children and allow callers to
# request at most 500.
LIST_DATA_DEFAULT_LIMIT = 100
LIST_DATA_MAX_LIMIT = 500

# Compact orientation only; agents inspect a source before describing its data.
SOURCE_TOP_LEVEL_PREVIEW = 12
SUMMARY_TOP_LEVEL_LIMIT = 5
SUMMARY_TABLE_LIMIT = 5


def summarize_catalog_sources(
    workspace_root: Path | str,
    top_level_limit: int = SUMMARY_TOP_LEVEL_LIMIT,
    table_limit: int = SUMMARY_TABLE_LIMIT,
) -> list[dict[str, Any]]:
    """Return bounded, branch-diverse impressions of cached sources."""
    summaries: list[dict[str, Any]] = []
    for source_id in list_cached_sources(workspace_root):
        raw = _load_catalog_raw(workspace_root, source_id)
        if not raw:
            continue

        original_source_id = raw.get("source_id", source_id)
        tables = raw.get("tables", []) or []
        folder_paths: set[tuple[str, ...]] = set()
        top_folders: dict[str, int] = {}
        root_tables: list[dict[str, Any]] = []
        tables_by_branch: dict[str, list[dict[str, Any]]] = {}
        max_depth = 0

        for table in tables:
            name = str(table.get("name", ""))
            raw_path = table.get("path")
            path = [str(segment) for segment in raw_path] if isinstance(raw_path, list) else []
            if not path and name:
                path = [name]
            if not path:
                continue

            max_depth = max(max_depth, len(path) - 1)
            for depth in range(1, len(path)):
                folder_paths.add(tuple(path[:depth]))

            item = {
                "type": "table",
                "name": path[-1],
                "path": path,
                "table_key": table.get("table_key", "") or "",
            }
            description = str((table.get("metadata") or {}).get("description", ""))
            if description:
                item["description"] = description[:80]

            if len(path) == 1:
                root_tables.append(item)
                branch = ""
            else:
                branch = path[0]
                top_folders[branch] = top_folders.get(branch, 0) + 1
            tables_by_branch.setdefault(branch, []).append(item)

        top_level: list[dict[str, Any]] = [
            {
                "type": "folder",
                "name": name,
                "path": [name],
                "descendant_table_count": count,
            }
            for name, count in sorted(
                top_folders.items(), key=lambda entry: (-entry[1], entry[0].casefold(), entry[0])
            )
        ]
        root_tables.sort(key=lambda item: (item["name"].casefold(), item["name"]))
        top_level.extend(root_tables)

        for branch_tables in tables_by_branch.values():
            branch_tables.sort(key=lambda item: (
                [segment.casefold() for segment in item["path"]], item["path"]
            ))
        sample_tables: list[dict[str, Any]] = []
        branch_names = sorted(tables_by_branch, key=lambda name: (name.casefold(), name))
        sample_index = 0
        while len(sample_tables) < table_limit:
            added = False
            for branch in branch_names:
                branch_tables = tables_by_branch[branch]
                if sample_index < len(branch_tables):
                    sample_tables.append(branch_tables[sample_index])
                    added = True
                    if len(sample_tables) == table_limit:
                        break
            if not added:
                break
            sample_index += 1

        summaries.append({
            "source_id": original_source_id,
            "table_count": len(tables),
            "folder_count": len(folder_paths),
            "max_depth": max_depth,
            "top_level": top_level[:top_level_limit],
            "sample_tables": sample_tables,
            "omitted": {
                "top_level": max(0, len(top_level) - top_level_limit),
                "tables": max(0, len(tables) - len(sample_tables)),
            },
        })

    summaries.sort(key=lambda summary: summary["source_id"])
    return summaries

def list_sources_summary(
    workspace_root: Path | str,
) -> list[dict[str, Any]]:
    """Return a per-source summary suitable for ``list_data()`` with no args.

    Each entry includes a bounded ``top_level`` preview and an explicit
    ``top_level_truncated`` signal. The preview is orientation, not a substitute
    for listing or finding data within the source.
    Sources whose cache file is missing or unreadable are skipped silently — the
    agent treats the cache as ground truth (see design-docs §8).
    """
    out: list[dict[str, Any]] = []
    for sid in list_cached_sources(workspace_root):
        raw = _load_catalog_raw(workspace_root, sid)
        if not raw:
            continue
        tables = raw.get("tables", []) or []
        is_hier = False
        folders: list[str] = []
        seen_folders: set[str] = set()
        leaves: list[str] = []
        for t in tables:
            p = t.get("path")
            p = [str(s) for s in p] if isinstance(p, list) else []
            if len(p) >= 2:
                is_hier = True
                if p[0] not in seen_folders:
                    seen_folders.add(p[0])
                    folders.append(p[0])
            else:
                leaf = p[0] if p else str(t.get("name", ""))
                if leaf:
                    leaves.append(leaf)
        top_level = folders + leaves
        out.append({
            "source_id": raw.get("source_id", sid),
            "table_count": len(tables),
            "is_hierarchical": is_hier,
            "top_level": top_level[:SOURCE_TOP_LEVEL_PREVIEW],
            "top_level_truncated": len(top_level) > SOURCE_TOP_LEVEL_PREVIEW,
        })
    out.sort(key=lambda r: r["source_id"])
    return out


def list_path_children(
    workspace_root: Path | str,
    source_id: str,
    path: list[str] | None = None,
    filter_by: str | None = None,
    limit: int = LIST_DATA_DEFAULT_LIMIT,
    start_after: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """List direct children at a hierarchy level within a source's catalog.

    Path semantics: each cached table record has ``path: list[str]``.  The
    final element is the table's leaf name in the tree view; earlier elements
    are folder segments.  For a query at depth ``K = len(path)``:

    * **Folders** = distinct ``path[K]`` from records with ``len(path) >= K+2``
      whose first ``K`` segments equal the input path.
    * **Tables** = records with ``len(path) == K+1`` whose first ``K`` segments
      equal the input path.  At depth 0 we additionally surface records with
      empty path, using their ``name`` as the leaf.

    ``filter_by`` may be ``folder`` or ``table``. Results use deterministic
    folder-first ordering and ``start_after`` is an exclusive node reference.
    """
    path = [str(p) for p in (path or [])]
    K = len(path)
    cap = max(1, min(int(limit or LIST_DATA_DEFAULT_LIMIT), LIST_DATA_MAX_LIMIT))
    node_filter = (filter_by or "").strip().lower() or None
    if node_filter not in {None, "folder", "table"}:
        raise ValueError("filter_by must be 'folder' or 'table'")

    raw = _load_catalog_raw(workspace_root, source_id)
    if not raw:
        return {
            "source_id": source_id,
            "path": path,
            "items": [],
            "total_count": 0,
            "truncated": False,
        }

    original_sid = raw.get("source_id", source_id)
    tables_raw = raw.get("tables", []) or []

    folder_table_counts: dict[str, int] = {}
    folder_child_names: dict[str, set[tuple[str, str]]] = {}
    leaf_tables: list[dict[str, Any]] = []

    for t in tables_raw:
        tname = t.get("name", "")
        tpath = t.get("path") or []
        if not isinstance(tpath, list):
            tpath = []
        tpath = [str(s) for s in tpath]
        plen = len(tpath)

        # Prefix must match exactly for K elements.
        if plen < K:
            continue
        if tpath[:K] != path:
            continue

        # Folder: at least one more segment after the prefix beyond the leaf.
        if plen >= K + 2:
            seg = tpath[K]
            folder_table_counts[seg] = folder_table_counts.get(seg, 0) + 1
            child_type = "folder" if plen >= K + 3 else "table"
            child_name = tpath[K + 1]
            folder_child_names.setdefault(seg, set()).add((child_type, child_name))
            continue

        # Table at this level.
        if plen == K + 1:
            leaf = tpath[K]
        elif plen == K and K == 0:
            # Empty-path tables surface only at root.
            leaf = tname
        else:
            continue

        leaf_tables.append({
            "type": "table",
            "name": leaf,
            "path": [*path, leaf],
            "table_key": t.get("table_key", "") or "",
        })

    folders = [
        {
            "type": "folder",
            "name": name,
            "path": [*path, name],
            "child_count": len(folder_child_names[name]),
            "descendant_table_count": table_count,
        }
        for name, table_count in folder_table_counts.items()
    ]
    folders.sort(key=lambda item: (item["name"].casefold(), item["name"]))
    leaf_tables.sort(key=lambda item: (item["name"].casefold(), item["name"]))
    items = (
        folders if node_filter == "folder"
        else leaf_tables if node_filter == "table"
        else folders + leaf_tables
    )
    total_count = len(items)

    if start_after is not None:
        try:
            start_index = next(
                index for index, item in enumerate(items)
                if item["type"] == start_after.get("type")
                and item["path"] == start_after.get("path")
                and (
                    item["type"] == "folder"
                    or item["table_key"] == start_after.get("table_key")
                )
            )
        except (AttributeError, StopIteration) as exc:
            raise ValueError("start_after does not identify an immediate child") from exc
        items = items[start_index + 1:]

    page_items = items[:cap]
    truncated = len(items) > len(page_items)

    result: dict[str, Any] = {
        "source_id": original_sid,
        "path": path,
        "items": page_items,
        "total_count": total_count,
        "truncated": truncated,
    }
    if truncated:
        last_item = page_items[-1]
        result["next_start_after"] = {
            key: last_item[key]
            for key in ("type", "path", "table_key")
            if key in last_item
        }
    return result
