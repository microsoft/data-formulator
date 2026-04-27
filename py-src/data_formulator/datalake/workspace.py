# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Workspace management for the Data Lake.

Each user has a workspace directory identified by their identity_id.
The workspace contains all their data files (uploaded and ingested)
plus a workspace.yaml metadata file.
"""

import io
import json
import os
import re
import shutil
import logging
import tempfile
import time
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from data_formulator.datalake.workspace_metadata import (
    WorkspaceMetadata,
    TableMetadata,
    load_metadata,
    save_metadata,
    update_metadata,
    metadata_exists,
)
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
from data_formulator.security.path_safety import ConfinedDir
from werkzeug.utils import secure_filename

logger = logging.getLogger(__name__)


def get_data_formulator_home() -> Path:
    """
    Get the Data Formulator home directory.

    Resolution order:
    1. Flask app.config['CLI_ARGS']['data_dir'] (set via --data-dir CLI flag)
    2. DATA_FORMULATOR_HOME environment variable
    3. Default: ~/.data_formulator
    """
    # Try Flask app config first (set by --data-dir CLI arg)
    try:
        from flask import current_app
        data_dir = current_app.config.get('CLI_ARGS', {}).get('data_dir')
        if data_dir:
            return Path(data_dir)
    except (RuntimeError, ImportError):
        pass

    env_home = os.getenv("DATA_FORMULATOR_HOME")
    if env_home:
        return Path(env_home)

    return Path.home() / ".data_formulator"


def get_default_workspace_root() -> Path:
    """
    Get the default workspace root directory.

    Returns DATA_FORMULATOR_HOME / "workspaces".
    """
    return get_data_formulator_home() / "workspaces"


def get_user_home(identity_id: str) -> Path:
    """Return the per-user home directory: DATA_FORMULATOR_HOME/users/<safe_id>/.

    Shared helper used by workspace_factory, data_connector, and any
    code that needs per-user storage paths.
    """
    safe_id = _sanitize_identity_id(identity_id)
    return get_data_formulator_home() / "users" / safe_id


def _sanitize_identity_id(identity_id: str) -> str:
    """Sanitize identity_id for use as a directory name.

    Uses ``secure_filename`` to produce a safe single-component name.
    Raises ``ValueError`` if the result is empty or too long.
    """
    if len(identity_id) > 256:
        raise ValueError("identity_id too long")
    result = secure_filename(identity_id)
    if not result:
        raise ValueError("identity_id sanitized to empty string")
    return result


def cleanup_stale_temp_files(workspace_path: Path, max_age_hours: int = 24) -> int:
    """
    Remove stale temporary files from workspace directory.

    This handles crash recovery by cleaning up temp files (.temp_*.parquet) that
    were not properly deleted due to server crashes or unexpected shutdowns.

    Args:
        workspace_path: Path to the workspace directory
        max_age_hours: Remove temp files older than this many hours (default: 24)

    Returns:
        Number of files cleaned up
    """
    if not workspace_path.exists():
        return 0

    cleaned_count = 0
    current_time = time.time()
    max_age_seconds = max_age_hours * 3600

    try:
        for file_path in workspace_path.glob('.temp_*.parquet'):
            try:
                # Check file age using modification time
                file_age = current_time - file_path.stat().st_mtime

                if file_age > max_age_seconds:
                    file_path.unlink(missing_ok=True)
                    cleaned_count += 1
                    logger.info(
                        f"Cleaned up stale temp file: {file_path.name} "
                        f"(age: {file_age / 3600:.1f} hours)"
                    )
            except Exception as e:
                logger.warning(f"Failed to clean temp file {file_path}: {e}")
    except Exception as e:
        logger.warning(f"Error during temp file cleanup in {workspace_path}: {e}")

    if cleaned_count > 0:
        logger.info(f"Cleaned up {cleaned_count} stale temp file(s) from {workspace_path}")

    return cleaned_count


class Workspace:
    """
    Manages a user's workspace directory in the Data Lake.
    
    The workspace contains:
    - workspace.yaml: Metadata file tracking all data sources
    - Data files: User uploaded files (CSV, Excel, etc.) and parquet files from data loaders
    
    All files are stored in a single flat directory per user.
    """
    
    def __init__(self, identity_id: str, root_dir: Optional[str | Path] = None, *, workspace_path: Optional[str | Path] = None):
        """
        Initialize a workspace for a user.
        
        Args:
            identity_id: Unique identifier for the user (e.g., "user:123" or "browser:abc")
            root_dir: Root directory for all workspaces. If None, uses default.
                      Ignored if workspace_path is provided.
            workspace_path: Direct path to the workspace directory. When provided,
                           root_dir and identity_id-based path resolution are skipped.
                           Used by WorkspaceManager for multi-workspace support.
        """
        if not identity_id:
            raise ValueError("identity_id cannot be empty")
        
        # Sanitize identity_id for filesystem safety
        self._identity_id = identity_id
        self._safe_id = self._sanitize_identity_id(identity_id)
        
        if workspace_path is not None:
            # Direct path mode (used by WorkspaceManager)
            self._path = Path(workspace_path)
            self._root = self._path.parent
        else:
            # Legacy mode: root_dir / sanitized_identity_id
            if root_dir is None:
                self._root = get_default_workspace_root()
            else:
                self._root = Path(root_dir)
            self._path = self._root / self._safe_id

            # Verify the constructed path hasn't escaped the root directory
            root_jail = ConfinedDir(self._root, mkdir=False)
            try:
                root_jail.resolve(self._safe_id)
            except ValueError:
                raise ValueError(
                    "Path traversal detected: workspace path escapes root directory"
                )

        # Ensure workspace directory exists
        self._path.mkdir(parents=True, exist_ok=True)

        # ConfinedDir jails for sub-directories — single source of truth for
        # all callers that need path-safe access (agents, routes, etc.).
        self._confined_root = ConfinedDir(self._path, mkdir=False)
        self._confined_data = ConfinedDir(self._path / "data")
        self._confined_scratch = ConfinedDir(self._path / "scratch")

        # Initialize metadata if it doesn't exist
        if not metadata_exists(self._path):
            self._init_metadata()

        # --- in-memory metadata cache ----------------------------------------
        # Avoids re-reading and re-parsing workspace.yaml on every method call.
        # Invalidated automatically by save_metadata() and cleanup().
        self._metadata_cache: Optional[WorkspaceMetadata] = None

        # Clean up any stale temp files from previous crashes (older than 24 hours)
        # This is safe because active temp files are always created fresh and
        # cleaned up within minutes of their creation
        cleanup_stale_temp_files(self._path, max_age_hours=24)

        logger.debug(f"Initialized workspace at {self._path}")
    
    @staticmethod
    def _sanitize_identity_id(identity_id: str) -> str:
        """Sanitize identity_id for use as a directory name.
        
        Delegates to module-level :func:`_sanitize_identity_id`.
        """
        return _sanitize_identity_id(identity_id)
    
    @property
    def confined_root(self) -> ConfinedDir:
        """ConfinedDir jail for the workspace root directory."""
        return self._confined_root

    @property
    def confined_data(self) -> ConfinedDir:
        """ConfinedDir jail for the ``data/`` sub-directory."""
        return self._confined_data

    @property
    def confined_scratch(self) -> ConfinedDir:
        """ConfinedDir jail for the ``scratch/`` sub-directory."""
        return self._confined_scratch

    def _init_metadata(self) -> None:
        """Initialize a new workspace with empty metadata."""
        metadata = WorkspaceMetadata.create_new()
        save_metadata(self._path, metadata)
        logger.info(f"Initialized new workspace metadata at {self._path}")
    
    def get_file_path(self, filename: str) -> Path:
        """
        Get the full path for a data file in the workspace.

        Files are stored under the ``data/`` subdirectory of the workspace.

        Uses :func:`safe_data_filename` for Unicode-safe sanitisation:
        extracts the basename to prevent path traversal while preserving
        non-ASCII characters (Chinese, Japanese, etc.).

        Args:
            filename: Name of the file
            
        Returns:
            Full path to the file under data/
        """
        basename = safe_data_filename(filename)
        try:
            return self._confined_data.resolve(basename)
        except ValueError:
            raise ValueError(f"Path traversal detected: {filename!r}")
    
    def file_exists(self, filename: str) -> bool:
        """
        Check if a file exists in the workspace.
        
        Args:
            filename: Name of the file
            
        Returns:
            True if file exists, False otherwise
        """
        return self.get_file_path(filename).exists()
    
    
    def delete_table(self, table_name: str) -> bool:
        """
        Delete a table by name (removes both file and metadata).
        
        Args:
            table_name: Name of the table to delete
            
        Returns:
            True if table was deleted, False if it didn't exist
        """
        metadata = self.get_metadata()
        table = metadata.get_table(table_name)
        
        if table is None:
            return False
        
        file_path = self.get_file_path(table.filename)
        if file_path.exists():
            file_path.unlink()
        
        removed = [False]

        def _remove(m: WorkspaceMetadata) -> None:
            removed[0] = m.remove_table(table_name)

        self._atomic_update_metadata(_remove)
        
        logger.info(f"Deleted table {table_name} from workspace {self._safe_id}")
        return removed[0]

    # ── Metadata helpers ─────────────────────────────────────────────

    def _atomic_update_metadata(
        self,
        updater: "Callable[[WorkspaceMetadata], None]",
    ) -> WorkspaceMetadata:
        """Atomically read → update → write workspace metadata.

        Uses :func:`update_metadata` which holds a **single** file lock
        across the entire read-modify-write cycle, preventing lost updates
        when multiple requests modify metadata concurrently.

        Subclasses (e.g. Azure Blob) should override this to provide
        their own concurrency control.
        """
        self._metadata_cache = update_metadata(self._path, updater)
        return self._metadata_cache

    def get_metadata(self) -> WorkspaceMetadata:
        if self._metadata_cache is not None:
            return self._metadata_cache
        self._metadata_cache = load_metadata(self._path)
        return self._metadata_cache
    
    def save_metadata(self, metadata: WorkspaceMetadata) -> None:
        save_metadata(self._path, metadata)
        self._metadata_cache = metadata

    def invalidate_metadata_cache(self) -> None:
        """Force the next get_metadata() to re-read from disk."""
        self._metadata_cache = None
    
    def add_table_metadata(self, table: TableMetadata) -> None:
        """Atomically add or update a table entry in workspace metadata."""
        self._atomic_update_metadata(lambda m: m.add_table(table))
    
    def get_table_metadata(self, table_name: str) -> Optional[TableMetadata]:
        """Look up table metadata, falling back to sanitized name."""
        ws_metadata = self.get_metadata()
        result = ws_metadata.get_table(table_name)
        if result is None:
            result = ws_metadata.get_table(sanitize_table_name(table_name))
        return result
    
    def list_tables(self) -> list[str]:
        metadata = self.get_metadata()
        return metadata.list_tables()
    
    def get_fresh_name(self, name: str) -> str:
        """
        Generate a unique table name that doesn't conflict with existing tables.
        
        Sanitizes the input name, then checks if it already exists in the workspace.
        If it does, appends an incrementing numeric suffix (_2, _3, ...) until
        a unique name is found.
        
        Args:
            name: Desired table name (will be sanitized)
            
        Returns:
            A sanitized, unique table name safe for use in write_parquet etc.
        """
        base = sanitize_table_name(name)
        existing = set(self.list_tables())
        
        if base not in existing:
            return base
        
        # Try incrementing suffixes
        counter = 2
        while f"{base}_{counter}" in existing:
            counter += 1
        return f"{base}_{counter}"
    
    def delete_tables_by_source_file(self, source_filename: str) -> list[str]:
        """Delete all tables whose source filename matches.

        Matches against both ``source_file`` (upload origin) and
        ``filename`` (physical file), so this works whether the table
        was stored as-is or converted to parquet.

        Atomically removes the metadata entries, then deletes the
        physical files.  Used when re-uploading a file so that sheets
        removed in the new version don't linger as orphans.

        Returns:
            Names of the deleted tables.
        """
        safe_filename = safe_data_filename(source_filename)
        deleted: list[str] = []
        files_to_delete: list[str] = []

        def _cleanup(metadata: WorkspaceMetadata) -> None:
            for name, table in list(metadata.tables.items()):
                if table.source_file == safe_filename or table.filename == safe_filename:
                    files_to_delete.append(table.filename)
                    metadata.remove_table(name)
                    deleted.append(name)

        self._atomic_update_metadata(_cleanup)

        for fname in set(files_to_delete):
            try:
                file_path = self.get_file_path(fname)
                if file_path.exists():
                    file_path.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete file {fname}: {e}")
        if deleted:
            logger.info(
                f"Deleted {len(deleted)} table(s) for source file "
                f"{safe_filename}: {deleted}"
            )
        return deleted

    def cleanup(self) -> None:
        """ Remove the entire workspace directory. """
        if self._path.exists():
            shutil.rmtree(self._path)
            logger.info(f"Cleaned up workspace {self._safe_id}")
        self._metadata_cache = None

    def get_relative_data_file_path(self, table_name: str) -> str:
        """
        Get the filename for a table, suitable for use in generated code.

        Returns just the filename (e.g. "sales_data.parquet").  The sandbox
        ensures the script runs with the workspace as its working directory,
        so ``pd.read_parquet("sales_data.parquet")`` works directly.

        Args:
            table_name: Name of the table in the workspace

        Returns:
            Filename string that can be used in read_parquet() / read_csv() etc.

        Raises:
            FileNotFoundError: If the table doesn't exist
        """
        metadata = self.get_table_metadata(table_name)
        if metadata is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        return f"data/{metadata.filename}"

    def read_data_as_df(self, table_name: str) -> pd.DataFrame:
        """
        Read a table from the workspace as a pandas DataFrame.

        Automatically selects the appropriate reader based on the file's type
        (stored in metadata). Supports parquet, csv, excel, json, and txt.
        Falls back to sanitized table name if the original name is not found.

        Args:
            table_name: Name of the table in the workspace

        Returns:
            pandas DataFrame with the table data

        Raises:
            FileNotFoundError: If the table or file doesn't exist
            ValueError: If the file type is not supported for DataFrame reading
        """
        metadata = self.get_table_metadata(table_name)
        if metadata is None:
            raise FileNotFoundError(f"Table not found: {table_name}")

        file_path = self.get_file_path(metadata.filename)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

        file_type = metadata.file_type

        if file_type == "parquet":
            return pd.read_parquet(file_path)
        elif file_type == "csv":
            return pd.read_csv(file_path)
        elif file_type == "excel":
            return pd.read_excel(file_path)
        elif file_type == "json":
            return pd.read_json(file_path)
        elif file_type == "txt":
            return pd.read_csv(file_path, sep="\t")
        else:
            raise ValueError(
                f"Unsupported file type '{file_type}' for table '{table_name}'. "
                f"Supported types: parquet, csv, excel, json, txt."
            )

    # ------------------------------------------------------------------
    # Parquet management
    # ------------------------------------------------------------------

    def write_parquet_from_arrow(
        self,
        table: pa.Table,
        table_name: str,
        compression: str = DEFAULT_COMPRESSION,
        source_info: Optional[dict[str, Any]] = None,
    ) -> TableMetadata:
        """
        Write a PyArrow Table directly to parquet.

        This is the preferred path because it avoids pandas conversion.
        """
        safe_name = sanitize_table_name(table_name)
        filename = f"{safe_name}.parquet"

        # Overwrite existing file if present
        metadata = self.get_metadata()
        if safe_name in metadata.tables:
            old_file = self.get_file_path(metadata.tables[safe_name].filename)
            if old_file.exists():
                old_file.unlink()

        file_path = self.get_file_path(filename)
        pq.write_table(table, file_path, compression=compression)

        now = datetime.now(timezone.utc)
        table_metadata = TableMetadata(
            name=safe_name,
            source_type="data_loader",
            filename=filename,
            file_type="parquet",
            created_at=now,
            content_hash=compute_arrow_table_hash(table),
            file_size=file_path.stat().st_size,
            row_count=table.num_rows,
            columns=get_arrow_column_info(table),
            last_synced=now,
        )

        if source_info:
            table_metadata.loader_type = source_info.get('loader_type')
            table_metadata.loader_params = source_info.get('loader_params')
            table_metadata.source_table = source_info.get('source_table')
            table_metadata.source_query = source_info.get('source_query')
            table_metadata.import_options = source_info.get('import_options')

        self.add_table_metadata(table_metadata)
        logger.info(
            f"Wrote parquet {filename}: {table.num_rows} rows, "
            f"{table.num_columns} cols ({table_metadata.file_size} bytes) [Arrow]"
        )

        return table_metadata

    def write_parquet(
        self,
        df: pd.DataFrame,
        table_name: str,
        compression: str = DEFAULT_COMPRESSION,
        source_info: Optional[dict[str, Any]] = None,
    ) -> TableMetadata:
        """Write a pandas DataFrame to parquet."""
        safe_name = sanitize_table_name(table_name)
        filename = f"{safe_name}.parquet"

        metadata = self.get_metadata()
        if safe_name in metadata.tables:
            old_file = self.get_file_path(metadata.tables[safe_name].filename)
            if old_file.exists():
                old_file.unlink()

        file_path = self.get_file_path(filename)
        # Sanitize DataFrame to handle mixed types in object columns
        sanitized_df = sanitize_dataframe_for_arrow(df)
        arrow_table = pa.Table.from_pandas(sanitized_df)
        pq.write_table(arrow_table, file_path, compression=compression)

        now = datetime.now(timezone.utc)
        table_metadata = TableMetadata(
            name=safe_name,
            source_type="data_loader",
            filename=filename,
            file_type="parquet",
            created_at=now,
            content_hash=compute_dataframe_hash(df),
            file_size=file_path.stat().st_size,
            row_count=len(df),
            columns=get_column_info(df),
            last_synced=now,
        )

        if source_info:
            table_metadata.loader_type = source_info.get('loader_type')
            table_metadata.loader_params = source_info.get('loader_params')
            table_metadata.source_table = source_info.get('source_table')
            table_metadata.source_query = source_info.get('source_query')
            table_metadata.import_options = source_info.get('import_options')

        self.add_table_metadata(table_metadata)
        logger.info(
            f"Wrote parquet {filename}: {len(df)} rows, "
            f"{len(df.columns)} cols ({table_metadata.file_size} bytes)"
        )

        return table_metadata

    def get_parquet_schema(self, table_name: str) -> dict:
        """Get schema information for a parquet table without reading all data."""
        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if meta.file_type != "parquet":
            raise ValueError(f"Table {table_name} is not a parquet file")
        path = self.get_file_path(meta.filename)
        if not path.exists():
            raise FileNotFoundError(f"Parquet file not found: {path}")

        pf = pq.ParquetFile(path)
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
            "last_synced": meta.last_synced.isoformat() if meta.last_synced else None,
        }

    def get_parquet_path(self, table_name: str) -> Path:
        """Return the resolved filesystem path of the parquet file for *table_name*."""
        meta = self.get_table_metadata(table_name)
        if meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")
        if meta.file_type != "parquet":
            raise ValueError(f"Table {table_name} is not a parquet file")
        path = self.get_file_path(meta.filename)
        if not path.exists():
            raise FileNotFoundError(f"Parquet file not found: {path}")
        return path.resolve()

    def run_parquet_sql(self, table_name: str, sql: str) -> pd.DataFrame:
        """
        Run a DuckDB SQL query against a parquet table.

        The *sql* string must contain a ``{parquet}`` placeholder which will
        be replaced with ``read_parquet('<path>')``.
        Example:  ``SELECT * FROM {parquet} AS t LIMIT 10``

        This gives efficient column-pruned / row-group-skipped reads on
        large parquet files without loading the full table into memory.
        """
        import duckdb

        path = self.get_parquet_path(table_name)
        path_escaped = str(path).replace("\\", "\\\\").replace("'", "''")
        if "{parquet}" not in sql:
            raise ValueError("SQL must contain {parquet} placeholder")
        full_sql = sql.format(parquet=f"read_parquet('{path_escaped}')")
        conn = duckdb.connect(":memory:")
        try:
            return conn.execute(full_sql).fetchdf()
        finally:
            conn.close()

    def refresh_parquet_from_arrow(
        self,
        table_name: str,
        table: pa.Table,
        compression: str = DEFAULT_COMPRESSION,
    ) -> tuple[TableMetadata, bool]:
        """
        Refresh a parquet table with new Arrow data.

        Returns ``(new_metadata, data_changed)``.
        """
        old_meta = self.get_table_metadata(table_name)
        if old_meta is None:
            raise FileNotFoundError(f"Table not found: {table_name}")

        new_hash = compute_arrow_table_hash(table)
        if old_meta.content_hash == new_hash:
            old_meta.last_synced = datetime.now(timezone.utc)
            self.add_table_metadata(old_meta)
            logger.info(f"Table {table_name} unchanged (hash: {new_hash[:8]}…)")
            return old_meta, False

        source_info = {
            'loader_type': old_meta.loader_type,
            'loader_params': old_meta.loader_params,
            'source_table': old_meta.source_table,
            'source_query': old_meta.source_query,
        }
        new_meta = self.write_parquet_from_arrow(
            table=table,
            table_name=table_name,
            compression=compression,
            source_info=source_info,
        )
        logger.info(f"Refreshed {table_name}: {old_meta.row_count} → {new_meta.row_count} rows")
        return new_meta, True

    def refresh_parquet(
        self,
        table_name: str,
        df: pd.DataFrame,
        compression: str = DEFAULT_COMPRESSION,
    ) -> tuple[TableMetadata, bool]:
        """Refresh a parquet table with new DataFrame data."""
        return self.refresh_parquet_from_arrow(
            table_name, pa.Table.from_pandas(df), compression
        )

    @contextmanager
    def local_dir(self):
        """Context manager yielding a local directory containing workspace files.

        For local workspaces this simply yields ``self._path``.
        Subclasses (e.g. Azure Blob) override this to download files to a
        temporary directory that is cleaned up on exit.

        Usage::

            with workspace.local_dir() as wd:
                subprocess.run(["python", "script.py"], cwd=wd)
        """
        yield self._path

    def save_workspace_snapshot(self, dst: Path) -> None:
        """Copy all workspace files (including metadata) to *dst* directory.

        Used by session save / export to capture the full workspace state.
        """
        if self._path.exists() and any(self._path.iterdir()):
            dst.mkdir(parents=True, exist_ok=True)
            shutil.copytree(self._path, dst, dirs_exist_ok=True)

    def restore_workspace_snapshot(self, src: Path) -> None:
        """Replace all workspace files with the contents of *src* directory.

        Used by session load / import to restore a previously saved workspace.
        """
        if self._path.exists():
            shutil.rmtree(self._path)
        self._path.mkdir(parents=True, exist_ok=True)
        if src.exists():
            shutil.copytree(src, self._path, dirs_exist_ok=True)

    # ------------------------------------------------------------------
    # Export / Import
    # ------------------------------------------------------------------

    def export_session_zip(self, state: dict) -> io.BytesIO:
        """Export current state + workspace as a zip."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("state.json", json.dumps(state, default=str, ensure_ascii=False))
            with tempfile.TemporaryDirectory(prefix="df_session_export_") as tmp_dir:
                ws_snap = Path(tmp_dir) / "workspace"
                self.save_workspace_snapshot(ws_snap)
                if ws_snap.exists():
                    for ws_file in ws_snap.rglob("*"):
                        if ws_file.is_file():
                            arcname = "workspace/" + str(ws_file.relative_to(ws_snap))
                            zf.write(ws_file, arcname)
        buf.seek(0)
        return buf

    def import_session_zip(self, zip_data: io.BytesIO) -> dict:
        """Import a zip.  Restores workspace, returns state dict.

        Raises ``ValueError`` on invalid zip / missing state.json.
        """
        with zipfile.ZipFile(zip_data, "r") as zf:
            if "state.json" not in zf.namelist():
                raise ValueError("Invalid session file: missing state.json")

            state = json.loads(zf.read("state.json"))

            workspace_entries = [
                n for n in zf.namelist()
                if n.startswith("workspace/") and not n.endswith("/")
            ]
            if workspace_entries:
                with tempfile.TemporaryDirectory(prefix="df_session_import_") as tmp_dir:
                    ws_tmp = Path(tmp_dir) / "workspace"
                    ws_tmp.mkdir(parents=True, exist_ok=True)
                    for entry in workspace_entries:
                        rel = entry[len("workspace/"):]
                        if not rel:
                            continue
                        # Sanitize each path component individually to preserve
                        # directory structure (e.g., "data/sales.parquet")
                        # while still guarding against zip-slip / path traversal.
                        parts = [secure_filename(p) for p in rel.split("/")]
                        parts = [p for p in parts if p]
                        if not parts:
                            continue
                        dest = ws_tmp.joinpath(*parts)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(zf.read(entry))
                    self.restore_workspace_snapshot(ws_tmp)

        return state

    def __repr__(self) -> str:
        return f"Workspace(identity_id={self._identity_id!r}, path={self._path!r})"


