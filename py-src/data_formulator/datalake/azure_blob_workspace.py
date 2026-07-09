# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Azure Blob Storage–backed workspace for the Data Lake.

Drop-in replacement for :class:`Workspace` where every file (data files
**and** ``workspace.yaml`` metadata) lives as a blob under::

    <container>/<datalake_root>/<sanitized_identity_id>/

Requires ``azure-storage-blob`` (``pip install azure-storage-blob``).

Usage::

    from azure.storage.blob import ContainerClient

    container = ContainerClient.from_connection_string(conn_str, "my-container")
    ws = AzureBlobWorkspace("user:42", container, datalake_root="workspaces")
"""

from __future__ import annotations

import io
import json
import logging
import os
import shutil
import tempfile
import threading
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional, TYPE_CHECKING

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import yaml

from data_formulator.datalake.workspace_metadata import (
    WorkspaceMetadata,
    TableMetadata,
    METADATA_FILENAME,
)
from werkzeug.utils import secure_filename
from data_formulator.datalake.parquet_utils import (
    safe_data_filename,
    sanitize_table_name,
    get_arrow_column_info,
    compute_arrow_table_hash,
    get_column_info,
    compute_dataframe_hash,
    sanitize_dataframe_for_arrow,
    DEFAULT_COMPRESSION,
)
from data_formulator.datalake.workspace import Workspace, get_data_formulator_home
from data_formulator.security.path_safety import ConfinedDir

if TYPE_CHECKING:
    from azure.storage.blob import ContainerClient

logger = logging.getLogger(__name__)


def _data_cache_ttl() -> float:
    """Seconds a cached *data* blob may be served without re-validating.

    Metadata is always re-validated (TTL 0). Data blobs (parquet) are
    effectively immutable per table version, so a small TTL lets rapid repeat
    reads (agent tool loops, UI refreshes) skip Azure entirely. Override with
    ``AZURE_BLOB_CACHE_TTL_SECONDS``.
    """
    try:
        return max(0.0, float(os.getenv("AZURE_BLOB_CACHE_TTL_SECONDS", "3")))
    except (TypeError, ValueError):
        return 3.0



class AzureBlobWorkspace(Workspace):
    """
    Workspace backed by Azure Blob Storage.

    All files (data + ``workspace.yaml``) are stored as blobs under
    ``<datalake_root>/<sanitized_identity_id>/`` inside the given container.

    Inherits from :class:`Workspace` so it is a drop-in replacement
    everywhere a ``Workspace`` is expected. Methods that only call other
    (overridden) methods — ``add_table_metadata``, ``get_table_metadata``,
    ``list_tables``, ``get_fresh_name``, ``get_relative_data_file_path``,
    ``refresh_parquet*`` — are inherited unchanged.
    """

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def __init__(
        self,
        identity_id: str,
        container_client: ContainerClient,
        datalake_root: str = "",
        *,
        blob_prefix: str | None = None,
    ):
        """
        Args:
            identity_id: Unique user identifier (e.g. ``"user:123"``).
            container_client: An ``azure.storage.blob.ContainerClient``
                already authenticated and pointing at the target container.
            datalake_root: Optional path prefix inside the container
                (e.g. ``"workspaces"``).  Leading/trailing slashes are
                stripped automatically. Ignored if blob_prefix is provided.
            blob_prefix: Direct blob prefix for this workspace. When provided,
                datalake_root and identity_id-based prefix are skipped.
                Used by AzureBlobWorkspaceManager for multi-workspace support.
        """
        if not identity_id:
            raise ValueError("identity_id cannot be empty")

        # --- identity -------------------------------------------------------
        self._identity_id = identity_id
        self._safe_id = self._sanitize_identity_id(identity_id)

        # --- blob storage ----------------------------------------------------
        self._container: ContainerClient = container_client
        self._container_name = getattr(container_client, "container_name", "") or ""
        if blob_prefix is not None:
            # Direct prefix mode (used by AzureBlobWorkspaceManager)
            self._datalake_root = ""
            self._prefix = blob_prefix.rstrip("/") + "/"
        else:
            # Legacy mode: datalake_root / safe_id
            root = datalake_root.strip("/")
            self._datalake_root = root
            self._prefix = f"{root}/{self._safe_id}/" if root else f"{self._safe_id}/"

        # _path / _root are not meaningful for blob storage but some code
        # (e.g. sandbox) may reference them, so we set them to None rather
        # than leaving them undefined.
        self._root = None  # type: ignore[assignment]
        self._path = None  # type: ignore[assignment]

        # --- local scratch directory ----------------------------------------
        # Blob storage has no local filesystem path, but agents (the
        # skill-based analyst agent and the data-loading chat sandbox) need a
        # real ``scratch/`` directory on disk for sandboxed code execution,
        # cross-turn namespace serialization, and user file uploads. We back
        # it with a stable per-workspace directory under the Data Formulator
        # home so it survives across requests handled by this instance.
        # ``confined_scratch`` (inherited from :class:`Workspace`) returns this
        # jail, so callers work identically to the local backend.
        safe_scratch_rel = self._prefix.strip("/").replace("/", os.sep) or self._safe_id
        scratch_base = get_data_formulator_home() / "scratch" / safe_scratch_rel
        scratch_base.mkdir(parents=True, exist_ok=True)
        self._scratch_dir = scratch_base
        self._confined_scratch = ConfinedDir(scratch_base, mkdir=False)
        # Blob storage has no local workspace root, so ``confined_root``
        # (inherited from :class:`Workspace`, returns ``self._confined_root``)
        # would otherwise be undefined. Point it at the same local scratch jail
        # so agents that read/list from the workspace root (e.g. the
        # data-loading chat's read_file/list_directory tools) operate on the
        # local working dir instead of raising AttributeError.
        self._confined_root = ConfinedDir(scratch_base, mkdir=False)

        # --- in-memory metadata cache ----------------------------------------
        # Avoids re-downloading workspace.yaml on every method call.
        # Invalidated automatically by save_metadata() and cleanup().
        self._metadata_cache: Optional[WorkspaceMetadata] = None

        # Per-instance lock for atomic metadata updates (blob storage has no
        # file-level locking like the local workspace, so we use a threading
        # lock to serialise in-process read-modify-write cycles).
        self._metadata_lock = threading.Lock()

        # --- blob data cache -------------------------------------------------
        # Request-local in-memory cache of downloaded blob bytes keyed by
        # filename.  Avoids repeated downloads of the same data file within one
        # request (e.g. analyze_table calls run_parquet_sql once per column).
        # Backed by the process-global :mod:`blob_disk_cache`, which persists
        # bytes + ETag across the short-lived per-request workspace instances.
        # Invalidated per-file on upload/delete, cleared on cleanup.
        self._blob_data_cache: dict[str, bytes] = {}

        # --- metadata --------------------------------------------------------
        # Skip the existence HEAD when the metadata blob is already cached on
        # disk (warm container) — this runs on every request-scoped construction.
        from data_formulator.datalake.blob_disk_cache import get_blob_disk_cache

        if get_blob_disk_cache().get(self._cache_key(METADATA_FILENAME)) is None:
            if not self._blob_exists(METADATA_FILENAME):
                self._init_metadata()

        logger.debug("Initialized AzureBlobWorkspace at %s", self._prefix)

    # ------------------------------------------------------------------
    # Low-level blob helpers
    # ------------------------------------------------------------------

    def _blob_name(self, filename: str) -> str:
        """Full blob name for *filename* within this workspace."""
        return f"{self._prefix}{filename}"

    def _data_blob_key(self, filename: str) -> str:
        """Blob-internal key for a data file (under data/ subdirectory)."""
        return f"data/{filename}"

    def _cache_key(self, filename: str) -> str:
        """Globally-unique key for the disk cache: container + full blob name."""
        return f"{self._container_name}/{self._blob_name(filename)}"

    def _get_blob(self, filename: str):
        """Return a ``BlobClient`` for *filename*."""
        return self._container.get_blob_client(self._blob_name(filename))

    def _blob_exists(self, filename: str) -> bool:
        from azure.core.exceptions import ResourceNotFoundError
        try:
            self._get_blob(filename).get_blob_properties()
            return True
        except ResourceNotFoundError:
            return False

    def _upload_bytes(
        self, filename: str, data: bytes | str, *, overwrite: bool = True
    ) -> int:
        """Upload *data* to blob.  Returns size in bytes.

        Write-through: the disk cache is updated with the new bytes + ETag so
        this worker serves the fresh copy immediately without a round trip.
        """
        from data_formulator.datalake.blob_disk_cache import get_blob_disk_cache

        raw = data.encode("utf-8") if isinstance(data, str) else data
        resp = self._get_blob(filename).upload_blob(raw, overwrite=overwrite)
        cache = get_blob_disk_cache()
        key = self._cache_key(filename)
        etag = resp.get("etag") if isinstance(resp, dict) else None
        if etag:
            cache.put(key, raw, etag)
        else:
            cache.invalidate(key)
        # Invalidate request-local copy of this file
        self._blob_data_cache.pop(filename, None)
        if hasattr(self, "_temp_file_cache") and filename in self._temp_file_cache:
            self._temp_file_cache.pop(filename).unlink(missing_ok=True)
        return len(raw)

    def _ensure_cached(self, filename: str):
        """Return a disk-cache :class:`CacheEntry` for *filename*, fetching or
        re-validating from Azure only when necessary.

        - Fresh within TTL (data blobs only) → served from disk, no Azure call.
        - Otherwise revalidate via a cheap ``get_blob_properties`` HEAD (no data
          transfer): matching ETag → keep the cached bytes; changed ETag → full
          download to refresh the cache.
        - Cold cache → full download.
        Raises ``ResourceNotFoundError`` if the blob does not exist.

        Note: we deliberately avoid a conditional ``download_blob`` here. The
        ``StorageStreamDownloader`` injects an ``If-Match`` on multi-chunk
        continuation requests, which combined with an ``If-None-Match`` makes
        large (multi-chunk) downloads fail with ``ResourceModifiedError``.
        Comparing ETags ourselves after a HEAD is equally cheap and robust.
        """
        from data_formulator.datalake.blob_disk_cache import get_blob_disk_cache

        cache = get_blob_disk_cache()
        key = self._cache_key(filename)
        ttl = 0.0 if filename == METADATA_FILENAME else _data_cache_ttl()
        blob = self._get_blob(filename)

        entry = cache.get(key)
        if entry is not None:
            if cache.is_fresh(key, ttl):
                return entry
            # Cheap revalidation: compare ETags via a HEAD (no data transfer).
            if blob.get_blob_properties().etag == entry.etag:
                cache.mark_validated(key)
                return entry

        # Cold cache or changed blob — full download.
        stream = blob.download_blob()
        data = stream.readall()
        return cache.put(key, data, stream.properties.etag)

    def _download_bytes(self, filename: str) -> bytes:
        cached = self._blob_data_cache.get(filename)
        if cached is not None:
            return cached
        data = self._ensure_cached(filename).read_bytes()
        self._blob_data_cache[filename] = data
        return data

    def _delete_blob(self, filename: str) -> None:
        from data_formulator.datalake.blob_disk_cache import get_blob_disk_cache

        self._get_blob(filename).delete_blob()
        get_blob_disk_cache().invalidate(self._cache_key(filename))
        self._blob_data_cache.pop(filename, None)
        if hasattr(self, "_temp_file_cache") and filename in self._temp_file_cache:
            self._temp_file_cache.pop(filename).unlink(missing_ok=True)

    @contextmanager
    def _temp_local_copy(self, filename: str):
        """Yield a local file path containing the blob's data.

        Backed by the process-global disk cache: the yielded path points at the
        cached ``.bin`` file (ETag-validated against Azure), so repeated calls
        across requests reuse the same local file with no re-download. Callers
        only read the file (DuckDB / pyarrow), so sharing the cached path is
        safe.
        """
        entry = self._ensure_cached(filename)
        yield entry.path

    def _cleanup_temp_files(self) -> None:
        """Remove all cached temp files from disk."""
        for path in getattr(self, "_temp_file_cache", {}).values():
            path.unlink(missing_ok=True)
        if hasattr(self, "_temp_file_cache"):
            self._temp_file_cache.clear()

    def _cleanup_scratch(self) -> None:
        """Remove the local scratch directory (sandbox working files)."""
        scratch_dir = getattr(self, "_scratch_dir", None)
        if scratch_dir and scratch_dir.exists():
            shutil.rmtree(scratch_dir, ignore_errors=True)

    def __del__(self) -> None:
        self._cleanup_temp_files()

    # ------------------------------------------------------------------
    # Metadata overrides
    # ------------------------------------------------------------------

    def _init_metadata(self) -> None:
        metadata = WorkspaceMetadata.create_new()
        self.save_metadata(metadata)
        logger.info("Initialized new workspace metadata in blob: %s", self._prefix)

    def get_metadata(self) -> WorkspaceMetadata:
        if self._metadata_cache is not None:
            return self._metadata_cache
        raw = self._download_bytes(METADATA_FILENAME)
        try:
            parsed = yaml.safe_load(raw)
        except yaml.YAMLError as e:
            raise ValueError(
                f"Corrupted workspace metadata YAML in blob storage: {e}"
            ) from e
        if parsed is None:
            raise ValueError("Metadata blob parsed to None")
        self._metadata_cache = WorkspaceMetadata.from_dict(parsed)
        return self._metadata_cache

    def save_metadata(self, metadata: WorkspaceMetadata) -> None:
        metadata.updated_at = datetime.now(timezone.utc)
        content = yaml.safe_dump(
            metadata.to_dict(),
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
        self._upload_bytes(METADATA_FILENAME, content)
        # Update the cache with the just-saved metadata
        self._metadata_cache = metadata

    def invalidate_metadata_cache(self) -> None:
        """Force the next get_metadata() to re-read from blob storage."""
        self._metadata_cache = None

    def _atomic_update_metadata(
        self,
        updater: Callable[[WorkspaceMetadata], None],
    ) -> WorkspaceMetadata:
        """Atomically read → update → write blob-backed metadata.

        Uses a per-instance :class:`threading.Lock` to serialise
        concurrent in-process metadata modifications.  This prevents
        lost-update races when the frontend sends parallel requests.
        """
        with self._metadata_lock:
            self._metadata_cache = None  # force fresh read from blob
            metadata = self.get_metadata()
            updater(metadata)
            self.save_metadata(metadata)
            return metadata

    # ------------------------------------------------------------------
    # File / table operations
    # ------------------------------------------------------------------

    def get_file_path(self, filename: str) -> str:  # type: ignore[override]
        """Return the full blob name for a data file.

        Data files are stored under the ``data/`` prefix within the workspace,
        matching the local workspace layout.

        .. note::
            The return type is ``str`` (a blob path), **not** a local
            ``pathlib.Path``.  Code that opens the result as a local file
            will not work — use :meth:`read_data_as_df`,
            :meth:`download_file`, or :meth:`_temp_local_copy` instead.
        """
        return self._blob_name(self._data_blob_key(safe_data_filename(filename)))

    def file_exists(self, filename: str) -> bool:
        return self._blob_exists(self._data_blob_key(safe_data_filename(filename)))

    def delete_table(self, table_name: str) -> bool:
        metadata = self.get_metadata()
        table = metadata.get_table(table_name)
        if table is None:
            return False

        if self._blob_exists(self._data_blob_key(table.filename)):
            self._delete_blob(self._data_blob_key(table.filename))

        removed = [False]

        def _remove(m: WorkspaceMetadata) -> None:
            removed[0] = m.remove_table(table_name)

        self._atomic_update_metadata(_remove)
        logger.info("Deleted table %s from blob workspace %s", table_name, self._safe_id)
        return removed[0]

    def delete_tables_by_source_file(self, source_filename: str) -> list[str]:
        safe_filename = safe_data_filename(source_filename)
        deleted: list[str] = []
        blobs_to_delete: list[str] = []

        def _cleanup(m: WorkspaceMetadata) -> None:
            for name, table in list(m.tables.items()):
                if table.source_file == safe_filename or table.filename == safe_filename:
                    blobs_to_delete.append(table.filename)
                    m.remove_table(name)
                    deleted.append(name)

        self._atomic_update_metadata(_cleanup)

        for fname in set(blobs_to_delete):
            blob_key = self._data_blob_key(fname)
            if self._blob_exists(blob_key):
                try:
                    self._delete_blob(blob_key)
                except Exception as e:
                    logger.warning("Failed to delete blob %s: %s", fname, e)
        if deleted:
            logger.info(
                "Deleted %d table(s) for source file %s: %s",
                len(deleted), safe_filename, deleted,
            )
        return deleted

    def cleanup(self) -> None:
        """Delete **all** blobs under this workspace's prefix."""
        from data_formulator.datalake.blob_disk_cache import get_blob_disk_cache

        cache = get_blob_disk_cache()
        for blob in self._container.list_blobs(name_starts_with=self._prefix):
            self._container.delete_blob(blob.name)
            cache.invalidate(f"{self._container_name}/{blob.name}")
        self._metadata_cache = None
        self._blob_data_cache.clear()
        self._cleanup_temp_files()
        self._cleanup_scratch()
        logger.info("Cleaned up blob workspace %s", self._safe_id)

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read_data_as_df(self, table_name: str) -> pd.DataFrame:
        from azure.core.exceptions import ResourceNotFoundError

        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        # Read straight from the ETag-validated disk cache path (no redundant
        # existence HEAD, no full in-memory copy); the download validates
        # existence and raises ResourceNotFoundError if the blob is gone.
        try:
            entry = self._ensure_cached(self._data_blob_key(meta.filename))
        except ResourceNotFoundError:
            raise FileNotFoundError(f"Blob not found: {meta.filename}")

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
                f"Unsupported file type '{meta.file_type}' for table '{table_name}'. "
                f"Supported: {', '.join(readers)}."
            )
        return reader(entry.path)

    # ------------------------------------------------------------------
    # Parquet write
    # ------------------------------------------------------------------

    def write_parquet_from_arrow(
        self,
        table: pa.Table,
        table_name: str,
        compression: str = DEFAULT_COMPRESSION,
        source_info: Optional[dict[str, Any]] = None,
    ) -> TableMetadata:
        safe_name = sanitize_table_name(table_name)
        filename = f"{safe_name}.parquet"

        # Remove old blob if overwriting
        ws_meta = self.get_metadata()
        if safe_name in ws_meta.tables:
            old_fn = ws_meta.tables[safe_name].filename
            if self._blob_exists(self._data_blob_key(old_fn)):
                self._delete_blob(self._data_blob_key(old_fn))

        # Serialise to bytes, upload
        buf = io.BytesIO()
        pq.write_table(table, buf, compression=compression)
        blob_bytes = buf.getvalue()
        self._upload_bytes(self._data_blob_key(filename), blob_bytes)

        now = datetime.now(timezone.utc)
        table_metadata = TableMetadata(
            name=safe_name,
            source_type="data_loader",
            filename=filename,
            file_type="parquet",
            created_at=now,
            content_hash=compute_arrow_table_hash(table),
            file_size=len(blob_bytes),
            row_count=table.num_rows,
            columns=get_arrow_column_info(table),
            last_synced=now,
        )

        if source_info:
            table_metadata.loader_type = source_info.get("loader_type")
            table_metadata.loader_params = source_info.get("loader_params")
            table_metadata.source_table = source_info.get("source_table")
            table_metadata.source_query = source_info.get("source_query")
            table_metadata.import_options = source_info.get("import_options")

        self.add_table_metadata(table_metadata)
        logger.info(
            "Wrote parquet blob %s: %d rows, %d cols (%d bytes) [Arrow]",
            filename, table.num_rows, table.num_columns, len(blob_bytes),
        )
        return table_metadata

    def write_parquet(
        self,
        df: pd.DataFrame,
        table_name: str,
        compression: str = DEFAULT_COMPRESSION,
        source_info: Optional[dict[str, Any]] = None,
    ) -> TableMetadata:
        safe_name = sanitize_table_name(table_name)
        filename = f"{safe_name}.parquet"

        ws_meta = self.get_metadata()
        if safe_name in ws_meta.tables:
            old_fn = ws_meta.tables[safe_name].filename
            if self._blob_exists(self._data_blob_key(old_fn)):
                self._delete_blob(self._data_blob_key(old_fn))

        sanitized_df = sanitize_dataframe_for_arrow(df)
        arrow_table = pa.Table.from_pandas(sanitized_df)

        buf = io.BytesIO()
        pq.write_table(arrow_table, buf, compression=compression)
        blob_bytes = buf.getvalue()
        self._upload_bytes(self._data_blob_key(filename), blob_bytes)

        now = datetime.now(timezone.utc)
        table_metadata = TableMetadata(
            name=safe_name,
            source_type="data_loader",
            filename=filename,
            file_type="parquet",
            created_at=now,
            content_hash=compute_dataframe_hash(df),
            file_size=len(blob_bytes),
            row_count=len(df),
            columns=get_column_info(df),
            last_synced=now,
        )

        if source_info:
            table_metadata.loader_type = source_info.get("loader_type")
            table_metadata.loader_params = source_info.get("loader_params")
            table_metadata.source_table = source_info.get("source_table")
            table_metadata.source_query = source_info.get("source_query")
            table_metadata.import_options = source_info.get("import_options")

        self.add_table_metadata(table_metadata)
        logger.info(
            "Wrote parquet blob %s: %d rows, %d cols (%d bytes)",
            filename, len(df), len(df.columns), len(blob_bytes),
        )
        return table_metadata

    # ------------------------------------------------------------------
    # Parquet read helpers
    # ------------------------------------------------------------------

    def get_parquet_schema(self, table_name: str) -> dict:
        from azure.core.exceptions import ResourceNotFoundError

        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if meta.file_type != "parquet":
            raise ValueError(f"Table {table_name} is not a parquet file")

        try:
            entry = self._ensure_cached(self._data_blob_key(meta.filename))
        except ResourceNotFoundError:
            raise FileNotFoundError(f"Parquet blob not found: {meta.filename}")
        pf = pq.ParquetFile(entry.path)
        schema = pf.schema_arrow
        return {
            "table_name": table_name,
            "filename": meta.filename,
            "num_rows": pf.metadata.num_rows,
            "num_columns": len(schema),
            "columns": [
                {"name": f.name, "type": str(f.type), "nullable": f.nullable}
                for f in schema
            ],
            "created_at": meta.created_at.isoformat(),
            "last_synced": (
                meta.last_synced.isoformat() if meta.last_synced else None
            ),
        }

    def get_parquet_path(self, table_name: str) -> str:  # type: ignore[override]
        """Return the full blob name for the parquet file.

        .. warning::
            Unlike the base class this returns a *blob path* (``str``),
            **not** a resolved local ``pathlib.Path``.
        """
        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if meta.file_type != "parquet":
            raise ValueError(f"Table {table_name} is not a parquet file")
        if not self._blob_exists(self._data_blob_key(meta.filename)):
            raise FileNotFoundError(f"Parquet blob not found: {meta.filename}")
        return self._blob_name(self._data_blob_key(meta.filename))

    def run_parquet_sql(self, table_name: str, sql: str) -> pd.DataFrame:
        """Run a DuckDB SQL query against a parquet table.

        Downloads the blob to a temporary local file for the duration of
        the query, so DuckDB can use its native parquet reader.
        """
        import duckdb
        from azure.core.exceptions import ResourceNotFoundError

        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if meta.file_type != "parquet":
            raise ValueError(f"Table {table_name} is not a parquet file")
        if "{parquet}" not in sql:
            raise ValueError("SQL must contain {parquet} placeholder")

        try:
            entry = self._ensure_cached(self._data_blob_key(meta.filename))
        except ResourceNotFoundError:
            raise FileNotFoundError(f"Parquet blob not found: {meta.filename}")
        escaped = str(entry.path).replace("\\", "\\\\").replace("'", "''")
        full_sql = sql.format(parquet=f"read_parquet('{escaped}')")
        conn = duckdb.connect(":memory:")
        try:
            return conn.execute(full_sql).fetchdf()
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Local directory materialisation (for sandbox execution)
    # ------------------------------------------------------------------

    @contextmanager
    def local_dir(self):
        """Download all workspace files to a temporary local directory.

        Yields the path to the temp directory.  The directory and its
        contents are removed when the context manager exits.
        """
        tmp = tempfile.mkdtemp(prefix="df_blob_ws_")
        tmp_path = Path(tmp)
        try:
            # Download every blob under this workspace's prefix
            for blob in self._container.list_blobs(name_starts_with=self._prefix):
                # Relative filename within the workspace
                rel = blob.name[len(self._prefix):]
                if not rel or rel == METADATA_FILENAME:
                    continue  # skip the metadata file itself
                local_file = tmp_path / rel
                local_file.parent.mkdir(parents=True, exist_ok=True)
                data = self._container.download_blob(blob.name).readall()
                local_file.write_bytes(data)
            yield tmp_path
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # ------------------------------------------------------------------
    # Raw file upload / download (replaces get_file_path + open() pattern)
    # ------------------------------------------------------------------

    def upload_file(self, content: bytes, filename: str) -> None:
        """Upload raw file content to the workspace as a data blob."""
        self._upload_bytes(self._data_blob_key(safe_data_filename(filename)), content)

    def download_file(self, filename: str) -> bytes:
        """Download raw file content from the workspace data blob."""
        return self._download_bytes(self._data_blob_key(safe_data_filename(filename)))

    # ------------------------------------------------------------------
    # Workspace snapshot (session save / restore)
    # ------------------------------------------------------------------

    def save_workspace_snapshot(self, dst: Path) -> None:
        """Download all workspace blobs (including metadata) to *dst*."""
        for blob in self._container.list_blobs(name_starts_with=self._prefix):
            rel = blob.name[len(self._prefix):]
            if not rel:
                continue
            dst.mkdir(parents=True, exist_ok=True)
            local_file = dst / rel
            local_file.parent.mkdir(parents=True, exist_ok=True)
            data = self._container.download_blob(blob.name).readall()
            local_file.write_bytes(data)

    def restore_workspace_snapshot(self, src: Path) -> None:
        """Replace all workspace blobs with files from *src* directory."""
        self.cleanup()
        if src.exists():
            for f in src.rglob("*"):
                if f.is_file():
                    rel = str(f.relative_to(src))
                    self._upload_bytes(rel, f.read_bytes())
        # Ensure metadata exists even if snapshot didn't include it
        if not self._blob_exists(METADATA_FILENAME):
            self._init_metadata()
        # Invalidate caches since metadata and data were replaced from snapshot
        self._metadata_cache = None
        self._blob_data_cache.clear()
        self._cleanup_temp_files()

    # ------------------------------------------------------------------
    # Representation
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"AzureBlobWorkspace(identity_id={self._identity_id!r}, "
            f"prefix={self._prefix!r})"
        )
