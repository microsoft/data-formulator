"""Tests for generate_data_summary inline-rows fallback.

When a table is not stored in the workspace (e.g. a derived table that only
exists in the browser), generate_data_summary should fall back to the inline
``rows`` sent in the request body, rather than returning a degraded
"data unavailable" message.
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from data_formulator.agents.agent_utils import generate_data_summary


pytestmark = [pytest.mark.backend]


def _mock_workspace(tables: dict | None = None):
    """Create a mock workspace that only has the given tables as DataFrames."""
    import pandas as pd
    stored = {}
    if tables:
        for name, rows in tables.items():
            stored[name] = pd.DataFrame(rows)

    ws = MagicMock()

    def _read(name):
        if name in stored:
            return stored[name]
        raise FileNotFoundError(f"No such table: {name}")

    def _path(name):
        if name in stored:
            return f"data/{name}.parquet"
        raise FileNotFoundError(f"No such table: {name}")

    ws.read_data_as_df = MagicMock(side_effect=_read)
    ws.get_relative_data_file_path = MagicMock(side_effect=_path)
    ws.get_metadata = MagicMock(return_value=None)
    ws.user_home = None
    return ws


class TestInlineRowsFallback:
    """generate_data_summary must use inline rows when workspace has no file."""

    def test_workspace_table_uses_parquet(self):
        """When the table exists in workspace, read from parquet (normal path)."""
        ws = _mock_workspace({"sales": [{"amount": 100}, {"amount": 200}]})
        result = generate_data_summary(
            [{"name": "sales"}],
            workspace=ws,
        )
        assert "sales" in result
        assert "amount" in result
        assert "⚠" not in result

    def test_derived_table_falls_back_to_inline_rows(self):
        """Derived table not in workspace — must use inline rows instead of
        returning the 'data unavailable' degraded message."""
        ws = _mock_workspace()  # empty workspace
        inline_rows = [
            {"city": "Beijing", "population": 21_540_000},
            {"city": "Shanghai", "population": 24_870_000},
        ]
        result = generate_data_summary(
            [{"name": "result_df", "rows": inline_rows}],
            workspace=ws,
        )
        assert "result_df" in result
        assert "city" in result
        assert "population" in result
        assert "⚠ Table data unavailable" not in result

    def test_no_workspace_no_rows_shows_unavailable(self):
        """When table is not in workspace AND no inline rows, show degraded."""
        ws = _mock_workspace()
        result = generate_data_summary(
            [{"name": "ghost_table"}],
            workspace=ws,
        )
        assert "⚠ Table data unavailable" in result

    def test_inline_rows_shows_in_memory_path(self):
        """When falling back to inline rows, file path should say (in-memory)."""
        ws = _mock_workspace()
        result = generate_data_summary(
            [{"name": "temp", "rows": [{"x": 1}]}],
            workspace=ws,
        )
        assert "(in-memory)" in result

    def test_inline_rows_sample_size_respected(self):
        """Only field_sample_size values should appear in schema summary."""
        ws = _mock_workspace()
        rows = [{"val": i} for i in range(100)]
        result = generate_data_summary(
            [{"name": "big", "rows": rows}],
            workspace=ws,
            field_sample_size=5,
        )
        assert "big" in result
        assert "val" in result
        assert "100 rows" in result
