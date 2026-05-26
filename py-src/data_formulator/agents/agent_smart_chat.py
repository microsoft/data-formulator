from __future__ import annotations

from dataclasses import dataclass
import difflib
import json
import logging
import re
from typing import List
import unicodedata

from data_formulator.agents.drawable_catalog import DrawableChartEntry

logger = logging.getLogger(__name__)

VALID_ACTIONS = {"draw", "qc_suggest", "suggest", "confirm", "info"}
QC_CHART_NAMES = {"QC Trend Line", "QC Histogram", "QC Trend Bar"}


@dataclass
class SmartChatResult:
    action: str
    message_vi: str
    chart_type_hint: str
    detected_fields: List[str]
    confidence: float
    rationale: str


def _build_catalog_summary(catalog: List[DrawableChartEntry], max_items: int = 8) -> str:
    if not catalog:
        return "(No drawable chart template found for current data.)"
    lines: List[str] = []
    for entry in catalog[:max_items]:
        enc = ", ".join(f"{k}={v}" for k, v in entry.encoding.items())
        lines.append(f"- {entry.chart_type} ({enc}) [confidence={entry.confidence:.2f}]")
    return "\n".join(lines)


def _extract_qc_intent(prompt: str) -> bool:
    text = (prompt or "").lower()
    hints = [
        "qc",
        "quality control",
        "kiem soat chat luong",
        "kiểm soát chất lượng",
        "spc",
    ]
    return any(h in text for h in hints)


def _extract_chart_hint(prompt: str, catalog: List[DrawableChartEntry]) -> str:
    text = (prompt or "")
    normalized_text = _normalize_text(text)
    names = [e.chart_type for e in catalog] + list(QC_CHART_NAMES)

    # 1) Exact name match first
    for name in names:
        if _normalize_text(name) in normalized_text:
            return name

    # 2) Alias/abbreviation map
    aliases = {
        "bar": "Bar Chart",
        "bar chart": "Bar Chart",
        "line": "Line Chart",
        "lin": "Line Chart",
        "line chart": "Line Chart",
        "box": "Boxplot",
        "boxplot": "Boxplot",
        "scatter": "Scatter Plot",
        "scat": "Scatter Plot",
        "hist": "Histogram",
        "histogram": "Histogram",
        "pie": "Pie Chart",
        "pie chart": "Pie Chart",
        "area": "Area Chart",
        "area chart": "Area Chart",
        "heat": "Heat Map",
        "heat map": "Heat Map",
        "waterfall": "Waterfall",
        "rolling": "Rolling Average",
        "radial": "Radial Plot",
        "bubble": "Bubble Plot",
        "regression": "Linear Regression",
        "linear regression": "Linear Regression",
        "loess": "Loess Regression",
        "loes": "Loess Regression",
        "qc trend line": "QC Trend Line",
        "qc histogram": "QC Histogram",
        "qc trend bar": "QC Trend Bar",
        "qc chart": "QC Trend Line",
    }
    tokens = [t for t in re.split(r"[^a-z0-9_]+", normalized_text) if t]
    for ngram_len in (3, 2, 1):
        if len(tokens) < ngram_len:
            continue
        for i in range(len(tokens) - ngram_len + 1):
            key = " ".join(tokens[i : i + ngram_len])
            if key in aliases:
                aliased = aliases[key]
                # Only return charts that are drawable in current catalog
                if any(c.chart_type == aliased for c in catalog) or aliased in QC_CHART_NAMES:
                    return aliased

    # 3) Fuzzy match against available chart names
    normalized_name_map = {_normalize_text(n): n for n in names}
    close = difflib.get_close_matches(
        normalized_text, normalized_name_map.keys(), n=1, cutoff=0.58
    )
    if close:
        return normalized_name_map[close[0]]

    for token in tokens:
        close_token = difflib.get_close_matches(
            token, normalized_name_map.keys(), n=1, cutoff=0.72
        )
        if close_token:
            return normalized_name_map[close_token[0]]

    return ""


def _normalize_text(text: str) -> str:
    t = (text or "").lower().strip()
    t = unicodedata.normalize("NFD", t)
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    return t


