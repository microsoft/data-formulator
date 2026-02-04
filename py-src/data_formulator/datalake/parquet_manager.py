# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Parquet manager for the Data Lake.

This module handles writing DataFrames to parquet files using pyarrow.
Used primarily for data ingested from external data loaders.
"""

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from data_formulator.datalake.metadata import TableMetadata, ColumnInfo, make_json_safe
from data_formulator.datalake.workspace import Workspace

logger = logging.getLogger(__name__)

# Default compression for parquet files
DEFAULT_COMPRESSION = "snappy"
# Default number of rows to persist in metadata for preview
DEFAULT_METADATA_SAMPLE_ROWS = 50


def get_sample_rows_from_arrow(table: pa.Table, limit: int = DEFAULT_METADATA_SAMPLE_ROWS) -> list[dict[str, Any]]:
    """
    Get a small sample of rows from an Arrow table as JSON/YAML-safe records.
    """
    if table.num_rows <= 0 or limit <= 0:
        return []
    sample = table.slice(0, min(limit, table.num_rows))
    # Arrow -> python list[dict]
    return make_json_safe(sample.to_pylist())


def get_arrow_column_info(table: pa.Table) -> list[ColumnInfo]:
    """
    Extract column information from a PyArrow Table.
    
    Args:
        table: PyArrow Table to analyze
        
    Returns:
        List of ColumnInfo objects
    """
    columns = []
    for field in table.schema:
        columns.append(ColumnInfo(name=field.name, dtype=str(field.type)))
    return columns


def compute_arrow_table_hash(table: pa.Table, sample_rows: int = 100) -> str:
    """
    Compute a hash representing the Arrow Table content.
    
    Uses row count, column names, and sampled rows for efficiency.
    
    Args:
        table: Arrow Table to hash
        sample_rows: Number of rows to sample for hashing
        
    Returns:
        MD5 hash as hex string
    """
    hash_parts = [
        f"rows:{table.num_rows}",
        f"cols:{','.join(table.column_names)}",
    ]
    
    if table.num_rows > 0:
        # Sample rows for hashing
        if table.num_rows <= sample_rows:
            sample = table
        else:
            # Take first, last, and random middle rows
            n = sample_rows // 3
            indices = (
                list(range(n)) +  # first n
                list(range(table.num_rows // 4, table.num_rows // 4 + n)) +  # middle n
                list(range(table.num_rows - n, table.num_rows))  # last n
            )
            sample = table.take(indices)
        
        # Convert sample to string for hashing
        hash_parts.append(f"data:{sample.to_string()}")
    
    content = '|'.join(hash_parts)
    return hashlib.md5(content.encode()).hexdigest()


def write_parquet_from_arrow(
    workspace: Workspace,
    table: pa.Table,
    table_name: str,
    compression: str = DEFAULT_COMPRESSION,
    loader_metadata: Optional[dict[str, Any]] = None,
) -> TableMetadata:
    """
    Write a PyArrow Table directly to parquet in the workspace.
    
    This is the preferred method for writing data as it avoids pandas conversion
    overhead entirely. Data flows directly: Source → Arrow → Parquet.
    
    Args:
        workspace: The workspace to write to
        table: PyArrow Table to write
        table_name: Name for the table
        compression: Parquet compression algorithm (default: snappy)
        loader_metadata: Optional metadata from data loader
        
    Returns:
        TableMetadata for the written file
    """
    # Sanitize table name
    safe_name = sanitize_table_name(table_name)
    filename = f"{safe_name}.parquet"
    
    # Check if table already exists
    metadata = workspace.get_metadata()
    if safe_name in metadata.tables:
        # Overwrite existing - delete old file first
        old_meta = metadata.tables[safe_name]
        old_file = workspace.get_file_path(old_meta.filename)
        if old_file.exists():
            old_file.unlink()
            logger.debug(f"Deleted old parquet file: {old_file}")
    
    # Write parquet file using pyarrow (direct, no pandas)
    file_path = workspace.get_file_path(filename)
    
    pq.write_table(
        table,
        file_path,
        compression=compression,
    )
    
    # Get file size
    file_size = file_path.stat().st_size
    
    # Compute content hash from Arrow table
    content_hash = compute_arrow_table_hash(table)
    
    # Get column info from Arrow schema
    columns = get_arrow_column_info(table)

    # Get sample rows for preview
    sample_rows = get_sample_rows_from_arrow(table)
    
    # Create metadata
    now = datetime.now(timezone.utc)
    table_metadata = TableMetadata(
        name=safe_name,
        source_type="data_loader",
        filename=filename,
        file_type="parquet",
        created_at=now,
        content_hash=content_hash,
        file_size=file_size,
        row_count=table.num_rows,
        columns=columns,
        sample_rows=sample_rows,
        last_synced=now,
    )
    
    # Add loader metadata if provided
    if loader_metadata:
        table_metadata.loader_type = loader_metadata.get('loader_type')
        table_metadata.loader_params = loader_metadata.get('loader_params')
        table_metadata.source_table = loader_metadata.get('source_table')
        table_metadata.source_query = loader_metadata.get('source_query')
    
    # Save metadata
    workspace.add_table_metadata(table_metadata)
    
    logger.info(
        f"Wrote parquet file {filename} with {table.num_rows} rows, "
        f"{table.num_columns} columns ({file_size} bytes) [Arrow-native]"
    )
    
    return table_metadata


def sanitize_table_name(name: str) -> str:
    """
    Sanitize a string to be a valid table/file name.
    
    Args:
        name: Original name
        
    Returns:
        Sanitized name
    """
    # Replace invalid characters with underscores
    sanitized = []
    for char in name:
        if char.isalnum() or char == '_':
            sanitized.append(char)
        else:
            sanitized.append('_')
    
    result = ''.join(sanitized)
    
    # Ensure it starts with a letter or underscore
    if result and not (result[0].isalpha() or result[0] == '_'):
        result = '_' + result
    
    # Ensure it's not empty
    if not result:
        result = '_unnamed'
    
    return result.lower()


def get_unique_table_name(workspace: Workspace, base_name: str) -> str:
    """
    Return a table name that does not clash with existing tables in the workspace.

    If the sanitized base_name is free, it is returned. Otherwise tries
    base_1, base_2, ... until an unused name is found.

    Args:
        workspace: The workspace to check for existing table names
        base_name: Desired base name (will be sanitized)

    Returns:
        A table name that is not yet in the workspace
    """
    safe_base = sanitize_table_name(base_name)
    existing = set(workspace.list_tables())
    candidate = safe_base
    suffix = 0
    while candidate in existing:
        suffix += 1
        candidate = f"{safe_base}_{suffix}"
    return candidate


def compute_dataframe_hash(df: pd.DataFrame, sample_rows: int = 100) -> str:
    """
    Compute a hash representing the DataFrame content.
    
    Uses row count, column names, and sampled rows for efficiency.
    
    Args:
        df: DataFrame to hash
        sample_rows: Number of rows to sample for hashing
        
    Returns:
        MD5 hash as hex string
    """
    hash_parts = [
        f"rows:{len(df)}",
        f"cols:{','.join(df.columns.tolist())}",
    ]
    
    if len(df) > 0:
        # Sample rows for hashing
        if len(df) <= sample_rows:
            sample = df
        else:
            # Take first, last, and random middle rows
            n = sample_rows // 3
            first = df.head(n)
            last = df.tail(n)
            middle = df.iloc[len(df)//4:len(df)*3//4].sample(min(n, len(df)//2), random_state=42)
            sample = pd.concat([first, middle, last])
        
        # Convert sample to string for hashing
        hash_parts.append(f"data:{sample.to_string()}")
    
    content = '|'.join(hash_parts)
    return hashlib.md5(content.encode()).hexdigest()


def get_column_info(df: pd.DataFrame) -> list[ColumnInfo]:
    """
    Extract column information from a DataFrame.
    
    Args:
        df: DataFrame to analyze
        
    Returns:
        List of ColumnInfo objects
    """
    columns = []
    for col_name in df.columns:
        dtype = str(df[col_name].dtype)
        columns.append(ColumnInfo(name=str(col_name), dtype=dtype))
    return columns


def write_parquet(
    workspace: Workspace,
    df: pd.DataFrame,
    table_name: str,
    compression: str = DEFAULT_COMPRESSION,
    loader_metadata: Optional[dict[str, Any]] = None,
) -> TableMetadata:
    """
    Write a DataFrame to parquet in the workspace.
    
    Args:
        workspace: The workspace to write to
        df: DataFrame to write
        table_name: Name for the table
        compression: Parquet compression algorithm (default: snappy)
        loader_metadata: Optional metadata from data loader (loader_type, loader_params, etc.)
        
    Returns:
        TableMetadata for the written file
    """
    # Sanitize table name
    safe_name = sanitize_table_name(table_name)
    filename = f"{safe_name}.parquet"
    
    # Check if table already exists
    metadata = workspace.get_metadata()
    if safe_name in metadata.tables:
        # Overwrite existing - delete old file first
        old_meta = metadata.tables[safe_name]
        old_file = workspace.get_file_path(old_meta.filename)
        if old_file.exists():
            old_file.unlink()
            logger.debug(f"Deleted old parquet file: {old_file}")
    
    # Write parquet file using pyarrow
    file_path = workspace.get_file_path(filename)
    
    # Convert DataFrame to PyArrow Table
    table = pa.Table.from_pandas(df)
    
    # Get sample rows for preview (before writing)
    sample_rows = get_sample_rows_from_arrow(table)

    # Write to parquet
    pq.write_table(
        table,
        file_path,
        compression=compression,
    )
    
    # Get file size
    file_size = file_path.stat().st_size
    
    # Compute content hash
    content_hash = compute_dataframe_hash(df)
    
    # Get column info
    columns = get_column_info(df)
    
    # Create metadata
    now = datetime.now(timezone.utc)
    table_metadata = TableMetadata(
        name=safe_name,
        source_type="data_loader",
        filename=filename,
        file_type="parquet",
        created_at=now,
        content_hash=content_hash,
        file_size=file_size,
        row_count=len(df),
        columns=columns,
        sample_rows=sample_rows,
        last_synced=now,
    )
    
    # Add loader metadata if provided
    if loader_metadata:
        table_metadata.loader_type = loader_metadata.get('loader_type')
        table_metadata.loader_params = loader_metadata.get('loader_params')
        table_metadata.source_table = loader_metadata.get('source_table')
        table_metadata.source_query = loader_metadata.get('source_query')
    
    # Save metadata
    workspace.add_table_metadata(table_metadata)
    
    logger.info(
        f"Wrote parquet file {filename} with {len(df)} rows, "
        f"{len(df.columns)} columns ({file_size} bytes)"
    )
    
    return table_metadata


def read_parquet_as_arrow(workspace: Workspace, table_name: str) -> pa.Table:
    """
    Read a parquet file from the workspace as a PyArrow Table.
    
    This is the preferred method for reading as it avoids pandas conversion.
    
    Args:
        workspace: The workspace to read from
        table_name: Name of the table
        
    Returns:
        PyArrow Table with the data
        
    Raises:
        FileNotFoundError: If the parquet file doesn't exist
        ValueError: If the table is not a parquet file
    """
    # Get table metadata
    table_meta = workspace.get_table_metadata(table_name)
    if table_meta is None:
        raise FileNotFoundError(f"Table not found: {table_name}")
    
    if table_meta.file_type != "parquet":
        raise ValueError(
            f"Table {table_name} is not a parquet file "
            f"(file_type={table_meta.file_type})"
        )
    
    file_path = workspace.get_file_path(table_meta.filename)
    if not file_path.exists():
        raise FileNotFoundError(f"Parquet file not found: {file_path}")
    
    # Read parquet file as Arrow table
    table = pq.read_table(file_path)
    
    logger.debug(f"Read parquet file {table_meta.filename}: {table.num_rows} rows [Arrow-native]")
    
    return table


def read_parquet(workspace: Workspace, table_name: str) -> pd.DataFrame:
    """
    Read a parquet file from the workspace as a pandas DataFrame.
    
    For better performance, consider using `read_parquet_as_arrow()` instead.
    
    Args:
        workspace: The workspace to read from
        table_name: Name of the table
        
    Returns:
        DataFrame with the data
        
    Raises:
        FileNotFoundError: If the parquet file doesn't exist
        ValueError: If the table is not a parquet file
    """
    table = read_parquet_as_arrow(workspace, table_name)
    return table.to_pandas()


def get_parquet_schema(workspace: Workspace, table_name: str) -> dict:
    """
    Get the schema of a parquet file without reading all data.
    
    Args:
        workspace: The workspace
        table_name: Name of the table
        
    Returns:
        Dictionary with schema information
        
    Raises:
        FileNotFoundError: If the table doesn't exist
    """
    table_meta = workspace.get_table_metadata(table_name)
    if table_meta is None:
        raise FileNotFoundError(f"Table not found: {table_name}")
    
    if table_meta.file_type != "parquet":
        raise ValueError(f"Table {table_name} is not a parquet file")
    
    file_path = workspace.get_file_path(table_meta.filename)
    if not file_path.exists():
        raise FileNotFoundError(f"Parquet file not found: {file_path}")
    
    # Read schema only
    parquet_file = pq.ParquetFile(file_path)
    schema = parquet_file.schema_arrow
    
    return {
        "table_name": table_name,
        "filename": table_meta.filename,
        "num_rows": parquet_file.metadata.num_rows,
        "num_columns": len(schema),
        "columns": [
            {
                "name": field.name,
                "type": str(field.type),
                "nullable": field.nullable,
            }
            for field in schema
        ],
        "created_at": table_meta.created_at.isoformat(),
        "last_synced": table_meta.last_synced.isoformat() if table_meta.last_synced else None,
    }


def get_parquet_path(workspace: Workspace, table_name: str) -> Path:
    """
    Return the filesystem path of the parquet file for a table.

    Args:
        workspace: The workspace
        table_name: Name of the table

    Returns:
        Resolved Path to the parquet file

    Raises:
        FileNotFoundError: If the table doesn't exist
        ValueError: If the table is not a parquet file
    """
    table_meta = workspace.get_table_metadata(table_name)
    if table_meta is None:
        table_meta = workspace.get_table_metadata(sanitize_table_name(table_name))
    if table_meta is None:
        raise FileNotFoundError(f"Table not found: {table_name}")
    if table_meta.file_type != "parquet":
        raise ValueError(f"Table {table_name} is not a parquet file")
    path = workspace.get_file_path(table_meta.filename)
    if not path.exists():
        raise FileNotFoundError(f"Parquet file not found: {path}")
    return path.resolve()


def refresh_parquet_from_arrow(
    workspace: Workspace,
    table_name: str,
    table: pa.Table,
    compression: str = DEFAULT_COMPRESSION,
) -> tuple[TableMetadata, bool]:
    """
    Refresh a parquet file with new data from a PyArrow Table.
    
    This is the preferred method as it avoids pandas conversion.
    Compares content hash to determine if data actually changed.
    
    Args:
        workspace: The workspace
        table_name: Name of the table to refresh
        table: New PyArrow Table
        compression: Parquet compression algorithm
        
    Returns:
        Tuple of (new TableMetadata, bool indicating if data changed)
        
    Raises:
        FileNotFoundError: If the table doesn't exist
    """
    # Get existing metadata
    old_meta = workspace.get_table_metadata(table_name)
    if old_meta is None:
        raise FileNotFoundError(f"Table not found: {table_name}")
    
    # Compute new hash from Arrow table
    new_hash = compute_arrow_table_hash(table)
    
    # Check if data changed
    data_changed = old_meta.content_hash != new_hash
    
    if not data_changed:
        # Update last_synced timestamp only
        old_meta.last_synced = datetime.now(timezone.utc)
        workspace.add_table_metadata(old_meta)
        logger.info(f"Table {table_name} unchanged (hash: {new_hash[:8]}...)")
        return old_meta, False
    
    # Data changed - rewrite the file
    # Preserve loader metadata from old entry
    loader_metadata = {
        'loader_type': old_meta.loader_type,
        'loader_params': old_meta.loader_params,
        'source_table': old_meta.source_table,
        'source_query': old_meta.source_query,
    }
    
    new_meta = write_parquet_from_arrow(
        workspace=workspace,
        table=table,
        table_name=table_name,
        compression=compression,
        loader_metadata=loader_metadata,
    )
    
    logger.info(
        f"Refreshed table {table_name}: "
        f"{old_meta.row_count} -> {new_meta.row_count} rows [Arrow-native]"
    )
    
    return new_meta, True


def refresh_parquet(
    workspace: Workspace,
    table_name: str,
    df: pd.DataFrame,
    compression: str = DEFAULT_COMPRESSION,
) -> tuple[TableMetadata, bool]:
    """
    Refresh a parquet file with new data from a pandas DataFrame.
    
    For better performance, consider using `refresh_parquet_from_arrow()` instead.
    Compares content hash to determine if data actually changed.
    
    Args:
        workspace: The workspace
        table_name: Name of the table to refresh
        df: New DataFrame
        compression: Parquet compression algorithm
        
    Returns:
        Tuple of (new TableMetadata, bool indicating if data changed)
        
    Raises:
        FileNotFoundError: If the table doesn't exist
    """
    # Convert DataFrame to Arrow table
    table = pa.Table.from_pandas(df)
    return refresh_parquet_from_arrow(workspace, table_name, table, compression)
