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
    AMOUNT, BOOLEAN, CATEGORY, CORRELATION, COUNT,
    COUNTRY, DATE, DATETIME, DECADE, DIRECTION, DURATION,
    ID, LATITUDE, MONTH, NAME, PROFIT, RANGE, RANK,
    SCORE, UNKNOWN, YEAR, YEAR_MONTH,
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
    @pytest.mark.parametrize("t", [AMOUNT, PROFIT, COUNT, DURATION])
    def test_measure_types_return_true(self, t):
        assert is_measure_type(t) is True

    @pytest.mark.parametrize("t", [CATEGORY, DATE, RANK, SCORE, UNKNOWN])
    def test_non_measure_types_return_false(self, t):
        assert is_measure_type(t) is False


# ---------------------------------------------------------------------------
# is_timeseries_type
# ---------------------------------------------------------------------------

class TestIsTimeseriesType:
    @pytest.mark.parametrize("t", [DATETIME, YEAR_MONTH, YEAR, DECADE])
    def test_timeseries_types_return_true(self, t):
        assert is_timeseries_type(t) is True

    @pytest.mark.parametrize("t", [AMOUNT, CATEGORY, RANK])
    def test_non_timeseries_return_false(self, t):
        assert is_timeseries_type(t) is False


# ---------------------------------------------------------------------------
# is_categorical_type
# ---------------------------------------------------------------------------

class TestIsCategoricalType:
    @pytest.mark.parametrize("t", [NAME, BOOLEAN, COUNTRY, ZIP_CODE, RANGE])
    def test_categorical_types_return_true(self, t):
        assert is_categorical_type(t) is True

    @pytest.mark.parametrize("t", [AMOUNT, DATE, RANK, LATITUDE])
    def test_non_categorical_return_false(self, t):
        assert is_categorical_type(t) is False


# ---------------------------------------------------------------------------
# is_ordinal_type
# ---------------------------------------------------------------------------

class TestIsOrdinalType:
    @pytest.mark.parametrize("t", [YEAR, MONTH, RANK, RANGE, DIRECTION])
    def test_ordinal_types_return_true(self, t):
        assert is_ordinal_type(t) is True

    @pytest.mark.parametrize("t", [AMOUNT, DATETIME, CATEGORY])
    def test_non_ordinal_return_false(self, t):
        assert is_ordinal_type(t) is False


# ---------------------------------------------------------------------------
# is_geo_type
# ---------------------------------------------------------------------------

class TestIsGeoType:
    @pytest.mark.parametrize("t", [LATITUDE, COUNTRY, ZIP_CODE])
    def test_geo_types_return_true(self, t):
        assert is_geo_type(t) is True

    @pytest.mark.parametrize("t", [AMOUNT, CATEGORY, RANK])
    def test_non_geo_return_false(self, t):
        assert is_geo_type(t) is False


# ---------------------------------------------------------------------------
# is_non_measure_numeric
# ---------------------------------------------------------------------------

class TestIsNonMeasureNumeric:
    @pytest.mark.parametrize("t", [RANK, SCORE, YEAR, LATITUDE])
    def test_non_measure_numerics_return_true(self, t):
        assert is_non_measure_numeric(t) is True

    @pytest.mark.parametrize("t", [AMOUNT, CATEGORY])
    def test_others_return_false(self, t):
        assert is_non_measure_numeric(t) is False


# ---------------------------------------------------------------------------
# is_signed_measure
# ---------------------------------------------------------------------------

class TestIsSignedMeasure:
    @pytest.mark.parametrize("t", [PROFIT, CORRELATION])
    def test_signed_measures_return_true(self, t):
        assert is_signed_measure(t) is True

    @pytest.mark.parametrize("t", [AMOUNT, COUNT, CATEGORY])
    def test_non_signed_return_false(self, t):
        assert is_signed_measure(t) is False


# ---------------------------------------------------------------------------
# get_vl_type — VL type mapping
# ---------------------------------------------------------------------------

class TestGetVlType:
    @pytest.mark.parametrize("semantic, expected_vl", [
        (DATETIME, "temporal"),
        (YEAR, "temporal"),
        (MONTH, "ordinal"),
        (DURATION, "quantitative"),
        (AMOUNT, "quantitative"),
        (RANK, "ordinal"),
        (SCORE, "quantitative"),
        (ID, "nominal"),
        (LATITUDE, "quantitative"),
        (COUNTRY, "nominal"),
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
    @pytest.mark.parametrize("name", ["date", "created_at", "order_date"])
    def test_temporal_names(self, name):
        assert infer_vl_type_from_name(name) == "temporal", f"Expected temporal for {name!r}"

    # Ordinal heuristics
    @pytest.mark.parametrize("name", ["month", "year_month", "rank", "user_rank", "priority_level"])
    def test_ordinal_names(self, name):
        assert infer_vl_type_from_name(name) == "ordinal", f"Expected ordinal for {name!r}"

    # Quantitative heuristics
    @pytest.mark.parametrize("name", ["revenue_sum", "avg_price", "max_score", "growth_rate", "lat", "longitude"])
    def test_quantitative_names(self, name):
        assert infer_vl_type_from_name(name) == "quantitative", f"Expected quantitative for {name!r}"

    # Nominal heuristics
    @pytest.mark.parametrize("name", ["user_name", "group_id", "country", "company"])
    def test_nominal_names(self, name):
        assert infer_vl_type_from_name(name) == "nominal", f"Expected nominal for {name!r}"

    # No-signal names — should return None
    @pytest.mark.parametrize("name", ["x", "value"])
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
    def test_all_registered_types_appear_in_prompt(self):
        """Every type in ALL_SEMANTIC_TYPES must appear somewhere in the prompt."""
        prompt = generate_semantic_types_prompt()
        for t in ALL_SEMANTIC_TYPES:
            assert t in prompt, f"Type {t!r} not present in generated prompt"


class TestSemanticGuidanceConsistency:
    """Every semantic type the agents are told to use must be one Flint registers."""

    def test_visualize_field_metadata_schema_lists_exactly_the_registered_types(self):
        import json
        from pathlib import Path

        import data_formulator.analyst.skills.visualization as visualization

        tools = json.loads((Path(visualization.__file__).parent / "tools.json").read_text())
        schema = tools[0]["function"]["parameters"]["properties"]["field_metadata"]["additionalProperties"]["oneOf"]
        assert schema[0]["enum"] == ALL_SEMANTIC_TYPES
        assert schema[1]["properties"]["semantic_type"]["enum"] == ALL_SEMANTIC_TYPES
        assert set(schema[1]["properties"]) == {
            "semantic_type", "unit", "intrinsic_domain", "sort_order", "diverging_midpoint",
        }

    def test_prompt_recommends_no_unregistered_types(self):
        prompt = generate_semantic_types_prompt()
        for name in ("Revenue/Cost", "AgeGroup", "Score/Rating", "Use String"):
            assert name not in prompt

    def test_data_load_example_uses_registered_types_and_orders_only_ordered_fields(self):
        import json
        import re

        from data_formulator.agents.agent_data_load import EXAMPLES

        for block in re.findall(r"\[OUTPUT\]\s*```json\s*(\{.*?\})\s*```", EXAMPLES, re.S):
            for name, field in json.loads(block)["fields"].items():
                assert field["semantic_type"] in ALL_SEMANTIC_TYPES, name
                if "sort_order" in field:
                    assert field["semantic_type"] not in CATEGORICAL_TYPES - {RANGE}, name
