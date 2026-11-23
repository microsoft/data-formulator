"""Tests for Phase 5 — Agent summary enhancement, workspace search, catalog cache,
search_data_tables tool, progressive context, and security boundaries."""
from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.datalake.workspace_metadata import (
    ColumnInfo,
    TableMetadata,
    WorkspaceMetadata,
)

pytestmark = [pytest.mark.backend]


# ── WorkspaceMetadata.search_tables ──────────────────────────────────

class TestWorkspaceSearch:
    def _make_ws(self) -> WorkspaceMetadata:
        ws = WorkspaceMetadata.create_new()
        ws.add_table(TableMetadata(
            name="orders",
            source_type="data_loader",
            filename="orders.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            description="Customer order records",
            columns=[
                ColumnInfo("order_id", "int64", description="Primary key"),
                ColumnInfo("customer_name", "text", description="Full customer name"),
                ColumnInfo("amount", "float64"),
            ],
        ))
        ws.add_table(TableMetadata(
            name="products",
            source_type="data_loader",
            filename="products.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            description="Product catalog",
            columns=[
                ColumnInfo("product_id", "int64"),
                ColumnInfo("name", "text"),
            ],
        ))
        return ws

    def test_match_table_name(self):
        results = self._make_ws().search_tables("order")
        assert len(results) >= 1
        assert results[0]["name"] == "orders"

    def test_match_table_description(self):
        results = self._make_ws().search_tables("catalog")
        assert any(r["name"] == "products" for r in results)

    def test_match_column_name(self):
        results = self._make_ws().search_tables("customer_name")
        assert results[0]["name"] == "orders"
        assert "customer_name" in results[0]["matched_columns"]

    def test_match_column_description(self):
        results = self._make_ws().search_tables("primary key")
        assert results[0]["name"] == "orders"

    def test_empty_query_returns_empty(self):
        assert self._make_ws().search_tables("") == []

    def test_no_match(self):
        assert self._make_ws().search_tables("zzz_nonexistent") == []

    def test_respects_limit(self):
        results = self._make_ws().search_tables("a", limit=1)
        assert len(results) <= 1


# ── get_field_summary values ─────────────────────────────────────────

class TestFieldSummaryValues:
    """The distinct values shown for a column: sorted, without missing ones."""

    @staticmethod
    def _values(df, column, sample=7):
        from data_formulator.agents.agent_utils import get_field_summary
        return get_field_summary(column, df, sample).split("values: ", 1)[1]

    def test_missing_values_are_left_out_and_do_not_break_the_order(self):
        import numpy as np
        import pandas as pd
        df = pd.DataFrame({
            "year": [np.nan, 1990.0, np.nan, 2024.0, 1970.0, np.nan, 2001.0, 1985.0, np.nan, 2010.0],
            "when": pd.to_datetime(["2024-01-02", None, "2021-01-01", None, "2024-01-02", None, None, None, None, None]),
            "count": pd.array([5, None, 1, 9, None, 3, 3, None, 1, 5], dtype="Int64"),
            "kind": pd.Categorical(["x", "z", None, "y", "x", None, "y", "z", "x", None]),
        })
        assert self._values(df, "year") == "1970.0, 1985.0, 1990.0, 2001.0, 2010.0, 2024.0"
        assert self._values(df, "year", sample=4) == "1970.0, 1985.0, ..., 2010.0, 2024.0"
        assert self._values(df, "when") == "2021-01-01T00:00:00.000000000, 2024-01-02T00:00:00.000000000"
        assert self._values(df, "count") == "1, 3, 5, 9"
        assert self._values(df, "kind") == "x, y, z"

    def test_unhashable_and_unsortable_cells_still_summarize(self):
        import pandas as pd
        df = pd.DataFrame({"json": [{"a": 1}, [1, 2], {"a": 1}, None, "x"], "mixed": [1, "a", 2.5, None, 1]})
        assert sorted(self._values(df, "json").split(", ")) == sorted(['"[1', '2]"', "x", "{'a': 1}"])
        assert sorted(self._values(df, "mixed").split(", ")) == ["1", "2.5", "a"]


# ── get_field_summary with column_description ────────────────────────

class TestFieldSummaryWithDescription:
    def test_no_description(self):
        import pandas as pd
        from data_formulator.agents.agent_utils import get_field_summary
        df = pd.DataFrame({"x": [1, 2, 3]})
        line = get_field_summary("x", df, 5)
        assert "x -- type:" in line
        assert "(" not in line

    def test_with_verbose_name(self):
        import pandas as pd
        from data_formulator.agents.agent_utils import get_field_summary
        df = pd.DataFrame({"order_id": [1, 2, 3]})
        line = get_field_summary("order_id", df, 5, verbose_name="订单编号")
        assert "[订单编号]" in line
        assert "order_id [订单编号] -- type:" in line

    def test_with_expression(self):
        import pandas as pd
        from data_formulator.agents.agent_utils import get_field_summary
        df = pd.DataFrame({"total": [100, 200]})
        line = get_field_summary("total", df, 5, expression="SUM(line_items.amount)")
        assert "[calc: SUM(line_items.amount)]" in line

    def test_with_all_metadata(self):
        import pandas as pd
        from data_formulator.agents.agent_utils import get_field_summary
        df = pd.DataFrame({"amount": [10.5, 20.3]})
        line = get_field_summary(
            "amount", df, 5,
            column_description="Transaction amount",
            verbose_name="金额",
            expression="SUM(payments.amount)",
        )
        assert "amount [金额] -- type:" in line
        assert "(Transaction amount)" in line
        assert "[calc: SUM(payments.amount)]" in line


