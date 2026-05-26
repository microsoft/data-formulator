"""
Field metadata computation for chart recommendation.

Given a DuckDB table, computes a FieldMeta for every column. The metadata
captures semantic properties (temporal/sequential/quantitative/categorical) and
QC-domain roles (control_limit/measurement/time/...), which downstream modules
(chart_defaults, chart_compatibility) use to pick or validate encodings.

Public surface:
    FieldMeta            — dataclass describing one column.
    compute_field_metadata(conn, table_name) -> Dict[str, FieldMeta]
    QC_ROLE_MAP          — fixed mapping from QC column name to role.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Dict, Optional

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# QC column name → semantic role. Detection is case-insensitive on the column
# name. Control-limit columns must never appear as encoding channels; they are
# rendered as horizontal reference lines.
QC_ROLE_MAP: Dict[str, str] = {
    "TARGET": "control_limit",
    "LL": "control_limit",
    "UL": "control_limit",
    "ARLL": "control_limit",
    "ARUL": "control_limit",
    "VALUE": "measurement",
    "QCDATE": "time",
    "LASTUPDATE": "time",
    "QCSHIFT": "shift",
    "QCSTDPARAMNAME": "param",
    "SLIPNO": "slip",
    "ITEMNAME": "item",
}

# Cardinality class thresholds (inclusive upper bounds).
CARDINALITY_LOW_MAX = 12
CARDINALITY_MID_MAX = 50
CARDINALITY_HIGH_MAX = 500

# A column is considered "quantitative" only if it has at least this many
# distinct values. Below this we treat numeric columns as ordinal/categorical
# (e.g. status codes 1/2/3) — they should not feed histograms or scatter axes.
MIN_DISTINCT_FOR_QUANTITATIVE = 10

# Identifier-like column-name pattern. Combined with high/huge cardinality to
# flag technical-artifact columns the picker should avoid as defaults.
# We treat `_` as a token boundary because Python's `\b` does not (underscore
# is a word character), so `\bid\b` would miss `customer_id`.
_ID_NAME_PATTERN = re.compile(
    r"(?:^|_)(id|no|code|seq|key|num)(?:_|$)", re.IGNORECASE
)

# DuckDB type families (compared after stripping parameters like DECIMAL(10,2)).
_INTEGER_TYPES = {
    "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "HUGEINT",
    "UINTEGER", "UBIGINT", "USMALLINT", "UTINYINT",
}
_FLOAT_TYPES = {"FLOAT", "DOUBLE", "REAL", "DECIMAL", "NUMERIC"}
_NUMERIC_TYPES = _INTEGER_TYPES | _FLOAT_TYPES
_TEMPORAL_TYPES = {
    "DATE", "TIMESTAMP", "TIME", "DATETIME",
    "TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ",
    "TIMESTAMP_NS", "TIMESTAMP_S", "TIMESTAMP_MS",
}


# ─────────────────────────────────────────────────────────────────────────────
# Data class
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class FieldMeta:
    """Semantic metadata for one column.

    `cardinality_class` is the primary signal the picker uses:
        - low  : ≤ 12 distinct  → ideal for bar.x, color, pie.label
        - mid  : ≤ 50 distinct  → still usable as categorical
        - high : ≤ 500 distinct → too many for bar; OK as quantitative
        - huge : > 500 distinct → only meaningful as quantitative/temporal axis
    """

    name: str
    sql_type: str
    cardinality: int
    null_ratio: float
    cardinality_class: str  # "low" | "mid" | "high" | "huge"
    is_temporal: bool
    is_sequential: bool
    is_quantitative: bool
    is_categorical: bool
    qc_role: Optional[str] = None
    looks_like_id: bool = False

    # Diagnostics (not used by downstream rules; kept for logging/debugging).
    row_count: int = 0
    stddev: Optional[float] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _normalize_type(sql_type: str) -> str:
    """Strip parameters/arrays from a DuckDB type string.

    "DECIMAL(10,2)" → "DECIMAL", "INTEGER[]" → "INTEGER",
    "TIMESTAMP WITH TIME ZONE" → "TIMESTAMP WITH TIME ZONE".
    """
    base = sql_type.upper().split("(")[0].split("[")[0].strip()
    return base


def _is_numeric_type(sql_type: str) -> bool:
    return _normalize_type(sql_type) in _NUMERIC_TYPES


def _is_integer_type(sql_type: str) -> bool:
    return _normalize_type(sql_type) in _INTEGER_TYPES


def _is_temporal_type(sql_type: str) -> bool:
    return _normalize_type(sql_type) in _TEMPORAL_TYPES


def _classify_cardinality(cardinality: int) -> str:
    if cardinality <= CARDINALITY_LOW_MAX:
        return "low"
    if cardinality <= CARDINALITY_MID_MAX:
        return "mid"
    if cardinality <= CARDINALITY_HIGH_MAX:
        return "high"
    return "huge"


def _detect_qc_role(col_name: str) -> Optional[str]:
    return QC_ROLE_MAP.get(col_name.upper())


def _looks_like_id_name(col_name: str) -> bool:
    return bool(_ID_NAME_PATTERN.search(col_name))


def _quote_ident(name: str) -> str:
    """Quote a DuckDB identifier (table or column). Doubles embedded quotes."""
    return '"' + name.replace('"', '""') + '"'


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────


def compute_field_metadata(conn, table_name: str) -> Dict[str, FieldMeta]:
    """Compute FieldMeta for every column in `table_name`.

    Args:
        conn: A DuckDB connection.
        table_name: The table or view to inspect (passed unquoted).

    Returns:
        Ordered dict of column-name → FieldMeta, matching the table schema order.
    """
    table_q = _quote_ident(table_name)

    schema_rows = conn.execute(f"DESCRIBE {table_q}").fetchall()
    # DESCRIBE columns: (column_name, column_type, null, key, default, extra)
    columns = [(row[0], row[1]) for row in schema_rows]

    row_count = conn.execute(f"SELECT COUNT(*) FROM {table_q}").fetchone()[0]

    metas: Dict[str, FieldMeta] = {}
    for col_name, col_type in columns:
        metas[col_name] = _compute_one(conn, table_q, col_name, col_type, row_count)
    return metas


def _compute_one(conn, table_q: str, col_name: str, col_type: str, row_count: int) -> FieldMeta:
    """Compute FieldMeta for a single column."""
    col_q = _quote_ident(col_name)

    if row_count == 0:
        # Empty table: return a meta with safe defaults. Downstream rules will
        # treat this column as unusable.
        return FieldMeta(
            name=col_name,
            sql_type=col_type,
            cardinality=0,
            null_ratio=0.0,
            cardinality_class="low",
            is_temporal=_is_temporal_type(col_type),
            is_sequential=False,
            is_quantitative=False,
            is_categorical=False,
            qc_role=_detect_qc_role(col_name),
            looks_like_id=False,
            row_count=0,
        )

    cardinality, non_null = conn.execute(
        f"SELECT COUNT(DISTINCT {col_q}), COUNT({col_q}) FROM {table_q}"
    ).fetchone()
    null_ratio = (row_count - non_null) / row_count

    stddev_val: Optional[float] = None
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    if _is_numeric_type(col_type) and non_null > 0:
        try:
            stats = conn.execute(
                f"SELECT STDDEV({col_q}), MIN({col_q}), MAX({col_q}) FROM {table_q}"
            ).fetchone()
            stddev_val = float(stats[0]) if stats[0] is not None else 0.0
            min_val = float(stats[1]) if stats[1] is not None else None
            max_val = float(stats[2]) if stats[2] is not None else None
        except Exception as e:
            logger.warning("Failed to compute numeric stats for %s: %s", col_name, e)

    is_temporal = _is_temporal_type(col_type)

    # Sequential: integer column where every row is a distinct value AND the
    # values form a perfect dense run (max - min + 1 == cardinality). This
    # matches the INDEX pattern (1..N) and intentionally rejects columns with
    # gaps so they don't get picked as ordinal axes by accident.
    is_sequential = (
        _is_integer_type(col_type)
        and non_null == row_count            # no NULLs
        and cardinality == row_count          # no duplicates
        and min_val is not None
        and max_val is not None
        and int(max_val - min_val + 1) == cardinality
    )

    # Quantitative: numeric with variance AND enough distinct values to plot as
    # a continuous axis. Sequential columns (INDEX-like) are explicitly excluded
    # because they encode position, not magnitude.
    is_quantitative = (
        _is_numeric_type(col_type)
        and not is_sequential
        and (stddev_val is not None and stddev_val > 0)
        and cardinality >= MIN_DISTINCT_FOR_QUANTITATIVE
    )

    cardinality_class = _classify_cardinality(cardinality)

    # Categorical: low/mid distinct values, NOT another primary role.
    # quantitative is excluded because a continuous metric with ~30 distinct
    # values is still a metric (line.y should accept it), not a category.
    # Boolean or low-cardinality int (e.g. status codes 1/2/3) qualify
    # because they fail is_quantitative (cardinality < MIN_DISTINCT).
    is_categorical = (
        cardinality_class in ("low", "mid")
        and not is_temporal
        and not is_sequential
        and not is_quantitative
    )

    qc_role = _detect_qc_role(col_name)
    looks_like_id = _looks_like_id_name(col_name) and cardinality_class in ("high", "huge")

    return FieldMeta(
        name=col_name,
        sql_type=col_type,
        cardinality=cardinality,
        null_ratio=null_ratio,
        cardinality_class=cardinality_class,
        is_temporal=is_temporal,
        is_sequential=is_sequential,
        is_quantitative=is_quantitative,
        is_categorical=is_categorical,
        qc_role=qc_role,
        looks_like_id=looks_like_id,
        row_count=row_count,
        stddev=stddev_val,
        min_value=min_val,
        max_value=max_val,
    )
