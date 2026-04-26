# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Data Lake module for Data Formulator.

This module provides a unified data management layer that:
- Manages user workspaces with identity-based directories
- Stores user-uploaded files as-is (CSV, Excel, TXT, HTML, JSON, PDF)
- Stores data from external loaders as parquet via pyarrow
- Tracks all data sources in a workspace.yaml metadata file

Example usage:

    from data_formulator.datalake import Workspace, save_uploaded_file, write_parquet
    
    # Get or create a workspace for a user
    workspace = Workspace("user:123")
    
    # Save an uploaded file
    with open("sales.csv", "rb") as f:
        metadata = save_uploaded_file(workspace, f.read(), "sales.csv")
    
    # Write a DataFrame as parquet (typically from data loaders)
    import pandas as pd
    df = pd.DataFrame({"id": [1, 2, 3], "name": ["a", "b", "c"]})
    metadata = write_parquet(workspace, df, "customers")
    
    # List tables in workspace
    tables = workspace.list_tables()
    
    # Read parquet back
    df = read_parquet(workspace, "customers")
"""

# Workspace management
from data_formulator.datalake.workspace import (
    Workspace,
    WorkspaceWithTempData,
    get_data_formulator_home,
    get_default_workspace_root,
    get_user_home,
)
from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.datalake.azure_blob_workspace import AzureBlobWorkspace
from data_formulator.datalake.cached_azure_blob_workspace import CachedAzureBlobWorkspace
from data_formulator.datalake.cache_manager import GlobalCacheManager

# Metadata types and operations
from data_formulator.datalake.workspace_metadata import (
    TableMetadata,
    ColumnInfo,
    WorkspaceMetadata,
    ImportedFrom,
    Derivation,
    load_metadata,
    save_metadata,
    update_metadata,
    metadata_exists,
    METADATA_VERSION,
    METADATA_FILENAME,
)

# File operations (for user uploads)
from data_formulator.datalake.file_manager import (
    save_uploaded_file,
    save_uploaded_file_from_path,
    is_supported_file,
    get_file_type,
    get_file_info,
    SUPPORTED_EXTENSIONS,
)

# Naming / ID sanitisation (lightweight, no heavy deps)
from data_formulator.datalake.naming import safe_source_id

# Parquet utilities (pure helpers, no Workspace dependency)
from data_formulator.datalake.parquet_utils import (
    safe_data_filename,
    sanitize_table_name,
    DEFAULT_COMPRESSION,
)
from data_formulator.datalake.table_names import (
    sanitize_workspace_parquet_table_name,
    sanitize_upload_stem_table_name,
    sanitize_external_loader_table_name,
    sanitize_duckdb_sql_table_name,
)

__all__ = [
    # Workspace
    "Workspace",
    "WorkspaceWithTempData",
    "AzureBlobWorkspace",
    "CachedAzureBlobWorkspace",
    "GlobalCacheManager",
    "get_data_formulator_home",
    "get_default_workspace_root",
    "get_user_home",
    "WorkspaceManager",
    # Metadata
    "TableMetadata",
    "ColumnInfo",
    "WorkspaceMetadata",
    "ImportedFrom",
    "Derivation",
    "load_metadata",
    "save_metadata",
    "update_metadata",
    "metadata_exists",
    "METADATA_VERSION",
    "METADATA_FILENAME",
    # File manager
    "save_uploaded_file",
    "save_uploaded_file_from_path",
    "get_supported_extensions",
    "is_supported_file",
    "get_file_type",
    "get_file_info",
    "SUPPORTED_EXTENSIONS",
    # Naming / ID sanitisation
    "safe_source_id",
    # Parquet utilities
    "safe_data_filename",
    "sanitize_table_name",
    "DEFAULT_COMPRESSION",
    # Table name sanitisation (single source of truth in table_names)
    "sanitize_workspace_parquet_table_name",
    "sanitize_upload_stem_table_name",
    "sanitize_external_loader_table_name",
    "sanitize_duckdb_sql_table_name",
]
