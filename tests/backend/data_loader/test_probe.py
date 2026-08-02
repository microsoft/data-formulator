"""Tests for the connector-level probe capability (design 37 §4.2).

Covers the pure ``compile_probe_sql`` compiler and the base-class
``probe`` default (bounded fetch + local DuckDB compute).
"""
from __future__ import annotations

from typing import Any

import pyarrow as pa
import pytest

from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.probe_utils import (
    PROBE_MAX_ROWS,
    compile_probe_sql,
)

pytestmark = [pytest.mark.backend]


# ------------------------------------------------------------------
# A minimal in-memory loader that serves probe from a fixed Arrow table.
# ------------------------------------------------------------------

class _FakeLoader(ExternalDataLoader):
    """A sample-strategy (C) loader backed by a fixed Arrow table.

    ``fetch_data_as_arrow`` returns the fixed table, honoring ``size`` so scan
    capping can be exercised. It deliberately IGNORES source_filters (like the
    Kusto loader) so we test that DuckDB re-applies filters locally. ``probe``
    opts into the DuckDB read-and-compute strategy.
    """

    def __init__(self, table: pa.Table):
        self._table = table
        self.last_import_options: dict[str, Any] | None = None

    def fetch_data_as_arrow(self, source_table, import_options=None):
        self.last_import_options = import_options or {}
        size = (import_options or {}).get("size")
        if size is not None:
            return self._table.slice(0, size)
        return self._table

    def probe(self, path, query):
        # Small scan cap so the cap-behavior tests stay fast.
        return probe_utils.run_probe_on_duckdb(self, path, query, scan_size=_SCAN)

    def list_tables(self, table_filter=None):
        return []

    @staticmethod
    def list_params():
        return []

    @staticmethod
    def auth_instructions():
        return ""


class _FakeSqlLoader(ExternalDataLoader):
    """A native-pushdown (Strategy A) loader that records the compiled SQL."""

    def __init__(self, result: pa.Table):
        self._result = result
        self.last_sql: str | None = None

    def fetch_data_as_arrow(self, source_table, import_options=None):
        raise AssertionError("Strategy A must not fetch a local copy")

    def probe(self, path, query):
        relation = ".".join(f'"{p}"' for p in path)

        def _execute(sql: str) -> pa.Table:
            self.last_sql = sql
            return self._result

        return probe_utils.probe_via_native_sql(
            query, relation=relation, dialect=probe_utils.POSTGRES,
            execute=_execute,
        )

    def list_tables(self, table_filter=None):
        return []

    @staticmethod
    def list_params():
        return []

    @staticmethod
    def auth_instructions():
        return ""


class _BareLoader(ExternalDataLoader):
    """A loader that opts into no probe strategy (base defaults apply)."""

    def __init__(self):
        pass

    def fetch_data_as_arrow(self, source_table, import_options=None):
        return pa.table({})

    def list_tables(self, table_filter=None):
        return []

    @staticmethod
    def list_params():
        return []

    @staticmethod
    def auth_instructions():
        return ""


# Keep the sample scan cap small so cap tests don't build 100k-row tables.
_SCAN = 1_000


def _sample_table() -> pa.Table:
    return pa.table({
        "region": ["West", "West", "East", "East", "North"],
        "revenue": [10, 20, 30, 40, 50],
        "ts": [1, 2, 3, 4, 5],
    })


# ------------------------------------------------------------------
# compile_probe_sql
# ------------------------------------------------------------------

class TestCompileProbeSql:
    def test_sample_projection(self):
        sql = compile_probe_sql({"columns": ["region"]}, out_limit=10)
        assert sql == 'SELECT "region" FROM t LIMIT 10'

    def test_sample_all_columns(self):
        sql = compile_probe_sql({}, out_limit=5)
        assert sql == "SELECT * FROM t LIMIT 5"

    def test_count(self):
        sql = compile_probe_sql({"aggregates": [{"op": "count"}]}, out_limit=1)
        assert sql == 'SELECT count(*) AS "count" FROM t LIMIT 1'

    def test_group_by_count_order(self):
        sql = compile_probe_sql({
            "group_by": ["region"],
            "aggregates": [{"op": "count", "as": "n"}],
            "order_by": [{"column": "n", "dir": "desc"}],
        }, out_limit=50)
        assert sql == (
            'SELECT "region", count(*) AS "n" FROM t '
            'GROUP BY "region" ORDER BY "n" DESC LIMIT 50'
        )

    def test_count_distinct(self):
        sql = compile_probe_sql({
            "aggregates": [{"op": "count_distinct", "column": "region", "as": "d"}],
        }, out_limit=1)
        assert sql == 'SELECT count(DISTINCT "region") AS "d" FROM t LIMIT 1'

    def test_filter_applied(self):
        sql = compile_probe_sql({
            "filters": [{"column": "region", "op": "EQ", "value": "West"}],
        }, out_limit=10)
        assert 'WHERE "region" = \'West\'' in sql

    def test_invalid_agg_op_raises(self):
        with pytest.raises(ValueError):
            compile_probe_sql({"aggregates": [{"op": "median", "column": "x"}]}, out_limit=1)

    def test_count_distinct_without_column_raises(self):
        with pytest.raises(ValueError):
            compile_probe_sql({"aggregates": [{"op": "count_distinct"}]}, out_limit=1)


