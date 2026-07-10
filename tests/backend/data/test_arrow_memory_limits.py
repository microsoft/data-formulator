"""Arrow result byte-limit regression tests."""

from __future__ import annotations

from unittest.mock import MagicMock

import pyarrow as pa
import pytest

from data_formulator.data_loader.external_data_loader import ExternalDataLoader

pytestmark = [pytest.mark.backend]


class WideLoader(ExternalDataLoader):
    def __init__(self, params=None):
        self.params = params or {}

    def fetch_data_as_arrow(self, source_table, import_options=None):
        return pa.table({"value": ["x" * 100]})

    def list_tables(self, table_filter=None):
        return []

    @staticmethod
    def list_params():
        return []

    @staticmethod
    def auth_instructions():
        return "No authentication."


def test_ingest_rejects_arrow_table_over_byte_budget() -> None:
    loader = WideLoader()
    workspace = MagicMock()

    with pytest.raises(ValueError, match="byte limit"):
        loader.ingest_to_workspace(
            workspace,
            "wide",
            "source",
            {"max_bytes": 10},
        )

    workspace.write_parquet_from_arrow.assert_not_called()
