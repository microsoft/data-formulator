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
from pathlib import Path
from typing import Any, Optional

from data_formulator.datalake.metadata import (
    WorkspaceMetadata,
    TableMetadata,
    load_metadata,
    save_metadata,
    metadata_exists,
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
        metadata = self.get_metadata()
        return metadata.get_table(table_name)
    
    def list_tables(self) -> list[str]:
        metadata = self.get_metadata()
        return metadata.list_tables()
    
    def cleanup(self) -> None:
        """ Remove the entire workspace directory. """
        if self._path.exists():
            shutil.rmtree(self._path)
            logger.info(f"Cleaned up workspace {self._safe_id}")
    
    
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
        import pandas as pd
        from data_formulator.datalake.parquet_manager import write_parquet, get_unique_table_name

        for item in self._temp_data:
            base_name = item.get("name", "table")
            name = get_unique_table_name(self._workspace, base_name)
            rows = item.get("rows", [])
            df = pd.DataFrame(rows) if rows else pd.DataFrame()
            meta = write_parquet(self._workspace, df, name)
            self._added_table_names.append(meta.name)
            logger.debug(f"Added temp table {meta.name} to workspace for duration of context")
        return self._workspace

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        for name in self._added_table_names:
            self._workspace.delete_table(name)
            logger.debug(f"Removed temp table {name} from workspace")
        self._added_table_names.clear()