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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_formulator.datalake.naming import safe_source_id
from data_formulator.security.path_safety import ConfinedDir

logger = logging.getLogger(__name__)

CATALOG_CACHE_DIR = "catalog_cache"


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


def save_catalog(
    workspace_root: Path | str,
    source_id: str,
    tables: list[dict[str, Any]],
    *,
    mode: str = "replace",
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
        payload = {
            "source_id": source_id,
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "tables": tables,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, default=str)
        logger.debug("Catalog cache written: %s (%d tables)", path, len(tables))
    except Exception:
        logger.debug("Failed to write catalog cache for %s", source_id, exc_info=True)


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
    all_ids = source_ids or list_cached_sources(workspace_root)

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


def list_sources_summary(
    workspace_root: Path | str,
) -> list[dict[str, Any]]:
    """Return a per-source summary suitable for ``list_data()`` with no args.

    Each entry: ``{source_id, table_count, is_hierarchical}``.  Sources whose
    cache file is missing or unreadable are skipped silently — the agent
    treats the cache as ground truth (see design-docs §8).
    """
    out: list[dict[str, Any]] = []
    for sid in list_cached_sources(workspace_root):
        raw = _load_catalog_raw(workspace_root, sid)
        if not raw:
            continue
        tables = raw.get("tables", []) or []
        is_hier = False
        for t in tables:
            p = t.get("path")
            if isinstance(p, list) and len(p) >= 2:
                is_hier = True
                break
        out.append({
            "source_id": raw.get("source_id", sid),
            "table_count": len(tables),
            "is_hierarchical": is_hier,
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
    if truncated:
        remaining = total - len(folders) - len(leaf_tables)
        result["hint"] = (
            f"{remaining} more entries not shown. Use list_path_children(filter=...) "
            f"to narrow, or find_data(query=..., scope='{original_sid}"
            + (":" + "/".join(path) if path else "")
            + "') to search this subtree."
        )
    return result
