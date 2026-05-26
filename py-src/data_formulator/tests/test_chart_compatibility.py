"""
Unit tests for data_formulator.agents.chart_compatibility.

Covers:
    - get_field_roles()       — role extraction from FieldMeta
    - check_chart_data_compatibility() — EARLY reject (pre-LLM)
    - validate_chart()        — POST-LLM reject
    - suggest_alternative_charts()

Each reject reason (R1–R4, R6, R7) has dedicated test cases plus several
"valid" cases to confirm the validators don't over-reject.
"""

from __future__ import annotations

from data_formulator.agents.chart_compatibility import (
    check_chart_data_compatibility,
    get_field_roles,
    suggest_alternative_charts,
    validate_chart,
)

from .conftest import (
    categorical_field,
    control_limit_field,
    quantitative_field,
    sequential_field,
    temporal_field,
)


# ─────────────────────────────────────────────────────────────────────────────
# get_field_roles
# ─────────────────────────────────────────────────────────────────────────────


class TestFieldRoles:
    def test_sequential_field_has_sequential_role(self):
        meta = sequential_field("INDEX", 1000)
        roles = get_field_roles(meta)
        assert "sequential" in roles
        # `categorical_huge` is NOT emitted when a primary role like
        # "sequential" already covers the field — otherwise a sequential
        # column would be wrongly excluded by reject lists that target
        # high-cardinality categoricals.
        assert "categorical_huge" not in roles
        assert "quantitative" not in roles

    def test_quantitative_field_has_quantitative_role(self):
        meta = quantitative_field("revenue", 200)
        roles = get_field_roles(meta)
        assert "quantitative" in roles
        assert "categorical" not in roles

    def test_low_categorical_field_has_categorical_low(self):
        meta = categorical_field("shift", 3)
        roles = get_field_roles(meta)
        assert "categorical" in roles
        assert "categorical_low" in roles

    def test_mid_categorical_field_has_categorical_mid(self):
        meta = categorical_field("param", 20)
        roles = get_field_roles(meta)
        assert "categorical" in roles
        assert "categorical_mid" in roles
        assert "categorical_low" not in roles

    def test_high_cardinality_categorical_not_marked_categorical(self):
        meta = categorical_field("item", 300)
        roles = get_field_roles(meta)
        # cardinality_class = "high", is_categorical = False (per builder)
        assert "categorical_high" in roles
        assert "categorical" not in roles

    def test_temporal_field_has_temporal_role(self):
        meta = temporal_field("date", 90)
        roles = get_field_roles(meta)
        assert "temporal" in roles

    def test_control_limit_field_has_control_limit_role(self):
        meta = control_limit_field("TARGET")
        roles = get_field_roles(meta)
        assert "control_limit" in roles


# ─────────────────────────────────────────────────────────────────────────────
# check_chart_data_compatibility — EARLY reject
# ─────────────────────────────────────────────────────────────────────────────


class TestEarlyRejectR1:
    """R1: no_data_fit — required channel has no compatible field."""

    def test_histogram_on_text_only_data_rejects_r1(self, text_only_metas):
        reject = check_chart_data_compatibility("histogram", text_only_metas, "generic")
        assert reject is not None
        assert reject.code == "R1"
        assert reject.short == "no_data_fit"

    def test_bar_on_numeric_only_data_rejects_r1(self, numeric_only_metas):
        """bar.x needs categorical_low/mid/temporal; numeric_only has only
        quantitative → R1."""
        reject = check_chart_data_compatibility("bar", numeric_only_metas, "generic")
        assert reject is not None
        assert reject.code == "R1"

    def test_histogram_on_qc_full_passes(self, qc_full_metas):
        """histogram.x = VALUE (quantitative) → should PASS."""
        reject = check_chart_data_compatibility("histogram", qc_full_metas, "qc")
        assert reject is None

    def test_line_on_qc_full_passes(self, qc_full_metas):
        reject = check_chart_data_compatibility("line", qc_full_metas, "qc")
        assert reject is None