# ------------------------------------------------------------------
# Strategy B/C — DuckDB read-and-compute (sample fallback shape)
# ------------------------------------------------------------------

class TestProbeViaDuckDB:
    def test_count(self):
        loader = _FakeLoader(_sample_table())
        res = loader.probe(["db", "t"], {"aggregates": [{"op": "count", "as": "n"}]})
        assert res["rows"] == [{"n": 5}]
        assert res["exact"] is True

    def test_distinct_values_with_frequency(self):
        loader = _FakeLoader(_sample_table())
        res = loader.probe(["db", "t"], {
            "group_by": ["region"],
            "aggregates": [{"op": "count", "as": "n"}],
            "order_by": [{"column": "n", "dir": "desc"}],
        })
        counts = {r["region"]: r["n"] for r in res["rows"]}
        assert counts == {"West": 2, "East": 2, "North": 1}
        # Highest frequency first (West/East tie at 2, North last).
        assert res["rows"][-1] == {"region": "North", "n": 1}

    def test_filter_applied_locally_even_when_loader_ignores_it(self):
        loader = _FakeLoader(_sample_table())
        res = loader.probe(["db", "t"], {
            "filters": [{"column": "region", "op": "EQ", "value": "East"}],
            "aggregates": [{"op": "sum", "column": "revenue", "as": "total"}],
        })
        # East rows are revenue 30 + 40 = 70
        assert res["rows"] == [{"total": 70}]

    def test_date_range(self):
        loader = _FakeLoader(_sample_table())
        res = loader.probe(["db", "t"], {
            "aggregates": [
                {"op": "min", "column": "ts", "as": "lo"},
                {"op": "max", "column": "ts", "as": "hi"},
            ],
        })
        assert res["rows"] == [{"lo": 1, "hi": 5}]

    def test_sample_projection(self):
        loader = _FakeLoader(_sample_table())
        res = loader.probe(["db", "t"], {"columns": ["region"], "limit": 2})
        assert res["columns"] == ["region"]
        assert res["row_count"] == 2

    def test_output_capped_at_probe_max_rows(self):
        big = pa.table({"x": list(range(PROBE_MAX_ROWS + 100))})
        loader = _FakeLoader(big)
        res = loader.probe(["db", "t"], {"limit": PROBE_MAX_ROWS + 50})
        assert res["row_count"] == PROBE_MAX_ROWS

    def test_scan_cap_marks_approximate(self):
        # More rows than the scan cap -> aggregation over a sample -> exact False.
        n = _SCAN + 10
        big = pa.table({"g": ["a"] * n})
        loader = _FakeLoader(big)
        res = loader.probe(["db", "t"], {
            "group_by": ["g"],
            "aggregates": [{"op": "count", "as": "n"}],
        })
        assert res["exact"] is False
        assert "approximate" in (res.get("compiled_note") or "")

    def test_empty_path_errors(self):
        loader = _FakeLoader(_sample_table())
        res = loader.probe([], {})
        assert "error" in res


# ------------------------------------------------------------------
# base class — no probe strategy opted in
# ------------------------------------------------------------------

class TestProbeUnavailable:
    def test_base_probe_reports_unavailable(self):
        loader = _BareLoader()
        res = loader.probe(["db", "t"], {})
        assert "error" in res


# ------------------------------------------------------------------
# Strategy A — native SQL pushdown
# ------------------------------------------------------------------

class TestProbeViaSql:
    def test_compiles_native_sql_and_returns_exact(self):
        result = pa.table({"region": ["West"], "n": [2]})
        loader = _FakeSqlLoader(result)
        res = loader.probe(["sales", "orders"], {
            "group_by": ["region"],
            "aggregates": [{"op": "count", "as": "n"}],
            "order_by": [{"column": "n", "dir": "desc"}],
            "limit": 50,
        })
        # SQL is compiled against the qualified relation and run natively —
        # no local fetch/DuckDB (the fake's fetch_data_as_arrow would assert).
        assert loader.last_sql == (
            'SELECT "region", count(*) AS "n" FROM "sales"."orders" '
            'GROUP BY "region" ORDER BY "n" DESC LIMIT 50'
        )
        assert res["rows"] == [{"region": "West", "n": 2}]
        assert res["exact"] is True

    def test_filter_compiles_into_where(self):
        loader = _FakeSqlLoader(pa.table({"n": [1]}))
        loader.probe(["t"], {
            "filters": [{"column": "region", "op": "EQ", "value": "West"}],
            "aggregates": [{"op": "count", "as": "n"}],
        })
        assert 'WHERE "region" = \'West\'' in loader.last_sql

    def test_invalid_query_returns_error_without_executing(self):
        loader = _FakeSqlLoader(pa.table({"n": [1]}))
        res = loader.probe(["t"], {"aggregates": [{"op": "median", "column": "x"}]})
        assert "error" in res
        assert loader.last_sql is None


