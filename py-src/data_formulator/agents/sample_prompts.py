from __future__ import annotations

from typing import Dict


SAMPLE_PROMPT_TEMPLATES_VI: Dict[str, str] = {
    "Bar Chart": "Vẽ bar chart so sánh {y} theo {x}",
    "Line Chart": "Vẽ line chart {y} theo {x}",
    "Histogram": "Phân bố giá trị {x}",
    "Heat Map": "Heatmap {x} × {y} với màu {color}",
    "Scatter Plot": "Vẽ scatter {y} theo {x}",
    "Pie Chart": "Vẽ pie chart tỉ trọng {theta} theo {color}",
    "QC Trend Line": "Vẽ QC trend line VALUE theo QCDATE / QCSHIFT",
    "QC Histogram": "Vẽ QC histogram phân bố VALUE",
    "QC Trend Bar": "Vẽ QC trend bar VALUE theo QCDATE",
}


def generate_sample_prompt(chart_type: str, encoding: Dict[str, str]) -> str:
    template = SAMPLE_PROMPT_TEMPLATES_VI.get(
        chart_type, "Vẽ {chart_type} với các trường phù hợp"
    )
    if "{chart_type}" in template:
        return template.format(chart_type=chart_type)

    safe_map = dict(encoding)
    for key in ("x", "y", "color", "theta", "VALUE", "QCDATE", "QCSHIFT", "INDEX"):
        safe_map.setdefault(key, key)
    try:
        return template.format(**safe_map)
    except Exception:
        return f"Vẽ {chart_type} với cấu hình gợi ý"

