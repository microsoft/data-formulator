"""Catalog annotations — user-owned metadata for catalog tables.

Each data source gets one JSON file:
``<user_home>/catalog_annotations/<source_id>.json``

The file format::

    {
        "source_id": "superset_prod",
        "updated_at": "2026-04-28T10:00:00Z",
        "version": 3,
        "tables": {
            "<table_key>": {
                "description": "...",
                "notes": "...",
                "tags": ["..."],
                "columns": {
                    "<col_name>": {"description": "..."}
                }
            }
        }
    }

Annotations are never overwritten by remote catalog sync.  Only user
edits (via the PATCH API) modify annotation files.

Concurrency: file-based locking (reusing the same primitives as
``WorkspaceLock``) + optimistic version control.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_formulator.datalake.naming import safe_source_id

logger = logging.getLogger(__name__)

ANNOTATIONS_DIR = "catalog_annotations"
_LOCK_SUFFIX = ".lock"
_MAX_LOCK_WAIT = 10.0  # seconds


# ---------------------------------------------------------------------------
# Platform-specific file locking (reuse workspace_metadata primitives)
# ---------------------------------------------------------------------------

from data_formulator.datalake.workspace_metadata import _lock_file, _unlock_file


class _AnnotationLock:
    """Exclusive file lock for a single annotation file."""

    def __init__(self, lock_path: Path, timeout: float = _MAX_LOCK_WAIT):
        self._lock_path = lock_path
        self._timeout = timeout
        self._fd = None

    def __enter__(self):
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        start = time.time()
        while True:
            try:
                self._fd = open(self._lock_path, "a+")
                _lock_file(self._fd.fileno())
                return self
            except (IOError, OSError):
                if self._fd:
                    self._fd.close()
                    self._fd = None
                if time.time() - start >= self._timeout:
                    raise TimeoutError(
                        f"Failed to acquire annotation lock after {self._timeout}s"
                    )
                time.sleep(0.05)

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._fd:
            try:
                _unlock_file(self._fd.fileno())
                self._fd.close()
            except Exception:
                logger.debug("Error releasing annotation lock", exc_info=True)
            finally:
                self._fd = None


# ---------------------------------------------------------------------------
# File paths
# ---------------------------------------------------------------------------

def _annotations_dir(user_home: Path | str) -> Path:
    return Path(user_home) / ANNOTATIONS_DIR


def _annotations_file(user_home: Path | str, source_id: str) -> Path:
    return _annotations_dir(user_home) / f"{safe_source_id(source_id)}.json"


def _lock_path(user_home: Path | str, source_id: str) -> Path:
    return _annotations_dir(user_home) / f"{safe_source_id(source_id)}{_LOCK_SUFFIX}"


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

def load_annotations(
    user_home: Path | str, source_id: str,
) -> dict[str, Any] | None:
    """Load annotation file for a source. Returns None if not found."""
    path = _annotations_file(user_home, source_id)
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.debug("Failed to read annotations %s", path, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Patch (single-table update with optimistic concurrency)
# ---------------------------------------------------------------------------

def _clean_table_annotation(ann: dict[str, Any]) -> dict[str, Any] | None:
    """Remove empty fields; return None if annotation is entirely empty.

    Semantic rules from design doc:
    - ``description: ""`` → delete the key
    - empty ``columns`` dict → delete the key
    - empty column entry → delete the column key
    - if all user fields are gone → remove the whole table annotation
    """
    cleaned: dict[str, Any] = {}

    for key in ("description", "notes"):
        val = ann.get(key)
        if isinstance(val, str) and val.strip():
            cleaned[key] = val.strip()

    tags = ann.get("tags")
    if isinstance(tags, list) and tags:
        cleaned["tags"] = tags

    columns = ann.get("columns")
    if isinstance(columns, dict):
        clean_cols: dict[str, Any] = {}
        for col_name, col_ann in columns.items():
            if not isinstance(col_ann, dict):
                continue
            clean_col: dict[str, Any] = {}
            col_desc = col_ann.get("description")
            if isinstance(col_desc, str) and col_desc.strip():
                clean_col["description"] = col_desc.strip()
            if clean_col:
                clean_cols[col_name] = clean_col
        if clean_cols:
            cleaned["columns"] = clean_cols

    return cleaned if cleaned else None


def patch_annotation(
    user_home: Path | str,
    source_id: str,
    table_key: str,
    patch: dict[str, Any],
    expected_version: int | None = None,
) -> dict[str, Any]:
    """Apply a single-table annotation patch under lock.

    Returns ``{"version": <new_version>}`` on success.
    Raises ``AnnotationConflict`` if version mismatch.
    Raises ``TimeoutError`` if lock cannot be acquired.
    """
    lock = _AnnotationLock(_lock_path(user_home, source_id))

    with lock:
        current = load_annotations(user_home, source_id)
        if current is None:
            current = {
                "source_id": source_id,
                "updated_at": "",
                "version": 0,
                "tables": {},
            }

        current_version = current.get("version", 0)

        if expected_version is not None and expected_version != 0:
            if current_version != expected_version:
                raise AnnotationConflict(
                    current_version=current_version,
                    table_key=table_key,
                )

        tables = current.get("tables", {})

        existing = tables.get(table_key, {})
        merged = {**existing}

        for field in ("description", "notes"):
            if field in patch:
                merged[field] = patch[field]

        if "tags" in patch:
            merged["tags"] = patch["tags"]

        if "columns" in patch and isinstance(patch["columns"], dict):
            existing_cols = merged.get("columns", {})
            for col_name, col_patch in patch["columns"].items():
                if isinstance(col_patch, dict):
                    existing_col = existing_cols.get(col_name, {})
                    existing_cols[col_name] = {**existing_col, **col_patch}
                elif col_patch is None:
                    existing_cols.pop(col_name, None)
            merged["columns"] = existing_cols

        cleaned = _clean_table_annotation(merged)
        if cleaned:
            tables[table_key] = cleaned
        else:
            tables.pop(table_key, None)

        new_version = current_version + 1
        current["tables"] = tables
        current["version"] = new_version
        current["updated_at"] = datetime.now(timezone.utc).isoformat()

        _atomic_write(user_home, source_id, current)

    return {"version": new_version}


# ---------------------------------------------------------------------------
# Atomic write
# ---------------------------------------------------------------------------

def _atomic_write(
    user_home: Path | str, source_id: str, data: dict[str, Any],
) -> None:
    """Write annotation file atomically via temp file + rename."""
    target = _annotations_file(user_home, source_id)
    target.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(
        dir=str(target.parent), suffix=".tmp", prefix=".ann_",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        # On Windows, os.replace atomically replaces the target
        os.replace(tmp_path, str(target))
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Delete (for lifecycle management)
# ---------------------------------------------------------------------------

def delete_annotations(user_home: Path | str, source_id: str) -> None:
    """Remove annotation file. Best-effort."""
    path = _annotations_file(user_home, source_id)
    try:
        if path.exists():
            path.unlink()
            logger.debug("Annotations deleted: %s", path)
    except Exception:
        logger.debug("Failed to delete annotations %s", path, exc_info=True)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class AnnotationConflict(Exception):
    """Raised when expected_version does not match current file version."""

    def __init__(self, current_version: int, table_key: str = ""):
        self.current_version = current_version
        self.table_key = table_key
        super().__init__(
            f"Annotation conflict: expected version does not match "
            f"current version {current_version}"
        )
