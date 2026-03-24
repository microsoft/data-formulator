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

from data_formulator.datalake.metadata import (
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
from data_formulator.datalake.workspace import Workspace

if TYPE_CHECKING:
    from azure.storage.blob import ContainerClient

logger = logging.getLogger(__name__)


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
    ):
        """
        Args:
            identity_id: Unique user identifier (e.g. ``"user:123"``).
            container_client: An ``azure.storage.blob.ContainerClient``
                already authenticated and pointing at the target container.
            datalake_root: Optional path prefix inside the container
                (e.g. ``"workspaces"``).  Leading/trailing slashes are
                stripped automatically.
        """
        if not identity_id:
            raise ValueError("identity_id cannot be empty")

        # --- identity -------------------------------------------------------
        self._identity_id = identity_id
        self._safe_id = self._sanitize_identity_id(identity_id)

        # --- blob storage ----------------------------------------------------
        self._container: ContainerClient = container_client
        root = datalake_root.strip("/")
        self._datalake_root = root
        self._prefix = f"{root}/{self._safe_id}/" if root else f"{self._safe_id}/"

        # _path / _root are not meaningful for blob storage but some code
        # (e.g. sandbox) may reference them, so we set them to None rather
        # than leaving them undefined.
        self._root = None  # type: ignore[assignment]
        self._path = None  # type: ignore[assignment]

        # --- in-memory metadata cache ----------------------------------------
        # Avoids re-downloading workspace.yaml on every method call.
        # Invalidated automatically by save_metadata() and cleanup().
        self._metadata_cache: Optional[WorkspaceMetadata] = None

        # Per-instance lock for atomic metadata updates (blob storage has no
        # file-level locking like the local workspace, so we use a threading
        # lock to serialise in-process read-modify-write cycles).
        self._metadata_lock = threading.Lock()

        # --- blob data cache -------------------------------------------------
        # Caches downloaded blob bytes keyed by filename.  Avoids repeated
        # downloads of the same data file within one request (e.g.
        # analyze_table calls run_parquet_sql once per column, each of
        # which would otherwise re-download the entire parquet blob).
        # Invalidated per-file on upload/delete, cleared on cleanup.
        self._blob_data_cache: dict[str, bytes] = {}

        # --- metadata --------------------------------------------------------
        if not self._blob_exists(METADATA_FILENAME):
            self._init_metadata()

        logger.debug("Initialized AzureBlobWorkspace at %s", self._prefix)

    # ------------------------------------------------------------------
    # Low-level blob helpers
    # ------------------------------------------------------------------

    def _blob_name(self, filename: str) -> str:
        """Full blob name for *filename* within this workspace."""
        return f"{self._prefix}{filename}"

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
        """Upload *data* to blob.  Returns size in bytes."""
        raw = data.encode("utf-8") if isinstance(data, str) else data
        self._get_blob(filename).upload_blob(raw, overwrite=overwrite)
        # Invalidate cached copy of this file
        self._blob_data_cache.pop(filename, None)
        if hasattr(self, "_temp_file_cache") and filename in self._temp_file_cache:
            self._temp_file_cache.pop(filename).unlink(missing_ok=True)
        return len(raw)

    def _download_bytes(self, filename: str) -> bytes:
        cached = self._blob_data_cache.get(filename)
        if cached is not None:
            return cached
        data = self._get_blob(filename).download_blob().readall()
        self._blob_data_cache[filename] = data
        return data

    def _delete_blob(self, filename: str) -> None:
        self._get_blob(filename).delete_blob()
        self._blob_data_cache.pop(filename, None)
        if hasattr(self, "_temp_file_cache") and filename in self._temp_file_cache:
            self._temp_file_cache.pop(filename).unlink(missing_ok=True)

    @contextmanager
    def _temp_local_copy(self, filename: str):
        """Yield a local file path containing the blob's data.

        The file is cached on disk for the lifetime of this workspace
        instance so that repeated calls (e.g. ``run_parquet_sql`` once
        per column in ``analyze_table``) don't re-write the temp file.
        The cache is keyed by filename and cleaned up when the instance
        is garbage-collected or when :meth:`cleanup` is called.
        """
        if not hasattr(self, "_temp_file_cache"):
            self._temp_file_cache: dict[str, Path] = {}

        tmp_path = self._temp_file_cache.get(filename)
        if tmp_path is None or not tmp_path.exists():
            data = self._download_bytes(filename)
            suffix = Path(filename).suffix
            tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            tmp.write(data)
            tmp.close()
            tmp_path = Path(tmp.name)
            self._temp_file_cache[filename] = tmp_path

        yield tmp_path
        # Don't delete — reused across calls, cleaned up on GC / cleanup()

    def _cleanup_temp_files(self) -> None:
        """Remove all cached temp files from disk."""
        for path in getattr(self, "_temp_file_cache", {}).values():
            path.unlink(missing_ok=True)
        if hasattr(self, "_temp_file_cache"):
            self._temp_file_cache.clear()

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
        parsed = yaml.safe_load(raw)
        if parsed is None:
            raise ValueError("Metadata blob parsed to None")
        self._metadata_cache = WorkspaceMetadata.from_dict(parsed)
        return self._metadata_cache

    def save_metadata(self, metadata: WorkspaceMetadata) -> None:
        metadata.updated_at = datetime.now(timezone.utc)
        content = yaml.dump(
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
        """Return the full blob name for *filename*.

        .. note::
            The return type is ``str`` (a blob path), **not** a local
            ``pathlib.Path``.  Code that opens the result as a local file
            will not work — use :meth:`read_data_as_df`,
            :meth:`download_file`, or :meth:`_temp_local_copy` instead.
        """
        return self._blob_name(safe_data_filename(filename))

    def file_exists(self, filename: str) -> bool:
        return self._blob_exists(safe_data_filename(filename))

    def delete_table(self, table_name: str) -> bool:
        metadata = self.get_metadata()
        table = metadata.get_table(table_name)
        if table is None:
            return False

        if self._blob_exists(table.filename):
            self._delete_blob(table.filename)

        removed = [False]

        def _remove(m: WorkspaceMetadata) -> None:
            removed[0] = m.remove_table(table_name)

        self._atomic_update_metadata(_remove)
        logger.info("Deleted table %s from blob workspace %s", table_name, self._safe_id)
        return removed[0]

    def delete_tables_by_source_file(self, source_filename: str) -> list[str]:
        safe_filename = safe_data_filename(source_filename)
        deleted: list[str] = []

        def _cleanup(m: WorkspaceMetadata) -> None:
            for name, table in list(m.tables.items()):
                if table.filename == safe_filename:
                    m.remove_table(name)
                    deleted.append(name)

        self._atomic_update_metadata(_cleanup)

        if deleted and self._blob_exists(safe_filename):
            try:
                self._delete_blob(safe_filename)
            except Exception as e:
                logger.warning("Failed to delete source blob %s: %s", safe_filename, e)
            logger.info(
                "Deleted %d table(s) for source file %s: %s",
                len(deleted), safe_filename, deleted,
            )
        return deleted

    def cleanup(self) -> None:
        """Delete **all** blobs under this workspace's prefix."""
        for blob in self._container.list_blobs(name_starts_with=self._prefix):
            self._container.delete_blob(blob.name)
        self._metadata_cache = None
        self._blob_data_cache.clear()
        self._cleanup_temp_files()
        logger.info("Cleaned up blob workspace %s", self._safe_id)

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read_data_as_df(self, table_name: str) -> pd.DataFrame:
        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if not self._blob_exists(meta.filename):
            raise FileNotFoundError(f"Blob not found: {meta.filename}")

        buf = io.BytesIO(self._download_bytes(meta.filename))
        readers = {
            "parquet": lambda b: pd.read_parquet(b),
            "csv": lambda b: pd.read_csv(b),
            "excel": lambda b: pd.read_excel(b),
            "json": lambda b: pd.read_json(b),
            "txt": lambda b: pd.read_csv(b, sep="\t"),
        }
        reader = readers.get(meta.file_type)
        if reader is None:
            raise ValueError(
                f"Unsupported file type '{meta.file_type}' for table '{table_name}'. "
                f"Supported: {', '.join(readers)}."
            )
        return reader(buf)

    # ------------------------------------------------------------------
    # Parquet write
    # ------------------------------------------------------------------

    def write_parquet_from_arrow(
        self,
        table: pa.Table,
        table_name: str,
        compression: str = DEFAULT_COMPRESSION,
        loader_metadata: Optional[dict[str, Any]] = None,
    ) -> TableMetadata:
        safe_name = sanitize_table_name(table_name)
        filename = f"{safe_name}.parquet"

        # Remove old blob if overwriting
        ws_meta = self.get_metadata()
        if safe_name in ws_meta.tables:
            old_fn = ws_meta.tables[safe_name].filename
            if self._blob_exists(old_fn):
                self._delete_blob(old_fn)

        # Serialise to bytes, upload
        buf = io.BytesIO()
        pq.write_table(table, buf, compression=compression)
        blob_bytes = buf.getvalue()
        self._upload_bytes(filename, blob_bytes)

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

        if loader_metadata:
            table_metadata.loader_type = loader_metadata.get("loader_type")
            table_metadata.loader_params = loader_metadata.get("loader_params")
            table_metadata.source_table = loader_metadata.get("source_table")
            table_metadata.source_query = loader_metadata.get("source_query")

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
        loader_metadata: Optional[dict[str, Any]] = None,
    ) -> TableMetadata:
        safe_name = sanitize_table_name(table_name)
        filename = f"{safe_name}.parquet"

        ws_meta = self.get_metadata()
        if safe_name in ws_meta.tables:
            old_fn = ws_meta.tables[safe_name].filename
            if self._blob_exists(old_fn):
                self._delete_blob(old_fn)

        sanitized_df = sanitize_dataframe_for_arrow(df)
        arrow_table = pa.Table.from_pandas(sanitized_df)

        buf = io.BytesIO()
        pq.write_table(arrow_table, buf, compression=compression)
        blob_bytes = buf.getvalue()
        self._upload_bytes(filename, blob_bytes)

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

        if loader_metadata:
            table_metadata.loader_type = loader_metadata.get("loader_type")
            table_metadata.loader_params = loader_metadata.get("loader_params")
            table_metadata.source_table = loader_metadata.get("source_table")
            table_metadata.source_query = loader_metadata.get("source_query")

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
        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if meta.file_type != "parquet":
            raise ValueError(f"Table {table_name} is not a parquet file")
        if not self._blob_exists(meta.filename):
            raise FileNotFoundError(f"Parquet blob not found: {meta.filename}")

        with self._temp_local_copy(meta.filename) as tmp_path:
            pf = pq.ParquetFile(tmp_path)
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
        if not self._blob_exists(meta.filename):
            raise FileNotFoundError(f"Parquet blob not found: {meta.filename}")
        return self._blob_name(meta.filename)

    def run_parquet_sql(self, table_name: str, sql: str) -> pd.DataFrame:
        """Run a DuckDB SQL query against a parquet table.

        Downloads the blob to a temporary local file for the duration of
        the query, so DuckDB can use its native parquet reader.
        """
        import duckdb

        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if meta.file_type != "parquet":
            raise ValueError(f"Table {table_name} is not a parquet file")
        if not self._blob_exists(meta.filename):
            raise FileNotFoundError(f"Parquet blob not found: {meta.filename}")
        if "{parquet}" not in sql:
            raise ValueError("SQL must contain {parquet} placeholder")

        with self._temp_local_copy(meta.filename) as tmp_path:
            escaped = str(tmp_path).replace("\\", "\\\\").replace("'", "''")
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
        """Upload raw file content to the workspace as a blob."""
        self._upload_bytes(safe_data_filename(filename), content)

    def download_file(self, filename: str) -> bytes:
        """Download raw file content from the workspace blob."""
        return self._download_bytes(safe_data_filename(filename))

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
    # Session management (blob-backed)
    # ------------------------------------------------------------------

    def _session_blob_prefix(self, session_name: str) -> str:
        """Blob prefix for a named session.

        Uses a parallel structure to the workspace prefix::

          workspace data:  <root>/<safe_id>/...
          sessions:        sessions/<safe_id>/<session_name>/...

        This mirrors the local filesystem layout where workspaces and
        sessions live side-by-side.
        """
        safe_name = self._sanitize_session_name(session_name)
        return f"sessions/{self._safe_id}/{safe_name}/"

    def save_session(self, session_name: str, state: dict) -> str:
        safe_name = self._sanitize_session_name(session_name)
        prefix = self._session_blob_prefix(session_name)

        # Wipe previous save
        for blob in self._container.list_blobs(name_starts_with=prefix):
            self._container.delete_blob(blob.name)

        # 1. Snapshot workspace files into session blobs
        for blob in self._container.list_blobs(name_starts_with=self._prefix):
            rel = blob.name[len(self._prefix):]
            if not rel:
                continue
            data = self._container.download_blob(blob.name).readall()
            self._container.upload_blob(
                f"{prefix}workspace/{rel}", data, overwrite=True
            )

        # 2. State JSON
        state_json = json.dumps(state, default=str, ensure_ascii=False)
        self._container.upload_blob(
            f"{prefix}state.json", state_json.encode("utf-8"), overwrite=True
        )

        saved_at = datetime.now(timezone.utc).isoformat()
        logger.info(f"Saved session '{safe_name}' for {self._identity_id} (blob)")
        return saved_at

    def load_session(self, session_name: str) -> dict | None:
        prefix = self._session_blob_prefix(session_name)
        state_blob = f"{prefix}state.json"

        from azure.core.exceptions import ResourceNotFoundError
        try:
            raw = self._container.download_blob(state_blob).readall()
        except ResourceNotFoundError:
            return None

        # Restore workspace: delete current blobs, copy session workspace blobs
        ws_prefix = f"{prefix}workspace/"
        ws_blobs = list(self._container.list_blobs(name_starts_with=ws_prefix))
        if ws_blobs:
            self.cleanup()
            for blob in ws_blobs:
                rel = blob.name[len(ws_prefix):]
                if not rel:
                    continue
                data = self._container.download_blob(blob.name).readall()
                self._container.upload_blob(
                    self._blob_name(rel), data, overwrite=True
                )
            if not self._blob_exists(METADATA_FILENAME):
                self._init_metadata()

        # Invalidate caches since workspace blobs were replaced
        self._metadata_cache = None
        self._blob_data_cache.clear()
        self._cleanup_temp_files()

        return json.loads(raw)

    def _sessions_root_prefix(self) -> str:
        """Blob prefix for all sessions of this user."""
        return f"sessions/{self._safe_id}/"

    def list_sessions(self) -> list[dict]:
        sessions_prefix = self._sessions_root_prefix()
        sessions: list[dict] = []
        seen: set[str] = set()

        for blob in self._container.list_blobs(name_starts_with=sessions_prefix):
            rel = blob.name[len(sessions_prefix):]
            parts = rel.split("/", 1)
            if len(parts) < 2:
                continue
            sess_name = parts[0]
            if sess_name in seen:
                continue
            # Check it has a state.json
            if parts[1] == "state.json":
                seen.add(sess_name)
                sessions.append({
                    "name": sess_name,
                    "saved_at": blob.last_modified.isoformat()
                    if blob.last_modified
                    else datetime.now(timezone.utc).isoformat(),
                })

        sessions.sort(key=lambda s: s["saved_at"], reverse=True)
        return sessions

    def delete_session(self, session_name: str) -> bool:
        prefix = self._session_blob_prefix(session_name)
        blobs = list(self._container.list_blobs(name_starts_with=prefix))
        if not blobs:
            return False
        for blob in blobs:
            self._container.delete_blob(blob.name)
        logger.info(f"Deleted session '{session_name}' for {self._identity_id} (blob)")
        return True

    def export_session_zip(self, state: dict) -> io.BytesIO:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("state.json", json.dumps(state, default=str, ensure_ascii=False))
            for blob in self._container.list_blobs(name_starts_with=self._prefix):
                rel = blob.name[len(self._prefix):]
                if not rel:
                    continue
                data = self._container.download_blob(blob.name).readall()
                zf.writestr(f"workspace/{rel}", data)
        buf.seek(0)
        return buf

    def import_session_zip(self, zip_data: io.BytesIO) -> dict:
        with zipfile.ZipFile(zip_data, "r") as zf:
            if "state.json" not in zf.namelist():
                raise ValueError("Invalid session file: missing state.json")

            state = json.loads(zf.read("state.json"))

            workspace_entries = [
                n for n in zf.namelist()
                if n.startswith("workspace/") and not n.endswith("/")
            ]
            if workspace_entries:
                self.cleanup()
                for entry in workspace_entries:
                    rel = entry[len("workspace/"):]
                    # Guard against zip-slip: secure_filename strips
                    # path separators and ".." components.
                    safe_rel = secure_filename(rel)
                    if not safe_rel:
                        continue  # skip entries that sanitise to empty
                    self._upload_bytes(safe_rel, zf.read(entry))
                if not self._blob_exists(METADATA_FILENAME):
                    self._init_metadata()
                # Invalidate caches since workspace blobs were replaced
                self._metadata_cache = None
                self._blob_data_cache.clear()
                self._cleanup_temp_files()

        return state

    # ------------------------------------------------------------------
    # Representation
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"AzureBlobWorkspace(identity_id={self._identity_id!r}, "
            f"prefix={self._prefix!r})"
        )
