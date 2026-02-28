# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Tests for data_formulator.workflows.create_vl_plots

These tests exercise Vega-Lite chart spec generation end-to-end:
  - detect_field_type        – field type inference
  - fields_to_encodings      – channel assignment per chart type
  - assemble_vegailte_chart  – spec assembly, type override, structural guarantees
  - create_chart_spec        – high-level helper
  - Renderability            – every generated spec must be convertible to PNG via
                               vl-convert, providing a simple quality gate that
                               catches structurally invalid or degenerate specs.

The test cases are inspired by the TypeScript chart-template library
(src/components/ChartTemplates.tsx) to ensure behavioural parity.
"""

import pytest
import numpy as np
import pandas as pd
import vl_convert as vlc

from data_formulator.workflows.create_vl_plots import (
    CHART_TEMPLATES,
    assemble_vegailte_chart,
    create_chart_spec,
    detect_field_type,
    fields_to_encodings,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture
def sales_df():
    """Sales data: nominal category, ordinal month, quantitative revenue/units."""
    return pd.DataFrame(
        {
            "category": [
                "Electronics",
                "Clothing",
                "Food",
                "Electronics",
                "Clothing",
                "Food",
            ],
            "month": ["Jan", "Jan", "Jan", "Feb", "Feb", "Feb"],
            "revenue": [1200.0, 450.0, 300.0, 1500.0, 520.0, 280.0],
            "units": [10, 25, 50, 12, 30, 45],
        }
    )


@pytest.fixture
def scatter_df():
    """Scatter data: two quantitative axes + nominal colour field."""
    rng = np.random.default_rng(42)
    return pd.DataFrame(
        {
            "x_val": rng.normal(0, 1, 60).tolist(),
            "y_val": rng.normal(0, 1, 60).tolist(),
            "species": ["setosa"] * 20 + ["versicolor"] * 20 + ["virginica"] * 20,
        }
    )


@pytest.fixture
def timeseries_df():
    """Time-series data: temporal x, quantitative y, nominal series."""
    dates = pd.date_range("2023-01", periods=12, freq="MS")
    rng = np.random.default_rng(0)
    return pd.DataFrame(
        {
            "date": list(dates) * 2,
            "value": rng.integers(100, 500, 24).tolist(),
            "series": ["A"] * 12 + ["B"] * 12,
        }
    )


@pytest.fixture
def heatmap_df():
    """Heatmap data: two nominal/ordinal axes + quantitative colour."""
    rng = np.random.default_rng(3)
    rows = [
        {"day": day, "hour": hour, "count": int(rng.integers(0, 100))}
        for day in ["Mon", "Tue", "Wed", "Thu", "Fri"]
        for hour in range(8, 18)
    ]
    return pd.DataFrame(rows)


@pytest.fixture
def boxplot_df():
    """Boxplot data: nominal x, quantitative y."""
    rng = np.random.default_rng(7)
    return pd.DataFrame(
        {
            "group": ["A"] * 20 + ["B"] * 20 + ["C"] * 20,
            "value": rng.normal(0, 1, 60).tolist(),
        }
    )


# ── detect_field_type ─────────────────────────────────────────────────────────


class TestDetectFieldType:
    def test_quantitative_continuous(self):
        s = pd.Series(range(100), dtype=float)
        assert detect_field_type(s) == "quantitative"

    def test_ordinal_small_cardinality(self):
        # 5 unique values out of 50 total → ratio = 0.1 < 0.5  ⇒ ordinal
        s = pd.Series([1, 2, 3, 4, 5] * 10)
        assert detect_field_type(s) == "ordinal"

    def test_temporal(self):
        s = pd.to_datetime(pd.Series(["2023-01-01", "2023-02-01", "2023-03-01"]))
        assert detect_field_type(s) == "temporal"

    def test_nominal_string(self):
        s = pd.Series(["apple", "banana", "cherry"])
        assert detect_field_type(s) == "nominal"

    def test_boolean(self):
        s = pd.Series([True, False, True, False])
        assert detect_field_type(s) == "nominal"


# ── fields_to_encodings ───────────────────────────────────────────────────────


class TestFieldsToEncodings:
    def test_bar_x_categorical_y_quantitative(self, sales_df):
        enc = fields_to_encodings(sales_df, "bar", ["category", "revenue"])
        assert enc.get("x", {}).get("field") == "category"
        assert enc.get("y", {}).get("field") == "revenue"

    def test_scatter_two_quantitative_axes(self, scatter_df):
        enc = fields_to_encodings(scatter_df, "point", ["x_val", "y_val"])
        assert "x" in enc and "y" in enc
        x_field = enc["x"]["field"]
        y_field = enc["y"]["field"]
        assert x_field in ("x_val", "y_val")
        assert y_field in ("x_val", "y_val")
        assert x_field != y_field

    def test_line_temporal_on_x(self, timeseries_df):
        enc = fields_to_encodings(timeseries_df, "line", ["date", "value"])
        assert enc.get("x", {}).get("field") == "date"
        assert enc.get("y", {}).get("field") == "value"

    def test_heatmap_assigns_color_to_quantitative(self, heatmap_df):
        enc = fields_to_encodings(heatmap_df, "heatmap", ["day", "hour", "count"])
        assert "x" in enc and "y" in enc and "color" in enc
        # The quantitative field 'count' should be the colour channel
        assert enc["color"]["field"] == "count"

    def test_boxplot_categorical_x(self, boxplot_df):
        enc = fields_to_encodings(boxplot_df, "boxplot", ["group", "value"])
        assert enc.get("x", {}).get("field") == "group"
        assert enc.get("y", {}).get("field") == "value"

    def test_empty_fields_returns_empty(self, sales_df):
        assert fields_to_encodings(sales_df, "bar", []) == {}

    def test_unknown_chart_type_returns_empty(self, sales_df):
        assert fields_to_encodings(sales_df, "unknown_chart", ["category"]) == {}


# ── assemble_vegailte_chart ───────────────────────────────────────────────────


class TestAssembleVegaliteChart:
    def test_basic_spec_structure(self, sales_df):
        encodings = {"x": {"field": "category"}, "y": {"field": "revenue"}}
        spec = assemble_vegailte_chart(sales_df, "bar", encodings)
        assert spec["mark"] == "bar"
        assert "encoding" in spec
        assert "values" in spec["data"]
        assert len(spec["data"]["values"]) == len(sales_df)

    def test_respects_type_override_in_encoding_input(self, heatmap_df):
        """A 'type' key inside encoding_input must override detect_field_type."""
        encodings = {
            # 'hour' is numeric; we explicitly request nominal treatment
            "x": {"field": "hour", "type": "nominal"},
            "y": {"field": "day"},
            "color": {"field": "count"},
        }
        spec = assemble_vegailte_chart(heatmap_df, "heatmap", encodings)
        assert spec["encoding"]["x"]["type"] == "nominal", (
            "assemble_vegailte_chart must honour the 'type' supplied in encoding input"
        )

    def test_heatmap_axes_are_nominal(self, heatmap_df):
        """Heatmap x and y must be nominal – mirrors the TypeScript postProcessor."""
        encodings = fields_to_encodings(heatmap_df, "heatmap", ["day", "hour", "count"])
        spec = assemble_vegailte_chart(heatmap_df, "heatmap", encodings)
        assert spec["encoding"]["x"]["type"] == "nominal", (
            "heatmap x axis must be nominal"
        )
        assert spec["encoding"]["y"]["type"] == "nominal", (
            "heatmap y axis must be nominal"
        )

    def test_group_bar_has_xoffset(self, sales_df):
        """Grouped bar chart must include xOffset – mirrors the TypeScript postProcessor."""
        encodings = {
            "x": {"field": "category"},
            "y": {"field": "revenue"},
            "color": {"field": "month"},
        }
        spec = assemble_vegailte_chart(sales_df, "group_bar", encodings)
        assert "xOffset" in spec["encoding"], (
            "group_bar chart must include xOffset encoding"
        )
        assert spec["encoding"]["xOffset"]["field"] == "month"

    def test_column_without_row_becomes_facet(self, sales_df):
        """A standalone 'column' encoding must be converted to 'facet'."""
        encodings = {
            "x": {"field": "category"},
            "y": {"field": "revenue"},
            "column": {"field": "month"},
        }
        spec = assemble_vegailte_chart(sales_df, "bar", encodings)
        assert "facet" in spec["encoding"], (
            "column encoding without row should become facet"
        )
        assert "column" not in spec["encoding"]

    def test_unknown_chart_type_raises(self, sales_df):
        with pytest.raises(ValueError, match="not found"):
            assemble_vegailte_chart(
                sales_df, "no_such_chart", {"x": {"field": "category"}}
            )

    def test_missing_field_skipped_gracefully(self, sales_df):
        """Fields absent from the dataframe must be silently skipped."""
        encodings = {"x": {"field": "category"}, "y": {"field": "nonexistent"}}
        spec = assemble_vegailte_chart(sales_df, "bar", encodings)
        # 'nonexistent' should not appear in the encoding
        assert "y" not in spec["encoding"] or spec["encoding"]["y"]["field"] != "nonexistent"


# ── Vega-Lite renderability (end-to-end quality gate) ────────────────────────


def _assert_renderable(spec: dict, label: str = "") -> None:
    """Assert that a spec renders to a non-trivial PNG via vl-convert."""
    png = vlc.vegalite_to_png(spec, scale=1.0)
    assert len(png) > 500, (
        f"Rendered PNG is suspiciously small ({len(png)} bytes)"
        + (f" for {label}" if label else "")
        + " – the chart may be empty or invalid"
    )


class TestVegaliteRenderability:
    """Every chart type must produce a spec that vl-convert can render."""

    def test_bar_chart_renders(self, sales_df):
        spec = create_chart_spec(sales_df, ["category", "revenue"], "bar")
        _assert_renderable(spec, "bar")

    def test_point_chart_renders(self, scatter_df):
        spec = create_chart_spec(scatter_df, ["x_val", "y_val"], "point")
        _assert_renderable(spec, "point")

    def test_line_chart_renders(self, timeseries_df):
        spec = create_chart_spec(timeseries_df, ["date", "value"], "line")
        _assert_renderable(spec, "line")

    def test_area_chart_renders(self, timeseries_df):
        spec = create_chart_spec(timeseries_df, ["date", "value"], "area")
        _assert_renderable(spec, "area")

    def test_heatmap_renders(self, heatmap_df):
        spec = create_chart_spec(heatmap_df, ["day", "hour", "count"], "heatmap")
        _assert_renderable(spec, "heatmap")

    def test_boxplot_renders(self, boxplot_df):
        spec = create_chart_spec(boxplot_df, ["group", "value"], "boxplot")
        _assert_renderable(spec, "boxplot")

    def test_group_bar_renders(self, sales_df):
        spec = create_chart_spec(sales_df, ["category", "revenue", "month"], "group_bar")
        _assert_renderable(spec, "group_bar")

    def test_point_with_color_renders(self, scatter_df):
        spec = create_chart_spec(scatter_df, ["x_val", "y_val", "species"], "point")
        _assert_renderable(spec, "point+color")


# ── create_chart_spec (high-level) ────────────────────────────────────────────


class TestCreateChartSpec:
    def test_all_chart_types_produce_valid_spec(self, sales_df):
        """Every template in CHART_TEMPLATES must return a renderable spec."""
        for template in CHART_TEMPLATES:
            chart_type = template["chart"]
            spec = create_chart_spec(sales_df, list(sales_df.columns), chart_type)
            assert isinstance(spec, dict), f"'{chart_type}' did not return a dict"
            assert "mark" in spec, f"'{chart_type}' spec missing 'mark'"
            assert "encoding" in spec, f"'{chart_type}' spec missing 'encoding'"
            _assert_renderable(spec, chart_type)

    def test_nonexistent_field_ignored(self, sales_df):
        """Fields absent from the dataframe must not cause a crash."""
        spec = create_chart_spec(sales_df, ["category", "nonexistent"], "bar")
        assert isinstance(spec, dict)
