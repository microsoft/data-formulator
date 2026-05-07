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


# ── Catalog cache ────────────────────────────────────────────────────

class TestCatalogCache:
    def test_save_and_load(self):
        from data_formulator.datalake.catalog_cache import save_catalog, load_catalog
        with tempfile.TemporaryDirectory() as tmp:
            tables = [
                {"name": "t1", "metadata": {"columns": [{"name": "a"}]}},
                {"name": "t2", "metadata": {"description": "desc"}},
            ]
            save_catalog(tmp, "pg:prod", tables)
            loaded = load_catalog(tmp, "pg:prod")
            assert loaded is not None
            assert len(loaded) == 2
            assert loaded[0]["name"] == "t1"

    def test_load_nonexistent_returns_none(self):
        from data_formulator.datalake.catalog_cache import load_catalog
        with tempfile.TemporaryDirectory() as tmp:
            assert load_catalog(tmp, "no-such") is None

    def test_delete_catalog(self):
        from data_formulator.datalake.catalog_cache import save_catalog, delete_catalog, load_catalog
        with tempfile.TemporaryDirectory() as tmp:
            save_catalog(tmp, "src1", [{"name": "t"}])
            delete_catalog(tmp, "src1")
            assert load_catalog(tmp, "src1") is None

    def test_search_catalog_cache(self):
        from data_formulator.datalake.catalog_cache import save_catalog, search_catalog_cache
        with tempfile.TemporaryDirectory() as tmp:
            save_catalog(tmp, "pg", [
                {"name": "users", "metadata": {"description": "User accounts", "columns": [
                    {"name": "email", "description": "User email address"},
                ]}},
                {"name": "orders", "metadata": {"columns": [
                    {"name": "order_id"},
                ]}},
            ])
            results = search_catalog_cache(tmp, "email")
            assert len(results) == 1
            assert results[0]["name"] == "users"
            assert "email" in results[0]["matched_columns"]

    def test_search_excludes_imported_tables(self):
        from data_formulator.datalake.catalog_cache import save_catalog, search_catalog_cache
        with tempfile.TemporaryDirectory() as tmp:
            save_catalog(tmp, "pg", [
                {"name": "orders", "metadata": {"description": "order data", "columns": []}},
            ])
            results = search_catalog_cache(tmp, "order", exclude_tables={"orders"})
            assert len(results) == 0


# ── get_field_summary with column_description ────────────────────────

class TestFieldSummaryWithDescription:
    def test_no_description(self):
        import pandas as pd
        from data_formulator.agents.agent_utils import get_field_summary
        df = pd.DataFrame({"x": [1, 2, 3]})
        line = get_field_summary("x", df, 5)
        assert "x -- type:" in line
        assert "(" not in line

    def test_with_description(self):
        import pandas as pd
        from data_formulator.agents.agent_utils import get_field_summary
        df = pd.DataFrame({"x": [1, 2, 3]})
        line = get_field_summary("x", df, 5, column_description="Primary key")
        assert "(Primary key)" in line

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

    def test_only_source_description(self):
        """When only column_description exists, it's shown in parens."""
        import pandas as pd
        from data_formulator.agents.agent_utils import get_field_summary
        df = pd.DataFrame({"x": [1]})
        line = get_field_summary(
            "x", df, 5,
            column_description="From source",
        )
        assert "(From source)" in line


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


# ── handle_search_data_tables ─────────────────────────────────────────

