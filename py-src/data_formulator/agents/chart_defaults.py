"""
Default encoding picker for chart recommendation.

Given a chart type, a dict of FieldMeta, and the data domain ("qc" or "generic"),
returns the best default encoding (channel → column-name) the chart can use.

Returns an empty dict if no valid encoding can be produced — the caller should
treat that as R1 (no_data_fit) and reject with an alternative-chart suggestion.

Domain semantics:
    qc       — QC columns (INDEX, VALUE, QCDATE, QCSHIFT, QCSTDPARAMNAME)
               carry domain meaning and are PREFERRED when they fit.
    generic  — INDEX-like / id-like / sequential columns are technical artifacts
               and AVOIDED unless they're the only option (and even then only
               for chart types that accept them, e.g. line/area).
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from data_formulator.agents.chart_compatibility import (
    CHART_REQUIREMENTS,
    ChannelSpec,
    _field_matches_channel,
    get_field_roles,
)
from data_formulator.agents.field_metadata import FieldMeta


# Soft-priority adjustments. These deltas shift the priority score; smaller =
# more preferred. They never override hard accept/reject rules — they just
# break ties.

# In QC mode, columns with a QC role get a strong boost.
_QC_DOMAIN_BONUS = -10

# In generic mode, sequential / id-like columns get a strong penalty so the
# picker avoids them unless they're literally the only option.
_GENERIC_SEQUENTIAL_PENALTY = 100
_GENERIC_ID_PENALTY = 100


def _priority_score(
    meta: FieldMeta, ch_spec: ChannelSpec, domain: str
) -> int:
    """Compute a priority score for binding `meta` to a channel with `ch_spec`.

    Smaller score = higher priority. The base score comes from the field's
    position in `ch_spec.soft_priority`; domain-specific bonuses/penalties
    nudge the result.
    """
    roles = get_field_roles(meta)

    # Base score: best (smallest) index into soft_priority for any matching role.
    base = 1000
    for i, pri_role in enumerate(ch_spec.soft_priority):
        if pri_role in roles:
            base = min(base, i)
    if base == 1000:
        # No soft_priority match → use length so anything-matched beats
        # nothing-matched but still ranks below explicit priorities.
        base = len(ch_spec.soft_priority)

    if domain == "qc" and meta.qc_role is not None and meta.qc_role != "control_limit":
        base += _QC_DOMAIN_BONUS

    if domain == "generic":
        # In generic mode, INDEX-like / id-like columns are technical
        # artifacts. Heavy penalty pushes them to the bottom of the list.
        if meta.is_sequential:
            base += _GENERIC_SEQUENTIAL_PENALTY
        if meta.looks_like_id:
            base += _GENERIC_ID_PENALTY

    # Tie-break direction depends on what the channel is FOR. A categorical
    # channel (x of bar, label of pie, color) is more readable with FEWER
    # distinct values. A quantitative channel (y of bar, value of pie, size)
    # is more meaningful with MORE distinct values (a metric with 5 distinct
    # values is barely a metric).
    is_categorical_channel = any(
        r.startswith("categorical") for r in ch_spec.accept_roles
    )
    card_capped = min(meta.cardinality, 9999)
    if is_categorical_channel:
        card_score = card_capped
    else:
        card_score = 9999 - card_capped

    base = base * 10000 + card_score
    return base


def pick_default_encoding(
    chart_type: str, field_metas: Dict[str, FieldMeta], domain: str
) -> Dict[str, str]:
    """Pick the best default encoding for `chart_type` from the available fields.

    Args:
        chart_type: One of the keys in CHART_REQUIREMENTS. Unknown types
            return {}.
        field_metas: column-name → FieldMeta.
        domain: "qc" or "generic".

    Returns:
        Dict mapping channel-name → column-name. Empty if any required channel
        has no compatible field (caller should treat as R1).
    """
    spec = CHART_REQUIREMENTS.get(chart_type)
    if spec is None:
        return {}

    if domain not in spec.domain:
        return {}

    # Control-limit fields never go in encoding, regardless of channel.
    available = {
        name: meta
        for name, meta in field_metas.items()
        if meta.qc_role != "control_limit"
    }

    # Step 1: build candidate list per channel (fields that pass all hard
    # rules: accept_roles, reject_roles, cardinality bounds).
    candidates: Dict[str, List[Tuple[str, FieldMeta]]] = {}
    for channel_name, ch_spec in spec.channels.items():
        ch_candidates = [
            (col_name, meta)
            for col_name, meta in available.items()
            if _field_matches_channel(meta, ch_spec)
        ]
        candidates[channel_name] = ch_candidates

    # Step 2: pick channels in priority order — required first, then optional.
    # Within each group sort by how constrained the channel is (fewer
    # candidates = pick first, so a critical channel doesn't lose its only
    # candidate to a less-constrained channel).
    required = [
        ch for ch, sp in spec.channels.items() if sp.required
    ]
    optional = [
        ch for ch, sp in spec.channels.items() if not sp.required
    ]

    required.sort(key=lambda c: len(candidates[c]))
    optional.sort(key=lambda c: len(candidates[c]))

    encoding: Dict[str, str] = {}
    used_columns: set[str] = set()

    for channel in required + optional:
        ch_spec = spec.channels[channel]
        ch_candidates = [
            (col, meta)
            for (col, meta) in candidates[channel]
            if col not in used_columns
        ]
        if not ch_candidates:
            if ch_spec.required:
                # Cannot fill a required channel — give up; the caller treats
                # empty result as R1.
                return {}
            continue

        ch_candidates.sort(key=lambda x: _priority_score(x[1], ch_spec, domain))
        chosen_col = ch_candidates[0][0]
        encoding[channel] = chosen_col
        used_columns.add(chosen_col)

    return encoding
