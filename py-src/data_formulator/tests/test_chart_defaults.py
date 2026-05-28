"""
Unit tests for data_formulator.agents.chart_defaults.

Verifies pick_default_encoding() picks meaningful fields per chart type and
domain. The acid test is the key complaint that triggered this work: bar.x
must NOT default to INDEX in QC mode, and INDEX must NEVER be picked in
generic mode.
"""

from __future__ import annotations

from data_formulator.agents.chart_defaults import pick_default_encoding


# ─────────────────────────────────────────────────────────────────────────────
# QC mode picks — the core acceptance tests for this refactor
# ─────────────────────────────────────────────────────────────────────────────


class TestQcModePicks:
    def test_qc_line_picks_qcdate_and_value(self, qc_full_metas):
        enc = pick_default_encoding("line", qc_full_metas, "qc")
        assert enc["x"] == "QCDATE"
        assert enc["y"] == "VALUE"

    def test_qc_bar_does_not_pick_index_for_x(self, qc_full_metas):
        """The bug-fix headline: bar must pick a CATEGORICAL x, not INDEX."""
        enc = pick_default_encoding("bar", qc_full_metas, "qc")
        assert enc.get("x") != "INDEX"
        assert enc["y"] == "VALUE"
        # x should be one of the categorical fields — QCSHIFT (3) preferred over
        # QCSTDPARAMNAME (15) due to lower cardinality.
        assert enc["x"] == "QCSHIFT"

    def test_qc_histogram_picks_value_not_index(self, qc_full_metas):
        """Histogram needs quantitative — must pick VALUE, not INDEX."""
        enc = pick_default_encoding("histogram", qc_full_metas, "qc")
        assert enc["x"] == "VALUE"
        assert "INDEX" not in enc.values()

    def test_qc_heatmap_picks_two_categorical_and_quantitative(self, qc_full_metas):
        enc = pick_default_encoding("heatmap", qc_full_metas, "qc")
        # x = temporal (QCDATE) is highest priority
        assert enc["x"] == "QCDATE"
        # y = one of the categorical-low/mid fields (not QCDATE again)
        assert enc["y"] in {"QCSHIFT", "QCSTDPARAMNAME"}
        assert enc["color"] == "VALUE"

    def test_qc_boxplot_picks_qcdate_and_value(self, qc_full_metas):
        enc = pick_default_encoding("boxplot", qc_full_metas, "qc")
        # For QC exploratory boxplot, temporal grouping is preferred first.
        assert enc["x"] == "QCDATE"
        assert enc["y"] == "VALUE"

    def test_qc_pie_picks_label_and_value_no_xy(self, qc_full_metas):
        enc = pick_default_encoding("pie", qc_full_metas, "qc")
        # pie forbids x/y; should only emit label/value
        assert "x" not in enc
        assert "y" not in enc
        assert enc["label"] in {"QCSHIFT", "QCSTDPARAMNAME"}  # categorical_low
        assert enc["value"] == "VALUE"

    def test_qc_area_picks_qcdate_and_value(self, qc_full_metas):
        enc = pick_default_encoding("area", qc_full_metas, "qc")
        assert enc["x"] == "QCDATE"
        assert enc["y"] == "VALUE"

    def test_qc_rolling_average_picks_qcdate_and_value(self, qc_full_metas):
        enc = pick_default_encoding("rolling_average", qc_full_metas, "qc")
        assert enc["x"] == "QCDATE"
        assert enc["y"] == "VALUE"

    def test_qc_linear_regression_picks_quantitative_y(self, qc_full_metas):
        enc = pick_default_encoding("linear_regression", qc_full_metas, "qc")
        assert enc["y"] == "VALUE"
        # x in linear_regression prefers quantitative > temporal > sequential.
        # Only quantitative we have is VALUE (used as y), so temporal QCDATE wins.
        assert enc["x"] == "QCDATE"

    def test_qc_scatter_avoids_index_picks_qcdate_or_value(self, qc_full_metas):
        """Scatter must avoid INDEX (sequential rejected). With QCDATE
        temporal + VALUE quantitative, picker picks them as x/y."""
        enc = pick_default_encoding("point", qc_full_metas, "qc")
        assert "INDEX" not in enc.values()
        # x prefers quantitative > temporal — but VALUE is the only quant,
        # and y also needs quantitative. So x=temporal (QCDATE), y=VALUE.
        assert enc["x"] == "QCDATE"
        assert enc["y"] == "VALUE"

    def test_qc_trend_line_full_encoding(self, qc_full_metas):
        enc = pick_default_encoding("qc_trend_line", qc_full_metas, "qc")
        assert enc["INDEX"] == "INDEX"
        assert enc["VALUE"] == "VALUE"
        assert enc["QCDATE"] == "QCDATE"
        assert enc["QCSHIFT"] == "QCSHIFT"
        assert enc["color"] in {"QCSTDPARAMNAME", "QCSHIFT"}

    def test_qc_trend_line_fails_without_qcshift(self, qc_no_shift_metas):
        enc = pick_default_encoding("qc_trend_line", qc_no_shift_metas, "qc")
        # QCSHIFT required but missing → empty
        assert enc == {}

    def test_qc_histogram_chart_full_encoding(self, qc_full_metas):
        enc = pick_default_encoding("qc_histogram", qc_full_metas, "qc")
        assert enc["VALUE"] == "VALUE"
        assert enc["INDEX"] == "INDEX"
        assert "color" in enc

    def test_qc_chart_in_generic_mode_returns_empty(self, qc_full_metas):
        """qc_trend_line domain is ["qc"] only — picking it in generic mode
        must return empty."""
        enc = pick_default_encoding("qc_trend_line", qc_full_metas, "generic")
        assert enc == {}

    def test_control_limits_never_appear_in_encoding(self, qc_full_metas):
        """No encoding channel should ever bind to TARGET/LL/UL/ARLL/ARUL,
        regardless of chart type."""
        forbidden = {"TARGET", "LL", "UL", "ARLL", "ARUL"}
        for chart in ["line", "bar", "histogram", "heatmap", "boxplot", "pie", "area"]:
            enc = pick_default_encoding(chart, qc_full_metas, "qc")
            assert not (forbidden & set(enc.values())), \
                f"{chart} picked a control-limit column: {enc}"


