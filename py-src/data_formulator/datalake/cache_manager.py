# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Global cache manager for multi-user deployments.

While each :class:`CachedAzureBlobWorkspace` enforces its own per-workspace
limit (default 1 GB), this module enforces a **server-wide ceiling** across
ALL user caches, preventing the aggregate local cache from consuming all
available disk space when many users are active.

Architecture
~~~~~~~~~~~~
``GlobalCacheManager`` is a **thread-safe singleton**.  The first call to
:meth:`get_instance` configures it (cache root, max bytes, scan interval);
subsequent calls return the same object.

Cross-user eviction
~~~~~~~~~~~~~~~~~~~
When the global limit is exceeded, files are evicted across *all* user
cache directories using **LRU by mtime** (oldest files first, regardless
of which user owns them).  Protected files (``workspace.yaml``) are never
evicted.  Eviction targets 80 % of the global max to avoid thrashing.

Graceful degradation
~~~~~~~~~~~~~~~~~~~~
When the global cache is full and eviction cannot free enough space,
individual workspaces fall through to direct Azure reads.  User-initiated
writes always succeed locally (correctness), but read-path caching is
skipped so the disk isn't filled further.

Disk scanning
~~~~~~~~~~~~~
Total disk usage is computed via ``os.walk()`` over the cache root.
To avoid excessive I/O on servers with many files, the scan is
**debounced** — at most once per ``scan_interval`` seconds (default 10 s).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

from data_formulator.datalake.metadata import METADATA_FILENAME

logger = logging.getLogger(__name__)

# Default global cache limit: 50 GB
_DEFAULT_GLOBAL_MAX_BYTES = 50 * 1024**3

# Default interval between filesystem scans (seconds)
_DEFAULT_SCAN_INTERVAL = 10.0


