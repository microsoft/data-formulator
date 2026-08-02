# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Process-persistent, ETag-validated local disk cache for Azure Blob reads.

Azure blob workspaces build a *fresh* :class:`AzureBlobWorkspace` on every
request, so their per-instance in-memory caches are always cold and every
request re-downloads ``workspace.yaml`` and data blobs (parquet files can be
many megabytes).  This module provides a single, process-global cache that
survives across those short-lived instances (and across requests within a
worker container), backed by real files on local disk.

Layout under ``<df_home>/blob_cache/``::

    <sha256(key)>.bin        # the blob bytes
    <sha256(key)>.meta.json  # {"key", "blob_name", "container", "etag", "size", "cached_at"}

The cache stores ``bytes + etag``.  Freshness (whether a conditional GET is
needed) is tracked *in memory per process* via a monotonic timestamp, so we
never write to disk just to record a read.  Callers (the workspace) decide the
TTL and issue conditional GETs; this module only stores/serves bytes and etags
and tracks last-validation times.

Eviction is best-effort LRU by total bytes, capped by
``AZURE_BLOB_CACHE_MAX_BYTES`` (default 2 GiB).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from data_formulator.datalake.workspace import get_data_formulator_home

logger = logging.getLogger(__name__)

CACHE_DIR_NAME = "blob_cache"
_DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB


@dataclass
class CacheEntry:
    """A cached blob: its bytes live at ``path``, validated by ``etag``."""

    key: str
    path: Path
    etag: str
    size: int

    def read_bytes(self) -> bytes:
        return self.path.read_bytes()


class BlobDiskCache:
    """Thread-safe on-disk cache of blob bytes keyed by ``container/blob_name``.

    Safe to share across threads.  Multiple *processes* (gunicorn workers)
    share the same directory; writes are atomic (temp + ``os.replace``) so a
    concurrent reader never sees a half-written file.  In-memory bookkeeping
    (index, validation timestamps, total size) is per-process — that only
    affects eviction accounting and TTL freshness, both of which are
    best-effort and remain correct via ETag validation.
    """

    def __init__(self, root: Path, max_bytes: int = _DEFAULT_MAX_BYTES) -> None:
        self._root = root
        self._max_bytes = max_bytes
        self._lock = threading.RLock()
        self._index: dict[str, CacheEntry] = {}
        self._validated_at: dict[str, float] = {}
        self._total_bytes = 0
        self._root.mkdir(parents=True, exist_ok=True)
        self._load_index()

    # ------------------------------------------------------------------
    # Paths / keys
    # ------------------------------------------------------------------

    @staticmethod
    def _stem(key: str) -> str:
        return hashlib.sha256(key.encode("utf-8")).hexdigest()

    def _bin_path(self, key: str) -> Path:
        return self._root / f"{self._stem(key)}.bin"

    def _meta_path(self, key: str) -> Path:
        return self._root / f"{self._stem(key)}.meta.json"

    # ------------------------------------------------------------------
    # Index bootstrap
    # ------------------------------------------------------------------

    def _load_index(self) -> None:
        """Populate the in-memory index by scanning existing meta files."""
        try:
            meta_files = list(self._root.glob("*.meta.json"))
        except OSError:
            return
        for meta_file in meta_files:
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                key = meta["key"]
                bin_path = self._bin_path(key)
                if not bin_path.exists():
                    continue
                size = int(meta.get("size", bin_path.stat().st_size))
                self._index[key] = CacheEntry(
                    key=key, path=bin_path, etag=meta["etag"], size=size
                )
                self._total_bytes += size
            except Exception:
                logger.debug("blob cache: skipping bad meta %s", meta_file, exc_info=True)

    # ------------------------------------------------------------------
    # Read side
    # ------------------------------------------------------------------

    def get(self, key: str) -> Optional[CacheEntry]:
        """Return the cached entry for *key*, or ``None`` if absent."""
        with self._lock:
            entry = self._index.get(key)
            if entry is not None and entry.path.exists():
                return entry
            if entry is not None:
                # bin vanished underneath us — drop the stale index record
                self._drop_locked(key)
            return None

    def is_fresh(self, key: str, ttl_seconds: float) -> bool:
        """Whether *key* was validated within the last ``ttl_seconds``."""
        if ttl_seconds <= 0:
            return False
        with self._lock:
            last = self._validated_at.get(key)
            return last is not None and (time.monotonic() - last) < ttl_seconds

    def mark_validated(self, key: str) -> None:
        """Record that *key* was just confirmed up-to-date against Azure."""
        with self._lock:
            self._validated_at[key] = time.monotonic()

    # ------------------------------------------------------------------
    # Write side
    # ------------------------------------------------------------------

    def put(self, key: str, data: bytes, etag: str) -> CacheEntry:
        """Store *data*/*etag* for *key* and return the resulting entry."""
        bin_path = self._bin_path(key)
        meta_path = self._meta_path(key)
        self._atomic_write(bin_path, data)
        meta = {
            "key": key,
            "etag": etag,
            "size": len(data),
            "cached_at": time.time(),
        }
        self._atomic_write(
            meta_path, json.dumps(meta, ensure_ascii=False).encode("utf-8")
        )
        with self._lock:
            old = self._index.get(key)
            if old is not None:
                self._total_bytes -= old.size
            entry = CacheEntry(key=key, path=bin_path, etag=etag, size=len(data))
            self._index[key] = entry
            self._total_bytes += entry.size
            self._validated_at[key] = time.monotonic()
            self._evict_if_needed_locked()
        return entry

    def invalidate(self, key: str) -> None:
        """Remove *key* from the cache (disk + memory)."""
        with self._lock:
            self._drop_locked(key)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _atomic_write(path: Path, data: bytes) -> None:
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            tmp.write_bytes(data)
            os.replace(tmp, path)
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    def _drop_locked(self, key: str) -> None:
        entry = self._index.pop(key, None)
        if entry is not None:
            self._total_bytes -= entry.size
        self._validated_at.pop(key, None)
        self._bin_path(key).unlink(missing_ok=True)
        self._meta_path(key).unlink(missing_ok=True)

    def _evict_if_needed_locked(self) -> None:
        if self._total_bytes <= self._max_bytes:
            return
        # Evict least-recently-validated first; entries never validated this
        # process (timestamp 0) go first.
        candidates = sorted(
            self._index.keys(),
            key=lambda k: self._validated_at.get(k, 0.0),
        )
        for key in candidates:
            if self._total_bytes <= self._max_bytes:
                break
            self._drop_locked(key)


_cache_singleton: Optional[BlobDiskCache] = None
_singleton_lock = threading.Lock()


def get_blob_disk_cache() -> BlobDiskCache:
    """Return the process-global :class:`BlobDiskCache` (created on first use)."""
    global _cache_singleton
    if _cache_singleton is None:
        with _singleton_lock:
            if _cache_singleton is None:
                try:
                    max_bytes = int(
                        os.getenv("AZURE_BLOB_CACHE_MAX_BYTES", str(_DEFAULT_MAX_BYTES))
                    )
                except ValueError:
                    max_bytes = _DEFAULT_MAX_BYTES
                root = get_data_formulator_home() / CACHE_DIR_NAME
                _cache_singleton = BlobDiskCache(root, max_bytes=max_bytes)
    return _cache_singleton
