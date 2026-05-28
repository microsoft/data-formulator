from __future__ import annotations

import pytest

from data_formulator.agents.chart_type_resolver import (
    detect_chart_type,
    is_valid_chart_type,
    to_display,
    to_internal,
)


@pytest.mark.parametrize(
    "prompt,expected",
    [
        ("Vẽ bar chart doanh thu", "Bar Chart"),
        ("draw a scatter plot", "Scatter Plot"),
        ("lin", "Line Chart"),
        ("biểu đồ cột theo tháng", "Bar Chart"),
        ("Draw Linear Regression: X vs Y", "Linear Regression"),
        ("QC Trend Line VALUE theo QCSHIFT", "QC Trend Line"),
        ("hôm nay trời thế nào", ""),
        ("vẽ pareto chart", ""),
    ],
)
def test_detect_chart_type(prompt, expected):
    assert detect_chart_type(prompt) == expected


def test_internal_display_roundtrip():
    assert to_internal("Bar Chart") == "bar"
    assert to_display("linear_regression") == "Linear Regression"


def test_is_valid_chart_type():
    assert is_valid_chart_type("Bar Chart") is True
    assert is_valid_chart_type("bar") is True
    assert is_valid_chart_type("Pareto Chart") is False

