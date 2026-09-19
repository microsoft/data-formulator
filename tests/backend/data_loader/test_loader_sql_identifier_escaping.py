"""Identifier/literal escaping for loaders that build SQL by interpolation.

``sort_columns`` and ``source_table`` reach ORDER BY / FROM clauses from
agent- and request-supplied import options, so a hostile value must be
escaped or rejected rather than concatenated into the query text.
"""
from __future__ import annotations

from unittest import mock

import pyarrow as pa
import pytest

from data_formulator.data_loader.bigquery_data_loader import BigQueryDataLoader
from data_formulator.data_loader.cosmosdb_data_loader import CosmosDBDataLoader
from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader

pytestmark = [pytest.mark.backend]

# Breaks out of backtick, bracket and bare-identifier quoting respectively.
INJECTIONS = [
    "col` FROM secrets; --",
    "col] FROM secrets; --",
    "col; DROP TABLE users",
    "col--comment",
    "col/*comment",
]


def _new(cls):
    """Build a loader without running its connecting ``__init__``."""
    return object.__new__(cls)


# ---------------------------------------------------------------------------
# BigQuery
# ---------------------------------------------------------------------------

@pytest.fixture()
def bigquery_loader():
    loader = _new(BigQueryDataLoader)
    loader.client = mock.MagicMock()
    loader.client.get_table.return_value = mock.MagicMock()
    loader.client.query.return_value.to_arrow.return_value = pa.table({})
    with mock.patch.object(BigQueryDataLoader, "_build_select_parts", return_value=["`id`"]):
        yield loader


def _bigquery_query(loader) -> str:
    return loader.client.query.call_args[0][0]


class TestBigQueryOrderBy:
    def test_escapes_backtick_in_sort_column(self, bigquery_loader):
        bigquery_loader.fetch_data_as_arrow(
            "proj.ds.tbl", {"size": 10, "sort_columns": ["amount`gross"]}
        )
        assert "ORDER BY `amount``gross` ASC" in _bigquery_query(bigquery_loader)

    @pytest.mark.parametrize("payload", INJECTIONS)
    def test_rejects_or_neutralizes_injection(self, bigquery_loader, payload):
        try:
            bigquery_loader.fetch_data_as_arrow(
                "proj.ds.tbl", {"size": 10, "sort_columns": [payload]}
            )
        except ValueError:
            return
        assert "FROM secrets" not in _bigquery_query(bigquery_loader)


# ---------------------------------------------------------------------------
# SQL Server
# ---------------------------------------------------------------------------

@pytest.fixture()
def mssql_loader():
    loader = _new(MSSQLDataLoader)
    loader.queries = []

    def fake_read_sql(query: str):
        loader.queries.append(query)
        return pa.table({})

    loader._read_sql = fake_read_sql  # type: ignore[method-assign]
    return loader


class TestMssqlEscaping:
    def test_escapes_bracket_in_sort_column(self, mssql_loader):
        mssql_loader.fetch_data_as_arrow(
            "dbo.events", {"size": 10, "sort_columns": ["amount]gross"]}
        )
        assert "ORDER BY [amount]]gross] ASC" in mssql_loader.queries[-1]

    @pytest.mark.parametrize("payload", INJECTIONS)
    def test_rejects_or_neutralizes_sort_injection(self, mssql_loader, payload):
        try:
            mssql_loader.fetch_data_as_arrow(
                "dbo.events", {"size": 10, "sort_columns": [payload]}
            )
        except ValueError:
            return
        assert "FROM secrets" not in mssql_loader.queries[-1]
        assert "DROP TABLE" not in mssql_loader.queries[-1]

    def test_rejects_injection_in_source_table(self, mssql_loader):
        with pytest.raises(ValueError):
            mssql_loader.fetch_data_as_arrow(
                "dbo.events; DROP TABLE users", {"size": 10}
            )

    def test_escapes_quote_in_schema_literal(self, mssql_loader):
        mssql_loader._safe_select_list("dbo' OR '1'='1", "events")
        assert "dbo'' OR ''1''=''1" in mssql_loader.queries[0]


# ---------------------------------------------------------------------------
# Cosmos DB
# ---------------------------------------------------------------------------

@pytest.fixture()
def cosmos_loader():
    loader = _new(CosmosDBDataLoader)
    loader.db = mock.MagicMock()
    loader.db.get_container_client.return_value.query_items.return_value = []
    return loader


def _cosmos_query(loader) -> str:
    return loader.db.get_container_client.return_value.query_items.call_args.kwargs["query"]


class TestCosmosOrderBy:
    def test_allows_plain_property(self, cosmos_loader):
        cosmos_loader.fetch_data_as_arrow("items", {"size": 10, "sort_columns": ["created_at"]})
        assert "ORDER BY c.created_at ASC" in _cosmos_query(cosmos_loader)

    @pytest.mark.parametrize("payload", INJECTIONS + ["a b", "a'b"])
    def test_rejects_injection(self, cosmos_loader, payload):
        with pytest.raises(ValueError):
            cosmos_loader.fetch_data_as_arrow(
                "items", {"size": 10, "sort_columns": [payload]}
            )
