"""
Static tests for the M4 prompt refactor.

These do NOT call the LLM. They assert the structural properties of
SYSTEM_PROMPT after the M4 cleanup, and verify _format_field_metadata_hint
produces well-formed hints that downstream tests can rely on.

Why static tests for a prompt? The bug the user reported — INDEX being picked
for bar/histogram — was rooted in the prompt instructing the LLM to do exactly
that ("x=INDEX (default)" appeared 8 times across 4 blocks). Removing those
strings is a CONCRETE, testable change. Any regression that re-adds them must
fail these tests.
"""

from __future__ import annotations

from data_formulator.agents.agent_sql_data_rec import SYSTEM_PROMPT
from data_formulator.agents.agent_py_data_rec import SYSTEM_PROMPT as PY_SYSTEM_PROMPT
from data_formulator.agents.chart_compatibility import format_field_metadata_hint

# Backwards-compat alias for tests written against the old underscore name.
_format_field_metadata_hint = format_field_metadata_hint

from .conftest import (
    categorical_field,
    control_limit_field,
    quantitative_field,
    sequential_field,
    temporal_field,
)


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM_PROMPT structural assertions
# ─────────────────────────────────────────────────────────────────────────────


class TestSystemPromptCleanup:
    def test_no_hardcoded_index_default(self):
        """The headline cleanup: no 'x=INDEX (default)' style instructions.

        These strings, repeated across the old prompt, told the LLM to pick
        INDEX for bar/histogram/heatmap — the exact bug we set out to fix.
        """
        bad_patterns = [
            'x="INDEX" (default)',
            'x="INDEX", y="VALUE"',
            'x="INDEX", color',
            'Priority 1: Use "INDEX"',
            'Priority 1: Use "VALUE"',
            'Priority 1: Use "QCSTDPARAMNAME"',
            'DEFAULT: INDEX',
            'DEFAULT: VALUE',
            'DEFAULT: QCSTDPARAMNAME',
            'Default mappings: x="INDEX"',
        ]
        for pattern in bad_patterns:
            assert pattern not in SYSTEM_PROMPT, (
                f"SYSTEM_PROMPT still contains the deprecated hardcoded default "
                f"'{pattern}'. Replace it with role-based guidance per RULE #4."
            )

    def test_default_axis_mappings_block_removed(self):
        """The 'DEFAULT AXIS MAPPINGS' header block is gone."""
        assert "DEFAULT AXIS MAPPINGS" not in SYSTEM_PROMPT
        assert "DEFAULT FIELD MAPPING RULES" not in SYSTEM_PROMPT

    def test_includes_rule_4_semantic_role_table(self):
        """The new role-based rule must be present."""
        assert "RULE #4" in SYSTEM_PROMPT
        assert "PICK FIELDS BY SEMANTIC ROLE" in SYSTEM_PROMPT

    def test_role_categories_documented(self):
        """The role names the LLM must reason about appear in the prompt."""
        required_roles = [
            "temporal",
            "sequential",
            "quantitative",
            "categorical_low",
            "categorical_mid",
            "categorical_huge",
            "control_limit",
        ]
        for role in required_roles:
            assert role in SYSTEM_PROMPT, f"Role '{role}' missing from prompt."

    def test_hard_constraints_documented(self):
        """Explicit reject conditions surface so the LLM doesn't generate them."""
        assert "HARD CONSTRAINTS" in SYSTEM_PROMPT or "NEVER" in SYSTEM_PROMPT
        # Specifically, the three things the validator will REJECT
        assert "control_limit" in SYSTEM_PROMPT
        assert "sequential" in SYSTEM_PROMPT
        assert "label" in SYSTEM_PROMPT and "value" in SYSTEM_PROMPT  # pie/donut form

    def test_token_reduction_target(self):
        """The refactor target was ≥30% prompt reduction.

        Pre-M4 baseline measured from git HEAD: 28,683 chars.
        Target ceiling: 28,683 × 0.70 = 20,078 chars.
        """
        PRE_M4_BASELINE = 28_683
        MAX_ALLOWED = 20_078  # ≥30% reduction
        assert len(SYSTEM_PROMPT) < MAX_ALLOWED, (
            f"SYSTEM_PROMPT is {len(SYSTEM_PROMPT)} chars — refactor target "
            f"was ≤ {MAX_ALLOWED} (≥30% off the {PRE_M4_BASELINE} baseline). "
            f"Regression likely from a re-introduced hardcoded default."
        )

    def test_qc_chart_specs_still_referenced(self):
        """QC charts should still be acknowledged — full specs are injected
        at runtime via QC_SYSTEM_PROMPT_EXTENSION."""
        assert "qc_trend_line" in SYSTEM_PROMPT
        assert "qc_histogram" in SYSTEM_PROMPT
        assert "qc_trend_bar" in SYSTEM_PROMPT


# ─────────────────────────────────────────────────────────────────────────────
# _format_field_metadata_hint
# ─────────────────────────────────────────────────────────────────────────────


