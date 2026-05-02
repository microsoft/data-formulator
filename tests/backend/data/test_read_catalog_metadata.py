"""Tests for handle_read_catalog_metadata agent tool.

Background
----
The read_catalog_metadata tool reads cached catalog metadata for a
specific table, overlays user annotations, and returns a text summary
safe for LLM consumption. It is used by the Agent after search_data_tables
to see full details of not-imported candidates.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from data_formulator.agents.context import handle_read_catalog_metadata
from data_formulator.datalake.catalog_cache import save_catalog
from data_formulator.datalake.catalog_annotations import patch_annotation

pytestmark = [pytest.mark.backend]


def _mock_workspace(user_home):
    """Create a mock workspace with user_home set."""
    ws = MagicMock()
    ws.user_home = Path(user_home) if user_home else None
    return ws


def _setup_cache(user_home: Path) -> None:
    tables = [
        {
            "name": "42:monthly_orders",
            "table_key": "uuid-42",
            "path": ["Sales Dashboard", "monthly_orders"],
            "metadata": {
                "description": "Source description of orders",
                "schema": "public",
                "database": "analytics",
                "row_count": 15000,
                "source_metadata_status": "synced",
                "columns": [
                    {"name": "order_id", "type": "INTEGER", "description": "Primary key",
                     "verbose_name": "订单编号"},
                    {"name": "amount", "type": "DECIMAL", "description": "Order amount",
                     "verbose_name": "金额", "expression": "SUM(line_items.amount)"},
                    {"name": "created_at", "type": "TIMESTAMP", "is_dttm": True},
                ],
            },
        },
        {
            "name": "users",
            "table_key": "uuid-99",
            "metadata": {"source_metadata_status": "unavailable"},
        },
    ]
    save_catalog(user_home, "superset_prod", tables)


class TestReadCatalogMetadata:

    def test_basic_output(self, tmp_path: Path):
        _setup_cache(tmp_path)
        result = handle_read_catalog_metadata(
            "superset_prod", "uuid-42", workspace=_mock_workspace(tmp_path),
        )
        assert "monthly_orders" in result
        assert "order_id" in result
        assert "INTEGER" in result
        assert "Source description of orders" in result
        assert "public" in result
        assert "15000" in result
        assert "synced" in result

    def test_with_annotations(self, tmp_path: Path):
        _setup_cache(tmp_path)
        patch_annotation(
            tmp_path, "superset_prod", "uuid-42",
            {
                "description": "User enriched description",
                "notes": "Used for Q1 analysis",
                "columns": {"order_id": {"description": "Unique order identifier"}},
            },
            expected_version=0,
        )
        result = handle_read_catalog_metadata(
            "superset_prod", "uuid-42", workspace=_mock_workspace(tmp_path),
        )
        assert "User enriched description" in result
        assert "Q1 analysis" in result
        assert "source: Primary key" in result
        assert "user: Unique order identifier" in result

    def test_table_not_found(self, tmp_path: Path):
        _setup_cache(tmp_path)
        result = handle_read_catalog_metadata(
            "superset_prod", "nonexistent-key", workspace=_mock_workspace(tmp_path),
        )
        assert "not found" in result.lower()

    def test_source_not_found(self, tmp_path: Path):
        result = handle_read_catalog_metadata(
            "nonexistent_source", "some-key", workspace=_mock_workspace(tmp_path),
        )
        assert "No cached catalog" in result

    def test_missing_params(self):
        result = handle_read_catalog_metadata("", "key", workspace=_mock_workspace("/tmp"))
        assert "required" in result.lower()

        result = handle_read_catalog_metadata("src", "", workspace=_mock_workspace("/tmp"))
        assert "required" in result.lower()

    def test_no_user_home(self):
        result = handle_read_catalog_metadata("src", "key", workspace=None)
        assert "not available" in result.lower()

    def test_path_in_output(self, tmp_path: Path):
        _setup_cache(tmp_path)
        result = handle_read_catalog_metadata(
            "superset_prod", "uuid-42", workspace=_mock_workspace(tmp_path),
        )
        assert "Sales Dashboard" in result

    def test_verbose_name_and_expression_in_output(self, tmp_path: Path):
        _setup_cache(tmp_path)
        result = handle_read_catalog_metadata(
            "superset_prod", "uuid-42", workspace=_mock_workspace(tmp_path),
        )
        assert "[订单编号]" in result
        assert "[金额]" in result
        assert "[calc: SUM(line_items.amount)]" in result
        assert "created_at" in result
        assert "[calc:" not in result.split("created_at")[1] if "created_at" in result else True

    def test_no_credentials_in_output(self, tmp_path: Path):
        _setup_cache(tmp_path)
        result = handle_read_catalog_metadata(
            "superset_prod", "uuid-42", workspace=_mock_workspace(tmp_path),
        )
        assert "token" not in result.lower()
        assert "password" not in result.lower()
