# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for normalize_dtype_to_app_type in parquet_utils."""

import pytest
from data_formulator.datalake.parquet_utils import normalize_dtype_to_app_type


class TestNormalizeDtypeToAppType:
    """Verify that pandas/Arrow dtype strings are mapped to standardized App Type labels."""

    # --- Datetime family ---

    @pytest.mark.parametrize("dtype_str, expected", [
        ("datetime64[ns]", "datetime"),
        ("datetime64[ns, UTC]", "datetime"),
        ("datetime64[us]", "datetime"),
        ("timestamp[ns]", "datetime"),
        ("timestamp[us, tz=UTC]", "datetime"),
    ])
    def test_datetime_types(self, dtype_str: str, expected: str):
        assert normalize_dtype_to_app_type(dtype_str) == expected

    # --- Date ---

    @pytest.mark.parametrize("dtype_str, expected", [
        ("date", "date"),
        ("date32", "date"),
        ("date32[day]", "date"),
        ("date64", "date"),
    ])
    def test_date_types(self, dtype_str: str, expected: str):
        assert normalize_dtype_to_app_type(dtype_str) == expected

    # --- Time ---

    @pytest.mark.parametrize("dtype_str, expected", [
        ("time", "time"),
        ("time32[ms]", "time"),
        ("time64[us]", "time"),
    ])
    def test_time_types(self, dtype_str: str, expected: str):
        assert normalize_dtype_to_app_type(dtype_str) == expected

    # --- Duration / timedelta ---

    @pytest.mark.parametrize("dtype_str, expected", [
        ("timedelta64[ns]", "duration"),
        ("duration[ns]", "duration"),
        ("duration[us]", "duration"),
    ])
    def test_duration_types(self, dtype_str: str, expected: str):
        assert normalize_dtype_to_app_type(dtype_str) == expected

    # --- Integer ---

    @pytest.mark.parametrize("dtype_str, expected", [
        ("int64", "integer"),
        ("int32", "integer"),
        ("Int64", "integer"),
        ("uint8", "integer"),
    ])
    def test_integer_types(self, dtype_str: str, expected: str):
        assert normalize_dtype_to_app_type(dtype_str) == expected

    # --- Number (float) ---

    @pytest.mark.parametrize("dtype_str, expected", [
        ("float64", "number"),
        ("float32", "number"),
        ("double", "number"),
        ("Float64", "number"),
    ])
    def test_float_types(self, dtype_str: str, expected: str):
        assert normalize_dtype_to_app_type(dtype_str) == expected

    # --- Boolean ---

    @pytest.mark.parametrize("dtype_str, expected", [
        ("bool", "boolean"),
        ("boolean", "boolean"),
    ])
    def test_boolean_types(self, dtype_str: str, expected: str):
        assert normalize_dtype_to_app_type(dtype_str) == expected

    # --- String / fallback ---

    @pytest.mark.parametrize("dtype_str, expected", [
        ("object", "string"),
        ("string", "string"),
        ("category", "string"),
        ("unknown_type", "string"),
    ])
    def test_string_fallback(self, dtype_str: str, expected: str):
        assert normalize_dtype_to_app_type(dtype_str) == expected
