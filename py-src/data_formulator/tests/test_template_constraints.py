from data_formulator.agents.chart_compatibility import validate_template_constraints


def test_template_constraints_reject_unknown_chart_type():
    result = validate_template_constraints("donut", {"theta": "value", "color": "label"})
    assert result.is_valid is False
    assert result.reject.code == "R8"


def test_template_constraints_reject_unknown_channel():
    result = validate_template_constraints("Bar Chart", {"x": "a", "y": "b", "foo": "c"})
    assert result.is_valid is False
    assert result.reject.code == "R9"


def test_template_constraints_accept_valid_channels():
    result = validate_template_constraints("bar", {"x": "a", "y": "b", "color": "c"})
    assert result.is_valid is True

