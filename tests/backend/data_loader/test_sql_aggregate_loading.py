"""Structured aggregate loading for SQL connectors.

SQL connectors run durable ``group_by``/``aggregates`` loads by compiling the
structured query with the probe compiler and executing one SELECT on the
source. Only the connection layer is mocked; table resolution, quoting, and
the executor's row-cap handling are real.
"""
from __future__ import annotations

import threading
from unittest.mock import Mock

import pyarrow as pa
import pytest

from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.athena_data_loader import AthenaDataLoader
from data_formulator.data_loader.bigquery_data_loader import BigQueryDataLoader
from data_formulator.data_loader.clickhouse_data_loader import ClickHouseDataLoader
from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader
from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
from data_formulator.data_loader.postgresql_data_loader import PostgreSQLDataLoader
from data_formulator.data_operations.executor import MAX_AGGREGATE_ROWS, execute_aggregate_query
from data_formulator.data_operations.models import LoadQuery

pytestmark = [pytest.mark.backend]

QUERY = {
    "filters": [{"column": "region", "op": "EQ", "value": "West"}],
    "group_by": ["region"],
    "aggregates": [{"op": "sum", "column": "amount", "as": "total"}],
    "order_by": [{"column": "total", "dir": "desc"}],
}
RESULT = pa.table({"region": ["West"], "total": [42]})


def _recorder():
    calls: list[str] = []

    def execute(sql: str, *_args, **_kwargs) -> pa.Table:
        calls.append(sql)
        return RESULT

    return calls, execute


class TestStrictCompile:
    @pytest.mark.parametrize("bad_filter", [
        {"column": "region", "op": "REGEX", "value": "W.*"},
        {"column": "region", "op": "IN", "value": []},
        {"column": "amount", "op": "BETWEEN", "value": [1]},
        {"op": "EQ", "value": "West"},
        {"column": "a;b", "op": "EQ", "value": 1},
    ])
    def test_durable_loads_reject_filters_probes_would_drop(self, bad_filter):
        query = {"filters": [bad_filter], "aggregates": [{"op": "count", "as": "n"}]}
        assert "WHERE" not in probe_utils.compile_probe_sql(query, 10)
        with pytest.raises(ValueError):
            probe_utils.compile_probe_sql(query, 10, strict=True)

    def test_durable_loads_reject_malformed_ordering(self):
        query = {"aggregates": [{"op": "count", "as": "n"}], "order_by": [{"dir": "desc"}]}
        with pytest.raises(ValueError):
            probe_utils.compile_probe_sql(query, 10, strict=True)

    def test_native_text_and_invalid_limits_never_execute(self):
        execute = Mock()
        for query, limit in (({"native": {"language": "sql", "text": "SELECT 1"}}, 10),
                             (QUERY, 0), (QUERY, True)):
            with pytest.raises(ValueError):
                probe_utils.query_via_native_sql(query, limit, relation='"t"',
                                                 dialect=probe_utils.POSTGRES, execute=execute)
        execute.assert_not_called()


