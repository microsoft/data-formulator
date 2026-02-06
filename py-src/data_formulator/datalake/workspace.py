# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Workspace management for the Data Lake.

Each user has a workspace directory identified by their identity_id.
The workspace contains all their data files (uploaded and ingested)
plus a workspace.yaml metadata file.
"""

import os
import shutil
import tempfile
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from data_formulator.datalake.metadata import (
    WorkspaceMetadata,
    TableMetadata,
    load_metadata,
    save_metadata,
    metadata_exists,
)
from data_formulator.datalake.parquet_utils import (
    sanitize_table_name,
    get_arrow_column_info,
    compute_arrow_table_hash,
    get_column_info,
    compute_dataframe_hash,
    sanitize_dataframe_for_arrow,
    DEFAULT_COMPRESSION,
)

logger = logging.getLogger(__name__)

# Environment variable for configuring workspace root
DATALAKE_ROOT_ENV = "DATALAKE_ROOT"

# Default subdirectory name under temp for workspaces
DEFAULT_WORKSPACE_SUBDIR = "data_formulator_workspaces"


def get_default_workspace_root() -> Path:
    """
    Get the default workspace root directory.
    
    Uses DATALAKE_ROOT env variable if set, otherwise uses system temp directory.
    """
    env_root = os.getenv(DATALAKE_ROOT_ENV)
    if env_root:
        return Path(env_root)
    return Path(tempfile.gettempdir()) / DEFAULT_WORKSPACE_SUBDIR


class Workspace:
    """
    Manages a user's workspace directory in the Data Lake.
    
    The workspace contains:
    - workspace.yaml: Metadata file tracking all data sources
    - Data files: User uploaded files (CSV, Excel, etc.) and parquet files from data loaders
    
    All files are stored in a single flat directory per user.
    """
    
    def __init__(self, identity_id: str, root_dir: Optional[str | Path] = None):
        """
        Initialize a workspace for a user.
        
        Args:
            identity_id: Unique identifier for the user (e.g., "user:123" or "browser:abc")
            root_dir: Root directory for all workspaces. If None, uses default.
        """
        if not identity_id:
            raise ValueError("identity_id cannot be empty")
        
        # Sanitize identity_id for filesystem safety
        self._identity_id = identity_id
        self._safe_id = self._sanitize_identity_id(identity_id)
        
        # Determine root directory
        if root_dir is None:
            self._root = get_default_workspace_root()
        else:
            self._root = Path(root_dir)
        
        # Workspace path is root / sanitized_identity_id
        self._path = self._root / self._safe_id
        
        # Ensure workspace directory exists
        self._path.mkdir(parents=True, exist_ok=True)
        
        # Initialize metadata if it doesn't exist
        if not metadata_exists(self._path):
            self._init_metadata()
        
        logger.debug(f"Initialized workspace at {self._path}")
    
    @staticmethod
    def _sanitize_identity_id(identity_id: str) -> str:
        """
        Sanitize identity_id for use as a directory name.
        
        Replaces potentially problematic characters with underscores.
        """
        # Replace colons, slashes, and other special characters
        safe_chars = []
        for char in identity_id:
            if char.isalnum() or char in ('_', '-'):
                safe_chars.append(char)
            else:
                safe_chars.append('_')
        return ''.join(safe_chars)
    
    def _init_metadata(self) -> None:
        """Initialize a new workspace with empty metadata."""
        metadata = WorkspaceMetadata.create_new()
        save_metadata(self._path, metadata)
        logger.info(f"Initialized new workspace metadata at {self._path}")
    
    def get_file_path(self, filename: str) -> Path:
        """
        Get the full path for a file in the workspace.
        
        Args:
            filename: Name of the file
            
        Returns:
            Full path to the file
        """
        # Prevent directory traversal attacks
        safe_filename = Path(filename).name
        return self._path / safe_filename
    
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
        
        # Delete the file
        file_path = self.get_file_path(table.filename)
        if file_path.exists():
            file_path.unlink()
        
        # Remove from metadata
        metadata.remove_table(table_name)
        self.save_metadata(metadata)
        
        logger.info(f"Deleted table {table_name} from workspace {self._safe_id}")
        return True
    
    def get_metadata(self) -> WorkspaceMetadata:
        return load_metadata(self._path)
    
    def save_metadata(self, metadata: WorkspaceMetadata) -> None:
        save_metadata(self._path, metadata)
    
    def add_table_metadata(self, table: TableMetadata) -> None:
        metadata = self.get_metadata()
        metadata.add_table(table)
        self.save_metadata(metadata)
    
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
    
    def cleanup(self) -> None:
        """ Remove the entire workspace directory. """
        if self._path.exists():
            shutil.rmtree(self._path)
            logger.info(f"Cleaned up workspace {self._safe_id}")

    def get_relative_data_file_path(self, table_name: str) -> str:
        """
        Get the filename for a table, suitable for use in generated code.

        Since files are stored flat in the workspace directory and code runs
        with the workspace as cwd, this returns just the filename
        (e.g. "sales_data.parquet", "report.csv").

        Falls back to sanitized table name if the original is not found.

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
        return metadata.filename

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

    def get_unique_table_name(self, base_name: str) -> str:
        """
        Return a table name that does not clash with existing tables.

        If the sanitized *base_name* is free it is returned as-is.
        Otherwise tries ``base_1``, ``base_2``, … until an unused name is found.
        """
        safe_base = sanitize_table_name(base_name)
        existing = set(self.list_tables())
        candidate = safe_base
        suffix = 0
        while candidate in existing:
            suffix += 1
            candidate = f"{safe_base}_{suffix}"
        return candidate

    def write_parquet_from_arrow(
        self,
        table: pa.Table,
        table_name: str,
        compression: str = DEFAULT_COMPRESSION,
        loader_metadata: Optional[dict[str, Any]] = None,
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

        if loader_metadata:
            table_metadata.loader_type = loader_metadata.get('loader_type')
            table_metadata.loader_params = loader_metadata.get('loader_params')
            table_metadata.source_table = loader_metadata.get('source_table')
            table_metadata.source_query = loader_metadata.get('source_query')

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
        loader_metadata: Optional[dict[str, Any]] = None,
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

        if loader_metadata:
            table_metadata.loader_type = loader_metadata.get('loader_type')
            table_metadata.loader_params = loader_metadata.get('loader_params')
            table_metadata.source_table = loader_metadata.get('source_table')
            table_metadata.source_query = loader_metadata.get('source_query')

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

        loader_metadata = {
            'loader_type': old_meta.loader_type,
            'loader_params': old_meta.loader_params,
            'source_table': old_meta.source_table,
            'source_query': old_meta.source_query,
        }
        new_meta = self.write_parquet_from_arrow(
            table=table,
            table_name=table_name,
            compression=compression,
            loader_metadata=loader_metadata,
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

    def __repr__(self) -> str:
        return f"Workspace(identity_id={self._identity_id!r}, path={self._path!r})"


def get_workspace(identity_id: str, root_dir: Optional[str | Path] = None) -> Workspace:
    """
    Get or create a workspace for a user.

    This is a convenience function that creates a Workspace instance.

    Args:
        identity_id: Unique identifier for the user
        root_dir: Optional root directory for workspaces

    Returns:
        Workspace instance
    """
    return Workspace(identity_id, root_dir)


class WorkspaceWithTempData:
    """
    Context manager that temporarily adds temp data (list of {name, rows}) to a workspace
    as parquet tables, yields the same workspace, and removes those tables on exit.

    Use when the client sends in-memory data (e.g. language == "python"): wrap the
    workspace so temp tables are visible for the block and then cleaned up.
    """

    def __init__(self, workspace: Workspace, temp_data: Optional[list[dict[str, Any]]] = None):
        self._workspace = workspace
        self._temp_data = temp_data if temp_data else None
        self._added_table_names: list[str] = []

    def __enter__(self) -> Workspace:
        if not self._temp_data:
            return self._workspace

        for item in self._temp_data:
            base_name = item.get("name", "table")
            name = self._workspace.get_unique_table_name(base_name)
            rows = item.get("rows", [])
            df = pd.DataFrame(rows) if rows else pd.DataFrame()
            meta = self._workspace.write_parquet(df, name)
            self._added_table_names.append(meta.name)
            logger.debug(f"Added temp table {meta.name} to workspace for duration of context")
        return self._workspace

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        for name in self._added_table_names:
            self._workspace.delete_table(name)
            logger.debug(f"Removed temp table {name} from workspace")
        self._added_table_names.clear()