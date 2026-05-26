from data_formulator.agents.chart_template_registry import (
    CHART_TEMPLATE_REGISTRY,
    get_drawable_template_names,
    get_template_spec,
    is_encoding_within_template_channels,
)


def test_registry_has_exactly_25_templates():
    assert len(CHART_TEMPLATE_REGISTRY) == 25


def test_drawable_templates_exclude_auto_and_table():
    drawable = get_drawable_template_names()
    assert "Auto" not in drawable
    assert "Table" not in drawable
    assert len(drawable) == 23


def test_qc_templates_have_fixed_channels_and_required():
    qc_trend = get_template_spec("QC Trend Line")
    assert qc_trend is not None
    assert qc_trend.channels == ["QCDATE", "QCSHIFT", "INDEX", "VALUE", "color"]
    assert qc_trend.required == ["QCDATE", "INDEX", "VALUE"]

    qc_hist = get_template_spec("QC Histogram")
    assert qc_hist is not None
    assert qc_hist.channels == ["VALUE", "INDEX", "color"]
    assert qc_hist.required == ["VALUE", "INDEX"]


def test_encoding_must_be_subset_of_template_channels():
    assert is_encoding_within_template_channels("Bar Chart", {"x", "y", "color"}) is True
    assert is_encoding_within_template_channels("Bar Chart", {"x", "y", "foo"}) is False
    assert is_encoding_within_template_channels("Unknown Chart", {"x"}) is False