class TestEarlyRejectR2:
    """R2: qc_chart on non-qc data."""

    def test_qc_trend_line_on_sales_data_rejects_r2(self, sales_long_metas):
        reject = check_chart_data_compatibility("qc_trend_line", sales_long_metas, "generic")
        assert reject is not None
        assert reject.code == "R2"
        assert reject.short == "qc_chart_non_qc_data"

    def test_qc_histogram_on_generic_rejects_r2(self, sales_long_metas):
        reject = check_chart_data_compatibility("qc_histogram", sales_long_metas, "generic")
        assert reject is not None
        assert reject.code == "R2"

    def test_qc_trend_bar_on_generic_rejects_r2(self, sales_long_metas):
        reject = check_chart_data_compatibility("qc_trend_bar", sales_long_metas, "generic")
        assert reject is not None
        assert reject.code == "R2"

    def test_qc_chart_on_qc_data_passes(self, qc_full_metas):
        reject = check_chart_data_compatibility("qc_trend_line", qc_full_metas, "qc")
        assert reject is None

    def test_unknown_chart_type_rejects_r2(self, sales_long_metas):
        reject = check_chart_data_compatibility("nonexistent", sales_long_metas, "generic")
        assert reject is not None
        assert reject.code == "R2"
        assert reject.short == "unknown_chart_type"


class TestEarlyRejectR4:
    """R4: wrong_dimensionality — multiple required channels can't be filled."""

    def test_scatter_with_only_categorical_data_rejects(self, text_only_metas):
        """scatter needs quantitative for y; text-only data has none."""
        reject = check_chart_data_compatibility("point", text_only_metas, "generic")
        assert reject is not None
        assert reject.code in ("R1", "R4")

    def test_scatter_with_single_numeric_and_temporal_passes(self, single_numeric_metas):
        """scatter.x accepts temporal too, so (date, metric) is a valid
        time-series scatter — NOT a reject case."""
        reject = check_chart_data_compatibility("point", single_numeric_metas, "generic")
        assert reject is None


class TestEarlyRejectValidCases:
    """Sanity: data + chart that MUST pass."""

    def test_qc_line_passes(self, qc_full_metas):
        assert check_chart_data_compatibility("line", qc_full_metas, "qc") is None

    def test_qc_bar_passes(self, qc_full_metas):
        assert check_chart_data_compatibility("bar", qc_full_metas, "qc") is None

    def test_qc_heatmap_passes(self, qc_full_metas):
        assert check_chart_data_compatibility("heatmap", qc_full_metas, "qc") is None

    def test_qc_trend_line_passes_on_qc(self, qc_full_metas):
        assert check_chart_data_compatibility("qc_trend_line", qc_full_metas, "qc") is None

    def test_generic_line_passes(self, sales_long_metas):
        assert check_chart_data_compatibility("line", sales_long_metas, "generic") is None

    def test_generic_bar_passes(self, sales_long_metas):
        assert check_chart_data_compatibility("bar", sales_long_metas, "generic") is None

    def test_generic_pie_passes(self, sales_long_metas):
        assert check_chart_data_compatibility("pie", sales_long_metas, "generic") is None


# ─────────────────────────────────────────────────────────────────────────────
# validate_chart — POST-LLM reject
# ─────────────────────────────────────────────────────────────────────────────


class TestPostValidateR3:
    """R3: cardinality_explosion — encoding bound to a too-cardinal column."""

    def test_bar_with_huge_categorical_x_rejects_r3(self, huge_categorical_metas):
        """bar.x max_distinct=200; item_name has 837 → R3."""
        encoding = {"x": "item_name", "y": "sales"}
        result = validate_chart("bar", encoding, huge_categorical_metas, "generic")
        assert result.is_valid is False
        assert result.reject.code == "R3"
        assert "item_name" in result.reject.context_columns

    def test_pie_with_too_many_labels_rejects(self):
        """pie.label max_distinct=12; a 50-distinct category triggers reject."""
        metas = {
            "many_cat": categorical_field("many_cat", cardinality=50),
            "val": quantitative_field("val", cardinality=100),
        }
        encoding = {"label": "many_cat", "value": "val"}
        result = validate_chart("pie", encoding, metas, "generic")
        assert result.is_valid is False
        # Could be R1 (role mismatch — mid not in accept_low) or R3 (max
        # cardinality). Both correct semantically; accept either.
        assert result.reject.code in ("R1", "R3")


