"""Ensure the analysis skill contains the non-ASCII identifier quoting rule.

This is a regression guard: the live ``AnalystAgent`` loads its chart-creation
guidance from the analysis skill body. The DuckDB notes there must remind the
LLM to wrap non-ASCII identifiers in double quotes when generating DuckDB SQL.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import data_formulator

pytestmark = [pytest.mark.backend]

_ANALYSIS_SKILL_BODY = (
    Path(data_formulator.__file__).parent
    / "analyst"
    / "skills"
    / "analysis"
    / "SKILL.md"
).read_text(encoding="utf-8")


def test_duckdb_notes_mentions_non_ascii_double_quoting() -> None:
    lower = _ANALYSIS_SKILL_BODY.lower()
    assert "non-ascii" in lower or "non ascii" in lower
    assert '"' in _ANALYSIS_SKILL_BODY


def test_duckdb_notes_mentions_identifier_quoting_rule() -> None:
    """The prompt should contain an explicit quoting rule for identifiers."""
    assert "identifier" in _ANALYSIS_SKILL_BODY.lower()
