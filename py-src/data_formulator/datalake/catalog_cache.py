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


def _search_python(
    workspace_root: Path | str,
    needle: str,
    all_ids: list[str],
    exclude: set[str],
    limit_per_source: int,
    *,
    exclude_pattern: re.Pattern | None = None,
    fields: set[str] | None = None,
    path_prefix: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Structured field search over the on-disk catalog cache.

    ``needle`` is always a regex pattern (case-insensitive).  Callers who
    want literal substring matching should ``re.escape`` first.  Invalid
    patterns raise :class:`CatalogSearchError`.
    """
    match_fields = fields if fields is not None else {"name", "description", "columns"}

    try:
        compiled = re.compile(needle, re.IGNORECASE)
    except re.error as exc:
        raise CatalogSearchError(f"Invalid query regex: {exc}") from exc

    def _matches(text: str) -> bool:
        return bool(text) and compiled.search(text) is not None

    results: list[dict[str, Any]] = []
    plen = len(path_prefix) if path_prefix else 0
    prefix = list(path_prefix or [])

    for sid in all_ids:
        raw = _load_catalog_raw(workspace_root, sid)
        if not raw:
            continue

        original_source_id = raw.get("source_id", sid)
        tables = raw.get("tables", [])

        source_hits: list[dict[str, Any]] = []
        for t in tables:
            tname = t.get("name", "")
            if tname in exclude:
                continue

            # Path-prefix filter
            if plen:
                tpath = t.get("path") or []
                if not isinstance(tpath, list) or len(tpath) < plen:
                    continue
                if [str(s) for s in tpath[:plen]] != prefix:
                    continue

            # Exclude pattern (regex on name)
            if exclude_pattern is not None and exclude_pattern.search(tname):
                continue

            score = 0
            matched_cols: list[str] = []
            match_reasons: list[str] = []
            meta = t.get("metadata") or {}
            table_key = t.get("table_key", "")

            if "name" in match_fields and _matches(tname):
                score += 10
                match_reasons.append("table_name")

            # Source description
            src_desc = meta.get("description", "")
            if "description" in match_fields and src_desc and _matches(src_desc):
                score += 5
                match_reasons.append("source_description")

            # Source columns
            if "columns" in match_fields:
                for col in meta.get("columns", []):
                    cname = col.get("name", "")
                    if cname and _matches(cname):
                        matched_cols.append(cname)
                        score += 2
                        if "column_name" not in match_reasons:
                            match_reasons.append("column_name")
                    cdesc = col.get("description", "")
                    if cdesc and _matches(cdesc):
                        matched_cols.append(cname)
                        score += 1
                        if "source_column_description" not in match_reasons:
                            match_reasons.append("source_column_description")

            if score > 0:
                source_hits.append({
                    "source_id": original_source_id,
                    "table_key": table_key,
                    "name": tname,
                    "description": src_desc,
                    "matched_columns": list(dict.fromkeys(matched_cols)),
                    "score": score,
                    "match_reasons": match_reasons,
                    "metadata_status": meta.get("source_metadata_status", ""),
                })

        source_hits.sort(key=lambda r: -r["score"])
        results.extend(source_hits[:limit_per_source])

    results.sort(key=lambda r: -r["score"])
    return results


def search_catalog_cache(
    workspace_root: Path | str,
    query: str,
    source_ids: list[str] | None = None,
    limit_per_source: int = 20,
    exclude_tables: set[str] | None = None,
    *,
    exclude_pattern: str | None = None,
    fields: list[str] | None = None,
    path_prefix: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Search across cached catalogs for tables matching a regex pattern.

    ``query`` is treated as a case-insensitive regex.  Callers passing
    user-typed keywords should ``re.escape`` the input first.  Invalid
    patterns raise :class:`CatalogSearchError`.

    Returns a flat list of match dicts with fields:
    ``source_id``, ``table_key``, ``name``, ``description``,
    ``matched_columns``, ``score``, ``match_reasons``, ``metadata_status``.

    ``exclude_pattern``, ``fields``, and ``path_prefix`` further constrain
    the search.
    """
    needle_raw = (query or "").strip()
    if not needle_raw:
        return []

    exclude = exclude_tables or set()
    all_ids = source_ids if source_ids is not None else list_cached_sources(workspace_root)
    try:
        from data_formulator.datalake.connector_preferences import disabled_connector_ids
        disabled_sources = disabled_connector_ids(workspace_root)
        all_ids = [source_id for source_id in all_ids if source_id not in disabled_sources]
    except Exception:
        logger.debug("Failed to filter disabled catalog search sources", exc_info=True)

    # Compile exclude pattern up-front so a bad pattern surfaces clearly.
    excl_re = None
    if exclude_pattern:
        try:
            excl_re = re.compile(exclude_pattern, re.IGNORECASE)
        except re.error as exc:
            raise CatalogSearchError(f"Invalid exclude regex: {exc}") from exc

    fields_set = set(fields) if fields else None

    return _search_python(
        workspace_root,
        needle_raw,
        all_ids,
        exclude,
        limit_per_source,
        exclude_pattern=excl_re,
        fields=fields_set,
        path_prefix=list(path_prefix or []),
    )


# ---------------------------------------------------------------------------
# Hierarchy navigation (used by the data loading agent's list_data tool)
# ---------------------------------------------------------------------------

# Hard cap on entries returned in one list_path_children response.  See
# design-docs/32-data-loading-agent-navigation.md §5.  Truncation pushes the
# agent toward find_data or a tighter filter rather than pagination.
LIST_DATA_LIMIT = 200

# Enough top-level names to answer "what's in there?" without a drill-down call.
SOURCE_TOP_LEVEL_PREVIEW = 12

# Descendant nodes returned alongside one level of children, so a source's shape
# is visible without walking it folder by folder.
SUBTREE_NODE_BUDGET = 150


def _build_subtree(
    tables_raw: list[dict[str, Any]],
    path: list[str],
    budget: int = SUBTREE_NODE_BUDGET,
) -> tuple[dict[str, Any], bool]:
    """Nested names below ``path``, one level down and deeper.

    Folders map to objects, tables to ``None``. Only descendants deeper than the
    requested level appear — tables *at* the level are already returned in full
    (with keys and descriptions) by :func:`list_path_children`.
    """
    K = len(path)
    tree: dict[str, Any] = {}
    nodes = 0
    for t in tables_raw:
        tpath = t.get("path")
        tpath = [str(s) for s in tpath] if isinstance(tpath, list) else []
        if len(tpath) < K + 2 or tpath[:K] != path:
            continue
        rest = [seg for seg in tpath[K:] if seg]
        if len(rest) < 2:
            continue
        if nodes >= budget:
            return tree, True
        node = tree
        for seg in rest[:-1]:
            child = node.get(seg)
            if not isinstance(child, dict):
                child = {}
                node[seg] = child
                nodes += 1
            node = child
        if rest[-1] not in node:
            node[rest[-1]] = None
            nodes += 1
    return tree, False


def list_sources_summary(
    workspace_root: Path | str,
) -> list[dict[str, Any]]:
    """Return a per-source summary suitable for ``list_data()`` with no args.

    Each entry: ``{source_id, table_count, is_hierarchical, top_level}``, where
    ``top_level`` previews the source's depth-0 children (folders first, then
    loose tables) so the inventory alone usually answers what a source holds.
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
        out.append({
            "source_id": raw.get("source_id", sid),
            "table_count": len(tables),
            "is_hierarchical": is_hier,
            "top_level": (folders + leaves)[:SOURCE_TOP_LEVEL_PREVIEW],
        })
    out.sort(key=lambda r: r["source_id"])
    return out


def list_path_children(
    workspace_root: Path | str,
    source_id: str,
    path: list[str] | None = None,
    filter: str | None = None,
    limit: int = LIST_DATA_LIMIT,
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

    ``filter`` is a case-insensitive substring match on the immediate child
    segment / table name (the *next* segment after the prefix), equivalent to
    ``ls <path>/*<filter>*``.  Not a regex — keep this primitive cheap.

    Returns ``{source_id, path, folders, tables, total_folders, total_tables,
    truncated, hint?}``.  Combined ``folders + tables`` are capped at ``limit``
    (folders take precedence to preserve drill-down).
    """
    path = [str(p) for p in (path or [])]
    K = len(path)
    cap = max(1, min(int(limit or LIST_DATA_LIMIT), LIST_DATA_LIMIT))
    filt = (filter or "").strip().lower() or None

    raw = _load_catalog_raw(workspace_root, source_id)
    if not raw:
        return {
            "source_id": source_id,
            "path": path,
            "folders": [],
            "tables": [],
            "total_folders": 0,
            "total_tables": 0,
            "truncated": False,
        }

    original_sid = raw.get("source_id", source_id)
    tables_raw = raw.get("tables", []) or []

    folder_counts: dict[str, int] = {}
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
            if filt and filt not in seg.lower():
                continue
            folder_counts[seg] = folder_counts.get(seg, 0) + 1
            continue

        # Table at this level.
        if plen == K + 1:
            leaf = tpath[K]
        elif plen == K and K == 0:
            # Empty-path tables surface only at root.
            leaf = tname
        else:
            continue

        if filt and filt not in leaf.lower():
            continue

        meta = t.get("metadata") or {}
        desc = (meta.get("description") or "")[:120]
        leaf_tables.append({
            "name": leaf,
            "table_key": t.get("table_key", "") or "",
            "description": desc,
        })

    # Sort folders by table_count desc then name; tables by name.
    folders = [
        {"name": name, "table_count": cnt}
        for name, cnt in sorted(
            folder_counts.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ]
    leaf_tables.sort(key=lambda r: r["name"])

    total_folders = len(folders)
    total_tables = len(leaf_tables)
    total = total_folders + total_tables
    truncated = total > cap

    # Combined cap: folders first (drill-down has higher value), then tables.
    if total_folders >= cap:
        folders = folders[:cap]
        leaf_tables = []
    else:
        leaf_tables = leaf_tables[: cap - total_folders]

    result: dict[str, Any] = {
        "source_id": original_sid,
        "path": path,
        "folders": folders,
        "tables": leaf_tables,
        "total_folders": total_folders,
        "total_tables": total_tables,
        "truncated": truncated,
    }
    subtree, subtree_truncated = _build_subtree(tables_raw, path)
    if subtree:
        result["tree"] = subtree
        if subtree_truncated:
            result["tree_truncated"] = True
    if truncated:
        remaining = total - len(folders) - len(leaf_tables)
        result["hint"] = (
            f"{remaining} more entries not shown. Use list_path_children(filter=...) "
            f"to narrow, or find_data(query=..., scope='{original_sid}"
            + (":" + "/".join(path) if path else "")
            + "') to search this subtree."
        )
    return result