# ── generate_data_summary with system description ────────────────────

class TestSummarySystemDescription:
    def test_uses_system_description_from_workspace_metadata(self):
        """After the attached_metadata removal, system description from
        TableMetadata is the only path into the prompt."""
        from data_formulator.agents.agent_utils import generate_data_summary
        import pandas as pd

        workspace = MagicMock()
        workspace.read_data_as_df.return_value = pd.DataFrame({"a": [1]})
        workspace.get_relative_data_file_path.return_value = "data/t.parquet"

        mock_ws_meta = WorkspaceMetadata.create_new()
        mock_ws_meta.add_table(TableMetadata(
            name="t",
            source_type="data_loader",
            filename="t.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            description="System description from source",
        ))
        workspace.get_metadata.return_value = mock_ws_meta

        result = generate_data_summary(
            [{"name": "t"}],
            workspace,
            include_data_samples=False,
        )
        assert "System description from source" in result

    def test_attached_metadata_is_ignored_if_present(self):
        """Legacy clients may still include attached_metadata in the
        payload; it must be silently dropped, not surfaced in the prompt."""
        from data_formulator.agents.agent_utils import generate_data_summary
        import pandas as pd

        workspace = MagicMock()
        workspace.read_data_as_df.return_value = pd.DataFrame({"a": [1]})
        workspace.get_relative_data_file_path.return_value = "data/t.parquet"

        mock_ws_meta = WorkspaceMetadata.create_new()
        mock_ws_meta.add_table(TableMetadata(
            name="t",
            source_type="data_loader",
            filename="t.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            description="System description",
        ))
        workspace.get_metadata.return_value = mock_ws_meta

        result = generate_data_summary(
            [{"name": "t", "attached_metadata": "Legacy user annotation"}],
            workspace,
            include_data_samples=False,
        )
        assert "Legacy user annotation" not in result
        assert "System description" in result


# ── build_catalog_metadata_lookups via workspace.user_home ────────────

class TestCatalogMetadataLookups:
    """Verify that build_catalog_metadata_lookups resolves user_home from workspace."""

    def test_lookups_use_workspace_user_home(self):
        """Loader-supplied descriptions injected into summary when workspace.user_home is set."""
        from data_formulator.agents.agent_utils import build_catalog_metadata_lookups
        from data_formulator.datalake.catalog_cache import save_catalog

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            save_catalog(tmp_path, "pg", [
                {"name": "daily_sales", "table_key": "ds-1",
                 "metadata": {
                     "description": "Source sales table",
                     "columns": [
                         {"name": "amount", "description": "Transaction amount",
                          "verbose_name": "金额", "expression": "SUM(line_items.amount)"},
                         {"name": "order_id", "description": "Primary key",
                          "verbose_name": "订单编号"},
                     ],
                 }},
            ])

            ws = MagicMock()
            ws.user_home = tmp_path

            ws_meta = WorkspaceMetadata.create_new()
            ws_meta.add_table(TableMetadata(
                name="daily_sales",
                source_type="data_loader",
                filename="daily_sales.parquet",
                file_type="parquet",
                created_at=datetime.now(timezone.utc),
                source_table="daily_sales",
            ))
            ws.get_metadata.return_value = ws_meta

            table_descs, col_descs, _extras, col_metas = build_catalog_metadata_lookups(ws)
            assert table_descs.get("daily_sales") == "Source sales table"
            assert col_descs.get("daily_sales", {}).get("amount") == "Transaction amount"

            assert "daily_sales" in col_metas
            amount_meta = col_metas["daily_sales"].get("amount", {})
            assert amount_meta.get("verbose_name") == "金额"
            assert amount_meta.get("expression") == "SUM(line_items.amount)"
            assert amount_meta.get("source_description") == "Transaction amount"
            order_meta = col_metas["daily_sales"].get("order_id", {})
            assert order_meta.get("verbose_name") == "订单编号"
            assert order_meta.get("source_description") == "Primary key"
            assert "expression" not in order_meta

    def test_lookups_graceful_without_user_home(self):
        """Returns empty dicts when workspace has no user_home."""
        from data_formulator.agents.agent_utils import build_catalog_metadata_lookups

        ws = MagicMock(spec=[])
        table_descs, col_descs, extras, col_metas = build_catalog_metadata_lookups(ws)
        assert table_descs == {}
        assert col_descs == {}
        assert extras == {}
        assert col_metas == {}


# ── _merge_source_metadata — empty description clears ─────────────────

class TestMergeSourceMetadataEmptyClear:
    """Verify that _merge_source_metadata clears descriptions when source returns empty."""

    def test_empty_description_clears_existing(self):
        from data_formulator.data_loader.external_data_loader import _merge_source_metadata
        meta = TableMetadata(
            name="t",
            source_type="data_loader",
            filename="t.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            description="Old description",
            columns=[ColumnInfo("col1", "text", description="Old col desc")],
        )
        _merge_source_metadata(meta, {
            "description": "",
            "columns": [{"name": "col1", "description": ""}],
        })
        assert meta.description is None
        assert meta.columns[0].description is None

    def test_missing_key_preserves_existing(self):
        from data_formulator.data_loader.external_data_loader import _merge_source_metadata
        meta = TableMetadata(
            name="t",
            source_type="data_loader",
            filename="t.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            description="Keep me",
            columns=[ColumnInfo("col1", "text", description="Keep me too")],
        )
        _merge_source_metadata(meta, {"columns": [{"name": "col1"}]})
        assert meta.description == "Keep me"
        assert meta.columns[0].description == "Keep me too"


