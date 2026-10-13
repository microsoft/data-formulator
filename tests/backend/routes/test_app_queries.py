"""Dashboard app data queries: workspace SQL and live connected-source reads (design-docs/59)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
import pyarrow as pa
import pytest
from flask import Flask

from data_formulator.app_queries import run_app_source_query, run_app_sql, validate_app_sql
from data_formulator.datalake.workspace import Workspace
from data_formulator.routes.apps import apps_bp

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def workspace(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"region": ["a", "b", "a"], "amount": [1, 2, 3]}), "sales")
    workspace.write_parquet(pd.DataFrame({"region": ["a", "b"], "name": ["Alpha", "Beta"]}), "regions")
    workspace.write_parquet(pd.DataFrame({"secret": ["s"]}), "private")
    return workspace


@pytest.fixture()
def client(workspace):
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(apps_bp)
    register_error_handlers(app)
    with patch("data_formulator.routes.apps.get_workspace", return_value=workspace), \
            patch("data_formulator.routes.apps.get_identity_id", return_value="local:test"):
        with app.test_client() as test_client:
            yield test_client


def test_sql_joins_declared_tables_with_bound_parameters(workspace) -> None:
    result = run_app_sql(workspace, ["sales", "regions"],
                         "select r.name, sum(s.amount) as total from sales s join regions r using (region) "
                         "where s.amount >= ? group by 1 order by 1;", [1])
    assert result == {"rows": [{"name": "Alpha", "total": 4.0}, {"name": "Beta", "total": 2.0}],
                      "columns": ["name", "total"], "truncated": False}


def test_sql_caps_rows_and_reports_truncation(workspace) -> None:
    result = run_app_sql(workspace, ["sales"], "select * from sales order by amount", limit=2)
    assert [row["amount"] for row in result["rows"]] == [1, 2] and result["truncated"] is True
    with pytest.raises(ValueError, match="limit must be an integer"):
        run_app_sql(workspace, ["sales"], "select 1", limit=500_000)


@pytest.mark.parametrize("sql, message", [
    ("select * from private", "'private' is not declared"),
    ("select * from read_parquet('/etc/passwd')", "cannot call table functions"),
    ("select * from duckdb_settings()", "cannot call table functions"),
    ("select * from main.sales", "by name only"),
    ("delete from sales", "exactly one SELECT"),
    ("select 1; select 2", "exactly one SELECT"),
    ("select * from", "SQL syntax error"),
])
def test_sql_reads_only_declared_tables(sql, message) -> None:
    with pytest.raises(ValueError, match=message):
        validate_app_sql(sql, ["sales"])


def test_sql_runs_on_a_locked_connection(workspace) -> None:
    # Even past validation, the connection cannot reach other files or the environment.
    with pytest.raises(ValueError, match="getenv"):
        run_app_sql(workspace, ["sales"], "select getenv('HOME') as home from sales")
    assert validate_app_sql("with t as (select * from sales) select * from t", ["sales"])


def test_sql_route_returns_rows_or_a_query_error(client) -> None:
    response = client.post("/api/apps/sql", json={"tables": ["sales"], "sql": "select count(*) as n from sales"})
    assert response.status_code == 200 and response.get_json()["data"]["rows"] == [{"n": 3}]
    response = client.post("/api/apps/sql", json={"tables": ["sales"], "sql": "select * from private"})
    # App errors use the API's error envelope; the frontend raises it as a query error in the app.
    body = response.get_json()
    assert body["status"] == "error" and "not declared" in body["error"]["message"]


class _Loader:
    def __init__(self):
        self.calls = []

    def query_model(self, source_table):
        return "relational"

    def check_native_query(self, native):
        if native["language"] != "kql":
            raise ValueError("Native query language is not supported by this connector.")

    def query_data_as_arrow(self, source_table, query, limit):
        self.calls.append(("query", source_table, query, limit))
        return pa.table({"day": ["d1", "d2", "d3"], "events": [3, 2, 1]})

    def fetch_data_as_arrow(self, source_table, import_options=None):
        self.calls.append(("fetch", source_table, import_options))
        return pa.table({"day": ["d1", "d2"], "events": [3, 2]})


def _source(monkeypatch):
    loader = _Loader()
    monkeypatch.setattr("data_formulator.data_connector.resolve_live_loader", lambda source_id: loader)
    monkeypatch.setattr("data_formulator.data_operations.discovery.DataDiscoveryService.resolve_load_table",
                        lambda self, source_id, table_key: {"source_table": "db.Events"} if table_key == "Events" else None)
    return loader


def test_source_query_runs_aggregates_at_the_source(monkeypatch) -> None:
    loader = _source(monkeypatch)
    result = run_app_source_query(SimpleNamespace(), "kusto", "Events",
                                  {"group_by": ["day"], "aggregates": [{"op": "count", "as": "events"}]}, limit=2)
    assert result["rows"] == [{"day": "d1", "events": 3}, {"day": "d2", "events": 2}] and result["truncated"] is True
    assert loader.calls == [("query", "db.Events", {"group_by": ["day"], "aggregates": [{"op": "count", "as": "events"}]}, 3)]


def test_source_query_fetches_filtered_rows(monkeypatch) -> None:
    loader = _source(monkeypatch)
    result = run_app_source_query(SimpleNamespace(), "kusto", "Events",
                                  {"filters": [{"column": "day", "op": "EQ", "value": "d1"}], "columns": ["day", "events"]})
    assert result["truncated"] is False and len(result["rows"]) == 2
    assert loader.calls[0][0] == "fetch" and loader.calls[0][2]["source_filters"] == [{"column": "day", "operator": "EQ", "value": "d1"}]


@pytest.mark.parametrize("table_key, query, message", [
    ("Missing", {}, "not in the catalog"),
    ("Events", {"native": {"language": "sql", "text": "select 1"}}, "not supported"),
    ("Events", {"sql": "select 1"}, "Unsupported load query fields"),
])
def test_source_query_refuses_unknown_tables_and_queries(monkeypatch, table_key, query, message) -> None:
    _source(monkeypatch)
    with pytest.raises(ValueError, match=message):
        run_app_source_query(SimpleNamespace(), "kusto", table_key, query)
