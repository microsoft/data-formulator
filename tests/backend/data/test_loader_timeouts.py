"""Finite timeout contracts for external connector SDK calls."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytestmark = [pytest.mark.backend]


def test_mongodb_configures_finite_connection_timeouts() -> None:
    from data_formulator.data_loader.mongodb_data_loader import MongoDBDataLoader

    with patch("pymongo.MongoClient") as client:
        MongoDBDataLoader({"host": "localhost", "database": "db"})

    kwargs = client.call_args.kwargs
    assert 0 < kwargs["serverSelectionTimeoutMS"] <= 30_000
    assert 0 < kwargs["connectTimeoutMS"] <= 30_000
    assert 0 < kwargs["socketTimeoutMS"] <= 120_000


def test_cosmos_configures_finite_connection_timeout() -> None:
    from data_formulator.data_loader.cosmosdb_data_loader import CosmosDBDataLoader

    with patch("data_formulator.data_loader.cosmosdb_data_loader.CosmosClient") as client:
        client.return_value.get_database_client.return_value.read.return_value = {}
        CosmosDBDataLoader({
            "endpoint": "https://example.documents.azure.com",
            "key": "secret",
            "database": "db",
        })

    assert 0 < client.call_args.kwargs["connection_timeout"] <= 30


def test_kusto_query_sets_server_timeout() -> None:
    from data_formulator.data_loader.kusto_data_loader import KustoDataLoader

    loader = KustoDataLoader.__new__(KustoDataLoader)
    loader.kusto_database = "db"
    loader.client = MagicMock()
    loader.client.execute.return_value = SimpleNamespace(primary_results=[MagicMock()])

    with patch(
        "data_formulator.data_loader.kusto_data_loader.dataframe_from_result_table",
        return_value=MagicMock(),
    ), patch.object(loader, "_convert_kusto_datetime_columns", side_effect=lambda value: value):
        loader.query("Orders | take 1")

    properties = loader.client.execute.call_args.args[2]
    assert properties.get_option("servertimeout", None) is not None


def test_bigquery_calls_use_finite_timeouts() -> None:
    from data_formulator.data_loader.bigquery_data_loader import BigQueryDataLoader

    loader = BigQueryDataLoader.__new__(BigQueryDataLoader)
    loader.project_id = "project"
    loader.dataset_ids = []
    loader.client = MagicMock()
    loader.client.list_datasets.return_value = []

    loader.list_tables()

    assert 0 < loader.client.list_datasets.call_args.kwargs["timeout"] <= 30
