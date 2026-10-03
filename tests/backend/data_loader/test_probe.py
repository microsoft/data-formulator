"""Tests for the connector-level probe capability (design 37 §4.2).

Covers the pure ``compile_probe_sql`` compiler and the base-class
``probe`` default (bounded fetch + local DuckDB compute).
"""
from __future__ import annotations

from typing import Any
from unittest.mock import Mock, patch

import pyarrow as pa
import duckdb
import pytest

from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.probe_utils import (
    PROBE_MAX_ROWS,
    compile_probe_sql,
)

pytestmark = [pytest.mark.backend]


@pytest.mark.parametrize("extension,content,expected", [
    ("csv", '\ufeffcode,text,score\r\n001,"line one\nline two, ""quoted""",2\r\n002,,\r\n',
     [{"code": "001", "text": 'line one\nline two, "quoted"', "score": 2},
      {"code": "002", "text": None, "score": None}]),
    ("tsv", "code\tvalue\n001\tfirst\n002\tsecond\n",
     [{"code": "001", "value": "first"}, {"code": "002", "value": "second"}]),
    ("json", '[{"key":"first"},{"key":"second","nested":{"value":2}}]',
     [{"key": "first", "nested": None}, {"key": "second", "nested": {"value": 2}}]),
    ("json", '\ufeff {\n "key": "single",\n "value": null\n}', [{"key": "single", "value": None}]),
    ("jsonl", '{"key":"first"}\n{"key":"second","value":2}\n',
     [{"key": "first", "value": None}, {"key": "second", "value": 2}]),
])
def test_native_text_reader_compatibility(tmp_path, extension, content, expected):
    path = tmp_path / f"[literal]*.{extension}"
    path.write_text(content, encoding="utf-8")
    with duckdb.connect() as connection:
        probe_utils.register_file_scan(connection, str(path))
        assert connection.execute("SELECT * FROM t").fetch_arrow_table().to_pylist() == expected


@pytest.mark.parametrize("content", ['[1, 2]', '[{"value": 1}, 2]', '{"value": invalid}'])
def test_native_json_rejects_invalid_records(tmp_path, content):
    path = tmp_path / "invalid.json"
    path.write_text(content)
    with duckdb.connect() as connection, pytest.raises(duckdb.Error):
        probe_utils.register_file_scan(connection, str(path))
        connection.execute("SELECT * FROM t").fetchall()


@pytest.mark.parametrize("purpose,expected_rows,value_limit", [("ui", 50, 1000), ("agent", 5, 200)])
def test_native_preview_bounds_columns_rows_and_values(tmp_path, purpose, expected_rows, value_limit):
    import pyarrow.parquet as pq

    path = tmp_path / "wide.parquet"
    pq.write_table(pa.table({f"field_{index}": ["x" * 2000] * 100 for index in range(30)}), path)
    result = probe_utils.preview_file(probe_utils.register_file_scan, str(path), {"size": 100}, purpose=purpose)
    assert len(result["rows"]) == expected_rows
    assert len(result["columns"]) == 20
    assert result["rows"][0]["field_0"] == "x" * value_limit + "..."
    assert result["inspection"]["columns_omitted"] == 10
    assert result["inspection"]["values_truncated"] is True
    assert result["inspection"]["schema_source"] == "footer"
    assert result["total_row_count"] is None
    selected = probe_utils.preview_file(probe_utils.register_file_scan, str(path), {"columns": ["field_29"]})
    assert [column["name"] for column in selected["columns"]] == ["field_29"]


def test_preview_preserves_nested_structure_with_a_cell_budget():
    table = pa.Table.from_pylist([{"record": {"items": ["x" * 100] * 30, "extra": "y" * 1000}}])
    preview = ExternalDataLoader.format_preview(table, {"size": 5}, purpose="agent")
    assert isinstance(preview["rows"][0]["record"], dict)
    assert len(str(preview["rows"][0]["record"])) < 250
    assert preview["inspection"]["values_truncated"] is True