# ------------------------------------------------------------------
# SQL dialect variants (TOP / bracket quoting / emulated ILIKE)
# ------------------------------------------------------------------

class TestSqlDialects:
    def test_mssql_top_and_brackets(self):
        sql = compile_probe_sql(
            {
                "group_by": ["region"],
                "aggregates": [{"op": "count", "as": "n"}],
            },
            out_limit=50,
            relation="[dbo].[orders]",
            dialect=probe_utils.MSSQL,
        )
        assert sql == (
            "SELECT TOP 50 [region], count(*) AS [n] "
            "FROM [dbo].[orders] GROUP BY [region]"
        )

    def test_mysql_backtick_and_emulated_ilike(self):
        sql = compile_probe_sql(
            {"filters": [{"column": "name", "op": "ILIKE", "value": "foo"}]},
            out_limit=10,
            dialect=probe_utils.MYSQL,
        )
        assert sql == (
            "SELECT * FROM t WHERE LOWER(`name`) LIKE LOWER('%foo%') LIMIT 10"
        )

    def test_bigquery_backtick_path_relation(self):
        sql = compile_probe_sql(
            {"columns": ["a"]},
            out_limit=5,
            relation="`ds.tbl`",
            dialect=probe_utils.BIGQUERY,
        )
        assert sql == "SELECT `a` FROM `ds.tbl` LIMIT 5"


# ------------------------------------------------------------------
# Kusto — native KQL compiler
# ------------------------------------------------------------------

class TestKustoKql:
    def _loader(self):
        from data_formulator.data_loader.kusto_data_loader import KustoDataLoader
        return object.__new__(KustoDataLoader)

    def test_summarize_by_pipeline(self):
        loader = self._loader()
        kql = loader._compile_probe_kql(
            "Events",
            {
                "filters": [{"column": "Region", "op": "EQ", "value": "West"}],
                "group_by": ["Region"],
                "aggregates": [
                    {"op": "count", "as": "n"},
                    {"op": "sum", "column": "Amount", "as": "total"},
                ],
                "order_by": [{"column": "total", "dir": "desc"}],
            },
            100,
        )
        assert kql == (
            "['Events']\n"
            "| where ['Region'] == \"West\"\n"
            "| summarize ['n']=count(), ['total']=sum(['Amount']) by ['Region']\n"
            "| order by ['total'] desc\n"
            "| take 100"
        )

    def test_projection_and_take(self):
        loader = self._loader()
        kql = loader._compile_probe_kql("T", {"columns": ["a", "b"], "limit": 5}, 5)
        assert kql == "['T']\n| project ['a'], ['b']\n| take 5"

    def test_invalid_agg_raises(self):
        loader = self._loader()
        with pytest.raises(ValueError):
            loader._compile_probe_kql("T", {"aggregates": [{"op": "median", "column": "x"}]}, 1)


# ------------------------------------------------------------------
# Mongo — native aggregation-pipeline compiler
# ------------------------------------------------------------------

class TestMongoPipeline:
    def _loader(self):
        from data_formulator.data_loader.mongodb_data_loader import MongoDBDataLoader
        return object.__new__(MongoDBDataLoader)

    def test_group_pipeline_with_distinct(self):
        loader = self._loader()
        pipeline = loader._compile_probe_pipeline(
            {
                "filters": [{"column": "region", "op": "EQ", "value": "West"}],
                "group_by": ["region"],
                "aggregates": [
                    {"op": "count", "as": "n"},
                    {"op": "count_distinct", "column": "user", "as": "u"},
                ],
            },
            100,
        )
        assert pipeline == [
            {"$match": {"region": {"$eq": "West"}}},
            {"$group": {
                "_id": {"region": "$region"},
                "n": {"$sum": 1},
                "u": {"$addToSet": "$user"},
            }},
            {"$project": {
                "_id": 0,
                "region": "$_id.region",
                "n": 1,
                "u": {"$size": "$u"},
            }},
            {"$limit": 100},
        ]

    def test_between_match(self):
        loader = self._loader()
        pipeline = loader._compile_probe_pipeline(
            {"filters": [{"column": "ts", "op": "BETWEEN", "value": [1, 5]}]},
            10,
        )
        assert pipeline[0] == {"$match": {"ts": {"$gte": 1, "$lte": 5}}}

    def test_invalid_agg_raises(self):
        loader = self._loader()
        with pytest.raises(ValueError):
            loader._compile_probe_pipeline({"aggregates": [{"op": "median", "column": "x"}]}, 1)