class GlobalCacheManager:
    """Thread-safe singleton managing total cache disk usage across all users.

    Usage::

        mgr = GlobalCacheManager.get_instance(
            cache_root=Path("~/.data_formulator/cache"),
            max_global_bytes=10 * 1024**3,   # 10 GB
        )

        # Before caching a downloaded file (optional write):
        if mgr.try_acquire_space(len(data)):
            cache_file.write_bytes(data)

        # After a mandatory write (e.g. user upload):
        cache_file.write_bytes(data)
        mgr.notify_write(len(data))

        # Monitoring:
        stats = mgr.get_global_stats()
    """

    _instance: GlobalCacheManager | None = None
    _init_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Singleton access
    # ------------------------------------------------------------------

    @classmethod
    def get_instance(
        cls,
        cache_root: Path | str | None = None,
        max_global_bytes: int = _DEFAULT_GLOBAL_MAX_BYTES,
        scan_interval: float = _DEFAULT_SCAN_INTERVAL,
    ) -> GlobalCacheManager:
        """Return the singleton, creating it on first call.

        Args:
            cache_root: Root of the local cache tree.  Defaults to
                ``~/.data_formulator/cache``.
            max_global_bytes: Global ceiling in bytes (default 10 GB).
            scan_interval: Min seconds between full filesystem scans
                (default 10).

        Subsequent calls return the existing singleton — arguments are
        ignored after the first call.
        """
        if cls._instance is not None:
            return cls._instance
        with cls._init_lock:
            if cls._instance is not None:
                return cls._instance
            if cache_root is None:
                from data_formulator.datalake.workspace import (
                    get_data_formulator_home,
                )

                cache_root = get_data_formulator_home() / "cache"
            cls._instance = cls(
                Path(cache_root), max_global_bytes, scan_interval
            )
            return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        """Discard the singleton (for testing only)."""
        with cls._init_lock:
            cls._instance = None

    # ------------------------------------------------------------------
    # Construction (private — use get_instance)
    # ------------------------------------------------------------------

    def __init__(
        self,
        cache_root: Path,
        max_global_bytes: int,
        scan_interval: float,
    ):
        self._cache_root = cache_root
        self._max_global_bytes = max_global_bytes
        self._scan_interval = scan_interval

        self._lock = threading.Lock()
        self._last_scan_time: float = 0.0
        self._cached_total_bytes: int = 0

        logger.info(
            "GlobalCacheManager: root=%s max=%d MB scan_interval=%.1fs",
            cache_root,
            max_global_bytes // (1024 * 1024),
            scan_interval,
        )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def max_global_bytes(self) -> int:
        return self._max_global_bytes

    @property
    def cache_root(self) -> Path:
        return self._cache_root

    # ------------------------------------------------------------------
    # Disk scanning (debounced)
    # ------------------------------------------------------------------

    def _scan_total_size(self) -> int:
        """Walk the cache root and sum file sizes.

        Debounced: returns the cached value if the last scan was less
        than ``scan_interval`` seconds ago.

        **Must be called with ``self._lock`` held.**
        """
        now = time.monotonic()
        if now - self._last_scan_time < self._scan_interval:
            return self._cached_total_bytes

        total = 0
        try:
            for dirpath, _dirnames, filenames in os.walk(self._cache_root):
                for fn in filenames:
                    try:
                        total += os.path.getsize(os.path.join(dirpath, fn))
                    except OSError:
                        pass
        except OSError:
            pass

        self._cached_total_bytes = total
        self._last_scan_time = now
        return total

    # ------------------------------------------------------------------
    # Space management
    # ------------------------------------------------------------------

    def try_acquire_space(self, needed_bytes: int) -> bool:
        """Try to make room for *needed_bytes* of new cache data.

        1. If total + needed is under the limit, return ``True``.
        2. Otherwise, run cross-user LRU eviction.
        3. If still insufficient, return ``False`` (caller should skip
           local caching and serve from Azure directly).

        This is intended for **optional** cache writes (e.g. caching a
        download).  For **mandatory** writes (user uploads), use
        :meth:`notify_write` after writing instead.
        """
        with self._lock:
            total = self._scan_total_size()
            if total + needed_bytes <= self._max_global_bytes:
                self._cached_total_bytes = total + needed_bytes
                return True

            # Try cross-user eviction
            freed = self._evict_global_unlocked(
                target_free=needed_bytes + int(self._max_global_bytes * 0.1)
            )

            # Re-scan after eviction
            if freed > 0:
                self._last_scan_time = 0.0  # force fresh scan
                total = self._scan_total_size()
                if total + needed_bytes <= self._max_global_bytes:
                    self._cached_total_bytes = total + needed_bytes
                    return True

            return False

    def notify_write(self, nbytes: int) -> None:
        """Notify the manager of a mandatory write (e.g. user upload).

        The write has already happened.  This bumps the cached counter
        and triggers global eviction if the limit is exceeded.
        """
        with self._lock:
            self._cached_total_bytes += nbytes
            if self._cached_total_bytes > self._max_global_bytes:
                self._evict_global_unlocked(
                    target_free=int(
                        self._cached_total_bytes
                        - self._max_global_bytes * 0.8
                    )
                )

    def maybe_evict_global(self) -> int:
        """Run cross-user eviction if total exceeds the global limit.

        Returns bytes freed.
        """
        with self._lock:
            total = self._scan_total_size()
            if total <= self._max_global_bytes:
                return 0
            return self._evict_global_unlocked(
                target_free=int(total - self._max_global_bytes * 0.8)
            )

    # ------------------------------------------------------------------
    # Cross-user LRU eviction (internal)
    # ------------------------------------------------------------------

    def _evict_global_unlocked(self, target_free: int) -> int:
        """Evict files across all user caches, LRU by mtime.

        **Must be called with ``self._lock`` held.**

        Skips:
        * ``workspace.yaml`` — correctness-critical metadata.
        * Hidden files (starting with ``.``).

        Args:
            target_free: Bytes to free.

        Returns:
            Total bytes actually freed.
        """
        if target_free <= 0:
            return 0

        # Collect all candidate files across all user caches
        candidates: list[tuple[str, float, int]] = []
        try:
            for dirpath, _, filenames in os.walk(self._cache_root):
                for fn in filenames:
                    if fn == METADATA_FILENAME:
                        continue
                    if fn.startswith("."):
                        continue
                    full = os.path.join(dirpath, fn)
                    try:
                        st = os.stat(full)
                        candidates.append((full, st.st_mtime, st.st_size))
                    except OSError:
                        pass
        except OSError:
            return 0

        # Sort by mtime ascending (oldest first = evict first)
        candidates.sort(key=lambda x: x[1])

        freed = 0
        evicted = 0
        for full_path, _mtime, size in candidates:
            if freed >= target_free:
                break
            try:
                os.unlink(full_path)
                freed += size
                evicted += 1
            except OSError:
                pass

        if evicted:
            logger.info(
                "Global cache eviction: removed %d file(s), freed %.1f MB "
                "(target was %.1f MB)",
                evicted,
                freed / (1024 * 1024),
                target_free / (1024 * 1024),
            )
            # Invalidate cached scan so next check is accurate
            self._last_scan_time = 0.0

        return freed

    # ------------------------------------------------------------------
    # Monitoring
    # ------------------------------------------------------------------

    def get_global_stats(self) -> dict[str, Any]:
        """Return global cache statistics for monitoring / debugging."""
        with self._lock:
            total = self._scan_total_size()

        # Count user-level cache directories (root/datalake_root/user_id/)
        user_dirs = 0
        try:
            for entry in os.scandir(self._cache_root):
                if entry.is_dir():
                    for sub in os.scandir(entry.path):
                        if sub.is_dir():
                            user_dirs += 1
        except OSError:
            pass

        return {
            "cache_root": str(self._cache_root),
            "total_size_bytes": total,
            "total_size_mb": round(total / (1024 * 1024), 2),
            "max_size_mb": round(self._max_global_bytes / (1024 * 1024), 2),
            "utilization_pct": (
                round(total / self._max_global_bytes * 100, 1)
                if self._max_global_bytes > 0
                else 0
            ),
            "user_cache_count": user_dirs,
        }

    # ------------------------------------------------------------------
    # Representation
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"GlobalCacheManager(root={self._cache_root!r}, "
            f"max={self._max_global_bytes // (1024**2)} MB)"
        )
