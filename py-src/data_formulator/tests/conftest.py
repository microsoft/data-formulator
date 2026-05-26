"""
Shared pytest fixtures for data_formulator tests.

Provides in-memory DuckDB connections and helper builders for synthetic test tables.
"""

from __future__ import annotations

import datetime as _dt
from typing import Dict, Iterable, Mapping

import duckdb
import pytest

from data_formulator.agents.field_metadata import FieldMeta


@pytest.fixture
def conn():
    """A fresh in-memory DuckDB connection per test."""
    c = duckdb.connect(":memory:")
    yield c
    c.close()


def _values_clause(rows: Iterable[Iterable]) -> str:
    """Build a VALUES clause for inserting rows. Quotes strings; uses NULL for None."""
    parts = []
    for row in rows:
        cells = []
        for v in row:
            if v is None:
                cells.append("NULL")
            elif isinstance(v, str):
                escaped = v.replace("'", "''")
                cells.append(f"'{escaped}'")
            elif isinstance(v, _dt.datetime):
                cells.append(f"TIMESTAMP '{v.isoformat(sep=' ')}'")
            elif isinstance(v, _dt.date):
                cells.append(f"DATE '{v.isoformat()}'")
            elif isinstance(v, bool):
                cells.append("TRUE" if v else "FALSE")
            else:
                cells.append(str(v))
        parts.append("(" + ", ".join(cells) + ")")
    return ",\n".join(parts)


def create_table(conn, table_name: str, columns: Mapping[str, str], rows: Iterable[Iterable]) -> None:
    """
    Create a DuckDB table with given schema and seed it.

    Args:
        conn: DuckDB connection.
        table_name: Identifier (unquoted; will be quoted internally).
        columns: Ordered mapping of column_name -> DuckDB type (e.g. "INTEGER", "VARCHAR", "DATE").
        rows: Iterable of row tuples matching the column order.
    """
    cols_sql = ", ".join(f'"{name}" {sql_type}' for name, sql_type in columns.items())
    conn.execute(f'CREATE TABLE "{table_name}" ({cols_sql})')

    rows_list = list(rows)
    if not rows_list:
        return

    values_sql = _values_clause(rows_list)
    conn.execute(f'INSERT INTO "{table_name}" VALUES {values_sql}')


@pytest.fixture
def make_table(conn):
    """Factory fixture: returns a function that creates a table on the shared connection."""

    def _factory(table_name: str, columns: Mapping[str, str], rows: Iterable[Iterable]):
        create_table(conn, table_name, columns, rows)
        return table_name

    return _factory


# ─────────────────────────────────────────────────────────────────────────────
# Mock FieldMeta builders (no DB needed — used in chart_defaults/compat tests)
# ─────────────────────────────────────────────────────────────────────────────


def make_meta(name: str, **overrides) -> FieldMeta:
    """Build a FieldMeta with sensible defaults; override any field via kwargs.

    Default is a low-cardinality categorical column (3 distinct values).
    """
    defaults: dict = dict(
        sql_type="VARCHAR",
        cardinality=3,
        null_ratio=0.0,
        cardinality_class="low",
        is_temporal=False,
        is_sequential=False,
        is_quantitative=False,
        is_categorical=True,
        qc_role=None,
        looks_like_id=False,
        row_count=100,
        stddev=None,
        min_value=None,
        max_value=None,
    )
    defaults.update(overrides)
    return FieldMeta(name=name, **defaults)


# Convenience builders for common field kinds.

def temporal_field(name: str, cardinality: int = 30, qc_role: str = None) -> FieldMeta:
    return make_meta(
        name,
        sql_type="DATE",
        cardinality=cardinality,
        cardinality_class="mid" if cardinality <= 50 else "high" if cardinality <= 500 else "huge",
        is_temporal=True,
        is_categorical=False,
        qc_role=qc_role,
    )


def sequential_field(name: str, cardinality: int = 1000) -> FieldMeta:
    cls = "low" if cardinality <= 12 else "mid" if cardinality <= 50 else "high" if cardinality <= 500 else "huge"
    return make_meta(
        name,
        sql_type="INTEGER",
        cardinality=cardinality,
        cardinality_class=cls,
        is_sequential=True,
        is_categorical=False,
        is_quantitative=False,
        min_value=1.0,
        max_value=float(cardinality),
        looks_like_id=(name.lower() in {"index", "id"} or "_id" in name.lower() or "_no" in name.lower()),
    )


def quantitative_field(name: str, cardinality: int = 100, qc_role: str = None) -> FieldMeta:
    cls = "low" if cardinality <= 12 else "mid" if cardinality <= 50 else "high" if cardinality <= 500 else "huge"
    return make_meta(
        name,
        sql_type="DOUBLE",
        cardinality=cardinality,
        cardinality_class=cls,
        is_quantitative=True,
        is_categorical=False,
        qc_role=qc_role,
        stddev=10.0,
        min_value=0.0,
        max_value=100.0,
    )


