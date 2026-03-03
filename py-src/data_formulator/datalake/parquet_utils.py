# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Parquet utility functions for the Data Lake.

Pure helper functions for parquet I/O, hashing, column introspection, and
name sanitisation.  These utilities have **no dependency on Workspace** and
are consumed by Workspace methods that handle metadata bookkeeping.
"""

import hashlib
import logging
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from werkzeug.utils import secure_filename

from data_formulator.datalake.metadata import ColumnInfo, make_json_safe

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Default compression for parquet files
DEFAULT_COMPRESSION = "snappy"

# Default number of rows to persist in metadata for preview
DEFAULT_METADATA_SAMPLE_ROWS = 50


# ---------------------------------------------------------------------------
# Name helpers
# ---------------------------------------------------------------------------

def sanitize_table_name(name: str) -> str:
    """
    Sanitize a string to be a valid table/file name.

    Uses ``werkzeug.utils.secure_filename`` as the first pass to strip
    path separators, leading dots, and other dangerous components (this
    is the sanitiser recognised by CodeQL / static-analysis tools).
    Additional rules are then applied to guarantee the result is a valid,
    lowercase, Python-identifier-style name.

    Args:
        name: Original name

    Returns:
        Sanitized name
    """
    # First pass: werkzeug's secure_filename neutralises path-traversal
    # components ("../", leading dots, etc.) and keeps only ASCII
    # alphanumerics plus ".", "_", and "-".
    name = secure_filename(name)

    # Second pass: replace any remaining chars that are not alphanumeric
    # or underscore (e.g. dots and hyphens kept by secure_filename).
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


# ---------------------------------------------------------------------------
# Arrow / DataFrame introspection
# ---------------------------------------------------------------------------

def get_sample_rows_from_arrow(
    table: pa.Table, limit: int = DEFAULT_METADATA_SAMPLE_ROWS
) -> list[dict[str, Any]]:
    """Get a small sample of rows from an Arrow table as JSON/YAML-safe records."""
    if table.num_rows <= 0 or limit <= 0:
        return []
    sample = table.slice(0, min(limit, table.num_rows))
    return make_json_safe(sample.to_pylist())


def get_arrow_column_info(table: pa.Table) -> list[ColumnInfo]:
    """Extract column information from a PyArrow Table."""
    return [ColumnInfo(name=field.name, dtype=str(field.type)) for field in table.schema]


def get_column_info(df: pd.DataFrame) -> list[ColumnInfo]:
    """Extract column information from a pandas DataFrame."""
    return [ColumnInfo(name=str(col), dtype=str(df[col].dtype)) for col in df.columns]


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

def compute_arrow_table_hash(table: pa.Table, sample_rows: int = 100) -> str:
    """
    Compute an MD5 hash representing the Arrow Table content.

    Uses row count, column names, and sampled rows for efficiency.
    """
    hash_parts = [
        f"rows:{table.num_rows}",
        f"cols:{','.join(table.column_names)}",
    ]

    if table.num_rows > 0:
        if table.num_rows <= sample_rows:
            sample = table
        else:
            n = sample_rows // 3
            indices = (
                list(range(n))
                + list(range(table.num_rows // 4, table.num_rows // 4 + n))
                + list(range(table.num_rows - n, table.num_rows))
            )
            sample = table.take(indices)
        hash_parts.append(f"data:{sample.to_string()}")

    content = '|'.join(hash_parts)
    return hashlib.md5(content.encode()).hexdigest()


def sanitize_dataframe_for_arrow(df: pd.DataFrame) -> pd.DataFrame:
    """
    Sanitize a DataFrame for conversion to PyArrow Table.
    
    Handles common issues that cause ArrowTypeError:
    - Mixed types in object columns (e.g., strings and integers)
    - Columns with all nulls that have ambiguous type
    
    For object dtype columns, converts all non-null values to strings
    to ensure consistent typing.
    
    Returns:
        A copy of the DataFrame with sanitized columns.
    """
    df = df.copy()
    
    for col in df.columns:
        # Handle object dtype columns (potential mixed types)
        if df[col].dtype == 'object':
            # Convert all non-null values to string
            # This handles mixed int/string columns safely
            df[col] = df[col].apply(
                lambda x: str(x) if pd.notna(x) and x is not None else None
            )
    
    return df


def compute_dataframe_hash(df: pd.DataFrame, sample_rows: int = 100) -> str:
    """
    Compute an MD5 hash representing the DataFrame content.

    Uses row count, column names, and sampled rows for efficiency.
    """
    hash_parts = [
        f"rows:{len(df)}",
        f"cols:{','.join(df.columns.tolist())}",
    ]

    if len(df) > 0:
        if len(df) <= sample_rows:
            sample = df
        else:
            n = sample_rows // 3
            first = df.head(n)
            last = df.tail(n)
            middle = df.iloc[len(df) // 4 : len(df) * 3 // 4].sample(
                min(n, len(df) // 2), random_state=42
            )
            sample = pd.concat([first, middle, last])
        hash_parts.append(f"data:{sample.to_string()}")

    content = '|'.join(hash_parts)
    return hashlib.md5(content.encode()).hexdigest()
