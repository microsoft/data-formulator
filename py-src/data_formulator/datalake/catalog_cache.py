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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_formulator.datalake.naming import safe_source_id
from data_formulator.security.path_safety import ConfinedDir

logger = logging.getLogger(__name__)

CATALOG_CACHE_DIR = "catalog_cache"


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
) -> None:
    """Persist catalog data to disk. Best-effort — errors are logged, not raised."""
    try:
        path = _cache_file(workspace_root, source_id, mkdir=True)
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
    """Load cached catalog. Returns None if not found or corrupted."""
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
    """Return source IDs (sanitised stems) that have a cached catalog.

    The returned strings are filename-safe stems, usable as keys for
    ``load_catalog`` / ``delete_catalog``.
    """
    cache_dir = _cache_dir(workspace_root)
    if not cache_dir.exists():
        return []
    return [p.stem for p in cache_dir.glob("*.json")]


def _search_python(
    workspace_root: Path | str,
    needle: str,
    all_ids: list[str],
    exclude: set[str],
    limit_per_source: int,
    annotations_by_source: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Python-based structured field search with annotation overlay.

    ``annotations_by_source`` maps ``source_id`` → full annotation data
    (as returned by ``load_annotations``). User annotation matches carry
    higher weight than source metadata matches.
    """
    results: list[dict[str, Any]] = []
    ann_map = annotations_by_source or {}

    for sid in all_ids:
        raw = _load_catalog_raw(workspace_root, sid)
        if not raw:
            continue

        original_source_id = raw.get("source_id", sid)
        tables = raw.get("tables", [])
        ann_tables = (ann_map.get(sid) or {}).get("tables", {})

        source_hits: list[dict[str, Any]] = []
        for t in tables:
            tname = t.get("name", "")
            if tname in exclude:
                continue

            score = 0
            matched_cols: list[str] = []
            match_reasons: list[str] = []
            meta = t.get("metadata") or {}
            table_key = t.get("table_key", "")
            ann = ann_tables.get(table_key, {}) if table_key else {}

            if needle in tname.lower():
                score += 10
                match_reasons.append("table_name")

            # Source description
            src_desc = meta.get("description", "")
            if src_desc and needle in src_desc.lower():
                score += 5
                match_reasons.append("source_description")

            # User annotation description (higher weight)
            user_desc = ann.get("description", "")
            if user_desc and needle in user_desc.lower():
                score += 8
                match_reasons.append("user_description")

            # User notes
            user_notes = ann.get("notes", "")
            if user_notes and needle in user_notes.lower():
                score += 3
                match_reasons.append("user_notes")

            # Source columns
            for col in meta.get("columns", []):
                cname = col.get("name", "")
                if needle in cname.lower():
                    matched_cols.append(cname)
                    score += 2
                    if "column_name" not in match_reasons:
                        match_reasons.append("column_name")
                cdesc = col.get("description", "")
                if cdesc and needle in cdesc.lower():
                    matched_cols.append(cname)
                    score += 1
                    if "source_column_description" not in match_reasons:
                        match_reasons.append("source_column_description")

            # User column annotations (higher weight)
            user_cols = ann.get("columns", {})
            for col_name, col_ann in user_cols.items():
                col_desc = col_ann.get("description", "") if isinstance(col_ann, dict) else ""
                if col_desc and needle in col_desc.lower():
                    matched_cols.append(col_name)
                    score += 3
                    if "user_column_description" not in match_reasons:
                        match_reasons.append("user_column_description")

            display_desc = user_desc or src_desc

            if score > 0:
                source_hits.append({
                    "source_id": original_source_id,
                    "table_key": table_key,
                    "name": tname,
                    "description": display_desc,
                    "matched_columns": list(dict.fromkeys(matched_cols)),
                    "score": score,
                    "match_reasons": match_reasons,
                    "metadata_status": meta.get("source_metadata_status", ""),
                })

        source_hits.sort(key=lambda r: -r["score"])
        results.extend(source_hits[:limit_per_source])

    results.sort(key=lambda r: -r["score"])
    return results


def _search_duckdb(
    workspace_root: Path | str,
    needle: str,
    all_ids: list[str],
    exclude: set[str],
    limit_per_source: int,
) -> list[dict[str, Any]]:
    """DuckDB-based catalog cache search using read_json_auto + SQL."""
    import duckdb

    results: list[dict[str, Any]] = []
    like_pat = f"%{needle}%"

    for sid in all_ids:
        path = _cache_file(workspace_root, sid)
        if not path.exists():
            continue

        escaped = str(path).replace("'", "''")
        conn = duckdb.connect(":memory:")
        try:
            # Flatten tables array from the JSON cache file
            rows = conn.execute(f"""
                WITH raw AS (
                    SELECT unnest(tables) AS t
                    FROM read_json_auto('{escaped}', format='newline_delimited',
                         union_by_name=true, maximum_object_size=104857600)
                ),
                base AS (
                    SELECT
                        t.name                       AS tname,
                        COALESCE(t.metadata.description, '')  AS tdesc,
                        t.metadata.columns           AS cols,
                        CASE WHEN lower(t.name) LIKE ? THEN 10 ELSE 0 END
                        + CASE WHEN COALESCE(t.metadata.description, '') != ''
                               AND lower(COALESCE(t.metadata.description, '')) LIKE ?
                               THEN 5 ELSE 0 END     AS base_score
                    FROM raw
                )
                SELECT tname, tdesc, cols, base_score
                FROM base
                WHERE tname NOT IN (SELECT unnest(?::VARCHAR[]))
                ORDER BY base_score DESC
            """, [like_pat, like_pat, list(exclude)]).fetchall()

            # Determine original source_id from file
            raw = _load_catalog_raw(workspace_root, sid)
            original_source_id = raw.get("source_id", sid) if raw else sid

            source_hits: list[dict[str, Any]] = []
            for tname, tdesc, cols_raw, base_score in rows:
                score = base_score
                matched_cols: list[str] = []
                cols = cols_raw if isinstance(cols_raw, list) else []
                for col in cols:
                    if not isinstance(col, dict):
                        continue
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
                        "description": tdesc,
                        "matched_columns": list(dict.fromkeys(matched_cols)),
                        "score": score,
                    })

            source_hits.sort(key=lambda r: -r["score"])
            results.extend(source_hits[:limit_per_source])
        except Exception:
            logger.debug("DuckDB search failed for source %s", sid, exc_info=True)
        finally:
            conn.close()

    results.sort(key=lambda r: -r["score"])
    return results


def search_catalog_cache(
    workspace_root: Path | str,
    query: str,
    source_ids: list[str] | None = None,
    limit_per_source: int = 20,
    exclude_tables: set[str] | None = None,
    annotations_by_source: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Search across cached catalogs for tables matching a keyword.

    Returns a flat list of match dicts with fields:
    ``source_id``, ``table_key``, ``name``, ``description``,
    ``matched_columns``, ``score``, ``match_reasons``, ``metadata_status``.

    When ``annotations_by_source`` is provided, user annotation fields
    (description, notes, column descriptions) are also searched with
    higher weight than source metadata.

    Prefers DuckDB for initial candidate retrieval, then overlays
    annotations in Python. Falls back to pure Python search if DuckDB
    is unavailable.
    """
    needle = (query or "").strip().lower()
    if not needle:
        return []

    exclude = exclude_tables or set()
    all_ids = source_ids or list_cached_sources(workspace_root)

    # Always use Python path when annotations are provided (for overlay).
    # DuckDB path is used only for cache-only search without annotations.
    if annotations_by_source:
        return _search_python(
            workspace_root, needle, all_ids, exclude, limit_per_source,
            annotations_by_source=annotations_by_source,
        )

    try:
        return _search_duckdb(workspace_root, needle, all_ids, exclude, limit_per_source)
    except Exception:
        logger.debug("DuckDB catalog search failed, falling back to Python", exc_info=True)
        return _search_python(workspace_root, needle, all_ids, exclude, limit_per_source)
