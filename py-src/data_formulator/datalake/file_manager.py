# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
File manager for user-uploaded files in the Data Lake.

This module handles storing user-uploaded files (CSV, Excel, TXT, HTML, JSON, PDF)
as-is in the workspace without conversion.
"""

import hashlib
import io
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Union

from data_formulator.datalake.workspace_metadata import TableMetadata
from data_formulator.datalake.parquet_utils import safe_data_filename
from data_formulator.datalake.table_names import sanitize_upload_stem_table_name
from data_formulator.datalake.workspace import Workspace

logger = logging.getLogger(__name__)

_TEXT_FILE_TYPES = {'csv', 'txt'}

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


_TRUSTED_DETECTIONS = frozenset({
    # CJK multi-byte — highly distinctive byte patterns
    'shift_jis', 'cp932', 'euc-jp', 'iso-2022-jp',
    'euc-kr', 'cp949', 'iso-2022-kr', 'johab',
    'big5', 'big5hkscs', 'cp950',
    'gb2312', 'gbk', 'gb18030', 'hz',
    # Cyrillic — distinctive character frequency
    'cp866', 'cp1251', 'windows-1251',
    'koi8-r', 'koi8-u', 'iso-8859-5', 'maccyrillic',
    # Common Windows codepages (1250-1258)
    'cp1250', 'cp1252', 'cp1253', 'cp1254',
    'cp1255', 'cp1256', 'cp1257', 'cp1258',
    'windows-1250', 'windows-1252', 'windows-1253', 'windows-1254',
    'windows-1255', 'windows-1256', 'windows-1257', 'windows-1258',
    # ISO-8859 standard series
    'iso-8859-1', 'iso-8859-2', 'iso-8859-5', 'iso-8859-6',
    'iso-8859-7', 'iso-8859-8', 'iso-8859-9',
    # Thai
    'tis-620', 'cp874',
})


def normalize_text_encoding(content: bytes, file_type: str) -> bytes:
    """Detect encoding of text file content and re-encode as UTF-8.

    Only processes text-based file types (csv, txt). Binary formats are
    returned unchanged.  Strategy:

      1. Strip UTF-8 BOM if present.
      2. Try strict UTF-8 decode — fast path for the common case.
      3. Try GBK — covers the vast majority of non-UTF-8 files
         produced by Chinese-locale Excel / Windows.  GBK is a strict
         superset of GB2312 and handles GB18030 BMP characters too.
      4. Use charset_normalizer for less common encodings (Shift-JIS,
         EUC-KR, Cyrillic …).  Only trust well-known encodings;
         legacy DOS/Mac codepages (cp775, cp857, hp_roman8 …) are
         easily confused with Latin-1 so we fall through instead.
      5. Manual fallback chain: gb18030, shift_jis, euc-kr.
      6. Last-resort: latin-1 (never raises, 1:1 byte mapping).
    """
    if file_type not in _TEXT_FILE_TYPES:
        return content

    if content.startswith(b'\xef\xbb\xbf'):
        content = content[3:]

    try:
        content.decode('utf-8')
        return content
    except UnicodeDecodeError:
        pass

    try:
        decoded = content.decode('gbk')
        logger.info("Decoded text file as GBK")
        return decoded.encode('utf-8')
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass

    try:
        from charset_normalizer import from_bytes
        result = from_bytes(content).best()
        if result is not None and result.encoding in _TRUSTED_DETECTIONS:
            logger.info("Detected encoding %s via charset_normalizer", result.encoding)
            return str(result).encode('utf-8')
        elif result is not None:
            logger.debug(
                "charset_normalizer suggested %s but it is not in the "
                "trusted set; falling through to manual chain",
                result.encoding,
            )
    except ImportError:
        pass

    for enc in ('gb18030', 'shift_jis', 'euc-kr'):
        try:
            decoded = content.decode(enc)
            logger.info("Decoded text file using fallback encoding %s", enc)
            return decoded.encode('utf-8')
        except (UnicodeDecodeError, UnicodeEncodeError):
            continue

    logger.warning("Could not detect encoding; falling back to latin-1")
    return content.decode('latin-1').encode('utf-8')


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
    Derive a table name from an upload filename (stem).

    Delegates to :func:`data_formulator.datalake.table_names.sanitize_upload_stem_table_name`.
    """
    return sanitize_upload_stem_table_name(name)


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
    # Sanitize filename to prevent path traversal (defence-in-depth)
    filename = safe_data_filename(filename)

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

    content = normalize_text_encoding(content, file_type)

    # Determine the actual filename to use
    if overwrite:
        actual_filename = filename
    else:
        actual_filename = generate_unique_filename(workspace, filename)
    
    # Determine table name
    if table_name is None:
        table_name = sanitize_table_name(actual_filename)

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
    )

    # Atomically ensure unique name + add metadata in one lock acquisition.
    # This prevents the lost-update race where two concurrent uploads both
    # read the same (stale) metadata and the second save overwrites the first.
    def _add_unique(metadata):
        name = table_metadata.name
        if not overwrite and name in metadata.tables:
            base = name
            counter = 1
            while f"{base}_{counter}" in metadata.tables:
                counter += 1
            table_metadata.name = f"{base}_{counter}"
        metadata.add_table(table_metadata)

    workspace._atomic_update_metadata(_add_unique)

    logger.info(
        f"Saved uploaded file {actual_filename} as table {table_metadata.name} "
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
