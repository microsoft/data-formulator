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
    get_workspace,
    get_default_workspace_root,
    DATALAKE_ROOT_ENV,
)

# Metadata types and operations
from data_formulator.datalake.metadata import (
    TableMetadata,
    ColumnInfo,
    WorkspaceMetadata,
    load_metadata,
    save_metadata,
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

# Parquet operations (for data loaders)
from data_formulator.datalake.parquet_manager import (
    write_parquet,
    read_parquet,
    get_parquet_schema,
    refresh_parquet,
    DEFAULT_COMPRESSION,
)

__all__ = [
    # Workspace
    "Workspace",
    "get_workspace",
    "get_default_workspace_root",
    "DATALAKE_ROOT_ENV",
    # Metadata
    "TableMetadata",
    "ColumnInfo",
    "WorkspaceMetadata",
    "load_metadata",
    "save_metadata",
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
    # Parquet manager
    "write_parquet",
    "read_parquet",
    "get_parquet_schema",
    "refresh_parquet",
    "DEFAULT_COMPRESSION",
]
