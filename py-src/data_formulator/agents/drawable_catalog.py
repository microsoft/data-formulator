from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from data_formulator.agents.chart_compatibility import validate_chart
from data_formulator.agents.chart_defaults import pick_default_encoding
from data_formulator.agents.chart_template_registry import (
    CHART_TEMPLATE_REGISTRY,
    ChartTemplateSpec,
    get_drawable_template_names,
)
from data_formulator.agents.field_metadata import FieldMeta
from data_formulator.agents.sample_prompts import generate_sample_prompt


@dataclass
class DrawableChartEntry:
    chart_type: str
    template_channels: List[str]
    encoding: Dict[str, str]
    domain: str
    confidence: float
    rationale_vi: str
    sample_prompt_vi: str
    preview_spec: Optional[dict] = None


COMPAT_CHART_TYPE_MAP: Dict[str, str] = {
    "Scatter Plot": "point",
    "Linear Regression": "linear_regression",
    "Loess Regression": "linear_regression",
    "Ranged Dot Plot": "point",
    "Boxplot": "boxplot",
    "Bar Chart": "bar",
    "Pyramid Chart": "bar",
    "Grouped Bar Chart": "group_bar",
    "Stacked Bar Chart": "group_bar",
    "Histogram": "histogram",
    "Threshold Bar Chart": "bar",
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
    "QC Histogram": "qc_histogram",
    "QC Trend Bar": "qc_trend_bar",
}


def _compute_confidence(chart_type: str, encoding: Dict[str, str], field_metas: Dict[str, FieldMeta]) -> float:
    score = 0.7
    x_field = encoding.get("x")
    if x_field and x_field in field_metas and field_metas[x_field].is_temporal:
        if chart_type in {"Line Chart", "Area Chart", "Rolling Average"}:
            score += 0.2
    if chart_type.startswith("QC"):
        score += 0.2
    return min(score, 1.0)


def _explain_choice(chart_type: str, encoding: Dict[str, str], field_metas: Dict[str, FieldMeta]) -> str:
    keys = ", ".join(f"{k}={v}" for k, v in encoding.items())
    return f"Gợi ý {chart_type} vì data phù hợp với kênh: {keys}."


def _is_template_domain_match(template: ChartTemplateSpec, domain: str) -> bool:
    if template.domain == "special":
        return False
    if template.domain == "qc":
        return domain == "qc"
    return domain in ("generic", "qc")


def build_drawable_catalog(
    field_metas: Dict[str, FieldMeta],
    domain: str,
    top_k: Optional[int] = None,
) -> List[DrawableChartEntry]:
    entries: List[DrawableChartEntry] = []

    for chart_type in get_drawable_template_names():
        template = CHART_TEMPLATE_REGISTRY[chart_type]
        if not _is_template_domain_match(template, domain):
            continue

        compat_type = COMPAT_CHART_TYPE_MAP.get(chart_type)
        if compat_type is None:
            continue

        encoding = pick_default_encoding(
            compat_type,
            field_metas,
            domain,
            allowed_channels=template.channels,
            required_channels=template.required,
        )
        if not encoding:
            continue

        if not all(ch in encoding for ch in template.required):
            continue

        validation = validate_chart(compat_type, encoding, field_metas, domain)
        if not validation.is_valid:
            # Compatibility spec can be stricter than template required channels
            # (notably QC charts). Keep template-valid entries and let later
            # pipeline stages enforce stricter checks where needed.
            if not validation.reject or validation.reject.short != "missing_required_channel":
                continue

        entries.append(
            DrawableChartEntry(
                chart_type=chart_type,
                template_channels=template.channels[:],
                encoding=encoding,
                domain=domain,
                confidence=_compute_confidence(chart_type, encoding, field_metas),
                rationale_vi=_explain_choice(chart_type, encoding, field_metas),
                sample_prompt_vi=generate_sample_prompt(chart_type, encoding),
                preview_spec=None,
            )
        )

    entries.sort(key=lambda x: x.confidence, reverse=True)
    if top_k is not None:
        return entries[:top_k]
    return entries
