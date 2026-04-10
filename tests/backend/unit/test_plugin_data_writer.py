"""Tests for :class:`PluginDataWriter`.

Verifies that the writer:

* Resolves workspace via identity and writes Parquet via ``workspace.write_parquet``
* Stamps ``loader_type = "plugin:<id>"`` on all tables
* Handles ``overwrite=True`` (default) and ``overwrite=False`` (auto-suffix)
* Returns the correct response dict shape
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from data_formulator.plugins.data_writer import PluginDataWriter

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Fake workspace / table metadata
# ------------------------------------------------------------------

@dataclass
class _FakeColumnInfo:
    name: str
    dtype: str = "string"
    semantic_type: Optional[str] = None


@dataclass
class _FakeTableMetadata:
    name: str
    row_count: int
    columns: list[_FakeColumnInfo] = field(default_factory=list)
    file_size: int = 0


class _FakeWorkspace:
    """Minimal stand-in for ``Workspace`` with a dict of known tables."""

    def __init__(self, existing_tables: list[str] | None = None):
        self._tables = set(existing_tables or [])

    def list_tables(self) -> list[str]:
        return list(self._tables)

    def write_parquet(
        self,
        df: pd.DataFrame,
        table_name: str,
        *,
        compression: str = "snappy",
        loader_metadata: dict[str, Any] | None = None,
    ) -> _FakeTableMetadata:
        self._tables.add(table_name)
        return _FakeTableMetadata(
            name=table_name,
            row_count=len(df),
            columns=[_FakeColumnInfo(name=c) for c in df.columns],
        )


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def writer():
    return PluginDataWriter("superset")


@pytest.fixture
def sample_df():
    return pd.DataFrame({"city": ["Seattle", "Portland"], "pop": [750_000, 650_000]})


# ------------------------------------------------------------------
# Tests — basic write
# ------------------------------------------------------------------

class TestBasicWrite:

    @patch("data_formulator.plugins.data_writer.get_identity_id", return_value="user:alice")
    @patch("data_formulator.plugins.data_writer.get_workspace")
    def test_write_returns_expected_shape(self, mock_get_ws, _mock_id, writer, sample_df):
        ws = _FakeWorkspace()
        mock_get_ws.return_value = ws

        result = writer.write_dataframe(sample_df, "cities")

        assert result["table_name"] == "cities"
        assert result["row_count"] == 2
        assert len(result["columns"]) == 2
        assert result["is_renamed"] is False
        mock_get_ws.assert_called_once_with("user:alice")

    @patch("data_formulator.plugins.data_writer.get_identity_id", return_value="user:bob")
    @patch("data_formulator.plugins.data_writer.get_workspace")
    def test_loader_metadata_stamped(self, mock_get_ws, _mock_id, writer, sample_df):
        ws = MagicMock(spec=_FakeWorkspace)
        ws.write_parquet.return_value = _FakeTableMetadata(
            name="sales", row_count=2, columns=[]
        )
        mock_get_ws.return_value = ws

        writer.write_dataframe(sample_df, "sales")

        _, kwargs = ws.write_parquet.call_args
        meta = kwargs["loader_metadata"]
        assert meta["loader_type"] == "plugin:superset"
        assert meta["source_table"] == "sales"

    @patch("data_formulator.plugins.data_writer.get_identity_id", return_value="user:carol")
    @patch("data_formulator.plugins.data_writer.get_workspace")
    def test_source_metadata_forwarded(self, mock_get_ws, _mock_id, writer, sample_df):
        ws = MagicMock(spec=_FakeWorkspace)
        ws.write_parquet.return_value = _FakeTableMetadata(
            name="t", row_count=2, columns=[]
        )
        mock_get_ws.return_value = ws

        writer.write_dataframe(
            sample_df, "t", source_metadata={"dashboard_id": 42}
        )

        _, kwargs = ws.write_parquet.call_args
        assert kwargs["loader_metadata"]["loader_params"] == {"dashboard_id": 42}


# ------------------------------------------------------------------
# Tests — overwrite / collision avoidance
# ------------------------------------------------------------------

class TestCollisionAvoidance:

    @patch("data_formulator.plugins.data_writer.get_identity_id", return_value="user:x")
    @patch("data_formulator.plugins.data_writer.get_workspace")
    def test_overwrite_true_replaces(self, mock_get_ws, _mock_id, writer, sample_df):
        ws = _FakeWorkspace(existing_tables=["cities"])
        mock_get_ws.return_value = ws

        result = writer.write_dataframe(sample_df, "cities", overwrite=True)
        assert result["table_name"] == "cities"

    @patch("data_formulator.plugins.data_writer.get_identity_id", return_value="user:x")
    @patch("data_formulator.plugins.data_writer.get_workspace")
    def test_overwrite_false_auto_suffix(self, mock_get_ws, _mock_id, writer, sample_df):
        ws = _FakeWorkspace(existing_tables=["cities", "cities_1"])
        mock_get_ws.return_value = ws

        result = writer.write_dataframe(sample_df, "cities", overwrite=False)
        assert result["table_name"] == "cities_2"

    @patch("data_formulator.plugins.data_writer.get_identity_id", return_value="user:x")
    @patch("data_formulator.plugins.data_writer.get_workspace")
    def test_overwrite_false_no_collision(self, mock_get_ws, _mock_id, writer, sample_df):
        ws = _FakeWorkspace(existing_tables=[])
        mock_get_ws.return_value = ws

        result = writer.write_dataframe(sample_df, "new_table", overwrite=False)
        assert result["table_name"] == "new_table"
