from __future__ import annotations

import difflib
import re
import unicodedata
from typing import Dict

from data_formulator.agents.chart_template_registry import CHART_TEMPLATE_REGISTRY


_ALIAS_TO_DISPLAY: Dict[str, str] = {
    "bar": "Bar Chart",
    "bar chart": "Bar Chart",
    "line": "Line Chart",
    "lin": "Line Chart",
    "line chart": "Line Chart",
    "scatter": "Scatter Plot",
    "scatter plot": "Scatter Plot",
    "point": "Scatter Plot",
    "hist": "Histogram",
    "histogram": "Histogram",
    "pie": "Pie Chart",
    "pie chart": "Pie Chart",
    "area": "Area Chart",
    "area chart": "Area Chart",
    "heat": "Heat Map",
    "heat map": "Heat Map",
    "heatmap": "Heat Map",
    "box": "Boxplot",
    "boxplot": "Boxplot",
    "waterfall": "Waterfall",
    "rolling": "Rolling Average",
    "rolling average": "Rolling Average",
    "regression": "Linear Regression",
    "linear regression": "Linear Regression",
    "linear_regression": "Linear Regression",
    "loess": "Loess Regression",
    "loess regression": "Loess Regression",
    "rolling_average": "Rolling Average",
    "radial_plot": "Radial Plot",
    "ranged_dot_plot": "Ranged Dot Plot",
    "qc_trend_line": "QC Trend Line",
    "qc_histogram": "QC Histogram",
    "qc_trend_bar": "QC Trend Bar",
    "bubble": "Bubble Plot",
    "bubble plot": "Bubble Plot",
    "radial": "Radial Plot",
    "radial plot": "Radial Plot",
    "group bar": "Grouped Bar Chart",
    "grouped bar": "Grouped Bar Chart",
    "stacked bar": "Stacked Bar Chart",
    "stacked bar chart": "Stacked Bar Chart",
    "threshold": "Threshold Bar Chart",
    "threshold bar chart": "Threshold Bar Chart",
    "dotted line": "Dotted Line Chart",
    "ranged dot plot": "Ranged Dot Plot",
    "dot plot": "Ranged Dot Plot",
    "pyramid chart": "Pyramid Chart",
    "qc trend line": "QC Trend Line",
    "qc histogram": "QC Histogram",
    "qc trend bar": "QC Trend Bar",
    "qc chart": "QC Trend Line",
    # Vietnamese aliases
    "bieu do cot": "Bar Chart",
    "bieu do duong": "Line Chart",
    "bieu do tron": "Pie Chart",
}

_DISPLAY_TO_INTERNAL: Dict[str, str] = {
    "Scatter Plot": "point",
    "Linear Regression": "linear_regression",
    "Loess Regression": "loess",
    "Ranged Dot Plot": "ranged_dot_plot",
    "Boxplot": "boxplot",
    "Bar Chart": "bar",
    "Pyramid Chart": "bar",
    "Grouped Bar Chart": "group_bar",
    "Stacked Bar Chart": "group_bar",
    "Histogram": "histogram",
    "Threshold Bar Chart": "threshold",
    "Line Chart": "line",
    "Dotted Line Chart": "line",
    "Rolling Average": "rolling_average",
    "Heat Map": "heatmap",
    "Pie Chart": "pie",
    "Radial Plot": "radial_plot",
    "Bubble Plot": "bubble",
    "Area Chart": "area",
    "Waterfall": "waterfall",
    "QC Trend Line": "qc_trend_line",
    "QC Trend Bar": "qc_trend_bar",
    "QC Histogram": "qc_histogram",
}

_INTERNAL_TO_DISPLAY: Dict[str, str] = {
    "point": "Scatter Plot",
    "linear_regression": "Linear Regression",
    "loess": "Loess Regression",
    "ranged_dot_plot": "Ranged Dot Plot",
    "boxplot": "Boxplot",
    "bar": "Bar Chart",
    "group_bar": "Grouped Bar Chart",
    "histogram": "Histogram",
    "threshold": "Threshold Bar Chart",
    "line": "Line Chart",
    "rolling_average": "Rolling Average",
    "heatmap": "Heat Map",
    "pie": "Pie Chart",
    "radial_plot": "Radial Plot",
    "bubble": "Bubble Plot",
    "area": "Area Chart",
    "waterfall": "Waterfall",
    "qc_trend_line": "QC Trend Line",
    "qc_trend_bar": "QC Trend Bar",
    "qc_histogram": "QC Histogram",
}


def _normalize_text(text: str) -> str:
    t = (text or "").lower().strip()
    t = unicodedata.normalize("NFD", t)
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    t = t.replace("đ", "d")
    return t


def detect_chart_type(prompt: str) -> str:
    """Detect chart type from free-form prompt and return display name."""
    if not prompt:
        return ""
    text = _normalize_text(prompt)

    normalized_registry_names = {
        _normalize_text(name): name for name in CHART_TEMPLATE_REGISTRY.keys()
    }

    # Exact name match from registry first.
    for normalized_name, display_name in normalized_registry_names.items():
        if normalized_name and normalized_name in text:
            return display_name

    # Alias n-gram match.
    tokens = [t for t in re.split(r"[^a-z0-9_]+", text) if t]
    for ngram_len in (3, 2, 1):
        if len(tokens) < ngram_len:
            continue
        for i in range(len(tokens) - ngram_len + 1):
            key = " ".join(tokens[i : i + ngram_len])
            if key in _ALIAS_TO_DISPLAY:
                candidate = _ALIAS_TO_DISPLAY[key]
                if candidate in CHART_TEMPLATE_REGISTRY:
                    return candidate

    # Conservative fuzzy fallback on individual tokens only, to avoid
    # false positives such as "pareto" -> "area".
    for token in tokens:
        if len(token) < 4:
            continue
        close = difflib.get_close_matches(
            token,
            list(normalized_registry_names.keys()),
            n=1,
            cutoff=0.82,
        )
        if close:
            return normalized_registry_names[close[0]]

    return ""


def to_internal(display_name: str) -> str:
    if not display_name:
        return ""
    name = display_name.strip()
    return _DISPLAY_TO_INTERNAL.get(name, name)


def to_display(internal_name: str) -> str:
    if not internal_name:
        return ""
    name = internal_name.strip()
    return _INTERNAL_TO_DISPLAY.get(name, name)


def is_valid_chart_type(chart_type: str) -> bool:
    if not chart_type:
        return False
    if chart_type in CHART_TEMPLATE_REGISTRY:
        return True
    display = to_display(chart_type)
    return display in CHART_TEMPLATE_REGISTRY
