# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for data_formulator.agents.semantic_types.

Covers:
- ALL_SEMANTIC_TYPES completeness
- Classification helpers: is_measure_type, is_timeseries_type,
  is_categorical_type, is_ordinal_type, is_geo_type,
  is_non_measure_numeric, is_signed_measure
- get_vl_type: VL-type mapping for every registered semantic type
- infer_vl_type_from_name: name-based heuristic inference
- generate_semantic_types_prompt: output shape and content
"""

from __future__ import annotations

import pytest

from data_formulator.agents.semantic_types import (
    # Constants
    AMOUNT, ADDRESS, BOOLEAN, CATEGORY, CITY, CORRELATION, COUNT,
    COUNTRY, DATE, DATETIME, DAY, DECADE, DIRECTION, DURATION, HOUR,
    ID, LATITUDE, LONGITUDE, MONTH, NAME, NUMBER, PERCENTAGE,
    PERCENTAGE_CHANGE, PRICE, PROFIT, QUANTITY, QUARTER, RANGE, RANK,
    REGION, SCORE, SENTIMENT, STATE, STATUS, TEMPERATURE, TIME,
    TIMESTAMP, UNKNOWN, WEEK, YEAR, YEAR_MONTH, YEAR_QUARTER, YEAR_WEEK,
    ZIP_CODE,
    # Sets / lists
    ALL_SEMANTIC_TYPES, MEASURE_TYPES, TIMESERIES_X_TYPES,
    CATEGORICAL_TYPES, ORDINAL_TYPES, GEO_TYPES, SIGNED_MEASURE_TYPES,
    NON_MEASURE_NUMERIC_TYPES, SEMANTIC_TYPE_CATEGORIES,
    VL_TYPE_MAP,
    # Functions
    is_measure_type, is_timeseries_type, is_categorical_type,
    is_ordinal_type, is_geo_type, is_non_measure_numeric, is_signed_measure,
    get_vl_type, infer_vl_type_from_name, generate_semantic_types_prompt,
)

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# ALL_SEMANTIC_TYPES completeness
# ---------------------------------------------------------------------------

class TestAllSemanticTypes:
    def test_no_duplicates(self):
        """Duplicate entries in ALL_SEMANTIC_TYPES would cause silent bugs."""
        assert len(ALL_SEMANTIC_TYPES) == len(set(ALL_SEMANTIC_TYPES))

    def test_includes_known_types(self):
        for t in [DATETIME, DATE, AMOUNT, COUNT, CATEGORY, COUNTRY, UNKNOWN]:
            assert t in ALL_SEMANTIC_TYPES

    def test_every_vl_map_key_is_in_all_types(self):
        """VL_TYPE_MAP should not reference types absent from ALL_SEMANTIC_TYPES."""
        for key in VL_TYPE_MAP:
            assert key in ALL_SEMANTIC_TYPES, f"{key!r} in VL_TYPE_MAP but not in ALL_SEMANTIC_TYPES"

    def test_vl_map_values_are_valid(self):
        valid = {"quantitative", "ordinal", "nominal", "temporal"}
        for key, val in VL_TYPE_MAP.items():
            assert val in valid, f"{key!r} maps to unexpected VL type {val!r}"

    def test_all_types_covered_in_semantic_categories(self):
        """Every type in ALL_SEMANTIC_TYPES should appear in at least one category group."""
        all_in_cats = {t for types in SEMANTIC_TYPE_CATEGORIES.values() for t in types}
        for t in ALL_SEMANTIC_TYPES:
            assert t in all_in_cats, f"{t!r} missing from SEMANTIC_TYPE_CATEGORIES"


# ---------------------------------------------------------------------------
# is_measure_type
# ---------------------------------------------------------------------------

class TestIsMeasureType:
    @pytest.mark.parametrize("t", [
        AMOUNT, PRICE, QUANTITY, TEMPERATURE, PERCENTAGE,
        PROFIT, PERCENTAGE_CHANGE, SENTIMENT, CORRELATION,
        COUNT, NUMBER, DURATION,
    ])
    def test_measure_types_return_true(self, t):
        assert is_measure_type(t) is True

    @pytest.mark.parametrize("t", [
        CATEGORY, NAME, COUNTRY, DATE, DATETIME, RANK, SCORE, ID, UNKNOWN,
    ])
    def test_non_measure_types_return_false(self, t):
        assert is_measure_type(t) is False

    def test_unknown_string_returns_false(self):
        assert is_measure_type("NotAType") is False


# ---------------------------------------------------------------------------
# is_timeseries_type
# ---------------------------------------------------------------------------

class TestIsTimeseriesType:
    @pytest.mark.parametrize("t", [
        DATETIME, DATE, TIME, TIMESTAMP,
        YEAR_MONTH, YEAR_QUARTER, YEAR_WEEK,
        YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, DECADE,
    ])
    def test_timeseries_types_return_true(self, t):
        assert is_timeseries_type(t) is True

    @pytest.mark.parametrize("t", [
        AMOUNT, CATEGORY, COUNTRY, COUNT, RANK, UNKNOWN,
    ])
    def test_non_timeseries_return_false(self, t):
        assert is_timeseries_type(t) is False


# ---------------------------------------------------------------------------
# is_categorical_type
# ---------------------------------------------------------------------------

class TestIsCategoricalType:
    @pytest.mark.parametrize("t", [
        NAME, CATEGORY, STATUS, BOOLEAN, DIRECTION,
        COUNTRY, STATE, CITY, REGION, ADDRESS, ZIP_CODE, RANGE,
    ])
    def test_categorical_types_return_true(self, t):
        assert is_categorical_type(t) is True

    @pytest.mark.parametrize("t", [
        AMOUNT, DATE, COUNT, RANK, LATITUDE, LONGITUDE, UNKNOWN,
    ])
    def test_non_categorical_return_false(self, t):
        assert is_categorical_type(t) is False


# ---------------------------------------------------------------------------
# is_ordinal_type
# ---------------------------------------------------------------------------

class TestIsOrdinalType:
    @pytest.mark.parametrize("t", [
        YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, DECADE,
        RANK, SCORE, RANGE, DIRECTION,
    ])
    def test_ordinal_types_return_true(self, t):
        assert is_ordinal_type(t) is True

    @pytest.mark.parametrize("t", [
        AMOUNT, DATETIME, CATEGORY, COUNTRY, UNKNOWN,
    ])
    def test_non_ordinal_return_false(self, t):
        assert is_ordinal_type(t) is False


# ---------------------------------------------------------------------------
# is_geo_type
# ---------------------------------------------------------------------------

class TestIsGeoType:
    @pytest.mark.parametrize("t", [
        LATITUDE, LONGITUDE,
        COUNTRY, STATE, CITY, REGION, ADDRESS, ZIP_CODE,
    ])
    def test_geo_types_return_true(self, t):
        assert is_geo_type(t) is True

    @pytest.mark.parametrize("t", [
        AMOUNT, DATE, CATEGORY, RANK, UNKNOWN,
    ])
    def test_non_geo_return_false(self, t):
        assert is_geo_type(t) is False


# ---------------------------------------------------------------------------
# is_non_measure_numeric
# ---------------------------------------------------------------------------

class TestIsNonMeasureNumeric:
    @pytest.mark.parametrize("t", [
        RANK, SCORE, YEAR, MONTH, DAY, HOUR, LATITUDE, LONGITUDE,
    ])
    def test_non_measure_numerics_return_true(self, t):
        assert is_non_measure_numeric(t) is True

    @pytest.mark.parametrize("t", [
        AMOUNT, CATEGORY, DATETIME, UNKNOWN,
    ])
    def test_others_return_false(self, t):
        assert is_non_measure_numeric(t) is False


# ---------------------------------------------------------------------------
# is_signed_measure
# ---------------------------------------------------------------------------

class TestIsSignedMeasure:
    @pytest.mark.parametrize("t", [PROFIT, PERCENTAGE_CHANGE, SENTIMENT, CORRELATION])
    def test_signed_measures_return_true(self, t):
        assert is_signed_measure(t) is True

    @pytest.mark.parametrize("t", [AMOUNT, COUNT, CATEGORY, DATE, UNKNOWN])
    def test_non_signed_return_false(self, t):
        assert is_signed_measure(t) is False


# ---------------------------------------------------------------------------
# get_vl_type — VL type mapping
# ---------------------------------------------------------------------------

class TestGetVlType:
    @pytest.mark.parametrize("semantic, expected_vl", [
        (DATETIME, "temporal"),
        (DATE, "temporal"),
        (TIME, "temporal"),
        (TIMESTAMP, "temporal"),
        (YEAR_MONTH, "temporal"),
        (YEAR_QUARTER, "temporal"),
        (YEAR_WEEK, "temporal"),
        (YEAR, "temporal"),
        (QUARTER, "ordinal"),
        (MONTH, "ordinal"),
        (WEEK, "ordinal"),
        (DAY, "ordinal"),
        (HOUR, "ordinal"),
        (DECADE, "ordinal"),
        (DURATION, "quantitative"),
        (AMOUNT, "quantitative"),
        (PRICE, "quantitative"),
        (QUANTITY, "quantitative"),
        (TEMPERATURE, "quantitative"),
        (PERCENTAGE, "quantitative"),
        (PROFIT, "quantitative"),
        (PERCENTAGE_CHANGE, "quantitative"),
        (SENTIMENT, "quantitative"),
        (CORRELATION, "quantitative"),
        (COUNT, "quantitative"),
        (NUMBER, "quantitative"),
        (RANK, "ordinal"),
        (SCORE, "quantitative"),
        (ID, "nominal"),
        (LATITUDE, "quantitative"),
        (LONGITUDE, "quantitative"),
        (COUNTRY, "nominal"),
        (STATE, "nominal"),
        (CITY, "nominal"),
        (REGION, "nominal"),
        (ADDRESS, "nominal"),
        (ZIP_CODE, "nominal"),
        (NAME, "nominal"),
        (CATEGORY, "nominal"),
        (STATUS, "nominal"),
        (BOOLEAN, "nominal"),
        (DIRECTION, "nominal"),
        (RANGE, "ordinal"),
        (UNKNOWN, "nominal"),
    ])
    def test_vl_type_mapping(self, semantic, expected_vl):
        assert get_vl_type(semantic) == expected_vl

    def test_unknown_type_returns_none(self):
        assert get_vl_type("NotARegisteredType") is None


# ---------------------------------------------------------------------------
# infer_vl_type_from_name — name-based heuristic inference
# ---------------------------------------------------------------------------

class TestInferVlTypeFromName:
    # Temporal heuristics
    @pytest.mark.parametrize("name", [
        "date", "created_at", "updated_at", "started_at", "ended_at",
        "order_date", "timestamp", "datetime", "time", "year",
    ])
    def test_temporal_names(self, name):
        assert infer_vl_type_from_name(name) == "temporal", f"Expected temporal for {name!r}"

    # Ordinal heuristics
    @pytest.mark.parametrize("name", [
        "month", "quarter", "week", "day", "hour", "decade",
        "year_month", "year_quarter",
        "rank", "ranking", "user_rank", "priority_level", "tier",
    ])
    def test_ordinal_names(self, name):
        assert infer_vl_type_from_name(name) == "ordinal", f"Expected ordinal for {name!r}"

    # Quantitative heuristics
    @pytest.mark.parametrize("name", [
        "revenue_sum", "total_sales", "avg_price", "count_orders",
        "mean_temperature", "max_score", "min_cost", "profit_change",
        "growth_rate", "pct_change", "lat", "lon", "latitude", "longitude",
    ])
    def test_quantitative_names(self, name):
        assert infer_vl_type_from_name(name) == "quantitative", f"Expected quantitative for {name!r}"

    # Nominal heuristics
    @pytest.mark.parametrize("name", [
        "user_name", "product_category", "status", "group_id",
        "country", "city", "region", "brand", "company",
    ])
    def test_nominal_names(self, name):
        assert infer_vl_type_from_name(name) == "nominal", f"Expected nominal for {name!r}"

    # No-signal names — should return None
    @pytest.mark.parametrize("name", [
        "x", "value", "col_a", "data", "info",
    ])
    def test_no_signal_names_return_none(self, name):
        assert infer_vl_type_from_name(name) is None, f"Expected None for {name!r}"

    def test_temporal_takes_priority_over_ordinal(self):
        """'year' should match temporal before ordinal."""
        assert infer_vl_type_from_name("year") == "temporal"

    def test_case_insensitive(self):
        assert infer_vl_type_from_name("Created_At") == "temporal"
        assert infer_vl_type_from_name("REVENUE_SUM") == "quantitative"


# ---------------------------------------------------------------------------
# generate_semantic_types_prompt
# ---------------------------------------------------------------------------

class TestGenerateSemanticTypesPrompt:
    def test_returns_non_empty_string(self):
        prompt = generate_semantic_types_prompt()
        assert isinstance(prompt, str)
        assert len(prompt) > 100

    def test_contains_category_headers(self):
        prompt = generate_semantic_types_prompt()
        assert "Temporal" in prompt
        assert "Numeric" in prompt
        assert "Geographic" in prompt
        assert "Categorical" in prompt

    def test_contains_type_names(self):
        prompt = generate_semantic_types_prompt()
        for t in [DATETIME, AMOUNT, COUNTRY, CATEGORY, UNKNOWN]:
            assert t in prompt, f"{t!r} missing from semantic types prompt"

    def test_contains_guidelines(self):
        prompt = generate_semantic_types_prompt()
        assert "Guidelines" in prompt

    def test_all_registered_types_appear_in_prompt(self):
        """Every type in ALL_SEMANTIC_TYPES must appear somewhere in the prompt."""
        prompt = generate_semantic_types_prompt()
        for t in ALL_SEMANTIC_TYPES:
            assert t in prompt, f"Type {t!r} not present in generated prompt"