class TestSqlConnectors:
    def test_postgresql_compiles_against_the_resolved_schema(self):
        loader = object.__new__(PostgreSQLDataLoader)
        loader.database = "main"
        calls, loader._read_sql = _recorder()
        assert loader.query_data_as_arrow("sales.orders", QUERY, 10001) is RESULT
        assert calls == [
            'SELECT "region", sum("amount") AS "total" FROM "sales"."orders" '
            "WHERE \"region\" = 'West' GROUP BY \"region\" ORDER BY \"total\" DESC LIMIT 10001"
        ]

    def test_postgresql_routes_cross_database_tables(self):
        loader = object.__new__(PostgreSQLDataLoader)
        loader.database = "main"
        loader._read_sql = Mock()
        loader._read_sql_on = Mock(return_value=RESULT)
        loader.query_data_as_arrow("warehouse.public.orders", QUERY, 5)
        sql, database = loader._read_sql_on.call_args.args
        assert database == "warehouse"
        assert 'FROM "public"."orders"' in sql
        loader._read_sql.assert_not_called()

    def test_mysql_uses_the_configured_database_under_the_connection_lock(self):
        loader = object.__new__(MySQLDataLoader)
        loader.database = "shop"
        loader._lock = threading.Lock()
        calls: list[str] = []

        def read(sql: str) -> pa.Table:
            assert loader._lock.locked()
            calls.append(sql)
            return RESULT

        loader._read_sql = read
        loader.query_data_as_arrow("orders", QUERY, 5)
        assert "FROM `shop`.`orders`" in calls[0]
        assert calls[0].endswith("LIMIT 5")

    def test_mssql_defaults_to_dbo_and_uses_top(self):
        loader = object.__new__(MSSQLDataLoader)
        calls, loader._execute_query = _recorder()
        loader.query_data_as_arrow("orders", QUERY, 10001)
        assert calls == [
            "SELECT TOP 10001 [region], sum([amount]) AS [total] FROM [dbo].[orders] "
            "WHERE [region] = 'West' GROUP BY [region] ORDER BY [total] DESC"
        ]

    def test_bigquery_quotes_the_whole_table_path(self):
        loader = object.__new__(BigQueryDataLoader)
        loader.client = Mock()
        loader.client.query.return_value.to_arrow.return_value = RESULT
        assert loader.query_data_as_arrow("proj.ds.orders", QUERY, 5) is RESULT
        assert "FROM `proj.ds.orders`" in loader.client.query.call_args.args[0]

    def test_clickhouse_stays_within_the_configured_database(self):
        loader = object.__new__(ClickHouseDataLoader)
        loader.database = "analytics"
        calls, loader._read_sql = _recorder()
        loader.query_data_as_arrow("events", QUERY, 5)
        assert "FROM `analytics`.`events`" in calls[0]
        with pytest.raises(ValueError, match="outside the configured database"):
            loader.query_data_as_arrow("other.events", QUERY, 5)
        assert len(calls) == 1

    def test_athena_validates_the_table_and_reads_results(self):
        loader = object.__new__(AthenaDataLoader)
        calls, loader._run_query_arrow = _recorder()
        loader.query_data_as_arrow("db.orders", QUERY, 5)
        assert 'SELECT "region", sum("amount") AS "total" FROM db.orders' in calls[0]
        with pytest.raises(ValueError):
            loader.query_data_as_arrow("db.orders; DROP TABLE x", QUERY, 5)
        assert len(calls) == 1

    @pytest.mark.parametrize("loader_class", [
        PostgreSQLDataLoader, MySQLDataLoader, MSSQLDataLoader,
        BigQueryDataLoader, ClickHouseDataLoader, AthenaDataLoader,
    ])
    def test_advertises_aggregate_loading_but_no_native_language(self, loader_class):
        capabilities = loader_class.query_capabilities()
        assert capabilities["aggregate_loading"] == "supported"
        assert capabilities["native_query_languages"] == []
        assert capabilities["execution_model"] == "server_query"


class TestExecutorIntegration:
    def _loader(self, rows: int):
        loader = object.__new__(PostgreSQLDataLoader)
        loader.database = "main"
        loader._read_sql = Mock(return_value=pa.table({"region": [f"r{i}" for i in range(rows)]}))
        return loader

    def test_overflow_without_an_explicit_limit_fails(self):
        loader = self._loader(MAX_AGGREGATE_ROWS + 1)
        with pytest.raises(ValueError, match="exceeds 10000 rows"):
            execute_aggregate_query(loader, "orders", LoadQuery.from_dict(QUERY))
        assert loader._read_sql.call_args.args[0].endswith(f"LIMIT {MAX_AGGREGATE_ROWS + 1}")

    def test_explicit_limit_bounds_the_result(self):
        loader = self._loader(4)
        table = execute_aggregate_query(loader, "orders", LoadQuery.from_dict({**QUERY, "limit": 3}))
        assert table.num_rows == 3
        assert loader._read_sql.call_args.args[0].endswith("LIMIT 4")

    def test_native_queries_are_rejected_before_the_source_is_queried(self):
        loader = self._loader(1)
        query = LoadQuery.from_dict({"native": {"language": "kql", "text": "orders | count"}})
        with pytest.raises(ValueError, match="Native query language is not supported"):
            execute_aggregate_query(loader, "orders", query)
        loader._read_sql.assert_not_called()
