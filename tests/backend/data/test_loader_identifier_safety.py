"""Query identifier safety regression tests for external data loaders."""

from __future__ import annotations

import threading
from unittest.mock import MagicMock

import pytest

pytestmark = [pytest.mark.backend, pytest.mark.security]


@pytest.mark.parametrize(
    ("loader_factory", "source_table", "sort_column", "execute_attr"),
    [
        ("mysql", "analytics.orders; DROP TABLE users", "created_at", "_read_sql"),
        ("mssql", "dbo.orders] DROP TABLE users", "created_at", "_execute_query"),
        ("kusto", "Orders'] | take 1", "created_at", "query"),
        ("bigquery", "project.dataset.orders` WHERE TRUE", "created_at", "client.query"),
        ("mysql", "analytics.orders", "created_at; DROP TABLE users", "_read_sql"),
        ("mssql", "dbo.orders", "created_at] DROP TABLE users", "_execute_query"),
        ("kusto", "Orders", "created_at | take 1", "query"),
        ("bigquery", "project.dataset.orders", "created_at` DESC", "client.query"),
    ],
)
def test_unsafe_identifiers_fail_before_query_execution(
    loader_factory: str,
    source_table: str,
    sort_column: str,
    execute_attr: str,
) -> None:
    loader = _make_loader(loader_factory)
    execute = loader
    for part in execute_attr.split("."):
        execute = getattr(execute, part)

    with pytest.raises(ValueError, match="Invalid identifier"):
        loader.fetch_data_as_arrow(
            source_table,
            {"sort_columns": [sort_column], "size": 10},
        )

    execute.assert_not_called()


def _make_loader(loader_type: str):
    if loader_type == "mysql":
        from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader

        loader = MySQLDataLoader.__new__(MySQLDataLoader)
        loader.database = "analytics"
        loader._lock = threading.Lock()
        loader._safe_select_list = MagicMock(return_value="*")
        loader._read_sql = MagicMock()
        return loader

    if loader_type == "mssql":
        from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader

        loader = MSSQLDataLoader.__new__(MSSQLDataLoader)
        loader._safe_select_list = MagicMock(return_value="*")
        loader._execute_query = MagicMock()
        return loader

    if loader_type == "kusto":
        from data_formulator.data_loader.kusto_data_loader import KustoDataLoader

        loader = KustoDataLoader.__new__(KustoDataLoader)
        loader.query = MagicMock()
        return loader

    if loader_type == "bigquery":
        from data_formulator.data_loader.bigquery_data_loader import BigQueryDataLoader

        loader = BigQueryDataLoader.__new__(BigQueryDataLoader)
        loader.client = MagicMock()
        loader.client.query = MagicMock()
        loader._build_select_parts = MagicMock(return_value=["*"])
        return loader

    raise AssertionError(f"Unknown loader type: {loader_type}")
