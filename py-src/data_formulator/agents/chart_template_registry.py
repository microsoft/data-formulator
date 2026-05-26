"""
Backend mirror of frontend ChartTemplates.

M1 scope:
- Keep a strict registry of supported chart templates.
- Enforce fixed channels + required channels for each template.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Set


@dataclass(frozen=True)
class ChartTemplateSpec:
    chart_type: str
    channels: List[str]
    required: List[str]
    domain: str  # "generic" | "qc" | "special"


CHART_TEMPLATE_REGISTRY: Dict[str, ChartTemplateSpec] = {
    # Special
    "Auto": ChartTemplateSpec("Auto", [], [], "special"),
    "Table": ChartTemplateSpec("Table", [], [], "special"),
    # Generic
    "Scatter Plot": ChartTemplateSpec(
        "Scatter Plot", ["x", "y", "color", "size", "opacity", "column", "row"], ["x", "y"], "generic"
    ),
    "Linear Regression": ChartTemplateSpec(
        "Linear Regression", ["x", "y", "size", "color", "column"], ["x", "y"], "generic"
    ),
    "Loess Regression": ChartTemplateSpec(
        "Loess Regression", ["x", "y", "size", "color", "column"], ["x", "y"], "generic"
    ),
    "Ranged Dot Plot": ChartTemplateSpec(
        "Ranged Dot Plot", ["x", "y", "color"], ["x", "y"], "generic"
    ),
    "Boxplot": ChartTemplateSpec(
        "Boxplot", ["x", "y", "color", "opacity", "column", "row"], ["x", "y"], "generic"
    ),
    "Bar Chart": ChartTemplateSpec(
        "Bar Chart", ["x", "y", "color", "opacity", "column", "row"], ["x", "y"], "generic"
    ),
    "Pyramid Chart": ChartTemplateSpec(
        "Pyramid Chart", ["x", "y", "color"], ["x", "y"], "generic"
    ),
    "Grouped Bar Chart": ChartTemplateSpec(
        "Grouped Bar Chart", ["x", "y", "color", "column", "row"], ["x", "y", "color"], "generic"
    ),
    "Stacked Bar Chart": ChartTemplateSpec(
        "Stacked Bar Chart", ["x", "y", "color", "column", "row"], ["x", "y", "color"], "generic"
    ),
    "Histogram": ChartTemplateSpec(
        "Histogram", ["x", "y", "color", "column", "row"], ["x"], "generic"
    ),
    "Threshold Bar Chart": ChartTemplateSpec(
        "Threshold Bar Chart", ["x", "y", "threshold"], ["x", "y", "threshold"], "generic"
    ),
    "Line Chart": ChartTemplateSpec(
        "Line Chart", ["x", "y", "color", "column", "row"], ["x", "y"], "generic"
    ),
    "Dotted Line Chart": ChartTemplateSpec(
        "Dotted Line Chart", ["x", "y", "color", "column", "row"], ["x", "y"], "generic"
    ),
    "Rolling Average": ChartTemplateSpec(
        "Rolling Average", ["x", "y", "color", "column", "row"], ["x", "y"], "generic"
    ),
    "Heat Map": ChartTemplateSpec(
        "Heat Map", ["x", "y", "color", "column", "row"], ["x", "y", "color"], "generic"
    ),
    "Pie Chart": ChartTemplateSpec(
        "Pie Chart", ["theta", "color", "text", "column", "row"], ["theta", "color"], "generic"
    ),
    "Radial Plot": ChartTemplateSpec(
        "Radial Plot", ["theta", "color"], ["theta"], "generic"
    ),
    "Bubble Plot": ChartTemplateSpec(
        "Bubble Plot", ["x", "y", "size", "color"], ["x", "y", "size"], "generic"
    ),
    "Area Chart": ChartTemplateSpec(
        "Area Chart", ["x", "y", "x2", "y2", "color", "column", "row"], ["x", "y"], "generic"
    ),
    "Waterfall": ChartTemplateSpec(
        "Waterfall", ["x", "y"], ["x", "y"], "generic"
    ),
    # QC
    "QC Trend Line": ChartTemplateSpec(
        "QC Trend Line", ["QCDATE", "QCSHIFT", "INDEX", "VALUE", "color"], ["QCDATE", "INDEX", "VALUE"], "qc"
    ),
    "QC Histogram": ChartTemplateSpec(
        "QC Histogram", ["VALUE", "INDEX", "color"], ["VALUE", "INDEX"], "qc"
    ),
    "QC Trend Bar": ChartTemplateSpec(
        "QC Trend Bar", ["QCDATE", "QCSHIFT", "VALUE"], ["QCDATE", "VALUE"], "qc"
    ),
}


def get_template_spec(chart_type: str) -> ChartTemplateSpec | None:
    return CHART_TEMPLATE_REGISTRY.get(chart_type)


def get_drawable_template_names() -> List[str]:
    return [name for name in CHART_TEMPLATE_REGISTRY.keys() if name not in {"Auto", "Table"}]


def get_required_channels(chart_type: str) -> List[str]:
    spec = get_template_spec(chart_type)
    return spec.required[:] if spec else []


def is_encoding_within_template_channels(chart_type: str, encoding_keys: Set[str]) -> bool:
    spec = get_template_spec(chart_type)
    if spec is None:
        return False
    allowed = set(spec.channels)
    return encoding_keys.issubset(allowed)

