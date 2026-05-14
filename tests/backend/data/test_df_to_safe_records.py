# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for df_to_safe_records — the single entry-point for
DataFrame → JSON-safe records conversion."""

import math
from datetime import date, datetime

import numpy as np
import pandas as pd
import pytest

pytestmark = [pytest.mark.backend]


from data_formulator.datalake.parquet_utils import df_to_safe_records


class TestDatetimeSerialization:
    """datetime64 columns must produce ISO-8601 strings, not epoch numbers."""

    def test_datetime_column_returns_iso_string(self):
        df = pd.DataFrame({"ts": pd.to_datetime(["2026-03-15", "2026-04-20"])})
        records = df_to_safe_records(df)
        assert records[0]["ts"] == "2026-03-15T00:00:00.000"
        assert records[1]["ts"] == "2026-04-20T00:00:00.000"

    def test_datetime_with_time_component(self):
        df = pd.DataFrame({"ts": pd.to_datetime(["2026-03-15 14:30:00"])})
        records = df_to_safe_records(df)
        assert "14:30:00" in records[0]["ts"]

    def test_nat_becomes_null(self):
        df = pd.DataFrame({"ts": pd.to_datetime(["2026-01-01", None])})
        records = df_to_safe_records(df)
        assert records[0]["ts"] is not None
        assert records[1]["ts"] is None


class TestMixedTypes:
    """DataFrames with mixed column types should serialize correctly."""

    def test_int_string_datetime_mixed(self):
        df = pd.DataFrame({
            "id": [1, 2],
            "name": ["Alice", "Bob"],
            "created": pd.to_datetime(["2026-01-01", "2026-06-15"]),
        })
        records = df_to_safe_records(df)
        assert records[0]["id"] == 1
        assert records[0]["name"] == "Alice"
        assert isinstance(records[0]["created"], str)
        assert records[0]["created"].startswith("2026-01-01")

    def test_float_with_nan(self):
        df = pd.DataFrame({"val": [1.5, float("nan"), 3.0]})
        records = df_to_safe_records(df)
        assert records[0]["val"] == 1.5
        assert records[1]["val"] is None
        assert records[2]["val"] == 3.0


class TestEdgeCases:
    """Empty DataFrames and exotic types."""

    def test_empty_dataframe(self):
        df = pd.DataFrame({"a": pd.Series([], dtype="int64")})
        assert df_to_safe_records(df) == []

    def test_empty_dataframe_no_columns(self):
        df = pd.DataFrame()
        assert df_to_safe_records(df) == []

    def test_default_handler_catches_exotic_types(self):
        df = pd.DataFrame({"val": [np.int64(42), np.float64(3.14)]})
        records = df_to_safe_records(df)
        assert records[0]["val"] == 42
        assert abs(records[1]["val"] - 3.14) < 0.001
