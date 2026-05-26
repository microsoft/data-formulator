"""
Chart compatibility knowledge base and validation.

This module declares the rules each chart type imposes on its encoding channels,
expressed in terms of FieldMeta-derived roles (temporal/sequential/quantitative/
categorical_low/...). Three public functions consume the knowledge base:

    get_field_roles(meta)                 — translate a FieldMeta into a role set
    check_chart_data_compatibility(...)   — EARLY reject: can chart be drawn at
                                            all from this data? (no LLM call)
    validate_chart(...)                   — POST-LLM reject: does the LLM's
                                            encoding choice make sense?

Reject codes (see KEHOACH_SUA_CHART_RECOMMENDATION.md section 6):
    R1 no_data_fit
    R2 qc_chart_non_qc_data
    R3 cardinality_explosion
    R4 wrong_dimensionality
    R6 channel_mismatch
    R7 control_limit_in_encoding

R5 (duplicate_keys) requires a DuckDB query against actual rows and is checked
separately at SQL-execution time, not here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

from data_formulator.agents.field_metadata import FieldMeta


# ─────────────────────────────────────────────────────────────────────────────
# Dataclasses
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ChannelSpec:
    """Constraints for a single encoding channel of a chart."""

    required: bool
    accept_roles: List[str]
    reject_roles: List[str] = field(default_factory=list)
    # Roles ordered most-preferred-first; the picker uses this to break ties.
    soft_priority: List[str] = field(default_factory=list)
    # Cardinality bounds for the field bound to this channel.
    min_distinct: int = 0
    max_distinct: Optional[int] = None


@dataclass
class ChartSpec:
    """Full constraint set for one chart type."""

    # Which domain(s) the chart is valid in. QC-specific charts list ["qc"]
    # only, so picking them in generic mode raises R2.
    domain: List[str]
    channels: Dict[str, ChannelSpec]
    # Channels the LLM must NOT emit (pie/donut emitting x/y → R6).
    forbidden_channels: List[str] = field(default_factory=list)


@dataclass
class RejectInfo:
    """A structured rejection for a single chart attempt."""

    code: str              # "R1" .. "R7"
    short: str             # short machine-readable tag
    message_vi: str        # Vietnamese user-facing message
    context_columns: List[str] = field(default_factory=list)
    suggested_chart_types: List[str] = field(default_factory=list)
    suggested_actions: List[str] = field(default_factory=list)


@dataclass
class ValidationResult:
    is_valid: bool
    reject: Optional[RejectInfo] = None


# ─────────────────────────────────────────────────────────────────────────────
# Shared agent-pipeline helpers
#
# These are the bits that BOTH agent_sql_data_rec and agent_py_data_rec need
# during the early-reject / post-validate pipeline. Centralized here so the
# two agents stay in sync (single source of truth for the env var name, the
# response shape, and the prompt hint format).
# ─────────────────────────────────────────────────────────────────────────────


def strict_validation_enabled() -> bool:
    """Feature flag for the chart-compatibility pipeline (early reject +
    post-validate). Default ON; setting ENABLE_STRICT_CHART_VALIDATION=false
    disables both branches and restores legacy behavior — used for rollback.
    """
    return os.environ.get("ENABLE_STRICT_CHART_VALIDATION", "true").lower() in ("1", "true", "yes")


def reject_info_to_response(
    reject: RejectInfo,
    *,
    agent_name: str,
    messages: Optional[List[dict]] = None,
) -> dict:
    """Serialize a RejectInfo into the agent-result dict the route returns.

    The shape matches what the frontend expects: status="rejected_incompatible"
    plus a flat `reject` block with reason code, Vietnamese message, and
    suggested alternatives.
    """
    return {
        "status": "rejected_incompatible",
        "agent": agent_name,
        "reject": {
            "reason_code": reject.code,
            "reason_short": reject.short,
            "message_vi": reject.message_vi,
            "context_columns": list(reject.context_columns),
            "suggested_chart_types": list(reject.suggested_chart_types),
            "suggested_actions": list(reject.suggested_actions),
        },
        "code": "",
        "content": None,
        "refined_goal": {
            "mode": "",
            "recommendation": reject.message_vi,
            "output_fields": [],
            "chart_encodings": {},
            "chart_type": "",
        },
        "dialog": list(messages or []),
    }


def format_field_metadata_hint(field_metas: Dict[str, FieldMeta]) -> str:
    """Render a FieldMeta dict as a compact role-hint block for the LLM prompt.

    Each line:
        `  COLUMN: role1 | role2 | ...  (cardinality=N, type=SQL_TYPE)`

    The intent: the model picks fields by SEMANTIC ROLE (matching the RULE #4
    table in the system prompt) rather than by hardcoded name patterns. This
    is what lets the picker generalize beyond the QC column names
    (INDEX/VALUE/QCSTDPARAMNAME) to any input schema.
    """
    if not field_metas:
        return ""

    lines = ["**[COLUMN ROLES — pick fields by ROLE, not by name]**"]
    for name, meta in field_metas.items():
        role_parts = []
        if meta.is_temporal:
            role_parts.append("temporal")
        if meta.is_sequential:
            role_parts.append("sequential")
        if meta.is_quantitative:
            role_parts.append("quantitative")
        if meta.is_categorical:
            role_parts.append(f"categorical_{meta.cardinality_class}")
        if not role_parts:
            # No primary role — surface cardinality class so the LLM still
            # has something to reason about (typically id-like high-card strings).
            role_parts.append(f"other_{meta.cardinality_class}")

        if meta.qc_role == "control_limit":
            role_parts.append("⚠CONTROL_LIMIT(do_not_encode)")
        elif meta.qc_role:
            role_parts.append(f"qc={meta.qc_role}")
        if meta.looks_like_id:
            role_parts.append("id_like")

        roles_str = " | ".join(role_parts)
        lines.append(
            f"  {name}: {roles_str}  (cardinality={meta.cardinality}, type={meta.sql_type})"
        )
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Role extraction
# ─────────────────────────────────────────────────────────────────────────────


def get_field_roles(meta: FieldMeta) -> Set[str]:
    """Translate a FieldMeta into a set of role tags used in accept/reject lists.

    A field can have multiple roles (e.g. a boolean column is both
    `categorical` and `categorical_low`). The matching rule is set membership:
    a channel accepts a field if at least one of its `accept_roles` is in the
    field's role set, and rejects if any `reject_roles` is in it.
    """
    roles: Set[str] = set()

    if meta.is_temporal:
        roles.add("temporal")
    if meta.is_sequential:
        roles.add("sequential")
    if meta.is_quantitative:
        roles.add("quantitative")
    if meta.is_categorical:
        roles.add("categorical")
        if meta.cardinality_class == "low":
            roles.add("categorical_low")
        elif meta.cardinality_class == "mid":
            roles.add("categorical_mid")

    # Anti-roles for high/huge cardinality fields that have NO other semantic
    # role — typically ID-like strings (e.g. ITEMNAME with 300 distinct).
    # We don't mark a quantitative or temporal column as categorical_high
    # even if its cardinality is high, because that would cause it to be
    # rejected by trend charts that legitimately want it on the x-axis.
    has_primary_role = (
        meta.is_temporal or meta.is_sequential
        or meta.is_quantitative or meta.is_categorical
    )
    if not has_primary_role:
        if meta.cardinality_class == "high":
            roles.add("categorical_high")
        elif meta.cardinality_class == "huge":
            roles.add("categorical_huge")

    if meta.qc_role == "control_limit":
        roles.add("control_limit")
    if meta.looks_like_id:
        roles.add("id_like")

    return roles


# ─────────────────────────────────────────────────────────────────────────────
# CHART_REQUIREMENTS — the declarative knowledge base
# ─────────────────────────────────────────────────────────────────────────────


# Reusable role bundles to keep the table below readable.
_TREND_X_ACCEPT = ["temporal", "sequential", "quantitative"]
_TREND_X_REJECT = ["categorical_high", "categorical_huge", "control_limit"]
_QUANTITATIVE_Y_ACCEPT = ["quantitative"]
_QUANTITATIVE_Y_REJECT = ["sequential", "categorical", "control_limit"]
_LOW_COLOR_ACCEPT = ["categorical_low", "categorical_mid"]
_LOW_COLOR_REJECT = ["categorical_high", "categorical_huge", "quantitative", "control_limit"]

_CATEGORICAL_X_ACCEPT = ["categorical_low", "categorical_mid", "temporal"]
_CATEGORICAL_X_REJECT = ["sequential", "categorical_huge", "quantitative", "control_limit"]


CHART_REQUIREMENTS: Dict[str, ChartSpec] = {
    # ── Group A: trend over an ordered axis ────────────────────────────────
    "line": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_TREND_X_ACCEPT,
                reject_roles=_TREND_X_REJECT,
                soft_priority=["temporal", "sequential", "quantitative"],
                min_distinct=2,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=_QUANTITATIVE_Y_ACCEPT,
                reject_roles=_QUANTITATIVE_Y_REJECT,
            ),
            "color": ChannelSpec(
                required=False,
                accept_roles=_LOW_COLOR_ACCEPT,
                reject_roles=_LOW_COLOR_REJECT,
            ),
        },
    ),
    "area": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_TREND_X_ACCEPT,
                reject_roles=_TREND_X_REJECT,
                soft_priority=["temporal", "sequential", "quantitative"],
                min_distinct=2,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=_QUANTITATIVE_Y_ACCEPT,
                reject_roles=_QUANTITATIVE_Y_REJECT,
            ),
            "color": ChannelSpec(
                required=False,
                accept_roles=_LOW_COLOR_ACCEPT,
                reject_roles=_LOW_COLOR_REJECT,
            ),
        },
    ),
    "rolling_average": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_TREND_X_ACCEPT,
                reject_roles=_TREND_X_REJECT,
                soft_priority=["temporal", "sequential", "quantitative"],
                min_distinct=2,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=_QUANTITATIVE_Y_ACCEPT,
                reject_roles=_QUANTITATIVE_Y_REJECT,
            ),
        },
    ),
    "linear_regression": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_TREND_X_ACCEPT,
                reject_roles=_TREND_X_REJECT,
                soft_priority=["quantitative", "temporal", "sequential"],
                min_distinct=2,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=_QUANTITATIVE_Y_ACCEPT,
                reject_roles=_QUANTITATIVE_Y_REJECT,
            ),
            "color": ChannelSpec(
                required=False,
                accept_roles=_LOW_COLOR_ACCEPT,
                reject_roles=_LOW_COLOR_REJECT,
            ),
        },
    ),

    # ── Group B: compare across categories ─────────────────────────────────
    "bar": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_CATEGORICAL_X_ACCEPT,
                reject_roles=_CATEGORICAL_X_REJECT,
                soft_priority=["categorical_low", "temporal", "categorical_mid"],
                max_distinct=200,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=_QUANTITATIVE_Y_ACCEPT,
                reject_roles=_QUANTITATIVE_Y_REJECT,
            ),
            "color": ChannelSpec(
                required=False,
                accept_roles=_LOW_COLOR_ACCEPT,
                reject_roles=["categorical_huge", "control_limit"],
            ),
        },
    ),
    "group_bar": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_CATEGORICAL_X_ACCEPT,
                reject_roles=_CATEGORICAL_X_REJECT,
                soft_priority=["categorical_low", "temporal", "categorical_mid"],
                max_distinct=100,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=_QUANTITATIVE_Y_ACCEPT,
                reject_roles=_QUANTITATIVE_Y_REJECT,
            ),
            "color": ChannelSpec(
                required=True,
                accept_roles=_LOW_COLOR_ACCEPT,
                reject_roles=["categorical_huge", "control_limit"],
            ),
        },
    ),

    # ── Group C: distribution ──────────────────────────────────────────────
    "histogram": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=[
                    "sequential", "categorical_low", "categorical_mid",
                    "categorical_high", "categorical_huge", "temporal", "control_limit",
                ],
                soft_priority=["quantitative"],
                min_distinct=10,
            ),
            "color": ChannelSpec(
                required=False,
                accept_roles=_LOW_COLOR_ACCEPT,
                reject_roles=_LOW_COLOR_REJECT,
            ),
        },
    ),
    "boxplot": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=["categorical_low", "categorical_mid"],
                reject_roles=["sequential", "categorical_huge", "quantitative", "control_limit"],
                soft_priority=["categorical_low", "categorical_mid"],
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=_QUANTITATIVE_Y_ACCEPT,
                reject_roles=_QUANTITATIVE_Y_REJECT,
            ),
            "color": ChannelSpec(
                required=False,
                accept_roles=_LOW_COLOR_ACCEPT,
                reject_roles=_LOW_COLOR_REJECT,
            ),
        },
    ),

    # ── Group D: relationship between two variables ───────────────────────
    "point": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=["quantitative", "temporal"],
                reject_roles=["sequential", "categorical_huge", "control_limit"],
                soft_priority=["quantitative", "temporal"],
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "control_limit"],
            ),
            "color": ChannelSpec(
                required=False,
                accept_roles=["categorical_low", "categorical_mid"],
                reject_roles=["categorical_huge", "quantitative", "control_limit"],
            ),
            "size": ChannelSpec(
                required=False,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),
    "bubble": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=["quantitative", "temporal"],
                reject_roles=["sequential", "categorical_huge", "control_limit"],
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "control_limit"],
            ),
            "size": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
            "color": ChannelSpec(
                required=False,
                accept_roles=["categorical_low", "categorical_mid"],
                reject_roles=["categorical_huge", "control_limit"],
            ),
        },
    ),

    # ── Group E: matrix ────────────────────────────────────────────────────
    "heatmap": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_CATEGORICAL_X_ACCEPT,
                reject_roles=_CATEGORICAL_X_REJECT,
                soft_priority=["temporal", "categorical_low", "categorical_mid"],
                max_distinct=200,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=["categorical_low", "categorical_mid"],
                reject_roles=["sequential", "categorical_huge", "quantitative", "control_limit"],
                soft_priority=["categorical_low", "categorical_mid"],
                max_distinct=100,
            ),
            "color": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),

    # ── Group F: composition (use label/value, NOT x/y) ───────────────────
    "pie": ChartSpec(
        domain=["qc", "generic"],
        forbidden_channels=["x", "y"],
        channels={
            "label": ChannelSpec(
                required=True,
                accept_roles=["categorical_low"],
                reject_roles=[
                    "categorical_mid", "categorical_high", "categorical_huge",
                    "quantitative", "sequential", "temporal", "control_limit",
                ],
                max_distinct=12,
            ),
            "value": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),
    "donut": ChartSpec(
        domain=["qc", "generic"],
        forbidden_channels=["x", "y"],
        channels={
            "label": ChannelSpec(
                required=True,
                accept_roles=["categorical_low"],
                reject_roles=[
                    "categorical_mid", "categorical_high", "categorical_huge",
                    "quantitative", "sequential", "temporal", "control_limit",
                ],
                max_distinct=12,
            ),
            "value": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),
    "funnel": ChartSpec(
        domain=["qc", "generic"],
        forbidden_channels=["x", "y"],
        channels={
            "label": ChannelSpec(
                required=True,
                accept_roles=["categorical_low", "categorical_mid"],
                reject_roles=["categorical_huge", "quantitative", "sequential", "control_limit"],
                max_distinct=20,
            ),
            "value": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),
    "pyramid": ChartSpec(
        domain=["qc", "generic"],
        forbidden_channels=["x", "y"],
        channels={
            "label": ChannelSpec(
                required=True,
                accept_roles=["categorical_low", "categorical_mid"],
                reject_roles=["categorical_huge", "quantitative", "sequential", "control_limit"],
                max_distinct=20,
            ),
            "value": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),

    # ── Group G: specialty ─────────────────────────────────────────────────
    "pareto": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=["categorical_low", "categorical_mid"],
                reject_roles=["sequential", "categorical_huge", "quantitative", "control_limit"],
                max_distinct=50,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),
    "waterfall": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=["categorical_low", "categorical_mid", "temporal"],
                reject_roles=["sequential", "categorical_huge", "quantitative", "control_limit"],
                max_distinct=30,
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),
    "timeline": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=["temporal"],
                reject_roles=["sequential", "quantitative", "categorical", "control_limit"],
            ),
            "y": ChannelSpec(
                required=False,
                accept_roles=["categorical_low", "categorical_mid"],
                reject_roles=["categorical_huge", "control_limit"],
            ),
        },
    ),
    "threshold": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_TREND_X_ACCEPT,
                reject_roles=_TREND_X_REJECT,
                soft_priority=["temporal", "sequential"],
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),
    "radial_plot": ChartSpec(
        domain=["qc", "generic"],
        channels={
            "x": ChannelSpec(
                required=True,
                accept_roles=_TREND_X_ACCEPT,
                reject_roles=["categorical_huge", "control_limit"],
            ),
            "y": ChannelSpec(
                required=True,
                accept_roles=["quantitative"],
                reject_roles=["sequential", "categorical", "control_limit"],
            ),
        },
    ),

    # ── Group H: QC charts (domain=["qc"] ONLY) ────────────────────────────
    "qc_trend_line": ChartSpec(
        domain=["qc"],
        channels={
            "INDEX": ChannelSpec(required=True, accept_roles=["sequential"]),
            "VALUE": ChannelSpec(required=True, accept_roles=["quantitative"]),
            "QCDATE": ChannelSpec(required=True, accept_roles=["temporal", "categorical"]),
            "QCSHIFT": ChannelSpec(required=True, accept_roles=["categorical_low"]),
            "color":   ChannelSpec(required=True, accept_roles=["categorical_low", "categorical_mid"]),
        },
    ),
    "qc_histogram": ChartSpec(
        domain=["qc"],
        channels={
            "VALUE": ChannelSpec(required=True, accept_roles=["quantitative"]),
            "INDEX": ChannelSpec(required=True, accept_roles=["sequential"]),
            "color": ChannelSpec(required=True, accept_roles=["categorical_low", "categorical_mid"]),
        },
    ),
    "qc_trend_bar": ChartSpec(
        domain=["qc"],
        channels={
            "VALUE":   ChannelSpec(required=True, accept_roles=["categorical", "quantitative"]),
            "QCDATE":  ChannelSpec(required=True, accept_roles=["temporal", "categorical"]),
            "QCSHIFT": ChannelSpec(required=True, accept_roles=["categorical_low"]),
        },
    ),
}


# ─────────────────────────────────────────────────────────────────────────────
# Internal validation helpers
# ─────────────────────────────────────────────────────────────────────────────


def _field_matches_channel(meta: FieldMeta, ch_spec: ChannelSpec) -> bool:
    """Return True iff `meta` satisfies all of `ch_spec`'s constraints."""
    roles = get_field_roles(meta)
    if not any(r in roles for r in ch_spec.accept_roles):
        return False
    if any(r in roles for r in ch_spec.reject_roles):
        return False
    if ch_spec.min_distinct and meta.cardinality < ch_spec.min_distinct:
        return False
    if ch_spec.max_distinct is not None and meta.cardinality > ch_spec.max_distinct:
        return False
    return True


