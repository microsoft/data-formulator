from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import re
from typing import Any, Dict, List, Optional

from data_formulator.agents.chart_type_resolver import (
    detect_chart_type,
    is_valid_chart_type,
    to_display,
)
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


def _build_catalog_summary(catalog: List[DrawableChartEntry], max_items: int = 15) -> str:
    """Summarize drawable catalog entries for the LLM."""
    if not catalog:
        return "(No drawable chart template found for current data.)"
    lines: List[str] = []
    for entry in catalog[:max_items]:
        enc = ", ".join(f"{k}={v}" for k, v in entry.encoding.items())
        line = f"- {entry.chart_type} ({enc}) [conf={entry.confidence:.2f}]"
        if entry.rationale_vi:
            line += f" — {entry.rationale_vi}"
        lines.append(line)
    return "\n".join(lines)


def _build_column_profile(field_metas: Dict[str, Any]) -> str:
    """Build a compact column profile for the LLM: type + cardinality + range."""
    if not field_metas:
        return ""
    lines: List[str] = []
    for name, m in field_metas.items():
        # Determine type tag
        if m.is_temporal:
            type_tag = "temporal"
        elif m.is_sequential:
            type_tag = "sequential(index-like)"
        elif m.is_quantitative:
            type_tag = "quantitative"
        elif m.is_categorical:
            type_tag = "categorical"
        else:
            type_tag = getattr(m, "sql_type", "unknown").lower()

        parts = [f"- {name} [{type_tag}]"]
        parts.append(f"cards={m.cardinality}({m.cardinality_class})")

        # Numeric range
        min_v = getattr(m, "min_value", None)
        max_v = getattr(m, "max_value", None)
        if m.is_quantitative and min_v is not None and max_v is not None:
            parts.append(f"range=[{min_v:.2f},{max_v:.2f}]")
            stddev = getattr(m, "stddev", None)
            if stddev is not None:
                parts.append(f"stddev~{stddev:.1f}")

        # QC role (how this column is used in QC charts)
        qc_role = getattr(m, "qc_role", None)
        if qc_role:
            parts.append(f"qc_role={qc_role}")

        sample_vals = getattr(m, "sample_values", [])
        if sample_vals and (m.is_categorical or m.is_temporal):
            vals_str = ", ".join(str(v) for v in sample_vals)
            parts.append(f"values=[{vals_str}]")

        # Usage hint
        if m.is_categorical and m.cardinality_class == "low":
            parts.append("→ ideal for grouping/color")
        elif m.is_categorical and m.cardinality_class == "mid":
            parts.append("→ usable for grouping")
        elif getattr(m, "looks_like_id", False):
            parts.append("⚠ id-like, avoid as axis")

        lines.append(" ".join(parts))

    return "\n".join(lines)


def _build_data_sample_section(sample_rows: List[dict]) -> str:
    if not sample_rows:
        return ""
    cols = list(sample_rows[0].keys())
    header = "| " + " | ".join(cols) + " |"
    separator = "| " + " | ".join(["---"] * len(cols)) + " |"
    rows_md = []
    for row in sample_rows:
        rows_md.append("| " + " | ".join(str(row.get(c, "")) for c in cols) + " |")
    return "\n".join([header, separator] + rows_md)


def _extract_qc_intent(prompt: str) -> bool:
    text = (prompt or "").lower()
    hints = [
        "qc",
        "quality control",
        "spc",
    ]
    return any(h in text for h in hints)


