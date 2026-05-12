from __future__ import annotations

import threading
from types import SimpleNamespace

import pyarrow as pa
import pytest

from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
from data_formulator.data_loader.postgresql_data_loader import PostgreSQLDataLoader
from data_formulator.data_loader.superset_data_loader import SupersetLoader

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


def test_postgresql_search_catalog_returns_lightweight_tree(monkeypatch):
    loader = PostgreSQLDataLoader.__new__(PostgreSQLDataLoader)
    loader.params = {"database": "analytics"}
    loader.database = "analytics"

    def fake_read_sql_on(query, dbname=None):
        assert "information_schema.tables" in query
        assert "information_schema.columns" not in query
        return pa.table({
            "table_schema": ["public"],
            "table_name": ["orders"],
        })

    monkeypatch.setattr(loader, "_read_sql_on", fake_read_sql_on)

    result = loader.search_catalog("ord", limit=10)

    assert result["truncated"] is False
    assert result["tree"][0]["name"] == "public"
    table = result["tree"][0]["children"][0]
    assert table["name"] == "orders"
    assert table["metadata"]["_source_name"] == "analytics.public.orders"


def test_mysql_search_catalog_returns_lightweight_tree(monkeypatch):
    loader = MySQLDataLoader.__new__(MySQLDataLoader)
    loader.params = {"database": ""}
    loader.database = ""
    loader._lock = threading.Lock()

    def fake_read_sql(query):
        assert "information_schema.tables" in query
        assert "information_schema.columns" not in query
        return pa.table({
            "TABLE_SCHEMA": ["analytics"],
            "TABLE_NAME": ["orders"],
        })

    monkeypatch.setattr(loader, "_read_sql", fake_read_sql)

    result = loader.search_catalog("ord", limit=10)

    assert result["truncated"] is False
    assert result["tree"][0]["name"] == "analytics"
    table = result["tree"][0]["children"][0]
    assert table["name"] == "orders"
    assert table["metadata"]["_source_name"] == "analytics.orders"


def test_superset_search_catalog_returns_dataset_and_dashboard_matches(monkeypatch):
    loader = SupersetLoader.__new__(SupersetLoader)
    monkeypatch.setattr(loader, "_ensure_token", lambda: "token")
    monkeypatch.setattr(loader, "_fetch_all_datasets", lambda token: [
        {
            "id": 7,
            "table_name": "sales_orders",
            "row_count": 42,
            "schema": "public",
            "database": {"database_name": "warehouse"},
        },
    ])
    loader._client = SimpleNamespace(
        list_dashboards=lambda token, page=0, page_size=500: {
            "result": [{"id": 3, "dashboard_title": "Sales Overview"}],
        },
    )
    monkeypatch.setattr(loader, "_build_dashboard_group_metadata", lambda token, dashboard_id: [
        {"name": "sales_orders", "dataset_id": 7, "row_count": 42},
    ])

    result = loader.search_catalog("sales", limit=10)

    assert result["truncated"] is False
    datasets = result["tree"][0]
    assert datasets["name"] == "All Datasets"
    assert datasets["children"][0]["metadata"]["dataset_id"] == 7
    dashboard = result["tree"][1]
    assert dashboard["node_type"] == "table_group"
    assert dashboard["metadata"]["dashboard_id"] == 3