def _has_any_compatible_field(
    ch_spec: ChannelSpec, field_metas: Dict[str, FieldMeta]
) -> bool:
    """Is there at least one field that could fill this channel?"""
    return any(_field_matches_channel(m, ch_spec) for m in field_metas.values())


# ─────────────────────────────────────────────────────────────────────────────
# Public API: suggestions
# ─────────────────────────────────────────────────────────────────────────────


def suggest_alternative_charts(
    field_metas: Dict[str, FieldMeta], domain: str, exclude: Optional[str] = None
) -> List[str]:
    """Return chart types that CAN be drawn from `field_metas` in `domain`.

    Used by reject paths to point the user at viable alternatives. Uses a
    bare-minimum check: every required channel must have at least one
    compatible field. Does NOT run the full picker (cheaper, and we only need
    a hint).
    """
    alternatives = []
    for chart_type, spec in CHART_REQUIREMENTS.items():
        if chart_type == exclude:
            continue
        if domain not in spec.domain:
            continue
        if all(
            (not ch.required) or _has_any_compatible_field(ch, field_metas)
            for ch in spec.channels.values()
        ):
            alternatives.append(chart_type)
    # Cap the list — too many suggestions overwhelms the modal.
    return alternatives[:5]


# ─────────────────────────────────────────────────────────────────────────────
# Public API: EARLY reject (no LLM needed)
# ─────────────────────────────────────────────────────────────────────────────