class WorkspaceWithTempData:
    """
    A Workspace wrapper with an in-memory metadata overlay for temporary tables.

    Delegates **all** attribute and method access to the wrapped workspace
    via ``__getattr__``, ensuring the correct backend-specific implementations
    (e.g. ``AzureBlobWorkspace.read_data_as_df``, ``local_dir``, etc.) are
    always used.

    Does **not** inherit from :class:`Workspace` — this is intentional so
    that Python's MRO cannot short-circuit to base-class implementations
    and skip subclass overrides on the wrapped workspace.

    Used as a context manager:

    .. code-block:: python

        with WorkspaceWithTempData(workspace, temp_data) as ws:
            ws.read_data_as_df("my_temp_table")  # works

    On enter:
      - Writes each temp table into the workspace via the workspace's own
        ``write_parquet`` method (works for local *and* blob backends).
      - Overrides ``get_table_metadata`` / ``list_tables`` to resolve temp
        tables from a fast in-memory dict, without touching ``workspace.yaml``.

    On exit:
      - Deletes the temp parquet files via the workspace's own
        ``delete_table`` / file deletion methods.

    The original ``Workspace`` is never mutated (metadata is overlaid).
    Nesting is supported: inner overlays delegate to outer overlays.
    """

    def __init__(self, workspace: Workspace, temp_data: Optional[list[dict[str, Any]]] = None):
        # Do NOT call Workspace.__init__ — we delegate everything to _base.
        # We also do NOT copy __dict__; instead __getattr__ proxies to _base.
        object.__setattr__(self, '_base', workspace)
        object.__setattr__(self, '_temp_data', temp_data if temp_data else None)
        object.__setattr__(self, '_temp_table_names', [])
        object.__setattr__(self, '_overlay', {})

    # ---- proxy everything else to the real workspace -----------------------

    def __getattr__(self, name: str) -> Any:
        """Delegate attribute access to the wrapped workspace."""
        return getattr(self._base, name)

    # ---- metadata overrides ------------------------------------------------

    def get_table_metadata(self, table_name: str) -> Optional[TableMetadata]:
        result = self._overlay.get(table_name)
        if result is None:
            result = self._overlay.get(sanitize_table_name(table_name))
        if result is not None:
            return result
        return self._base.get_table_metadata(table_name)

    def list_tables(self) -> list[str]:
        names = self._base.list_tables()
        for name in self._overlay:
            if name not in names:
                names.append(name)
        return names

    def read_data_as_df(self, table_name: str) -> pd.DataFrame:
        """Read a table — temp overlay first, then delegate to base."""
        safe = sanitize_table_name(table_name)
        if table_name in self._overlay or safe in self._overlay:
            # Temp table was written via base workspace; delegate read to it
            return self._base.read_data_as_df(safe)
        return self._base.read_data_as_df(table_name)

    # ---- context manager ---------------------------------------------------

    def __enter__(self) -> "WorkspaceWithTempData":
        if not self._temp_data:
            logger.debug("[WorkspaceWithTempData] no temp data to mount")
            return self

        logger.debug(f"[WorkspaceWithTempData] mounting {len(self._temp_data)} temp table(s)")
        for item in self._temp_data:
            base_name = item.get("name", "table")
            safe_name = sanitize_table_name(base_name)

            rows = item.get("rows", [])
            df = pd.DataFrame(rows) if rows else pd.DataFrame()

            # Write through the base workspace (handles local *and* blob)
            self._base.write_parquet(df, safe_name)

            # Build an overlay entry so get_table_metadata resolves without
            # touching the real workspace.yaml.
            meta = self._base.get_table_metadata(safe_name)
            if meta is not None:
                self._overlay[safe_name] = meta

            self._temp_table_names.append(safe_name)
            logger.debug(
                f"[WorkspaceWithTempData] mounted temp table '{base_name}' -> '{safe_name}' "
                f"({len(df)} rows, file={safe_name}.parquet)"
            )

        # Debug: list all files in workspace after mounting
        try:
            ws_path = self._base._path
            ws_files = [f for f in os.listdir(ws_path) if not f.startswith('.')]
            logger.debug(f"[WorkspaceWithTempData] workspace files after mount: {ws_files}")
        except Exception as e:
            logger.debug(f"[WorkspaceWithTempData] could not list workspace files: {e}")

        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        logger.debug(f"[WorkspaceWithTempData] cleaning up {len(self._temp_table_names)} temp table(s): {self._temp_table_names}")
        for name in self._temp_table_names:
            try:
                self._base.delete_table(name)
            except Exception as e:
                logger.warning(f"Failed to remove temp table {name}: {e}")

        self._temp_table_names.clear()
        self._overlay.clear()