class TestSearchDataTablesTool:
    """Tests for the search_data_tables agent tool handler."""

    def test_workspace_scope_returns_results(self):
        from data_formulator.agents.context import handle_search_data_tables

        ws = MagicMock()
        ws_meta = WorkspaceMetadata.create_new()
        ws_meta.add_table(TableMetadata(
            name="orders",
            source_type="data_loader",
            filename="orders.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            description="Order data",
            columns=[ColumnInfo("order_id", "int64")],
        ))
        ws.get_metadata.return_value = ws_meta

        result = handle_search_data_tables("order", "workspace", ws)
        assert "orders" in result
        assert "imported" in result

    def test_all_scope_combines_workspace_and_cache(self):
        from data_formulator.agents.context import handle_search_data_tables
        from data_formulator.datalake.catalog_cache import save_catalog
        with tempfile.TemporaryDirectory() as tmp:
            ws = MagicMock()
            ws_meta = WorkspaceMetadata.create_new()
            ws_meta.add_table(TableMetadata(
                name="orders",
                source_type="data_loader",
                filename="orders.parquet",
                file_type="parquet",
                created_at=datetime.now(timezone.utc),
                description="imported order table",
            ))
            ws.get_metadata.return_value = ws_meta

            save_catalog(tmp, "pg", [
                {"name": "remote_orders", "table_key": "uuid-remote-1",
                 "metadata": {"description": "Remote order data", "columns": []}},
            ])

            ws.user_home = Path(tmp)
            result = handle_search_data_tables("order", "all", ws)
            assert "orders" in result
            assert "remote_orders" in result

    def test_not_imported_results_include_source_id_and_table_key(self):
        """Not-imported search results must include source_id and table_key for read_catalog_metadata."""
        from data_formulator.agents.context import handle_search_data_tables
        from data_formulator.datalake.catalog_cache import save_catalog
        with tempfile.TemporaryDirectory() as tmp:
            ws = MagicMock()
            ws.get_metadata.return_value = None

            save_catalog(tmp, "superset_prod", [
                {"name": "monthly_orders", "table_key": "uuid-42",
                 "metadata": {"description": "Monthly order aggregation", "columns": []}},
            ])

            ws.user_home = Path(tmp)
            result = handle_search_data_tables("order", "all", ws)
            assert "source_id: superset_prod" in result
            assert "table_key: uuid-42" in result

    def test_search_then_read_catalog_metadata_roundtrip(self):
        """search_data_tables output provides source_id/table_key for read_catalog_metadata."""
        from data_formulator.agents.context import handle_search_data_tables, handle_read_catalog_metadata
        from data_formulator.datalake.catalog_cache import save_catalog
        with tempfile.TemporaryDirectory() as tmp:
            ws = MagicMock()
            ws.get_metadata.return_value = None

            save_catalog(tmp, "pg_analytics", [
                {"name": "revenue_summary", "table_key": "rev-uuid-1",
                 "metadata": {
                     "description": "Monthly revenue rollup",
                     "columns": [
                         {"name": "month", "type": "DATE"},
                         {"name": "total_revenue", "type": "DECIMAL"},
                     ],
                     "source_metadata_status": "synced",
                 }},
            ])

            ws.user_home = Path(tmp)
            search_result = handle_search_data_tables("revenue", "all", ws)
            assert "source_id: pg_analytics" in search_result
            assert "table_key: rev-uuid-1" in search_result

            read_result = handle_read_catalog_metadata(
                "pg_analytics", "rev-uuid-1", workspace=ws,
            )
            assert "revenue_summary" in read_result
            assert "total_revenue" in read_result
            assert "DECIMAL" in read_result
            assert "synced" in read_result

    def test_empty_query_returns_message(self):
        from data_formulator.agents.context import handle_search_data_tables
        ws = MagicMock()
        result = handle_search_data_tables("", "all", ws)
        assert "keyword" in result.lower() or "provide" in result.lower()

    def test_results_do_not_contain_credentials(self):
        """Search results must not leak loader_params, tokens, or connection strings."""
        from data_formulator.agents.context import handle_search_data_tables
        from data_formulator.datalake.catalog_cache import save_catalog
        with tempfile.TemporaryDirectory() as tmp:
            ws = MagicMock()
            ws.get_metadata.return_value = None
            save_catalog(tmp, "pg", [
                {"name": "users", "metadata": {
                    "description": "User table",
                    "columns": [{"name": "email"}],
                }},
            ])
            ws.user_home = Path(tmp)
            result = handle_search_data_tables("user", "all", ws)
            for sensitive in ("password", "api_key", "secret", "token", "connection_string"):
                assert sensitive not in result.lower()


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


# ── Progressive context — inspect_source_data level adjustment ────────

class TestProgressiveContext:
    """Verify inspect_source_data keeps bounded samples for each table."""

    def test_few_tables_includes_samples(self):
        """Few tables include bounded sample rows."""
        from data_formulator.agents.context import handle_inspect_source_data
        import pandas as pd

        workspace = MagicMock()
        workspace.read_data_as_df.return_value = pd.DataFrame({"a": [1, 2, 3]})
        workspace.get_relative_data_file_path.return_value = "data/t.parquet"
        workspace.get_metadata.return_value = None

        tables = [{"name": "t1"}, {"name": "t2"}]
        result = handle_inspect_source_data(["t1", "t2"], tables, workspace)
        assert "Sample" in result or "sample" in result.lower()

    def test_many_tables_include_bounded_samples(self):
        """>3 tables still include per-table bounded sample rows."""
        from data_formulator.agents.context import handle_inspect_source_data
        import pandas as pd

        workspace = MagicMock()
        workspace.read_data_as_df.return_value = pd.DataFrame({"a": [1, 2, 3]})
        workspace.get_relative_data_file_path.return_value = "data/t.parquet"
        workspace.get_metadata.return_value = None

        tables = [{"name": f"t{i}"} for i in range(5)]
        names = [f"t{i}" for i in range(5)]
        result = handle_inspect_source_data(names, tables, workspace)
        assert "Sample" in result
