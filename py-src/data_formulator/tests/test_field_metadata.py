"""
Unit tests for data_formulator.agents.field_metadata.

30 test cases grouped as:
    - QC field detection (10 cases)
    - Generic field detection (10 cases)
    - Edge cases (10 cases)
"""

from __future__ import annotations

import datetime as dt

import pytest

from data_formulator.agents.field_metadata import (
    QC_ROLE_MAP,
    FieldMeta,
    _classify_cardinality,
    _is_integer_type,
    _is_numeric_type,
    _is_temporal_type,
    _looks_like_id_name,
    _normalize_type,
    compute_field_metadata,
)


# ─────────────────────────────────────────────────────────────────────────────
# Group 1: QC field detection (10 cases)
# ─────────────────────────────────────────────────────────────────────────────


class TestQcFieldDetection:
    def test_01_index_sequential_dense(self, conn, make_table):
        """INDEX column 1..1000 is sequential, NOT quantitative."""
        rows = [(i, 100.0 + i * 0.1) for i in range(1, 1001)]
        make_table("t", {"INDEX": "INTEGER", "VALUE": "DOUBLE"}, rows)

        metas = compute_field_metadata(conn, "t")
        idx = metas["INDEX"]

        assert idx.is_sequential is True
        assert idx.is_quantitative is False  # sequential excludes quantitative
        assert idx.cardinality == 1000
        assert idx.cardinality_class == "huge"

    def test_02_qcdate_is_temporal(self, conn, make_table):
        rows = [(dt.date(2026, 1, i),) for i in range(1, 11)]
        make_table("t", {"QCDATE": "DATE"}, rows)

        meta = compute_field_metadata(conn, "t")["QCDATE"]
        assert meta.is_temporal is True
        assert meta.qc_role == "time"
        assert meta.is_quantitative is False
        assert meta.is_categorical is False  # temporal excludes categorical

    def test_03_qcshift_low_cardinality_categorical(self, conn, make_table):
        rows = [(s,) for s in ["A", "B", "C"] * 100]
        make_table("t", {"QCSHIFT": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["QCSHIFT"]
        assert meta.cardinality == 3
        assert meta.cardinality_class == "low"
        assert meta.is_categorical is True
        assert meta.qc_role == "shift"

    def test_04_value_quantitative_with_variance(self, conn, make_table):
        rows = [(float(v),) for v in range(1, 101)]  # 100 distinct, variance > 0
        make_table("t", {"VALUE": "DOUBLE"}, rows)

        meta = compute_field_metadata(conn, "t")["VALUE"]
        assert meta.is_quantitative is True
        assert meta.qc_role == "measurement"
        assert meta.stddev is not None and meta.stddev > 0

    def test_05_target_constant_is_control_limit_not_quantitative(self, conn, make_table):
        """TARGET column (control limit) typically constant per param → variance = 0 → not quantitative."""
        rows = [(50.0,) for _ in range(100)]
        make_table("t", {"TARGET": "DOUBLE"}, rows)

        meta = compute_field_metadata(conn, "t")["TARGET"]
        assert meta.qc_role == "control_limit"
        assert meta.is_quantitative is False  # zero variance
        assert meta.cardinality == 1

    def test_06_ll_role_is_control_limit(self, conn, make_table):
        rows = [(40.0,) for _ in range(50)]
        make_table("t", {"LL": "DOUBLE"}, rows)

        meta = compute_field_metadata(conn, "t")["LL"]
        assert meta.qc_role == "control_limit"

    def test_07_qcstdparamname_mid_cardinality(self, conn, make_table):
        # 20 distinct param names → mid cardinality
        rows = [(f"PARAM_{i % 20:02d}",) for i in range(200)]
        make_table("t", {"QCSTDPARAMNAME": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["QCSTDPARAMNAME"]
        assert meta.cardinality == 20
        assert meta.cardinality_class == "mid"
        assert meta.is_categorical is True
        assert meta.qc_role == "param"

    def test_08_itemname_high_cardinality(self, conn, make_table):
        # 300 distinct items → high cardinality (51..500)
        rows = [(f"ITEM_{i:04d}",) for i in range(300)]
        make_table("t", {"ITEMNAME": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["ITEMNAME"]
        assert meta.cardinality == 300
        assert meta.cardinality_class == "high"
        assert meta.is_categorical is False  # high cardinality excluded from categorical
        assert meta.qc_role == "item"

    def test_09_slipno_role(self, conn, make_table):
        rows = [(f"SLP-{i}",) for i in range(20)]
        make_table("t", {"SLIPNO": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["SLIPNO"]
        assert meta.qc_role == "slip"

    def test_10_lastupdate_timestamp_temporal(self, conn, make_table):
        rows = [(dt.datetime(2026, 1, 1, 10, i),) for i in range(30)]
        make_table("t", {"LASTUPDATE": "TIMESTAMP"}, rows)

        meta = compute_field_metadata(conn, "t")["LASTUPDATE"]
        assert meta.is_temporal is True
        assert meta.qc_role == "time"


# ─────────────────────────────────────────────────────────────────────────────
# Group 2: Generic field detection (10 cases)
# ─────────────────────────────────────────────────────────────────────────────


class TestGenericFieldDetection:
    def test_11_generic_date_no_qc_role(self, conn, make_table):
        rows = [(dt.date(2026, m, 1),) for m in range(1, 13)]
        make_table("t", {"date": "DATE"}, rows)

        meta = compute_field_metadata(conn, "t")["date"]
        assert meta.is_temporal is True
        assert meta.qc_role is None  # lowercase 'date' not in QC_ROLE_MAP

    def test_12_product_low_cardinality(self, conn, make_table):
        rows = [(p,) for p in ["Apple", "Banana", "Cherry", "Date", "Elderberry"] * 20]
        make_table("t", {"product": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["product"]
        assert meta.cardinality == 5
        assert meta.cardinality_class == "low"
        assert meta.is_categorical is True
        assert meta.qc_role is None

    def test_13_region_categorical(self, conn, make_table):
        rows = [(r,) for r in ["North", "South", "East", "West"] * 25]
        make_table("t", {"region": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["region"]
        assert meta.is_categorical is True
        assert meta.cardinality == 4

    def test_14_revenue_quantitative(self, conn, make_table):
        rows = [(100.0 + i * 13.7,) for i in range(50)]
        make_table("t", {"revenue": "DOUBLE"}, rows)

        meta = compute_field_metadata(conn, "t")["revenue"]
        assert meta.is_quantitative is True
        assert meta.qc_role is None

    def test_15_quantity_int_quantitative(self, conn, make_table):
        # 50 distinct non-sequential integers (with gaps) → quantitative, not sequential
        rows = [(i * 3,) for i in range(1, 51)]
        make_table("t", {"quantity": "INTEGER"}, rows)

        meta = compute_field_metadata(conn, "t")["quantity"]
        assert meta.is_quantitative is True
        assert meta.is_sequential is False  # has gaps (3,6,9,...)

    def test_16_customer_id_high_cardinality_looks_like_id(self, conn, make_table):
        # Sequential ID 1..1000 → both sequential AND looks_like_id
        rows = [(i,) for i in range(1, 1001)]
        make_table("t", {"customer_id": "INTEGER"}, rows)

        meta = compute_field_metadata(conn, "t")["customer_id"]
        assert meta.is_sequential is True
        assert meta.looks_like_id is True
        assert meta.cardinality_class == "huge"

    def test_17_order_no_string_high_cardinality_looks_like_id(self, conn, make_table):
        rows = [(f"ORD-{i:06d}",) for i in range(600)]
        make_table("t", {"order_no": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["order_no"]
        assert meta.looks_like_id is True
        assert meta.is_sequential is False  # not an integer

    def test_18_status_enum_categorical(self, conn, make_table):
        rows = [(s,) for s in ["active", "inactive", "pending"] * 100]
        make_table("t", {"status": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["status"]
        assert meta.is_categorical is True
        assert meta.cardinality == 3

    def test_19_created_at_timestamp(self, conn, make_table):
        rows = [(dt.datetime(2026, 1, 1) + dt.timedelta(hours=i),) for i in range(48)]
        make_table("t", {"created_at": "TIMESTAMP"}, rows)

        meta = compute_field_metadata(conn, "t")["created_at"]
        assert meta.is_temporal is True
        assert meta.qc_role is None

    def test_20_boolean_categorical_low(self, conn, make_table):
        rows = [(bool(i % 2),) for i in range(20)]
        make_table("t", {"is_active": "BOOLEAN"}, rows)

        meta = compute_field_metadata(conn, "t")["is_active"]
        assert meta.cardinality == 2
        assert meta.cardinality_class == "low"
        assert meta.is_categorical is True
        assert meta.is_quantitative is False


# ─────────────────────────────────────────────────────────────────────────────
# Group 3: Edge cases (10 cases)
# ─────────────────────────────────────────────────────────────────────────────


class TestEdgeCases:
    def test_21_empty_table_safe_defaults(self, conn, make_table):
        make_table("t", {"col_a": "INTEGER", "col_b": "VARCHAR"}, [])

        metas = compute_field_metadata(conn, "t")
        assert metas["col_a"].cardinality == 0
        assert metas["col_a"].is_quantitative is False
        assert metas["col_a"].is_sequential is False
        assert metas["col_b"].row_count == 0

    def test_22_all_null_column(self, conn, make_table):
        rows = [(None,) for _ in range(10)]
        make_table("t", {"x": "INTEGER"}, rows)

        meta = compute_field_metadata(conn, "t")["x"]
        assert meta.null_ratio == 1.0
        assert meta.cardinality == 0
        assert meta.is_quantitative is False

    def test_23_constant_value_not_quantitative(self, conn, make_table):
        rows = [(42.0,) for _ in range(100)]
        make_table("t", {"x": "DOUBLE"}, rows)

        meta = compute_field_metadata(conn, "t")["x"]
        assert meta.cardinality == 1
        assert meta.is_quantitative is False  # stddev = 0

    def test_24_string_numbers_not_quantitative(self, conn, make_table):
        """Numbers stored as strings are categorical, not quantitative."""
        rows = [(s,) for s in ["1", "2", "3"] * 100]
        make_table("t", {"x": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["x"]
        assert meta.is_quantitative is False
        assert meta.is_categorical is True

    def test_25_sequential_with_gaps_is_not_sequential(self, conn, make_table):
        """INDEX 1,2,5,7,10 — has gaps → not strictly sequential."""
        rows = [(v,) for v in [1, 2, 5, 7, 10]]
        make_table("t", {"INDEX": "INTEGER"}, rows)

        meta = compute_field_metadata(conn, "t")["INDEX"]
        # cardinality=5, range = 10-1+1 = 10 ≠ 5 → not sequential
        assert meta.is_sequential is False

    def test_26_low_cardinality_int_not_quantitative(self, conn, make_table):
        """Integer with only 3 distinct values (e.g. status code) → categorical, not quantitative."""
        rows = [(i % 3,) for i in range(100)]
        make_table("t", {"code": "INTEGER"}, rows)

        meta = compute_field_metadata(conn, "t")["code"]
        assert meta.cardinality == 3
        assert meta.is_quantitative is False  # below MIN_DISTINCT_FOR_QUANTITATIVE
        assert meta.is_categorical is True

    def test_27_float_single_value_not_quantitative(self, conn, make_table):
        rows = [(3.14,) for _ in range(20)]
        make_table("t", {"x": "DOUBLE"}, rows)

        meta = compute_field_metadata(conn, "t")["x"]
        assert meta.is_quantitative is False

    def test_28_high_cardinality_string_not_categorical(self, conn, make_table):
        # 600 distinct strings → huge → not categorical
        rows = [(f"unique_{i}",) for i in range(600)]
        make_table("t", {"x": "VARCHAR"}, rows)

        meta = compute_field_metadata(conn, "t")["x"]
        assert meta.cardinality_class == "huge"
        assert meta.is_categorical is False

    def test_29_column_name_with_special_chars(self, conn, make_table):
        """Column names with spaces/parens must be properly quoted."""
        rows = [(i * 1.5,) for i in range(20)]
        make_table("t", {"value (USD)": "DOUBLE"}, rows)

        metas = compute_field_metadata(conn, "t")
        assert "value (USD)" in metas
        assert metas["value (USD)"].is_quantitative is True

    def test_30_decimal_type_recognized_as_numeric(self, conn, make_table):
        """DECIMAL(10,2) should be recognized as numeric for stats."""
        rows = [(i + 0.5,) for i in range(20)]
        make_table("t", {"price": "DECIMAL(10,2)"}, rows)

        meta = compute_field_metadata(conn, "t")["price"]
        assert meta.is_quantitative is True
        assert meta.stddev is not None and meta.stddev > 0


# ─────────────────────────────────────────────────────────────────────────────
# Sanity tests for pure helper functions (no DB needed)
# ─────────────────────────────────────────────────────────────────────────────


class TestHelpers:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("INTEGER", "INTEGER"),
            ("DECIMAL(10,2)", "DECIMAL"),
            ("INTEGER[]", "INTEGER"),
            ("varchar", "VARCHAR"),
            ("  TIMESTAMP  ", "TIMESTAMP"),
        ],
    )
    def test_normalize_type(self, raw, expected):
        assert _normalize_type(raw) == expected

    @pytest.mark.parametrize(
        "sql_type,is_num",
        [
            ("INTEGER", True),
            ("DOUBLE", True),
            ("DECIMAL(10,2)", True),
            ("VARCHAR", False),
            ("DATE", False),
            ("BOOLEAN", False),
        ],
    )
    def test_is_numeric(self, sql_type, is_num):
        assert _is_numeric_type(sql_type) is is_num

    def test_is_integer(self):
        assert _is_integer_type("INTEGER") is True
        assert _is_integer_type("DOUBLE") is False
        assert _is_integer_type("BIGINT") is True

    def test_is_temporal(self):
        assert _is_temporal_type("DATE") is True
        assert _is_temporal_type("TIMESTAMP") is True
        assert _is_temporal_type("VARCHAR") is False

    @pytest.mark.parametrize(
        "cardinality,expected",
        [
            (0, "low"),
            (12, "low"),
            (13, "mid"),
            (50, "mid"),
            (51, "high"),
            (500, "high"),
            (501, "huge"),
            (100_000, "huge"),
        ],
    )
    def test_classify_cardinality(self, cardinality, expected):
        assert _classify_cardinality(cardinality) == expected

    @pytest.mark.parametrize(
        "name,expected",
        [
            ("customer_id", True),
            ("order_no", True),
            ("product_code", True),
            ("seq_num", True),
            ("revenue", False),
            ("date", False),
            ("name", False),
        ],
    )
    def test_looks_like_id_name(self, name, expected):
        assert _looks_like_id_name(name) is expected

    def test_qc_role_map_contains_required_columns(self):
        """Sanity check the QC_ROLE_MAP includes all critical QC columns."""
        required = {"TARGET", "LL", "UL", "VALUE", "QCDATE", "QCSHIFT"}
        assert required.issubset(QC_ROLE_MAP.keys())


def test_sample_values_populated_for_low_cardinality(conn, make_table):
    rows = [(v,) for v in ["iPhone", "Samsung", "Oppo", "Samsung"]]
    make_table("t", {"product": "VARCHAR"}, rows)
    meta = compute_field_metadata(conn, "t")["product"]
    assert set(meta.sample_values) == {"iPhone", "Samsung", "Oppo"}


def test_sample_values_populated_for_temporal(conn, make_table):
    rows = [(dt.date(2026, 1, d),) for d in [1, 2, 3, 4, 5]]
    make_table("t", {"day": "DATE"}, rows)
    meta = compute_field_metadata(conn, "t")["day"]
    assert len(meta.sample_values) in (3, 5)
