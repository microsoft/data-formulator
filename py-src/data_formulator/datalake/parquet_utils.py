# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Parquet utility functions for the Data Lake.

Pure helper functions for parquet I/O, hashing, column introspection, and
name sanitisation.  These utilities have **no dependency on Workspace** and
are consumed by Workspace methods that handle metadata bookkeeping.
"""

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from data_formulator.datalake.workspace_metadata import ColumnInfo, make_json_safe
from data_formulator.datalake.table_names import sanitize_workspace_parquet_table_name

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

def safe_data_filename(filename: str) -> str:
    """Unicode-safe filename sanitisation for data files.

    Prevents path traversal by extracting the basename while preserving
    Unicode characters (Chinese, Japanese, Korean, etc.) that
    ``werkzeug.secure_filename`` would strip.

    Use this instead of ``secure_filename`` for any path that stores or
    reads user data files (parquet, csv, xlsx, …).

    Args:
        filename: Input filename (may contain path components)

    Returns:
        Sanitised basename (Unicode preserved, no directory components)

    Raises:
        ValueError: If the result is empty or unsafe
    """
    basename = Path(filename).name if filename else ""
    # Strip control characters (U+0000–U+001F) but keep all Unicode
    basename = re.sub(r"[\x00-\x1f]", "", basename).strip()
    if not basename or basename in (".", ".."):
        raise ValueError(f"Invalid filename: {filename!r}")
    return basename


def sanitize_table_name(name: str) -> str:
    """
    Sanitize a string to be a valid workspace / parquet logical table name.

    Delegates to :func:`data_formulator.datalake.table_names.sanitize_workspace_parquet_table_name`.
    """
    return sanitize_workspace_parquet_table_name(name)


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


def df_to_safe_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Convert a pandas DataFrame to a list of JSON-safe record dicts.

    Uses ``date_format='iso'`` so that datetime columns are serialized as
    ISO-8601 strings instead of epoch milliseconds.  ``default_handler=str``
    provides a safety net for exotic types (Decimal, bytes, etc.).

    All code that converts a DataFrame to records for API responses or
    streaming should call this function rather than using ``df.to_json``
    / ``df.to_dict`` directly.
    """
    return json.loads(
        df.to_json(orient="records", date_format="iso", default_handler=str)
    )


def normalize_dtype_to_app_type(dtype_str: str) -> str:
    """Map a pandas/Arrow dtype string to a standardized App Type label.

    The labels are consumed by the frontend ``mapApiTypeToAppType()`` and must
    stay in sync with the ``Type`` enum in ``src/data/types.ts``.

    Returns one of: 'datetime', 'date', 'time', 'duration',
                     'integer', 'number', 'boolean', 'string'.
    """
    t = dtype_str.lower()
    if 'datetime' in t or 'timestamp' in t:
        return 'datetime'
    if t == 'date' or t.startswith('date32') or t.startswith('date64'):
        return 'date'
    if t == 'time' or t.startswith('time32') or t.startswith('time64'):
        return 'time'
    if 'timedelta' in t or 'duration' in t:
        return 'duration'
    if 'int' in t:
        return 'integer'
    if 'float' in t or 'double' in t:
        return 'number'
    if 'bool' in t:
        return 'boolean'
    return 'string'


def get_arrow_column_info(table: pa.Table) -> list[ColumnInfo]:
    """Extract column information from a PyArrow Table."""
    return [ColumnInfo(name=field.name, dtype=normalize_dtype_to_app_type(str(field.type))) for field in table.schema]


def get_column_info(df: pd.DataFrame) -> list[ColumnInfo]:
    """Extract column information from a pandas DataFrame."""
    return [ColumnInfo(name=str(col), dtype=normalize_dtype_to_app_type(str(df[col].dtype))) for col in df.columns]


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
