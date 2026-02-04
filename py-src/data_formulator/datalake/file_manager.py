# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
File manager for user-uploaded files in the Data Lake.

This module handles storing user-uploaded files (CSV, Excel, TXT, HTML, JSON, PDF)
as-is in the workspace without conversion.
"""

import hashlib
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Union

from data_formulator.datalake.metadata import TableMetadata, make_json_safe
from data_formulator.datalake.workspace import Workspace

logger = logging.getLogger(__name__)

# Supported file extensions for upload
SUPPORTED_EXTENSIONS = {
    '.csv': 'csv',
    '.xlsx': 'excel',
    '.xls': 'excel',
    '.txt': 'txt',
    '.html': 'html',
    '.htm': 'html',
    '.json': 'json',
    '.pdf': 'pdf',
}


def is_supported_file(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    return ext in SUPPORTED_EXTENSIONS


def get_file_type(filename: str) -> str | None:
    """
    Get the file type based on extension.
    
    Args:
        filename: Name of the file
        
    Returns:
        File type string (e.g., 'csv', 'excel') or None if unsupported
    """
    ext = Path(filename).suffix.lower()
    return SUPPORTED_EXTENSIONS.get(ext)


def compute_file_hash(content: bytes) -> str:
    """
    Compute MD5 hash of file content.
    
    Args:
        content: File content as bytes
        
    Returns:
        MD5 hash as hex string
    """
    return hashlib.md5(content).hexdigest()


def sanitize_table_name(name: str) -> str:
    """
    Sanitize a string to be a valid table name.
    
    Args:
        name: Original name
        
    Returns:
        Sanitized name suitable for use as a table identifier
    """
    # Remove extension if present
    name = Path(name).stem
    
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


def generate_unique_filename(
    workspace: Workspace,
    desired_filename: str,
) -> str:
    """
    Generate a unique filename if the desired one already exists.
    
    Args:
        workspace: The workspace to check
        desired_filename: The desired filename
        
    Returns:
        A unique filename (may be the original if it doesn't exist)
    """
    if not workspace.file_exists(desired_filename):
        return desired_filename
    
    # Split filename and extension
    path = Path(desired_filename)
    stem = path.stem
    suffix = path.suffix
    
    # Try adding numbers until we find a unique name
    counter = 1
    while True:
        new_filename = f"{stem}_{counter}{suffix}"
        if not workspace.file_exists(new_filename):
            return new_filename
        counter += 1
        if counter > 1000:  # Safety limit
            raise ValueError(f"Could not generate unique filename for {desired_filename}")


def save_uploaded_file(
    workspace: Workspace,
    file_content: Union[bytes, BinaryIO],
    filename: str,
    table_name: str | None = None,
    overwrite: bool = False,
) -> TableMetadata:
    """
    Save an uploaded file to the workspace.
    
    The file is stored as-is without conversion. Metadata is added to track
    the file in the workspace.
    
    Args:
        workspace: The workspace to save to
        file_content: File content as bytes or file-like object
        filename: Original filename (used for extension detection)
        table_name: Name to use for the table. If None, derived from filename.
        overwrite: If True, overwrite existing file. If False, generate unique name.
        
    Returns:
        TableMetadata for the saved file
        
    Raises:
        ValueError: If file type is not supported
    """
    # Validate file type
    file_type = get_file_type(filename)
    if file_type is None:
        raise ValueError(
            f"Unsupported file type: {filename}. "
            f"Supported extensions: {', '.join(SUPPORTED_EXTENSIONS.keys())}"
        )
    
    # Read content if it's a file-like object
    if hasattr(file_content, 'read'):
        content = file_content.read()
    else:
        content = file_content

    # Best-effort preview sample rows for supported structured formats.
    # (Never fail the upload if parsing fails.)
    sample_rows = None
    try:
        import pandas as pd
        from io import BytesIO

        sample_limit = 50
        bio = BytesIO(content)
        if file_type == "csv":
            df_sample = pd.read_csv(bio, nrows=sample_limit)
        elif file_type == "excel":
            df_sample = pd.read_excel(bio, nrows=sample_limit)
        elif file_type == "json":
            # pd.read_json reads entire input; cap after load.
            df_sample = pd.read_json(bio).head(sample_limit)
        else:
            df_sample = None

        if df_sample is not None:
            # Replace NaN/NaT with None for JSON/YAML friendliness
            df_sample = df_sample.astype(object).where(pd.notnull(df_sample), None)
            sample_rows = make_json_safe(df_sample.to_dict(orient="records"))
    except Exception:
        sample_rows = None
    
    # Determine the actual filename to use
    if overwrite:
        actual_filename = filename
    else:
        actual_filename = generate_unique_filename(workspace, filename)
    
    # Determine table name
    if table_name is None:
        table_name = sanitize_table_name(actual_filename)
    
    # Ensure table name is unique in metadata
    metadata = workspace.get_metadata()
    if table_name in metadata.tables and not overwrite:
        # Generate unique table name
        base_name = table_name
        counter = 1
        while table_name in metadata.tables:
            table_name = f"{base_name}_{counter}"
            counter += 1
    
    # Write the file
    file_path = workspace.get_file_path(actual_filename)
    with open(file_path, 'wb') as f:
        f.write(content)
    
    # Compute hash and size
    content_hash = compute_file_hash(content)
    file_size = len(content)
    
    # Create metadata
    table_metadata = TableMetadata(
        name=table_name,
        source_type="upload",
        filename=actual_filename,
        file_type=file_type,
        created_at=datetime.now(timezone.utc),
        content_hash=content_hash,
        file_size=file_size,
        sample_rows=sample_rows,
    )
    
    # Save metadata
    workspace.add_table_metadata(table_metadata)
    
    logger.info(
        f"Saved uploaded file {actual_filename} as table {table_name} "
        f"({file_size} bytes, hash={content_hash[:8]}...)"
    )
    
    return table_metadata


def save_uploaded_file_from_path(
    workspace: Workspace,
    source_path: Union[str, Path],
    table_name: str | None = None,
    overwrite: bool = False,
) -> TableMetadata:
    """
    Save a file from a local path to the workspace.
    
    Args:
        workspace: The workspace to save to
        source_path: Path to the source file
        table_name: Name to use for the table. If None, derived from filename.
        overwrite: If True, overwrite existing file.
        
    Returns:
        TableMetadata for the saved file
    """
    source_path = Path(source_path)
    
    if not source_path.exists():
        raise FileNotFoundError(f"Source file not found: {source_path}")
    
    with open(source_path, 'rb') as f:
        content = f.read()
    
    return save_uploaded_file(
        workspace=workspace,
        file_content=content,
        filename=source_path.name,
        table_name=table_name,
        overwrite=overwrite,
    )


def get_file_info(workspace: Workspace, table_name: str) -> dict | None:
    """
    Get information about an uploaded file.
    
    Args:
        workspace: The workspace
        table_name: Name of the table
        
    Returns:
        Dictionary with file information or None if not found
    """
    table_meta = workspace.get_table_metadata(table_name)
    if table_meta is None:
        return None
    
    file_path = workspace.get_file_path(table_meta.filename)
    
    result = {
        "table_name": table_name,
        "filename": table_meta.filename,
        "file_type": table_meta.file_type,
        "file_size": table_meta.file_size,
        "content_hash": table_meta.content_hash,
        "created_at": table_meta.created_at.isoformat(),
        "exists": file_path.exists(),
    }
    
    if file_path.exists():
        stat = file_path.stat()
        result["current_size"] = stat.st_size
        result["modified_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
    
    return result