def _fallback_result(
    prompt: str,
    columns: List[str],
    domain: str,
    drawable_catalog: List[DrawableChartEntry],
) -> SmartChatResult:
    _ = columns
    text = (prompt or "").strip()
    chart_hint = _extract_chart_hint(text, drawable_catalog)
    qc_intent = _extract_qc_intent(text)
    has_chart_hint = bool(chart_hint)
    has_columns = any(c.lower() in text.lower() for c in columns[:20]) if text else False
    if domain == "generic" and (qc_intent or chart_hint in QC_CHART_NAMES):
        return SmartChatResult(
            action="info",
            message_vi=(
                "Biểu đồ QC cần các cột đặc trưng như TARGET, LL, UL, QCDATE, QCSHIFT. "
                "Dữ liệu hiện tại không phải QC, bạn có thể chọn biểu đồ thay thế bên dưới."
            ),
            chart_type_hint=chart_hint,
            detected_fields=[],
            confidence=0.9,
            rationale="fallback: reject qc chart for generic domain",
        )
    if domain == "qc" and qc_intent and not has_chart_hint:
        return SmartChatResult(
            action="qc_suggest",
            message_vi="Bạn muốn vẽ biểu đồ QC, hãy chọn 1 trong 3 mẫu QC phù hợp bên dưới.",
            chart_type_hint="",
            detected_fields=[],
            confidence=0.8,
            rationale="fallback: qc intent but no specific qc chart",
        )
    if has_chart_hint and (has_columns or chart_hint in QC_CHART_NAMES):
        return SmartChatResult(
            action="draw",
            message_vi="Mình sẽ vẽ theo yêu cầu của bạn.",
            chart_type_hint=chart_hint,
            detected_fields=[],
            confidence=0.75,
            rationale="fallback: chart hint is explicit",
        )
    if has_chart_hint and not has_columns:
        return SmartChatResult(
            action="confirm",
            message_vi="Mình đã hiểu loại biểu đồ, bạn chọn một gợi ý cụ thể để xác định metric và nhóm.",
            chart_type_hint=chart_hint,
            detected_fields=[],
            confidence=0.78,
            rationale="fallback: chart intent detected without explicit fields",
        )
    if has_columns:
        return SmartChatResult(
            action="confirm",
            message_vi="Mình thấy bạn đã nêu các cột chính, hãy chọn kiểu biểu đồ phù hợp nhất.",
            chart_type_hint=chart_hint,
            detected_fields=[],
            confidence=0.7,
            rationale="fallback: columns found but chart not explicit",
        )
    if any(k in text.lower() for k in ["chart", "biểu đồ", "ve ", "vẽ", "plot", "visual"]):
        return SmartChatResult(
            action="suggest",
            message_vi="Dựa trên dữ liệu hiện có, đây là các biểu đồ có thể vẽ ngay.",
            chart_type_hint="",
            detected_fields=[],
            confidence=0.7,
            rationale="fallback: vague visualization intent",
        )
    return SmartChatResult(
        action="info",
        message_vi="Mình hỗ trợ vẽ biểu đồ từ dữ liệu. Bạn có thể mô tả mục tiêu phân tích cụ thể hơn.",
        chart_type_hint="",
        detected_fields=[],
        confidence=0.65,
        rationale="fallback: off-topic",
    )


def _parse_llm_response(raw: str) -> dict:
    text = (raw or "").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _build_system_prompt(columns: List[str], domain: str, catalog_summary: str) -> str:
    qc_guard = (
        "Domain=qc: QC charts can be used.\n"
        "Domain=generic: QC charts (QC Trend Line/QC Histogram/QC Trend Bar) are forbidden. "
        "If requested, you MUST return action='info' with a short explanation."
    )
    return f"""
You are a chart assistant. Decide one action and return JSON only.

Data domain: {domain}
Columns: {columns}
Catalog (already drawable with this data):
{catalog_summary}

Rules:
1) Actions must be one of: draw, qc_suggest, suggest, confirm, info.
2) {qc_guard}
3) draw: user clearly asks specific chart and enough fields/context.
4) qc_suggest: domain=qc and user asks QC chart in general (not specific QC chart).
5) confirm: user provides metric/dimension intent but chart type is unclear.
6) suggest: user is vague but chart-related.
7) info: off-topic, or QC request on generic domain.
8) Keep message_vi natural and short (1-3 sentences), language matching user.
9) chart_type_hint should be exact chart type name when possible, otherwise empty string.

Output JSON schema:
{{
  "action": "draw|qc_suggest|suggest|confirm|info",
  "message_vi": "string",
  "chart_type_hint": "string",
  "detected_fields": ["FIELD1"],
  "confidence": 0.0,
  "rationale": "one short english sentence"
}}
""".strip()


class SmartChatAgent:
    def __init__(self, client):
        self.client = client

    def run(
        self,
        prompt: str,
        columns: List[str],
        domain: str,
        drawable_catalog: List[DrawableChartEntry],
    ) -> SmartChatResult:
        catalog_summary = _build_catalog_summary(drawable_catalog)
        system_prompt = _build_system_prompt(columns, domain, catalog_summary)
        try:
            response = self.client.get_completion(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"User prompt: {prompt}"},
                ]
            )
            raw = response.choices[0].message.content.strip()
            parsed = _parse_llm_response(raw)
            action = str(parsed.get("action", "suggest")).strip().lower()
            if action not in VALID_ACTIONS:
                action = "suggest"
            inferred_hint = _extract_chart_hint(prompt, drawable_catalog)
            llm_hint = str(parsed.get("chart_type_hint", "")).strip()
            final_hint = llm_hint or inferred_hint
            result = SmartChatResult(
                action=action,
                message_vi=str(parsed.get("message_vi", "")).strip(),
                chart_type_hint=final_hint,
                detected_fields=list(parsed.get("detected_fields", [])) if isinstance(parsed.get("detected_fields", []), list) else [],
                confidence=float(parsed.get("confidence", 0.8)),
                rationale=str(parsed.get("rationale", "")).strip(),
            )
            # If user clearly mentions a chart type but LLM action is too vague, escalate to confirm.
            # Exception: keep "info" when user requests a QC chart on generic domain
            # (domain mismatch — the "info" message explains why QC chart can't be drawn).
            is_qc_mismatch = inferred_hint in QC_CHART_NAMES and domain == "generic"
            if inferred_hint and result.action in {"suggest", "info"} and not is_qc_mismatch:
                result.action = "confirm"
            if not result.message_vi:
                result = _fallback_result(prompt, columns, domain, drawable_catalog)
            return result
        except Exception as e:
            logger.warning(f"SmartChatAgent failed, fallback engaged: {e}")
            return _fallback_result(prompt, columns, domain, drawable_catalog)