def test_native_preview_projects_before_execution():
    with patch("duckdb.connect") as connect:
        connection = connect.return_value.__enter__.return_value
        connection.execute.return_value.fetch_arrow_table.return_value = pa.table({"field_0": [1]})
        register = Mock()
        register.return_value.columns = [f"field_{index}" for index in range(30)]
        probe_utils.preview_file(register, "data.parquet", {"size": 5})
    register.assert_called_once_with(connection, "data.parquet", preview=True)
    connection.table.assert_not_called()
    statement = connection.execute.call_args.args[0]
    assert '"field_19"' in statement
    assert '"field_20"' not in statement
    assert statement.endswith("LIMIT 5")


def test_athena_import_pushes_filters_projection_and_sort_before_limit():
    from data_formulator.data_loader.athena_data_loader import AthenaDataLoader

    loader = object.__new__(AthenaDataLoader)
    loader._execute_query = Mock(return_value="s3://fixture/results.csv")
    loader.s3_fs = Mock()
    loader.s3_fs.open_input_file.return_value.__enter__ = Mock()
    loader.s3_fs.open_input_file.return_value.__exit__ = Mock()
    expected = pa.table({"score": [9]})
    with patch("data_formulator.data_loader.athena_data_loader.pa_csv.read_csv", return_value=expected):
        assert loader.fetch_data_as_arrow("db.reviews", {
            "size": 1, "columns": ["score"], "sort_columns": ["score"], "sort_order": "desc",
            "source_filters": [{"column": "group", "operator": "EQ", "value": "target"}],
        }) is expected
    sql = loader._execute_query.call_args.args[0]
    assert 'SELECT "score" FROM db.reviews' in sql
    assert 'WHERE "group" = \'target\'' in sql
    assert 'ORDER BY "score" DESC' in sql
    assert sql.endswith("LIMIT 1")


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
    @pytest.mark.parametrize("values", [["West", "East"], ["West", "West"], ["O'Brien", "East"],
                                        ["West", None], []])
    @pytest.mark.parametrize("operator", ["IN", "NOT_IN"])
    def test_duckdb_string_membership_preserves_results(self, values, operator):
        query = {"filters": [{"column": "region", "op": operator, "value": values}],
                 "order_by": [{"column": "id", "dir": "desc"}]}
        with duckdb.connect() as connection:
            connection.register("t", pa.table({"id": [1, 2, 3, 4, 5],
                                               "region": ["West", "East", "O'Brien", "North", None]}))
            baseline = compile_probe_sql(query, 3, dialect=probe_utils.DUCKDB)
            optimized = compile_probe_sql(query, 3, dialect=probe_utils.DUCKDB, string_columns=("region",))
            assert connection.execute(optimized).fetchall() == connection.execute(baseline).fetchall()

    def test_membership_optimization_requires_duckdb_and_verified_string_column(self):
        query = {"filters": [{"column": "date", "op": "IN", "value": ["2024-01-01", "2024-01-02"]}]}
        assert "list_contains" not in compile_probe_sql(query, 10, dialect=probe_utils.DUCKDB)
        assert "list_contains" not in compile_probe_sql(query, 10, dialect=probe_utils.POSTGRES,
                                                       string_columns=("date",))
        with duckdb.connect() as connection:
            connection.execute("CREATE TABLE t AS SELECT DATE '2024-01-01' AS date")
            assert len(connection.execute(compile_probe_sql(query, 10, dialect=probe_utils.DUCKDB)).fetchall()) == 1

    def test_string_membership_is_exact_inside_parquet_scan(self, tmp_path):
        import pyarrow.parquet as pq

        path = tmp_path / "reviews.parquet"
        pq.write_table(pa.table({"title": ["first", "other", "second", None],
                                "quote": ["first review", "unneeded review", "second review", None]}), path)
        query = {"filters": [{"column": "title", "op": "IN", "value": ["first", "second"]}]}
        sql = compile_probe_sql(query, 10, dialect=probe_utils.DUCKDB, string_columns=("title",))
        assert '"title" IN' in sql
        with duckdb.connect() as connection:
            probe_utils.register_file_scan(connection, str(path))
            plan = connection.execute("EXPLAIN " + sql).fetchone()[1]
            scan_plan = plan.split("PARQUET_SCAN", 1)[1]
            assert "list_contains" in scan_plan
            assert "Filters:" in scan_plan
            assert connection.execute(sql).fetchall() == [("first", "first review"), ("second", "second review")]

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


