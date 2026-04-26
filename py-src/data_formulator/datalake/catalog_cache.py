"""Catalog cache — persist lightweight list_tables() results to disk.

Stored as JSON files under ``<workspace_root>/catalog_cache/<source_id>.json``.
Used by agents to search available data without live connections.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any

from data_formulator.datalake.naming import safe_source_id

logger = logging.getLogger(__name__)

CATALOG_CACHE_DIR = "catalog_cache"


def _cache_dir(workspace_root: Path | str) -> Path:
    return Path(workspace_root) / CATALOG_CACHE_DIR


def _cache_file(workspace_root: Path | str, source_id: str) -> Path:
    return _cache_dir(workspace_root) / f"{safe_source_id(source_id)}.json"


def save_catalog(
    workspace_root: Path | str,
    source_id: str,
    tables: list[dict[str, Any]],
) -> None:
    """Persist catalog data to disk. Best-effort — errors are logged, not raised."""
    try:
        cache_dir = _cache_dir(workspace_root)
        cache_dir.mkdir(parents=True, exist_ok=True)
        path = _cache_file(workspace_root, source_id)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"source_id": source_id, "tables": tables}, f, ensure_ascii=False, default=str)
        logger.debug("Catalog cache written: %s (%d tables)", path, len(tables))
    except Exception:
        logger.debug("Failed to write catalog cache for %s", source_id, exc_info=True)


def _load_catalog_raw(workspace_root: Path | str, source_id: str) -> dict[str, Any] | None:
    """Load raw catalog JSON (including original ``source_id`` key)."""
    path = _cache_file(workspace_root, source_id)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.debug("Failed to read catalog cache %s", path, exc_info=True)
        return None


def load_catalog(workspace_root: Path | str, source_id: str) -> list[dict[str, Any]] | None:
    """Load cached catalog. Returns None if not found or corrupted."""
    raw = _load_catalog_raw(workspace_root, source_id)
    if raw is None:
        return None
    return raw.get("tables", [])


def delete_catalog(workspace_root: Path | str, source_id: str) -> None:
    """Remove cached catalog file. Best-effort."""
    path = _cache_file(workspace_root, source_id)
    try:
        if path.exists():
            path.unlink()
            logger.debug("Catalog cache deleted: %s", path)
    except Exception:
        logger.debug("Failed to delete catalog cache %s", path, exc_info=True)


def list_cached_sources(workspace_root: Path | str) -> list[str]:
    """Return source IDs (sanitised stems) that have a cached catalog.

    The returned strings are filename-safe stems, usable as keys for
    ``load_catalog`` / ``delete_catalog``.
    """
    cache_dir = _cache_dir(workspace_root)
    if not cache_dir.exists():
        return []
    return [p.stem for p in cache_dir.glob("*.json")]


def search_catalog_cache(
    workspace_root: Path | str,
    query: str,
    source_ids: list[str] | None = None,
    limit_per_source: int = 20,
    exclude_tables: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Search across cached catalogs for tables matching a keyword.

    Returns a flat list of match dicts:
    ``{"source_id", "name", "description", "matched_columns", "score"}``.
    Already-imported tables (in ``exclude_tables``) are excluded.
    """
    needle = (query or "").strip().lower()
    if not needle:
        return []

    exclude = exclude_tables or set()
    all_ids = source_ids or list_cached_sources(workspace_root)
    results: list[dict[str, Any]] = []

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

            score = 0
            matched_cols: list[str] = []
            meta = t.get("metadata") or {}

            if needle in tname.lower():
                score += 10
            desc = meta.get("description", "")
            if desc and needle in desc.lower():
                score += 5
            for col in meta.get("columns", []):
                cname = col.get("name", "")
                if needle in cname.lower():
                    matched_cols.append(cname)
                    score += 2
                cdesc = col.get("description", "")
                if cdesc and needle in cdesc.lower():
                    matched_cols.append(cname)
                    score += 1

            if score > 0:
                source_hits.append({
                    "source_id": original_source_id,
                    "name": tname,
                    "description": desc,
                    "matched_columns": list(dict.fromkeys(matched_cols)),
                    "score": score,
                })

        source_hits.sort(key=lambda r: -r["score"])
        results.extend(source_hits[:limit_per_source])

    results.sort(key=lambda r: -r["score"])
    return results
