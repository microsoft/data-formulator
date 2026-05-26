from __future__ import annotations

from dataclasses import dataclass, field
from typing import List
import re


PROMPT_CONCRETE = "CONCRETE"
PROMPT_PARTIAL = "PARTIAL"
PROMPT_VAGUE = "VAGUE"
PROMPT_OFF_TOPIC = "OFF_TOPIC"


CHART_KEYWORDS = [
    "bar chart",
    "line chart",
    "histogram",
    "heat map",
    "scatter",
    "pie chart",
    "area chart",
    "boxplot",
    "waterfall",
    "biểu đồ cột",
    "biểu đồ đường",
    "biểu đồ",
    "heatmap",
]

SPECIFIC_CHART_KEYWORDS = [
    "bar chart",
    "line chart",
    "histogram",
    "heat map",
    "scatter",
    "pie chart",
    "area chart",
    "boxplot",
    "waterfall",
    "biểu đồ cột",
    "biểu đồ đường",
    "heatmap",
]

VISUAL_INTENT_KEYWORDS = [
    "vẽ",
    "biểu đồ",
    "chart",
    "visualize",
    "plot",
    "phân tích data",
    "analyze data",
    "show me",
]

OFFTOPIC_HINTS = [
    "thời tiết",
    "weather",
    "bạn là ai",
    "who are you",
    "hack",
]


@dataclass
class PromptClassification:
    category: str
    confidence: float
    chart_type_hint: str = ""
    missing_info: List[str] = field(default_factory=list)
    rationale: str = ""


def _contains_any(text: str, keywords: List[str]) -> bool:
    return any(k in text for k in keywords)


def _count_column_hits(text: str, available_columns: List[str] | None) -> int:
    if not available_columns:
        return 0
    hits = 0
    for col in available_columns:
        c = col.strip().lower()
        if len(c) < 2:
            continue
        # Word-boundary-ish match so "b" doesn't match "bar".
        if re.search(rf"(?<![a-z0-9_]){re.escape(c)}(?![a-z0-9_])", text):
            hits += 1
    return hits


def classify_prompt(prompt: str, available_columns: List[str] | None = None) -> PromptClassification:
    text = (prompt or "").strip().lower()
    if not text:
        return PromptClassification(
            category=PROMPT_VAGUE,
            confidence=0.8,
            rationale="Empty prompt treated as vague chart intent.",
        )

    if _contains_any(text, OFFTOPIC_HINTS) and not _contains_any(text, VISUAL_INTENT_KEYWORDS):
        return PromptClassification(
            category=PROMPT_OFF_TOPIC,
            confidence=0.9,
            rationale="Prompt matches off-topic hints and has no chart intent.",
        )

    has_chart_keyword = _contains_any(text, CHART_KEYWORDS)
    has_specific_chart_keyword = _contains_any(text, SPECIFIC_CHART_KEYWORDS)
    has_visual_intent = _contains_any(text, VISUAL_INTENT_KEYWORDS)

    column_hits = _count_column_hits(text, available_columns)

    has_formula_intent = any(k in text for k in ["sum(", "group by", "avg(", "mean(", "x=", "y=", "trục x", "trục y"])

    if has_chart_keyword and (column_hits >= 1 or has_formula_intent):
        return PromptClassification(
            category=PROMPT_CONCRETE,
            confidence=0.9,
            rationale="Chart type and field/formula signals are explicit.",
        )

    if (has_specific_chart_keyword and column_hits == 0) or (not has_chart_keyword and (column_hits >= 1 or has_formula_intent)):
        missing = []
        if not has_chart_keyword:
            missing.append("chart_type")
        if column_hits == 0 and not has_formula_intent:
            missing.append("fields")
        return PromptClassification(
            category=PROMPT_PARTIAL,
            confidence=0.8,
            missing_info=missing,
            rationale="Prompt has partial chart intent but misses key parameters.",
        )

    if has_visual_intent:
        return PromptClassification(
            category=PROMPT_VAGUE,
            confidence=0.8,
            rationale="Prompt asks for charting but lacks concrete details.",
        )

    return PromptClassification(
        category=PROMPT_OFF_TOPIC,
        confidence=0.7,
        rationale="No charting/data-visualization intent detected.",
    )