def categorical_field(name: str, cardinality: int = 3, qc_role: str = None) -> FieldMeta:
    if cardinality <= 12:
        cls = "low"
    elif cardinality <= 50:
        cls = "mid"
    elif cardinality <= 500:
        cls = "high"
    else:
        cls = "huge"
    return make_meta(
        name,
        sql_type="VARCHAR",
        cardinality=cardinality,
        cardinality_class=cls,
        is_categorical=(cls in ("low", "mid")),
        qc_role=qc_role,
    )


def control_limit_field(name: str) -> FieldMeta:
    """A control-limit column (TARGET, LL, UL, ARLL, ARUL)."""
    return make_meta(
        name,
        sql_type="DOUBLE",
        cardinality=1,
        cardinality_class="low",
        is_categorical=False,
        is_quantitative=False,
        qc_role="control_limit",
        stddev=0.0,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Pre-built schemas mirroring real-world data shapes
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def qc_full_metas() -> Dict[str, FieldMeta]:
    """Full QC schema: INDEX, QCDATE, QCSHIFT, VALUE, QCSTDPARAMNAME, ITEMNAME,
    SLIPNO, TARGET, LL, UL, ARLL, ARUL."""
    return {
        "INDEX": sequential_field("INDEX", cardinality=1000),
        "QCDATE": temporal_field("QCDATE", cardinality=30, qc_role="time"),
        "QCSHIFT": categorical_field("QCSHIFT", cardinality=3, qc_role="shift"),
        "VALUE": quantitative_field("VALUE", cardinality=950, qc_role="measurement"),
        "QCSTDPARAMNAME": categorical_field("QCSTDPARAMNAME", cardinality=15, qc_role="param"),
        "ITEMNAME": categorical_field("ITEMNAME", cardinality=300, qc_role="item"),
        "SLIPNO": categorical_field("SLIPNO", cardinality=600, qc_role="slip"),
        "TARGET": control_limit_field("TARGET"),
        "LL": control_limit_field("LL"),
        "UL": control_limit_field("UL"),
        "ARLL": control_limit_field("ARLL"),
        "ARUL": control_limit_field("ARUL"),
    }


@pytest.fixture
def qc_no_shift_metas() -> Dict[str, FieldMeta]:
    """QC schema missing QCSHIFT — qc_trend_line should not be possible here."""
    return {
        "INDEX": sequential_field("INDEX", cardinality=500),
        "QCDATE": temporal_field("QCDATE", cardinality=30, qc_role="time"),
        "VALUE": quantitative_field("VALUE", cardinality=450, qc_role="measurement"),
        "QCSTDPARAMNAME": categorical_field("QCSTDPARAMNAME", cardinality=10, qc_role="param"),
        "TARGET": control_limit_field("TARGET"),
        "LL": control_limit_field("LL"),
        "UL": control_limit_field("UL"),
    }


@pytest.fixture
def sales_long_metas() -> Dict[str, FieldMeta]:
    """Generic e-commerce schema: date + product + region + revenue + quantity."""
    return {
        "date": temporal_field("date", cardinality=90),
        "product": categorical_field("product", cardinality=5),
        "region": categorical_field("region", cardinality=4),
        "revenue": quantitative_field("revenue", cardinality=200),
        "quantity": quantitative_field("quantity", cardinality=80),
    }


@pytest.fixture
def text_only_metas() -> Dict[str, FieldMeta]:
    """Schema with NO numeric columns — many charts impossible."""
    return {
        "category": categorical_field("category", cardinality=5),
        "subcategory": categorical_field("subcategory", cardinality=20),
        "label": categorical_field("label", cardinality=8),
    }


@pytest.fixture
def numeric_only_metas() -> Dict[str, FieldMeta]:
    """Schema with multiple quantitative columns and no categorical."""
    return {
        "metric_a": quantitative_field("metric_a", cardinality=500),
        "metric_b": quantitative_field("metric_b", cardinality=400),
        "metric_c": quantitative_field("metric_c", cardinality=300),
    }


@pytest.fixture
def huge_categorical_metas() -> Dict[str, FieldMeta]:
    """Schema with a huge-cardinality column — should trigger R3 for bar."""
    return {
        "item_name": categorical_field("item_name", cardinality=837),
        "sales": quantitative_field("sales", cardinality=600),
    }


@pytest.fixture
def fake_qc_metas() -> Dict[str, FieldMeta]:
    """Schema that LOOKS like QC (has TARGET, LL) but lacks QC signature
    columns (no QCDATE/QCSHIFT/QCSTDPARAMNAME/SLIPNO).

    is_qc_data() should NOT classify this as QC.
    """
    return {
        "date": temporal_field("date", cardinality=90),
        "TARGET": quantitative_field("TARGET", cardinality=12),  # sales target, not QC
        "LL": quantitative_field("LL", cardinality=5),           # budget low limit
        "revenue": quantitative_field("revenue", cardinality=200),
    }


@pytest.fixture
def single_numeric_metas() -> Dict[str, FieldMeta]:
    """Schema with only 1 quantitative column — scatter requires 2 → R4."""
    return {
        "date": temporal_field("date", cardinality=90),
        "category": categorical_field("category", cardinality=5),
        "metric": quantitative_field("metric", cardinality=200),
    }
