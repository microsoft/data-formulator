"""Ensure SHARED_DUCKDB_NOTES contains the non-ASCII identifier quoting rule.

This is a regression guard: the DuckDB notes prompt must remind the LLM to
wrap non-ASCII identifiers in double quotes when generating DuckDB SQL.
"""
from __future__ import annotations

import pytest

from data_formulator.agents.agent_data_rec import SHARED_DUCKDB_NOTES

pytestmark = [pytest.mark.backend]


def test_duckdb_notes_mentions_non_ascii_double_quoting() -> None:
    lower = SHARED_DUCKDB_NOTES.lower()
    assert "non-ascii" in lower or "non ascii" in lower
    assert "double quotes" in lower or '"' in SHARED_DUCKDB_NOTES


def test_duckdb_notes_mentions_identifier_quoting_rule() -> None:
    """The prompt should contain an explicit quoting rule for identifiers."""
    assert "identifier" in SHARED_DUCKDB_NOTES.lower()


def test_duckdb_notes_is_not_excessively_long() -> None:
    """Overly long DuckDB notes can confuse models about the JSON output format.
    Keep it under 800 characters to avoid prompt bloat."""
    assert len(SHARED_DUCKDB_NOTES) < 800