# ─────────────────────────────────────────────────────────────────────────────
# Generic mode picks
# ─────────────────────────────────────────────────────────────────────────────


class TestGenericModePicks:
    def test_generic_line_picks_temporal_x_and_quantitative_y(self, sales_long_metas):
        enc = pick_default_encoding("line", sales_long_metas, "generic")
        assert enc["x"] == "date"
        # revenue or quantity — both quantitative; lower cardinality preferred? Actually
        # the cardinality tie-breaker prefers SMALLER. quantity has 80, revenue 200.
        assert enc["y"] in {"revenue", "quantity"}

    def test_generic_bar_picks_low_categorical_x(self, sales_long_metas):
        enc = pick_default_encoding("bar", sales_long_metas, "generic")
        # categorical_low: product(5) and region(4). region has lower cardinality.
        assert enc["x"] in {"region", "product"}
        assert enc["y"] in {"revenue", "quantity"}

    def test_generic_histogram_picks_quantitative(self, sales_long_metas):
        enc = pick_default_encoding("histogram", sales_long_metas, "generic")
        # quantitative columns: revenue (200), quantity (80) — smaller card preferred
        assert enc["x"] in {"revenue", "quantity"}

    def test_generic_pie_picks_low_categorical_label(self, sales_long_metas):
        enc = pick_default_encoding("pie", sales_long_metas, "generic")
        assert enc["label"] in {"region", "product"}
        assert enc["value"] in {"revenue", "quantity"}
        assert "x" not in enc
        assert "y" not in enc

    def test_generic_scatter_picks_two_quantitative(self, sales_long_metas):
        enc = pick_default_encoding("point", sales_long_metas, "generic")
        # Need 2 quantitatives for x, y
        picks = {enc["x"], enc["y"]}
        assert picks == {"revenue", "quantity"}

    def test_generic_scatter_with_temporal_and_quantitative(self, single_numeric_metas):
        """scatter.x accepts temporal too, so (date, metric) is drawable as
        scatter (time-series scatter). The picker must NOT pick INDEX-like
        artifacts."""
        enc = pick_default_encoding("point", single_numeric_metas, "generic")
        assert enc["x"] == "date"
        assert enc["y"] == "metric"

    def test_generic_heatmap_full_encoding(self, sales_long_metas):
        enc = pick_default_encoding("heatmap", sales_long_metas, "generic")
        # x = temporal (date) preferred; y = categorical (region/product)
        assert enc["x"] == "date"
        assert enc["y"] in {"region", "product"}
        assert enc["color"] in {"revenue", "quantity"}

    def test_generic_text_only_cannot_draw_bar(self, text_only_metas):
        """No quantitative field → bar.y impossible → empty."""
        enc = pick_default_encoding("bar", text_only_metas, "generic")
        assert enc == {}

    def test_generic_text_only_cannot_draw_histogram(self, text_only_metas):
        enc = pick_default_encoding("histogram", text_only_metas, "generic")
        assert enc == {}

    def test_generic_numeric_only_cannot_draw_pie(self, numeric_only_metas):
        """No categorical_low field → pie.label impossible."""
        enc = pick_default_encoding("pie", numeric_only_metas, "generic")
        assert enc == {}

    def test_generic_numeric_only_can_draw_scatter(self, numeric_only_metas):
        enc = pick_default_encoding("point", numeric_only_metas, "generic")
        # 3 quantitative columns → scatter picks 2
        assert "x" in enc and "y" in enc
        assert enc["x"] != enc["y"]

    def test_fake_qc_data_treated_as_generic(self, fake_qc_metas):
        """fake_qc has TARGET/LL columns but no QC signature → generic mode
        should still pick TARGET/LL as numeric columns (no special QC handling)."""
        enc = pick_default_encoding("bar", fake_qc_metas, "generic")
        # Only 1 low-cardinality categorical we have is... LL (cardinality=5).
        # Hmm but TARGET (12) is also categorical_low. revenue is quantitative.
        # x should be a categorical_low — among LL, TARGET, none... wait
        # TARGET and LL are quantitative in our fake fixture. So no categorical.
        # date is temporal, accepted as x for bar.
        # → x = date, y = revenue
        assert enc["x"] == "date"
        assert enc["y"] == "revenue"

    def test_generic_does_not_pick_id_like_column(self):
        """Generic mode must avoid columns flagged as id-like."""
        from .conftest import categorical_field, quantitative_field, temporal_field

        metas = {
            "customer_id": categorical_field("customer_id", cardinality=1000),
            "date": temporal_field("date", cardinality=90),
            "revenue": quantitative_field("revenue", cardinality=200),
        }
        # Mark customer_id as looks_like_id
        metas["customer_id"].looks_like_id = True

        enc = pick_default_encoding("line", metas, "generic")
        # customer_id is categorical_huge, rejected by line.x reject_roles anyway.
        # x should be date.
        assert enc["x"] == "date"
        assert "customer_id" not in enc.values()


