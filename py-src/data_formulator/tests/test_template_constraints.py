from data_formulator.agents.chart_compatibility import validate_template_constraints


def test_template_constraints_reject_unknown_chart_type():
    result = validate_template_constraints("donut", {"theta": "value", "color": "label"})
    assert result.is_valid is False
    assert result.reject.code == "R8"


def test_template_constraints_auto_drop_unknown_channel_for_non_qc_chart():
    enc = {"x": "a", "y": "b", "foo": "c"}
    result = validate_template_constraints("Bar Chart", enc)
    assert result.is_valid is True
    assert "foo" not in enc


def test_template_constraints_accept_valid_channels():
    result = validate_template_constraints("bar", {"x": "a", "y": "b", "color": "c"})
    assert result.is_valid is True


def test_template_constraints_auto_map_facet_for_non_qc_chart():
    enc = {"x": "a", "y": "b", "facet": "group_col"}
    result = validate_template_constraints("Bar Chart", enc)
    assert result.is_valid is True
    assert "facet" not in enc
    assert ("column" in enc) or ("row" in enc)


def test_template_constraints_qc_chart_remains_strict_no_alias_mapping():
    enc = {"QCDATE": "d", "VALUE": "v", "facet": "f"}
    result = validate_template_constraints("QC Trend Bar", enc)
    assert result.is_valid is False
    assert result.reject.code == "R9"


def test_template_constraints_drop_blank_channel_assignments():
    enc = {"x": "cluster", "y": "pop", "size": ""}
    result = validate_template_constraints("Boxplot", enc)
    assert result.is_valid is True
    assert "size" not in enc