def _extract_chart_hint(prompt: str, catalog: List[DrawableChartEntry]) -> str:
    _ = catalog
    return detect_chart_type(prompt)


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
                "QC charts require columns such as TARGET, LL, UL, QCDATE, and QCSHIFT. "
                "The current data is not QC. Please choose an alternative chart below."
            ),
            chart_type_hint=chart_hint,
            detected_fields=[],
            confidence=0.9,
            rationale="fallback: reject qc chart for generic domain",
        )
    if domain == "qc" and qc_intent and not has_chart_hint:
        return SmartChatResult(
            action="qc_suggest",
            message_vi="You requested a QC chart. Please choose 1 of the 3 suitable QC templates below.",
            chart_type_hint="",
            detected_fields=[],
            confidence=0.8,
            rationale="fallback: qc intent but no specific qc chart",
        )
    if has_chart_hint and (has_columns or chart_hint in QC_CHART_NAMES):
        return SmartChatResult(
            action="draw",
            message_vi="I will draw the chart as requested.",
            chart_type_hint=chart_hint,
            detected_fields=[],
            confidence=0.75,
            rationale="fallback: chart hint is explicit",
        )
    if has_chart_hint and not has_columns:
        return SmartChatResult(
            action="confirm",
            message_vi="I understand the chart type. Please choose a specific suggestion to define metric and grouping.",
            chart_type_hint=chart_hint,
            detected_fields=[],
            confidence=0.78,
            rationale="fallback: chart intent detected without explicit fields",
        )
    if has_columns:
        return SmartChatResult(
            action="confirm",
            message_vi="I see the key columns you mentioned. Please choose the most suitable chart type.",
            chart_type_hint=chart_hint,
            detected_fields=[],
            confidence=0.7,
            rationale="fallback: columns found but chart not explicit",
        )
    if any(k in text.lower() for k in ["chart", "plot", "visual"]):
        return SmartChatResult(
            action="suggest",
            message_vi="Based on the current data, here are charts you can draw right away.",
            chart_type_hint="",
            detected_fields=[],
            confidence=0.7,
            rationale="fallback: vague visualization intent",
        )
    return SmartChatResult(
        action="info",
        message_vi="I can help create charts from your data. Please describe your analysis goal more specifically.",
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


def _build_system_prompt(
    columns: List[str],
    domain: str,
    catalog_summary: str,
    column_profile: str = "",
    data_sample_md: str = "",
) -> str:
    qc_guard = (
        "Domain=qc: QC charts can be used.\n"
        "Domain=generic: QC charts (QC Trend Line/QC Histogram/QC Trend Bar) are forbidden. "
        "If requested, you MUST return action='info' with a short explanation."
    )

    # Use column profile when available instead of only column names.
    col_section = (
        f"Column profiles (name [type] cardinality stats):\n{column_profile}"
        if column_profile
        else f"Columns (names only): {columns}"
    )
    data_sample_section = (
        f"\n=== DATA SAMPLE (representative rows) ===\n{data_sample_md}\n"
        if data_sample_md
        else ""
    )

    return f"""
You are a chart assistant. Decide one action and return JSON only.

Data domain: {domain}
{col_section}
{data_sample_section}

Catalog (drawable charts pre-computed for this data):
{catalog_summary}

Rules:
1) Actions must be one of: draw, qc_suggest, suggest, confirm, info.
2) {qc_guard}
3) draw: user clearly asks a specific chart and enough fields/context are given.
4) qc_suggest: domain=qc and user asks QC chart in general (not a specific QC chart).
5) confirm: user mentions a specific column or metric but chart type is unclear - propose 2-3 fitting charts.
6) suggest: user is vague but chart-related - show diverse options from catalog.
7) info: off-topic, or QC chart request on generic domain.
8) message_vi: natural language in English, 1-3 sentences.
   GOOD: "VALUE is a measurement metric, and QCSHIFT has only 3 categories."
   BAD: "Your prompt is missing information."
9) chart_type_hint: exact chart type name when possible, else empty string.
10) Use column profile to reason about suitability: categorical(low) -> ideal for grouping;
    quantitative -> good for Y-axis; temporal -> time series; sequential(index-like) -> avoid as axis.

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
        field_metas: Optional[Dict[str, Any]] = None,
        sample_rows: Optional[List[dict]] = None,
    ) -> SmartChatResult:
        catalog_summary = _build_catalog_summary(drawable_catalog)
        column_profile = _build_column_profile(field_metas) if field_metas else ""
        data_sample_md = _build_data_sample_section(sample_rows or [])
        system_prompt = _build_system_prompt(
            columns,
            domain,
            catalog_summary,
            column_profile,
            data_sample_md,
        )
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
            llm_hint_raw = str(parsed.get("chart_type_hint", "")).strip()
            llm_hint = to_display(llm_hint_raw) if llm_hint_raw else ""
            if llm_hint and not is_valid_chart_type(llm_hint):
                logger.warning(
                    "SmartChatAgent: invalid LLM chart_type_hint '%s' ignored",
                    llm_hint_raw,
                )
                llm_hint = ""
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
