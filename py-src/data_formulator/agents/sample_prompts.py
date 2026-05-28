from __future__ import annotations

from typing import Dict


SAMPLE_PROMPT_TEMPLATES_VI: Dict[str, str] = {
    "Bar Chart": "Draw a Bar Chart comparing {y} by {x}",
    "Line Chart": "Draw a Line Chart of {y} by {x}",
    "Histogram": "Show the distribution of {x}",
    "Heat Map": "Draw a Heat Map with {x} x {y} colored by {color}",
    "Scatter Plot": "Draw a Scatter Plot of {y} vs {x}",
    "Pie Chart": "Draw a Pie Chart for {theta} share by {color}",
    "QC Trend Line": "Draw a QC Trend Line for VALUE by QCDATE / QCSHIFT",
    "QC Histogram": "Draw a QC Histogram for VALUE distribution",
    "QC Trend Bar": "Draw a QC Trend Bar for VALUE by QCDATE",
}


def generate_sample_prompt(chart_type: str, encoding: Dict[str, str]) -> str:
    template = SAMPLE_PROMPT_TEMPLATES_VI.get(
        chart_type, "Draw {chart_type} with suitable fields"
    )
    if "{chart_type}" in template:
        return template.format(chart_type=chart_type)

    safe_map = dict(encoding)
    for key in ("x", "y", "color", "theta", "VALUE", "QCDATE", "QCSHIFT", "INDEX"):
        safe_map.setdefault(key, key)
    try:
        return template.format(**safe_map)
    except Exception:
        return f"Draw {chart_type} with suggested encodings"