class TestFieldMetadataHint:
    def test_empty_dict_returns_empty_string(self):
        assert _format_field_metadata_hint({}) == ""

    def test_qc_full_renders_expected_roles(self, qc_full_metas):
        hint = _format_field_metadata_hint(qc_full_metas)
        assert "COLUMN ROLES" in hint
        # INDEX → sequential
        assert "INDEX" in hint
        assert "sequential" in hint
        # VALUE → quantitative + qc=measurement
        assert "VALUE" in hint
        assert "quantitative" in hint
        assert "qc=measurement" in hint
        # QCSHIFT → categorical_low + qc=shift
        assert "QCSHIFT" in hint
        assert "categorical_low" in hint
        # Control limits explicitly flagged
        assert "TARGET" in hint
        assert "CONTROL_LIMIT" in hint

    def test_generic_renders_no_qc_role(self, sales_long_metas):
        hint = _format_field_metadata_hint(sales_long_metas)
        # No QC annotations
        assert "qc=" not in hint
        assert "CONTROL_LIMIT" not in hint
        # But standard role tagging is present
        assert "temporal" in hint  # date
        assert "quantitative" in hint  # revenue/quantity
        assert "categorical_low" in hint  # product/region

    def test_cardinality_and_type_included(self):
        metas = {"VALUE": quantitative_field("VALUE", cardinality=950, qc_role="measurement")}
        hint = _format_field_metadata_hint(metas)
        assert "cardinality=950" in hint
        assert "type=DOUBLE" in hint

    def test_id_like_flagged(self):
        meta = sequential_field("customer_id", 5000)
        meta.looks_like_id = True
        hint = _format_field_metadata_hint({"customer_id": meta})
        assert "id_like" in hint

    def test_no_primary_role_fallback(self):
        """A high-cardinality string with no other role still shows up."""
        meta = categorical_field("hash_col", 800)  # huge cardinality, NOT categorical
        hint = _format_field_metadata_hint({"hash_col": meta})
        # The fallback "other_<class>" label appears
        assert "other_huge" in hint or "categorical_huge" in hint

    def test_format_is_one_line_per_column(self):
        metas = {"a": temporal_field("a"), "b": quantitative_field("b"), "c": categorical_field("c")}
        hint = _format_field_metadata_hint(metas)
        # Header + 3 column lines = 4 lines
        assert len(hint.splitlines()) == 4

    def test_control_limit_marker_distinct(self):
        """The CONTROL_LIMIT marker is unmistakable so the LLM doesn't pick it."""
        metas = {"TARGET": control_limit_field("TARGET"), "VALUE": quantitative_field("VALUE")}
        hint = _format_field_metadata_hint(metas)
        # Marker should be on the TARGET line, not VALUE
        target_line = [l for l in hint.splitlines() if "TARGET" in l][0]
        value_line = [l for l in hint.splitlines() if l.strip().startswith("VALUE")][0]
        assert "CONTROL_LIMIT" in target_line
        assert "CONTROL_LIMIT" not in value_line


# ─────────────────────────────────────────────────────────────────────────────
# Python agent prompt parity — M4 was retro-applied to agent_py_data_rec
# ─────────────────────────────────────────────────────────────────────────────


class TestPythonAgentPromptParity:
    """The Python agent must mirror the SQL agent's structural cleanup so users
    on `language='python'` get the same field-selection quality."""

    def test_no_hardcoded_index_default(self):
        bad_patterns = [
            'x="INDEX" (default)',
            'x="INDEX", y="VALUE"',
            'Priority 1: Use "INDEX"',
            'DEFAULT: INDEX',
            'DEFAULT: VALUE',
            'Default mappings: x="INDEX"',
        ]
        for pattern in bad_patterns:
            assert pattern not in PY_SYSTEM_PROMPT, (
                f"PY_SYSTEM_PROMPT still contains the deprecated hardcoded "
                f"default '{pattern}'."
            )

    def test_includes_rule_4_semantic_role_table(self):
        assert "RULE #4" in PY_SYSTEM_PROMPT
        assert "PICK FIELDS BY SEMANTIC ROLE" in PY_SYSTEM_PROMPT

    def test_role_categories_documented(self):
        required_roles = [
            "temporal",
            "sequential",
            "quantitative",
            "categorical_low",
            "categorical_mid",
            "categorical_huge",
            "control_limit",
        ]
        for role in required_roles:
            assert role in PY_SYSTEM_PROMPT, f"Role '{role}' missing from Python prompt."

    def test_hard_constraints_documented(self):
        assert "HARD CONSTRAINTS" in PY_SYSTEM_PROMPT
        assert "control_limit" in PY_SYSTEM_PROMPT
        assert "sequential" in PY_SYSTEM_PROMPT
        assert "label" in PY_SYSTEM_PROMPT and "value" in PY_SYSTEM_PROMPT

    def test_no_per_chart_default_bloat(self):
        """The verbose per-chart-type ('Bar Charts: x: Categorical, ...') and
        the old guidelines block should be gone."""
        # The old block had many '(point) Scatter Plots:' style entries —
        # we now describe chart-type intent in a much shorter list.
        assert PY_SYSTEM_PROMPT.count("(point) Scatter Plots") == 0
        assert PY_SYSTEM_PROMPT.count("(bar) Bar Charts") == 0

    def test_no_growth_versus_baseline(self):
        """The Python agent prompt had less hardcoded bloat than the SQL one
        to begin with, so the reduction is modest (~6%). Baseline: 17,689
        chars. We assert no regression past 17,000.

        The more meaningful checks for this refactor are the structural
        invariants above (RULE #4 present, no hardcoded defaults, etc.).
        """
        BASELINE_CHARS = 17_689
        MAX_ALLOWED = 17_000  # modest reduction from baseline
        assert len(PY_SYSTEM_PROMPT) < MAX_ALLOWED, (
            f"PY_SYSTEM_PROMPT is {len(PY_SYSTEM_PROMPT)} chars — should be "
            f"under {MAX_ALLOWED} (baseline {BASELINE_CHARS}). Regression "
            f"likely from re-added bloat."
        )