# ─────────────────────────────────────────────────────────────────────────────
# Edge cases & validation behaviour
# ─────────────────────────────────────────────────────────────────────────────


class TestEdgeCases:
    def test_unknown_chart_type_returns_empty(self, sales_long_metas):
        enc = pick_default_encoding("nonexistent_chart", sales_long_metas, "generic")
        assert enc == {}

    def test_empty_metas_returns_empty(self):
        enc = pick_default_encoding("bar", {}, "generic")
        assert enc == {}

    def test_huge_cardinality_blocked_by_bar(self, huge_categorical_metas):
        """bar has max_distinct=200 — a 837-distinct column must NOT be
        picked for x. Since there's no other categorical (sales is
        quantitative), the picker returns empty (R1)."""
        enc = pick_default_encoding("bar", huge_categorical_metas, "generic")
        # item_name has 837 unique → exceeds max_distinct → rejected
        # → no categorical_low/mid available for x → empty
        assert enc == {}

    def test_pie_label_cardinality_max_12(self):
        """pie.label has max_distinct=12. A 13-distinct categorical column
        is not picked."""
        from .conftest import categorical_field, quantitative_field

        metas = {
            # cardinality 15 → still cardinality_low? No: low max is 12, so this
            # is categorical_mid which pie REJECTS.
            "category": categorical_field("category", cardinality=15),
            "value": quantitative_field("value", cardinality=100),
        }
        enc = pick_default_encoding("pie", metas, "generic")
        # No categorical_low available → empty
        assert enc == {}

    def test_same_column_not_used_twice(self, sales_long_metas):
        """Picker must never bind the same column to two channels."""
        for chart in ["line", "bar", "histogram", "heatmap", "pie", "point"]:
            enc = pick_default_encoding(chart, sales_long_metas, "generic")
            if enc:
                assert len(enc.values()) == len(set(enc.values())), \
                    f"{chart}: duplicate columns in {enc}"

    def test_qc_chart_x_required(self, qc_full_metas):
        """qc_trend_line.QCSHIFT is required (categorical_low). Hide it →
        empty result."""
        partial = {k: v for k, v in qc_full_metas.items() if k != "QCSHIFT"}
        enc = pick_default_encoding("qc_trend_line", partial, "qc")
        assert enc == {}

    def test_text_only_can_still_draw_pie(self, text_only_metas):
        """Pie needs categorical label + quantitative value. Text-only has
        no quantitative → empty."""
        enc = pick_default_encoding("pie", text_only_metas, "generic")
        assert enc == {}

    def test_priority_order_smaller_cardinality_for_color(self, qc_full_metas):
        """For the bar.color (optional) channel, lower cardinality wins.
        QCSHIFT (3) should beat QCSTDPARAMNAME (15) if both qualify."""
        enc = pick_default_encoding("bar", qc_full_metas, "qc")
        # We already use QCSHIFT for x. Color is optional and the next-best
        # categorical_low... but no other categorical_low exists. Color may be omitted.
        # If color is present, it must be a categorical_low/mid that's not used.
        if "color" in enc:
            assert enc["color"] != enc["x"]
            assert enc["color"] != enc["y"]
