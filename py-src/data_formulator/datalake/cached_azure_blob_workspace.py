# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Cached Azure Blob workspace with persistent local file mirror.

Wraps :class:`AzureBlobWorkspace` with a **write-through local cache**
under ``~/.data_formulator/cache/``.  Reads come from the local mirror
(filesystem speed), writes go to the local mirror immediately and are
uploaded to Azure Blob Storage in a background thread.

Key performance improvements over plain ``AzureBlobWorkspace``:

* ``read_data_as_df()`` — reads local parquet directly (no blob download)
* ``local_dir()``       — yields the cache directory (no temp-dir downloads)
* ``run_parquet_sql()`` — runs DuckDB against local parquet (no temp copy)
* ``write_parquet()``   — writes local file immediately, Azure upload in bg

Cache eviction
--------------
An LRU eviction mechanism prevents unbounded disk growth:

* **Max size** — configurable, default 1 GB per workspace.
* **Trigger**  — checked after every write.
* **Policy**   — evict least-recently-used files (oldest ``mtime``) until
  total cache size drops to 80 % of the max.
* **Protected** — ``workspace.yaml`` and files with pending background
  uploads are never evicted.

Usage::

    from azure.storage.blob import ContainerClient
    from data_formulator.datalake.cached_azure_blob_workspace import (
        CachedAzureBlobWorkspace,
    )

    container = ContainerClient.from_connection_string(conn_str, "my-container")
    ws = CachedAzureBlobWorkspace(
        "user:42", container,
        datalake_root="workspaces",
        max_cache_bytes=2 * 1024**3,   # 2 GB cache
    )
