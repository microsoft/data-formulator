from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, FrozenSet, List, Optional, Tuple

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


def _encoding_key(chart_type: str, encoding: Dict[str, str]) -> FrozenSet:
    """Unique key cho một (chart_type, encoding) combo — dùng để chống duplicate."""
    return frozenset([(chart_type,)] + list(encoding.items()))


def _try_build_entry(
    chart_type: str,
    compat_type: str,
    template: ChartTemplateSpec,
    forced_metas: Dict[str, FieldMeta],
    full_metas: Dict[str, FieldMeta],
    domain: str,
    confidence_scale: float = 1.0,
) -> Optional[DrawableChartEntry]:
    """Thử build một DrawableChartEntry với forced_metas (cho phép force column nào được pick).

    forced_metas: field_metas đã được lọc để ép pick_default_encoding chọn column mong muốn.
    full_metas: dùng để validate và tính confidence (không lọc).
    confidence_scale: nhân vào confidence để đánh dấu variant (thường < 1.0).
    """
    # Compatibility rules for pie/donut use internal channels (label/value),
    # while frontend templates use (color/theta). Bridge these two naming
    # schemes explicitly so catalog generation doesn't drop valid pie charts.
    if compat_type in {"pie", "donut"}:
        encoding_internal = pick_default_encoding(
            compat_type,
            forced_metas,
            domain,
            allowed_channels=["label", "value"],
            required_channels=["label", "value"],
        )
        if not encoding_internal:
            return None
        encoding = {
            "color": encoding_internal.get("label", ""),
            "theta": encoding_internal.get("value", ""),
        }
        encoding = {k: v for k, v in encoding.items() if v}
    elif compat_type == "radial_plot":
        encoding_internal = pick_default_encoding(
            compat_type,
            forced_metas,
            domain,
            allowed_channels=["x", "y"],
            required_channels=["x", "y"],
        )
        if not encoding_internal:
            return None
        encoding = {
            "theta": encoding_internal.get("x", ""),
            "color": encoding_internal.get("y", ""),
        }
        encoding = {k: v for k, v in encoding.items() if v}
    else:
        encoding = pick_default_encoding(
            compat_type,
            forced_metas,
            domain,
            allowed_channels=template.channels,
            required_channels=template.required,
        )
    if not encoding:
        return None
    if not all(ch in encoding for ch in template.required):
        return None

    validation = validate_chart(compat_type, encoding, full_metas, domain)
    if not validation.is_valid:
        if not validation.reject or validation.reject.short != "missing_required_channel":
            return None

    return DrawableChartEntry(
        chart_type=chart_type,
        template_channels=template.channels[:],
        encoding=encoding,
        domain=domain,
        confidence=_compute_confidence(chart_type, encoding, full_metas) * confidence_scale,
        rationale_vi=_explain_choice(chart_type, encoding, full_metas),
        sample_prompt_vi=generate_sample_prompt(chart_type, encoding),
        preview_spec=None,
    )


def _get_categorical_candidates(
    field_metas: Dict[str, FieldMeta],
    exclude: Optional[str] = None,
) -> List[str]:
    """Trả về các cột categorical (low/mid), sắp xếp theo cardinality tăng dần."""
    cols = [
        name for name, meta in field_metas.items()
        if meta.is_categorical
        and meta.qc_role not in ("control_limit",)
        and meta.cardinality_class in ("low", "mid")
        and name != exclude
    ]
    cols.sort(key=lambda n: field_metas[n].cardinality)
    return cols


def _get_quantitative_candidates(
    field_metas: Dict[str, FieldMeta],
    exclude: Optional[str] = None,
) -> List[str]:
    """Trả về các cột quantitative, sắp xếp theo stddev giảm dần (variation cao hơn → ưu tiên)."""
    cols = [
        name for name, meta in field_metas.items()
        if meta.is_quantitative
        and meta.qc_role not in ("control_limit",)
        and name != exclude
    ]
    cols.sort(key=lambda n: -(field_metas[n].stddev or 0.0))
    return cols