def check_chart_data_compatibility(
    chart_type: str, field_metas: Dict[str, FieldMeta], domain: str
) -> Optional[RejectInfo]:
    """Pre-LLM check: can `chart_type` be drawn at all from the data?

    Returns None if drawable; otherwise a RejectInfo. The agent should call
    this BEFORE invoking the LLM and short-circuit on reject.
    """
    spec = CHART_REQUIREMENTS.get(chart_type)

    if spec is None:
        return RejectInfo(
            code="R2",
            short="unknown_chart_type",
            message_vi=f"Loại biểu đồ '{chart_type}' không được hỗ trợ.",
            suggested_chart_types=suggest_alternative_charts(field_metas, domain),
        )

    # R2: chart belongs to a different domain
    if domain not in spec.domain:
        if "qc" in spec.domain and domain == "generic":
            return RejectInfo(
                code="R2",
                short="qc_chart_non_qc_data",
                message_vi=(
                    f"{chart_type} chỉ áp dụng cho QC data "
                    f"(cần TARGET + LL/UL/ARLL/ARUL + cột QCDATE/QCSHIFT/QCSTDPARAMNAME/SLIPNO). "
                    f"Data hiện tại không phải QC. Dùng chart thường thay thế."
                ),
                suggested_chart_types=suggest_alternative_charts(field_metas, domain, exclude=chart_type),
                suggested_actions=["Chọn line / bar / histogram thay vì QC chart"],
            )
        return RejectInfo(
            code="R2",
            short="wrong_domain",
            message_vi=f"{chart_type} không áp dụng cho domain '{domain}'.",
            suggested_chart_types=suggest_alternative_charts(field_metas, domain, exclude=chart_type),
        )

    # R1: each REQUIRED channel must have at least one compatible field
    missing = []
    for channel_name, ch_spec in spec.channels.items():
        if not ch_spec.required:
            continue
        if not _has_any_compatible_field(ch_spec, field_metas):
            missing.append((channel_name, ch_spec))

    if not missing:
        return None

    # R4 vs R1: if more than one required channel is missing, it's a
    # dimensionality problem (e.g. scatter needs 2 quantitatives, only 1 found).
    if len(missing) > 1:
        channels_str = ", ".join(c for c, _ in missing)
        return RejectInfo(
            code="R4",
            short="wrong_dimensionality",
            message_vi=(
                f"{chart_type} cần đủ field cho các channel: {channels_str}. "
                f"Data hiện tại không đáp ứng đủ. "
                f"Thử chart đơn giản hơn hoặc bổ sung dữ liệu."
            ),
            context_columns=list(field_metas.keys()),
            suggested_chart_types=suggest_alternative_charts(field_metas, domain, exclude=chart_type),
        )

    channel_name, ch_spec = missing[0]
    accept_str = ", ".join(ch_spec.accept_roles)
    return RejectInfo(
        code="R1",
        short="no_data_fit",
        message_vi=(
            f"{chart_type} cần channel '{channel_name}' là kiểu [{accept_str}], "
            f"nhưng data hiện tại không có field nào phù hợp."
        ),
        context_columns=list(field_metas.keys()),
        suggested_chart_types=suggest_alternative_charts(field_metas, domain, exclude=chart_type),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public API: POST-LLM reject
# ─────────────────────────────────────────────────────────────────────────────


def validate_chart(
    chart_type: str,
    encoding: Dict[str, str],
    field_metas: Dict[str, FieldMeta],
    domain: str,
) -> ValidationResult:
    """Post-LLM check: does the LLM's encoding choice make sense?

    Catches R3 (cardinality_explosion), R6 (channel_mismatch), R7
    (control_limit_in_encoding), R4 (required channel missing), and any
    per-channel role mismatch that the early-check missed.
    """
    spec = CHART_REQUIREMENTS.get(chart_type)
    if spec is None:
        return ValidationResult(
            False,
            RejectInfo(
                code="R2",
                short="unknown_chart_type",
                message_vi=f"Loại biểu đồ '{chart_type}' không được hỗ trợ.",
            ),
        )

    if domain not in spec.domain:
        return ValidationResult(
            False, check_chart_data_compatibility(chart_type, field_metas, domain)
        )

    # R6: forbidden channels (e.g. pie emitting x/y)
    used_forbidden = [c for c in spec.forbidden_channels if c in encoding]
    if used_forbidden:
        return ValidationResult(
            False,
            RejectInfo(
                code="R6",
                short="channel_mismatch",
                message_vi=(
                    f"{chart_type} không dùng channel {used_forbidden}. "
                    f"Hãy dùng các channel: {list(spec.channels.keys())}."
                ),
                context_columns=[encoding[c] for c in used_forbidden],
                suggested_actions=[f"Đổi sang channel {list(spec.channels.keys())}"],
            ),
        )

    # R7: control limits in encoding
    for channel, col_name in encoding.items():
        meta = field_metas.get(col_name)
        if meta is not None and meta.qc_role == "control_limit":
            return ValidationResult(
                False,
                RejectInfo(
                    code="R7",
                    short="control_limit_in_encoding",
                    message_vi=(
                        f"Cột '{col_name}' là control limit (TARGET/LL/UL/ARLL/ARUL), "
                        f"không được dùng làm encoding channel. "
                        f"Control limit được render thành đường tham chiếu, không phải dimension."
                    ),
                    context_columns=[col_name],
                ),
            )

    # Per-channel validation against ChannelSpec
    for channel, col_name in encoding.items():
        ch_spec = spec.channels.get(channel)
        if ch_spec is None:
            # Unknown channel — not in forbidden list either; allow with no check.
            continue
        meta = field_metas.get(col_name)
        if meta is None:
            return ValidationResult(
                False,
                RejectInfo(
                    code="R1",
                    short="missing_column",
                    message_vi=f"Cột '{col_name}' không tồn tại trong data.",
                    context_columns=[col_name],
                ),
            )

        roles = get_field_roles(meta)

        # Check cardinality bounds FIRST so an over-cardinal field surfaces as
        # R3 (cardinality_explosion — most actionable message for the user)
        # rather than R1 role mismatch.
        if ch_spec.max_distinct is not None and meta.cardinality > ch_spec.max_distinct:
            return ValidationResult(
                False,
                RejectInfo(
                    code="R3",
                    short="cardinality_explosion",
                    message_vi=(
                        f"{chart_type} với {meta.cardinality} giá trị '{col_name}' sẽ không đọc được "
                        f"(giới hạn {ch_spec.max_distinct}). "
                        f"Thử: (1) Lọc top-{ch_spec.max_distinct // 2}, (2) GROUP BY level cao hơn, "
                        f"(3) đổi sang chart khác như histogram/treemap."
                    ),
                    context_columns=[col_name],
                    suggested_chart_types=suggest_alternative_charts(
                        field_metas, domain, exclude=chart_type
                    ),
                ),
            )

        if any(r in roles for r in ch_spec.reject_roles):
            return ValidationResult(
                False,
                RejectInfo(
                    code="R1",
                    short="role_mismatch",
                    message_vi=(
                        f"Cột '{col_name}' (kiểu {sorted(roles)}) không phù hợp với "
                        f"channel '{channel}' của {chart_type}. "
                        f"Channel này cần: {ch_spec.accept_roles}."
                    ),
                    context_columns=[col_name],
                    suggested_chart_types=suggest_alternative_charts(
                        field_metas, domain, exclude=chart_type
                    ),
                ),
            )

        if not any(r in roles for r in ch_spec.accept_roles):
            return ValidationResult(
                False,
                RejectInfo(
                    code="R1",
                    short="role_mismatch",
                    message_vi=(
                        f"Cột '{col_name}' (kiểu {sorted(roles)}) không thuộc loại "
                        f"chấp nhận của channel '{channel}': {ch_spec.accept_roles}."
                    ),
                    context_columns=[col_name],
                    suggested_chart_types=suggest_alternative_charts(
                        field_metas, domain, exclude=chart_type
                    ),
                ),
            )

        if ch_spec.min_distinct and meta.cardinality < ch_spec.min_distinct:
            return ValidationResult(
                False,
                RejectInfo(
                    code="R4",
                    short="wrong_dimensionality",
                    message_vi=(
                        f"Channel '{channel}' của {chart_type} cần ít nhất "
                        f"{ch_spec.min_distinct} giá trị phân biệt, "
                        f"'{col_name}' chỉ có {meta.cardinality}."
                    ),
                    context_columns=[col_name],
                ),
            )

    # R4: required channels missing from encoding
    missing_required = [
        ch for ch, sp in spec.channels.items() if sp.required and ch not in encoding
    ]
    if missing_required:
        return ValidationResult(
            False,
            RejectInfo(
                code="R4",
                short="missing_required_channel",
                message_vi=(
                    f"{chart_type} thiếu channel bắt buộc: {missing_required}."
                ),
            ),
        )

    return ValidationResult(True)