"""

from __future__ import annotations

import atexit
import collections
import io
import logging
import os
import shutil
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, TYPE_CHECKING

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import yaml

from data_formulator.datalake.azure_blob_workspace import AzureBlobWorkspace
from data_formulator.datalake.cache_manager import GlobalCacheManager
from data_formulator.datalake.workspace_metadata import (
    METADATA_FILENAME,
    WorkspaceMetadata,
)
from data_formulator.datalake.parquet_utils import sanitize_table_name
from data_formulator.datalake.workspace import Workspace, get_data_formulator_home

if TYPE_CHECKING:
    from azure.storage.blob import ContainerClient

logger = logging.getLogger(__name__)

# Default cache size limit per workspace (1 GB).
_DEFAULT_MAX_CACHE_BYTES = 1 * 1024 ** 3


class CachedAzureBlobWorkspace(AzureBlobWorkspace):
    """Azure Blob workspace with a persistent local file cache.

    Every file written to Azure is also written to a local cache directory.
    Reads are served from the local cache whenever possible — falling back
    to Azure only for files that have been evicted or written by another
    process.

    Background uploads
    ~~~~~~~~~~~~~~~~~~
    Data-file uploads are submitted to a :class:`ThreadPoolExecutor` so
    they don't block the request thread.  Metadata (``workspace.yaml``)
    is always uploaded **synchronously** because it is small and
    correctness-critical.  Call :meth:`wait_for_uploads` to block until
    all pending uploads finish (e.g. before shutdown or tests).

    Multi-instance safety
    ~~~~~~~~~~~~~~~~~~~~~~
    When the same user is served by multiple server instances (e.g.
    behind a load balancer), each instance has its own local cache.
    Stale-cache detection compares the local ``workspace.yaml``'s
    ``updated_at`` timestamp against Azure on a configurable interval
    (default: 30 s).  If Azure is newer, the local metadata and any
    changed data files are re-downloaded.

    Global cache budget
    ~~~~~~~~~~~~~~~~~~~~
    A :class:`GlobalCacheManager` singleton enforces a server-wide
    ceiling (default 10 GB) across **all** user caches.  When the
    global limit is exceeded, cross-user LRU eviction removes the
    oldest files server-wide.  If eviction cannot free enough space,
    download-path caching is skipped (graceful degradation) so reads
    fall through to Azure Blob Storage directly.

    Thread safety
    ~~~~~~~~~~~~~
    The local cache directory is per-user so there are no cross-user
    conflicts.  Per-file upload locks prevent concurrent background
    uploads from racing on the same blob.  The ``_pending_uploads``
    set is protected by a global lock.
    """

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def __init__(
        self,
        identity_id: str,
        container_client: "ContainerClient",
        datalake_root: str = "",
        *,
        blob_prefix: str | None = None,
        cache_root: str | Path | None = None,
        max_cache_bytes: int = _DEFAULT_MAX_CACHE_BYTES,
        max_global_cache_bytes: int | None = None,
        bg_upload_workers: int = 2,
        staleness_check_interval: float = 30.0,
    ):
        """
        Args:
            identity_id:  Unique user identifier.
            container_client:  Azure ``ContainerClient``.
            datalake_root:  Path prefix inside the blob container.
            cache_root:  Root of the local cache tree.  Defaults to
                ``~/.data_formulator/cache``.
            max_cache_bytes:  Maximum total size of cached files for this
                workspace before LRU eviction kicks in.
            max_global_cache_bytes:  Server-wide ceiling across **all**
                user caches (default: 10 GB).  ``None`` uses the
                :class:`GlobalCacheManager` default.
            bg_upload_workers:  Thread pool size for background uploads.
            staleness_check_interval:  Seconds between Azure metadata
                freshness checks (default: 30).  Set to 0 to check on
                every ``get_metadata()`` call.
        """
        # We must set up the cache directory *before* calling
        # super().__init__ because the parent's __init__ may call
        # _upload_bytes (via _init_metadata / save_metadata).
        safe_id = Workspace._sanitize_identity_id(identity_id)

        if cache_root is None:
            cache_root = get_data_formulator_home() / "cache"
        base = Path(cache_root)

        if blob_prefix is not None:
            # Multi-workspace mode: cache dir based on blob prefix
            safe_prefix = blob_prefix.strip("/").replace("/", os.sep)
            self._cache_dir = base / safe_prefix
        else:
            root = datalake_root.strip("/")
            if root:
                self._cache_dir = base / root / safe_id
            else:
                self._cache_dir = base / safe_id
        self._cache_dir.mkdir(parents=True, exist_ok=True)

        self._max_cache_bytes = max_cache_bytes

        # Background upload machinery
        self._pending_uploads: set[str] = set()
        self._upload_lock = threading.Lock()
        # Per-file locks to serialise concurrent uploads to the same blob
        self._file_locks: dict[str, threading.Lock] = collections.defaultdict(
            threading.Lock
        )
        self._upload_executor = ThreadPoolExecutor(
            max_workers=bg_upload_workers,
            thread_name_prefix="df_cache_upload",
        )
        self._upload_futures: list[Future] = []
        # Register atexit hook to flush pending uploads on interpreter exit
        atexit.register(self._atexit_flush)

        # Staleness detection for multi-instance deployments
        self._staleness_check_interval = staleness_check_interval
        self._last_staleness_check: float = 0.0  # epoch seconds
        self._local_metadata_updated_at: Optional[datetime] = None

        # Initialise the global cache manager (singleton) — must be
        # before super().__init__ because _upload_bytes references it.
        gcm_kwargs: dict[str, Any] = {"cache_root": base}
        if max_global_cache_bytes is not None:
            gcm_kwargs["max_global_bytes"] = max_global_cache_bytes
        self._global_cache = GlobalCacheManager.get_instance(**gcm_kwargs)

        # Now safe to call super().__init__ — our _upload_bytes / etc.
        # overrides are in place and _cache_dir is ready.
        super().__init__(identity_id, container_client, datalake_root, blob_prefix=blob_prefix)

        # Run initial eviction if cache is over-sized (e.g. from prev run)
        self._maybe_evict()

        logger.info(
            "Initialized CachedAzureBlobWorkspace: prefix=%s cache=%s "
            "max=%d MB global_max=%d MB",
            self._prefix,
            self._cache_dir,
            self._max_cache_bytes // (1024 * 1024),
            self._global_cache.max_global_bytes // (1024 * 1024),
        )

    # ------------------------------------------------------------------
    # Cache path helper
    # ------------------------------------------------------------------

    def _cache_path(self, filename: str) -> Path:
        """Return the local cache path for *filename*.

        Raises ``ValueError`` if the resolved path escapes the cache
        directory (defence-in-depth against path-traversal attacks).
        """
        resolved = (self._cache_dir / filename).resolve()
        if not resolved.is_relative_to(self._cache_dir.resolve()):
            raise ValueError(
                f"Path traversal detected: {filename!r} resolves outside "
                f"the cache directory"
            )
        return resolved

    # ------------------------------------------------------------------
    # Low-level blob overrides (write-through cache)
    # ------------------------------------------------------------------

    def _upload_bytes(
        self,
        filename: str,
        data: bytes | str,
        *,
        overwrite: bool = True,
    ) -> int:
        """Write *data* to local cache **and** Azure.

        Metadata (``workspace.yaml``) is uploaded synchronously.
        Data files are uploaded in a background thread.
        """
        raw = data.encode("utf-8") if isinstance(data, str) else data

        # 1. Write to local cache immediately
        cache_file = self._cache_path(filename)
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_bytes(raw)

        # 2. Invalidate in-memory caches (inherited from AzureBlobWorkspace)
        self._blob_data_cache.pop(filename, None)
        if hasattr(self, "_temp_file_cache") and filename in self._temp_file_cache:
            self._temp_file_cache.pop(filename).unlink(missing_ok=True)

        # 3. Upload to Azure
        if filename == METADATA_FILENAME:
            # Metadata: synchronous (small, correctness-critical)
            self._get_blob(filename).upload_blob(raw, overwrite=overwrite)
        else:
            # Data files: background upload with per-file lock
            with self._upload_lock:
                self._pending_uploads.add(filename)

            def _bg_upload(fn: str, payload: bytes) -> None:
                # Per-file lock ensures concurrent writes to the same
                # blob are serialised — last write always wins.
                file_lock = self._file_locks[fn]
                file_lock.acquire()
                try:
                    self._get_blob(fn).upload_blob(payload, overwrite=True)
                    logger.debug("Background upload complete: %s", fn)
                except Exception:
                    logger.warning(
                        "Background upload FAILED for %s — data is safe in "
                        "local cache and will be retried on next write.",
                        fn,
                        exc_info=True,
                    )
                finally:
                    file_lock.release()
                    with self._upload_lock:
                        self._pending_uploads.discard(fn)

            fut = self._upload_executor.submit(_bg_upload, filename, raw)
            self._upload_futures.append(fut)

        # 4. Evict if needed (per-workspace, then global)
        self._maybe_evict()
        # Notify global manager of the mandatory write
        self._global_cache.notify_write(len(raw))

        return len(raw)

    def _download_bytes(self, filename: str) -> bytes:
        """Read from local cache first, then Azure, then populate cache."""
        # 1. Local cache hit
        cache_file = self._cache_path(filename)
        if cache_file.exists():
            data = cache_file.read_bytes()
            # Touch to update mtime for LRU tracking
            try:
                os.utime(cache_file, None)
            except OSError:
                pass
            # Also populate in-memory cache for extra speed on hot paths
            self._blob_data_cache[filename] = data
            return data

        # 2. In-memory cache (shouldn't happen if local cache is warm)
        cached = self._blob_data_cache.get(filename)
        if cached is not None:
            # Backfill local cache — only if global budget allows
            if self._global_cache.try_acquire_space(len(cached)):
                try:
                    cache_file.parent.mkdir(parents=True, exist_ok=True)
                    cache_file.write_bytes(cached)
                except OSError:
                    logger.debug("Failed to backfill cache for %s", filename)
            return cached

        # 3. Azure download (cache miss — evicted or written by other instance)
        data = self._get_blob(filename).download_blob().readall()
        self._blob_data_cache[filename] = data

        # Persist to local cache only if global budget allows
        if self._global_cache.try_acquire_space(len(data)):
            try:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_bytes(data)
            except OSError:
                logger.debug(
                    "Global cache full — serving %s from Azure without "
                    "local caching",
                    filename,
                )
        else:
            logger.debug(
                "Global cache full — serving %s from Azure without "
                "local caching",
                filename,
            )
        return data

    def _blob_exists(self, filename: str) -> bool:
        """Check local cache first, then Azure."""
        if self._cache_path(filename).exists():
            return True
        # Fall back to Azure (file may have been evicted)
        return super()._blob_exists(filename)

    # ------------------------------------------------------------------
    # Staleness detection (multi-instance safety)
    # ------------------------------------------------------------------

    def _check_staleness(self) -> None:
        """Compare local metadata timestamp with Azure's.

        If Azure has a newer ``updated_at``, invalidate local metadata
        and any data files whose table metadata has changed.
        Called by ``get_metadata()`` at most once per
        ``staleness_check_interval``.
        """
        now = time.monotonic()
        if now - self._last_staleness_check < self._staleness_check_interval:
            return
        self._last_staleness_check = now

        try:
            # Fetch fresh metadata from Azure (bypass all caches)
            raw = self._get_blob(METADATA_FILENAME).download_blob().readall()
            parsed = yaml.safe_load(raw)
            if parsed is None:
                return
            remote_meta = WorkspaceMetadata.from_dict(parsed)
        except Exception:
            # If Azure is unreachable, use local cache silently
            logger.debug("Staleness check: Azure unreachable, using local cache")
            return

        local_meta = self._metadata_cache
        if local_meta is None:
            # No local metadata cached yet — will be loaded fresh anyway
            return

        if remote_meta.updated_at <= local_meta.updated_at:
            return  # local is up to date

        logger.info(
            "Stale cache detected: local=%s remote=%s — refreshing",
            local_meta.updated_at.isoformat(),
            remote_meta.updated_at.isoformat(),
        )

        # Find data files that changed (different hash or new tables)
        for table_name, remote_table in remote_meta.tables.items():
            local_table = local_meta.tables.get(table_name)
            if (
                local_table is None
                or local_table.content_hash != remote_table.content_hash
            ):
                # Invalidate cached file so next read re-downloads
                self._cache_path(remote_table.filename).unlink(missing_ok=True)
                self._blob_data_cache.pop(remote_table.filename, None)
                logger.debug("Invalidated stale cached file: %s", remote_table.filename)

        # Find tables deleted remotely
        for table_name in list(local_meta.tables.keys()):
            if table_name not in remote_meta.tables:
                old_fn = local_meta.tables[table_name].filename
                self._cache_path(old_fn).unlink(missing_ok=True)
                self._blob_data_cache.pop(old_fn, None)

        # Update local metadata cache file and in-memory cache
        self._cache_path(METADATA_FILENAME).write_bytes(raw)
        self._metadata_cache = remote_meta
        self._blob_data_cache[METADATA_FILENAME] = raw

    def _delete_blob(self, filename: str) -> None:
        """Delete from local cache, in-memory caches, and Azure."""
        # Local cache
        self._cache_path(filename).unlink(missing_ok=True)

        # In-memory caches
        self._blob_data_cache.pop(filename, None)
        if hasattr(self, "_temp_file_cache") and filename in self._temp_file_cache:
            self._temp_file_cache.pop(filename).unlink(missing_ok=True)

        # Azure
        try:
            self._get_blob(filename).delete_blob()
        except Exception:
            logger.debug("Azure delete failed for %s (may not exist)", filename)

    # ------------------------------------------------------------------
    # Temp-local-copy override (use cache file directly)
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Metadata override with staleness check
    # ------------------------------------------------------------------

    def get_metadata(self) -> WorkspaceMetadata:
        """Return workspace metadata, checking Azure for staleness."""
        self._check_staleness()
        return super().get_metadata()

    # ------------------------------------------------------------------
    # Temp-local-copy override (use cache file directly)
    # ------------------------------------------------------------------

    @contextmanager
    def _temp_local_copy(self, filename: str):
        """Yield the local cache path directly — no temp file needed."""
        cache_file = self._cache_path(filename)
        if not cache_file.exists():
            # Ensure file is in cache
            self._download_bytes(filename)
        yield cache_file

    # ------------------------------------------------------------------
    # Read overrides (read directly from local cache files)
    # ------------------------------------------------------------------

    def read_data_as_df(self, table_name: str) -> pd.DataFrame:
        """Read table from local cache (fast!) with Azure fallback."""
        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")

        cache_file = self._cache_path(meta.filename)

        # Ensure file is in cache
        if not cache_file.exists():
            # Download from Azure and populate cache
            self._download_bytes(meta.filename)

        # Update mtime for LRU
        try:
            os.utime(cache_file, None)
        except OSError:
            pass

        # Read directly from local file — fastest path
        readers = {
            "parquet": lambda p: pd.read_parquet(p),
            "csv": lambda p: pd.read_csv(p),
            "excel": lambda p: pd.read_excel(p),
            "json": lambda p: pd.read_json(p),
            "txt": lambda p: pd.read_csv(p, sep="\t"),
        }
        reader = readers.get(meta.file_type)
        if reader is None:
            raise ValueError(
                f"Unsupported file type '{meta.file_type}' for table "
                f"'{table_name}'. Supported: {', '.join(readers)}."
            )
        return reader(cache_file)

    def run_parquet_sql(self, table_name: str, sql: str) -> pd.DataFrame:
        """Run DuckDB SQL against local cache file (no temp copy needed)."""
        import duckdb

        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if meta.file_type != "parquet":
            raise ValueError(f"Table {table_name} is not a parquet file")
        if "{parquet}" not in sql:
            raise ValueError("SQL must contain {parquet} placeholder")

        cache_file = self._cache_path(meta.filename)
        if not cache_file.exists():
            self._download_bytes(meta.filename)

        # Update mtime for LRU
        try:
            os.utime(cache_file, None)
        except OSError:
            pass

        escaped = str(cache_file).replace("\\", "\\\\").replace("'", "''")
        full_sql = sql.format(parquet=f"read_parquet('{escaped}')")
        conn = duckdb.connect(":memory:")
        try:
            return conn.execute(full_sql).fetchdf()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # local_dir — the biggest win
    # ------------------------------------------------------------------

    @contextmanager
    def local_dir(self):
        """Yield the cache directory — no temp dir, no mass downloads.

        Verifies that all workspace data files are present in the local
        cache before yielding.  Any missing files (evicted or written by
        another instance) are downloaded on demand.
        """
        self._ensure_all_cached()
        yield self._cache_dir

    def _ensure_all_cached(self) -> None:
        """Download any workspace files not present in local cache."""
        for blob in self._container.list_blobs(name_starts_with=self._prefix):
            rel = blob.name[len(self._prefix) :]
            if not rel or rel == METADATA_FILENAME:
                continue
            cache_file = self._cache_path(rel)
            if not cache_file.exists():
                data = self._container.download_blob(blob.name).readall()
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_bytes(data)
                logger.debug("local_dir: downloaded missing file %s", rel)

    # ------------------------------------------------------------------
    # Cache eviction (LRU by mtime)
    # ------------------------------------------------------------------

    def _get_cache_size(self) -> int:
        """Total bytes of all files in the cache directory."""
        total = 0
        for f in self._cache_dir.iterdir():
            if f.is_file():
                try:
                    total += f.stat().st_size
                except OSError:
                    pass
        return total

    def _maybe_evict(self) -> None:
        """Evict LRU files if cache exceeds ``max_cache_bytes``.

        Evicts down to 80 % of max.  Never evicts ``workspace.yaml``
        or files with pending background uploads.
        """
        total = self._get_cache_size()
        if total <= self._max_cache_bytes:
            return

        target = int(self._max_cache_bytes * 0.8)

        # Collect eviction candidates (sorted oldest mtime first)
        candidates: list[tuple[Path, float, int]] = []
        with self._upload_lock:
            pending = set(self._pending_uploads)

        for f in self._cache_dir.iterdir():
            if not f.is_file():
                continue
            if f.name == METADATA_FILENAME:
                continue  # never evict metadata
            if f.name in pending:
                continue  # never evict files being uploaded
            try:
                st = f.stat()
                candidates.append((f, st.st_mtime, st.st_size))
            except OSError:
                pass

        # Sort by mtime ascending (oldest first = evict first)
        candidates.sort(key=lambda x: x[1])

        evicted = 0
        freed = 0
        for path, mtime, size in candidates:
            if total <= target:
                break
            try:
                path.unlink(missing_ok=True)
                total -= size
                freed += size
                evicted += 1
            except OSError:
                pass

        if evicted:
            logger.info(
                "Cache eviction: removed %d file(s), freed %.1f MB, "
                "remaining %.1f / %.1f MB",
                evicted,
                freed / (1024 * 1024),
                total / (1024 * 1024),
                self._max_cache_bytes / (1024 * 1024),
            )

        # Also run global cross-user eviction if needed
        self._global_cache.maybe_evict_global()

    def get_cache_stats(self) -> dict[str, Any]:
        """Return cache statistics for monitoring / debugging."""
        files = []
        total_size = 0
        for f in self._cache_dir.iterdir():
            if f.is_file():
                try:
                    st = f.stat()
                    files.append({"name": f.name, "size": st.st_size, "mtime": st.st_mtime})
                    total_size += st.st_size
                except OSError:
                    pass

        with self._upload_lock:
            pending = list(self._pending_uploads)

        return {
            "cache_dir": str(self._cache_dir),
            "file_count": len(files),
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "max_size_mb": round(self._max_cache_bytes / (1024 * 1024), 2),
            "utilization_pct": round(total_size / self._max_cache_bytes * 100, 1)
            if self._max_cache_bytes > 0
            else 0,
            "pending_uploads": pending,
            "files": sorted(files, key=lambda f: f["mtime"], reverse=True),
        }

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def wait_for_uploads(self, timeout: float | None = 30) -> bool:
        """Block until all pending background uploads complete.

        Args:
            timeout: Max seconds to wait.  ``None`` = wait forever.

        Returns:
            ``True`` if all uploads finished, ``False`` if timeout was hit.
        """
        # Collect outstanding futures
        futures = [f for f in self._upload_futures if not f.done()]
        if not futures:
            return True

        from concurrent.futures import wait, FIRST_EXCEPTION

        done, not_done = wait(futures, timeout=timeout)
        # Clean up completed futures
        self._upload_futures = [f for f in self._upload_futures if not f.done()]

        if not_done:
            logger.warning(
                "%d background upload(s) did not complete within %.1fs",
                len(not_done),
                timeout or 0,
            )
            return False
        return True

    def _atexit_flush(self) -> None:
        """Best-effort flush of pending uploads on interpreter shutdown."""
        with self._upload_lock:
            if not self._pending_uploads:
                return
            pending_count = len(self._pending_uploads)

        logger.info("Flushing %d pending upload(s) on shutdown...", pending_count)
        self.wait_for_uploads(timeout=30)

    def cleanup(self) -> None:
        """Remove local cache immediately, delete Azure blobs in background.

        The local cache is cleared **synchronously** so the workspace is
        immediately reusable.  Azure blob deletion is submitted to the
        background thread pool so the caller isn't blocked by many
        sequential Azure API calls.
        """
        # 1. Wait for any in-flight uploads (so we don't race with them)
        self.wait_for_uploads(timeout=60)

        # 2. Clear local caches immediately (non-blocking)
        if self._cache_dir.exists():
            shutil.rmtree(self._cache_dir, ignore_errors=True)
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        self._metadata_cache = None
        self._blob_data_cache.clear()
        self._cleanup_temp_files()

        # 3. Delete Azure blobs in background
        prefix = self._prefix
        container = self._container

        def _bg_cleanup() -> None:
            try:
                for blob in container.list_blobs(name_starts_with=prefix):
                    try:
                        container.delete_blob(blob.name)
                    except Exception:
                        logger.debug("Failed to delete blob %s", blob.name)
                logger.info("Background cleanup finished for %s", prefix)
            except Exception:
                logger.warning(
                    "Background Azure cleanup failed for %s",
                    prefix,
                    exc_info=True,
                )

        self._upload_executor.submit(_bg_cleanup)
        logger.info("Cleanup: local cache cleared, Azure deletion queued for %s", self._safe_id)

    # ------------------------------------------------------------------
    # snapshot / session overrides: ensure cache consistency
    # ------------------------------------------------------------------

    def restore_workspace_snapshot(self, src: Path) -> None:
        """Restore snapshot and repopulate local cache."""
        # Clear local cache first
        if self._cache_dir.exists():
            shutil.rmtree(self._cache_dir, ignore_errors=True)
        self._cache_dir.mkdir(parents=True, exist_ok=True)

        # Delegate to parent (uploads blobs to Azure)
        super().restore_workspace_snapshot(src)

        # Repopulate cache from the source snapshot
        if src.exists():
            for f in src.rglob("*"):
                if f.is_file():
                    rel = str(f.relative_to(src))
                    cache_file = self._cache_path(rel)
                    cache_file.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, cache_file)

    def invalidate_metadata_cache(self) -> None:
        """Force re-read of metadata from Azure (clears local + in-memory)."""
        self._cache_path(METADATA_FILENAME).unlink(missing_ok=True)
        super().invalidate_metadata_cache()

    # ------------------------------------------------------------------
    # Representation
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"CachedAzureBlobWorkspace(identity_id={self._identity_id!r}, "
            f"prefix={self._prefix!r}, cache={self._cache_dir!r})"
        )