def _build_encoding_variants(
    chart_type: str,
    compat_type: str,
    template: ChartTemplateSpec,
    default_encoding: Dict[str, str],
    field_metas: Dict[str, FieldMeta],
    domain: str,
    max_cat_variants: int = 2,
    max_quant_variants: int = 2,
) -> List[DrawableChartEntry]:
    """Sinh các catalog variant bằng cách thay thế cột categorical-x và/hoặc quantitative-y.

    Kỹ thuật: khi muốn force cột A vào slot x, ta xây dựng `forced_metas` chỉ
    chứa cột A trong nhóm categorical (loại bỏ các categorical khác).
    `pick_default_encoding` sẽ không còn lựa chọn nào khác ngoài A cho slot x.
    Tương tự với quantitative y.
    """
    variants: List[DrawableChartEntry] = []

    default_x = default_encoding.get("x")
    default_y = default_encoding.get("y")

    default_x_meta = field_metas.get(default_x) if default_x else None
    default_y_meta = field_metas.get(default_y) if default_y else None

    # ── Variant 1: Thay categorical x ─────────────────────────────────────────
    if default_x_meta and default_x_meta.is_categorical:
        alt_cat_cols = _get_categorical_candidates(field_metas, exclude=default_x)

        for alt_x in alt_cat_cols[:max_cat_variants]:
            # forced_metas: chỉ giữ alt_x trong nhóm categorical
            forced = {
                k: v for k, v in field_metas.items()
                if k == alt_x or not v.is_categorical
            }
            entry = _try_build_entry(
                chart_type, compat_type, template,
                forced_metas=forced, full_metas=field_metas,
                domain=domain, confidence_scale=0.92,
            )
            if entry and entry.encoding.get("x") == alt_x:
                variants.append(entry)

    # ── Variant 2: Thay quantitative y ────────────────────────────────────────
    if default_y_meta and default_y_meta.is_quantitative:
        alt_quant_cols = _get_quantitative_candidates(field_metas, exclude=default_y)

        for alt_y in alt_quant_cols[:max_quant_variants]:
            # forced_metas: chỉ giữ alt_y trong nhóm quantitative
            forced = {
                k: v for k, v in field_metas.items()
                if k == alt_y or not v.is_quantitative
            }
            entry = _try_build_entry(
                chart_type, compat_type, template,
                forced_metas=forced, full_metas=field_metas,
                domain=domain, confidence_scale=0.88,
            )
            if entry and entry.encoding.get("y") == alt_y:
                # Giữ nguyên categorical x từ default encoding nếu có thể
                variants.append(entry)

    return variants


def build_drawable_catalog(
    field_metas: Dict[str, FieldMeta],
    domain: str,
    top_k: Optional[int] = None,
) -> List[DrawableChartEntry]:
    """Build danh sách DrawableChartEntry với full exploration của các column combinations.

    Khác với phiên bản cũ (1 entry/chart_type), phiên bản này:
    - Tạo entry mặc định cho mỗi chart type (best encoding)
    - Tạo thêm variants bằng cách thay categorical x và/hoặc quantitative y
    - Dedup để tránh encoding trùng nhau
    - Tổng số entries: thường 40-80 tùy dataset, so với ~20 trước đây
    """
    entries: List[DrawableChartEntry] = []
    seen: set = set()  # Tập hợp encoding_key để chống duplicate

    for chart_type in get_drawable_template_names():
        template = CHART_TEMPLATE_REGISTRY[chart_type]
        if not _is_template_domain_match(template, domain):
            continue

        compat_type = COMPAT_CHART_TYPE_MAP.get(chart_type)
        if compat_type is None:
            continue

        # ── Default entry ──────────────────────────────────────────────────────
        default_entry = _try_build_entry(
            chart_type, compat_type, template,
            forced_metas=field_metas, full_metas=field_metas,
            domain=domain, confidence_scale=1.0,
        )
        if default_entry is None:
            continue

        key = _encoding_key(chart_type, default_entry.encoding)
        if key not in seen:
            entries.append(default_entry)
            seen.add(key)

        # ── Variant entries (thêm column combinations) ─────────────────────────
        # Chỉ generate variants cho chart types có x và/hoặc y channels
        # (không áp dụng cho QC charts — chúng có fixed field mapping)
        if not chart_type.startswith("QC"):
            variant_entries = _build_encoding_variants(
                chart_type, compat_type, template,
                default_encoding=default_entry.encoding,
                field_metas=field_metas,
                domain=domain,
                max_cat_variants=2,
                max_quant_variants=2,
            )
            for v in variant_entries:
                v_key = _encoding_key(chart_type, v.encoding)
                if v_key not in seen:
                    entries.append(v)
                    seen.add(v_key)

    entries.sort(key=lambda x: x.confidence, reverse=True)
    if top_k is not None:
        return entries[:top_k]
    return entries