class TestPostValidateR6:
    """R6: channel_mismatch — forbidden channels emitted."""

    def test_pie_with_x_channel_rejects_r6(self, qc_full_metas):
        encoding = {"x": "QCSHIFT", "y": "VALUE"}
        result = validate_chart("pie", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code == "R6"

    def test_donut_with_y_channel_rejects_r6(self, sales_long_metas):
        encoding = {"label": "region", "value": "revenue", "y": "quantity"}
        result = validate_chart("donut", encoding, sales_long_metas, "generic")
        assert result.is_valid is False
        assert result.reject.code == "R6"

    def test_funnel_with_x_rejects_r6(self, sales_long_metas):
        encoding = {"x": "region", "label": "region", "value": "revenue"}
        result = validate_chart("funnel", encoding, sales_long_metas, "generic")
        assert result.is_valid is False
        assert result.reject.code == "R6"


class TestPostValidateR7:
    """R7: control_limit_in_encoding."""

    def test_line_with_target_y_rejects_r7(self, qc_full_metas):
        encoding = {"x": "QCDATE", "y": "TARGET"}
        result = validate_chart("line", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code == "R7"
        assert "TARGET" in result.reject.context_columns

    def test_bar_with_ll_color_rejects_r7(self, qc_full_metas):
        encoding = {"x": "QCSHIFT", "y": "VALUE", "color": "LL"}
        result = validate_chart("bar", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code == "R7"

    def test_scatter_with_arul_x_rejects_r7(self, qc_full_metas):
        encoding = {"x": "ARUL", "y": "VALUE"}
        result = validate_chart("point", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code == "R7"


class TestPostValidateRoleMismatch:
    """The headline bug fix: certain chart/field combinations must reject."""

    def test_bar_with_index_x_rejects(self, qc_full_metas):
        """bar.x rejects 'sequential' role AND has max_distinct=200. INDEX
        (1000 distinct, sequential) triggers either R3 (cardinality) or R1
        (role mismatch) — both correctly reject."""
        encoding = {"x": "INDEX", "y": "VALUE"}
        result = validate_chart("bar", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code in ("R1", "R3")

    def test_histogram_with_index_x_rejects(self, qc_full_metas):
        """histogram.x rejects 'sequential' — must not allow INDEX."""
        encoding = {"x": "INDEX"}
        result = validate_chart("histogram", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code == "R1"

    def test_heatmap_with_index_x_rejects(self, qc_full_metas):
        encoding = {"x": "INDEX", "y": "QCSHIFT", "color": "VALUE"}
        result = validate_chart("heatmap", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        # Could be R3 (1000 > max_distinct=200) or R1 (sequential rejected).
        assert result.reject.code in ("R1", "R3")

    def test_line_with_categorical_y_rejects(self, qc_full_metas):
        encoding = {"x": "QCDATE", "y": "QCSHIFT"}
        result = validate_chart("line", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code == "R1"

    def test_qc_chart_on_generic_rejects_r2(self, sales_long_metas):
        encoding = {"INDEX": "date", "VALUE": "revenue"}
        result = validate_chart("qc_trend_line", encoding, sales_long_metas, "generic")
        assert result.is_valid is False
        assert result.reject.code == "R2"


class TestPostValidateMissingRequired:
    def test_bar_missing_y_rejects_r4(self, qc_full_metas):
        encoding = {"x": "QCSHIFT"}  # no y
        result = validate_chart("bar", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code in ("R1", "R4")

    def test_pie_missing_value_rejects_r4(self, qc_full_metas):
        encoding = {"label": "QCSHIFT"}  # no value
        result = validate_chart("pie", encoding, qc_full_metas, "qc")
        assert result.is_valid is False
        assert result.reject.code in ("R1", "R4")


class TestPostValidateValidCases:
    """Sanity: realistic valid encodings must pass."""

    def test_qc_line_with_qcdate_value_passes(self, qc_full_metas):
        encoding = {"x": "QCDATE", "y": "VALUE"}
        result = validate_chart("line", encoding, qc_full_metas, "qc")
        assert result.is_valid is True

    def test_qc_bar_with_qcshift_value_passes(self, qc_full_metas):
        encoding = {"x": "QCSHIFT", "y": "VALUE"}
        result = validate_chart("bar", encoding, qc_full_metas, "qc")
        assert result.is_valid is True

    def test_qc_histogram_with_value_passes(self, qc_full_metas):
        encoding = {"x": "VALUE"}
        result = validate_chart("histogram", encoding, qc_full_metas, "qc")
        assert result.is_valid is True

    def test_qc_heatmap_full_passes(self, qc_full_metas):
        encoding = {"x": "QCDATE", "y": "QCSHIFT", "color": "VALUE"}
        result = validate_chart("heatmap", encoding, qc_full_metas, "qc")
        assert result.is_valid is True

    def test_qc_pie_passes(self, qc_full_metas):
        encoding = {"label": "QCSHIFT", "value": "VALUE"}
        result = validate_chart("pie", encoding, qc_full_metas, "qc")
        assert result.is_valid is True

    def test_qc_trend_line_full_passes(self, qc_full_metas):
        encoding = {
            "INDEX": "INDEX",
            "VALUE": "VALUE",
            "QCDATE": "QCDATE",
            "QCSHIFT": "QCSHIFT",
            "color": "QCSTDPARAMNAME",
        }
        result = validate_chart("qc_trend_line", encoding, qc_full_metas, "qc")
        assert result.is_valid is True

    def test_generic_line_passes(self, sales_long_metas):
        encoding = {"x": "date", "y": "revenue"}
        result = validate_chart("line", encoding, sales_long_metas, "generic")
        assert result.is_valid is True

    def test_generic_bar_passes(self, sales_long_metas):
        encoding = {"x": "product", "y": "revenue"}
        result = validate_chart("bar", encoding, sales_long_metas, "generic")
        assert result.is_valid is True

    def test_generic_pie_passes(self, sales_long_metas):
        encoding = {"label": "region", "value": "revenue"}
        result = validate_chart("pie", encoding, sales_long_metas, "generic")
        assert result.is_valid is True

    def test_generic_heatmap_passes(self, sales_long_metas):
        encoding = {"x": "date", "y": "region", "color": "revenue"}
        result = validate_chart("heatmap", encoding, sales_long_metas, "generic")
        assert result.is_valid is True


# ─────────────────────────────────────────────────────────────────────────────
# suggest_alternative_charts
# ─────────────────────────────────────────────────────────────────────────────


class TestSuggestAlternatives:
    def test_suggests_charts_drawable_on_qc_data(self, qc_full_metas):
        suggestions = suggest_alternative_charts(qc_full_metas, "qc")
        assert len(suggestions) > 0
        # All suggestions must be drawable; quick sanity = include some basics
        assert any(c in suggestions for c in {"line", "bar", "histogram", "heatmap"})

    def test_suggests_only_generic_charts_in_generic_mode(self, sales_long_metas):
        suggestions = suggest_alternative_charts(sales_long_metas, "generic")
        # qc_* charts MUST NOT be suggested in generic mode
        assert all(not s.startswith("qc_") for s in suggestions)

    def test_text_only_data_excludes_quantitative_charts(self, text_only_metas):
        suggestions = suggest_alternative_charts(text_only_metas, "generic")
        # No quantitative columns → exclude histogram, scatter, bar, line, area...
        forbidden = {"histogram", "bar", "line", "area", "scatter", "heatmap"}
        # Most quantitative-dependent charts should not appear
        # (some specialty charts might appear if they only need categorical; tolerate that)
        for chart in forbidden:
            assert chart not in suggestions, f"{chart} should not be drawable from text-only data"

    def test_exclude_argument_omits_chart(self, qc_full_metas):
        all_suggestions = suggest_alternative_charts(qc_full_metas, "qc")
        if "line" in all_suggestions:
            filtered = suggest_alternative_charts(qc_full_metas, "qc", exclude="line")
            assert "line" not in filtered
