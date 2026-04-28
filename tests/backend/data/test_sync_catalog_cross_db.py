"""Tests for cross-database sync_catalog_metadata in PostgreSQL and MSSQL.

Background
----
When the ``database`` connection param is empty, PostgreSQL and MSSQL loaders
must iterate all accessible databases during sync_catalog_metadata() because
their information_schema is per-database (unlike MySQL where it is global).
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
import pyarrow as pa

pytestmark = [pytest.mark.backend]


# ── Helpers ────────────────────────────────────────────────────────────

def _arrow_from_dicts(rows: list[dict], columns: list[str]) -> pa.Table:
    """Build a PyArrow table from a list of row dicts."""
    if not rows:
        return pa.table({c: pa.array([], type=pa.null()) for c in columns})
    return pa.table({c: [r[c] for r in rows] for c in columns})


# ── PostgreSQL ─────────────────────────────────────────────────────────

class TestPostgreSQLSyncCatalogMetadata:
    """sync_catalog_metadata for PostgreSQLDataLoader."""

    @pytest.fixture()
    def _patch_pg_connect(self):
        """Prevent real psycopg2 connections."""
        with patch("psycopg2.connect") as mock_conn:
            conn = MagicMock()
            conn.autocommit = True
            mock_conn.return_value = conn
            yield mock_conn

    def _make_loader(self, *, database: str = "", _patch_pg_connect=None):
        from data_formulator.data_loader.postgresql_data_loader import (
            PostgreSQLDataLoader,
        )
        return PostgreSQLDataLoader({
            "host": "localhost",
            "port": "5432",
            "user": "postgres",
            "password": "pass",
            "database": database,
        })

    # -- Single database (database specified) --

    def test_single_db_delegates_to_list_tables(self, _patch_pg_connect):
        loader = self._make_loader(database="mydb")
        fake_tables = [
            {"name": "public.orders", "metadata": {"_source_name": "public.orders", "columns": []}},
        ]
        with patch.object(loader, "list_tables", return_value=fake_tables) as lt:
            result = loader.sync_catalog_metadata()
        lt.assert_called_once_with(None)
        assert len(result) == 1
        assert result[0]["name"] == "public.orders"
        assert result[0].get("table_key")

    # -- Multi database (database empty) --

    def test_multi_db_iterates_all_databases(self, _patch_pg_connect):
        loader = self._make_loader(database="")

        db_list = _arrow_from_dicts(
            [{"datname": "app_db"}, {"datname": "analytics"}],
            ["datname"],
        )

        app_tables = _arrow_from_dicts(
            [{"schemaname": "public", "tablename": "users"}],
            ["schemaname", "tablename"],
        )
        app_cols = _arrow_from_dicts(
            [{"table_schema": "public", "table_name": "users",
              "column_name": "id", "data_type": "integer", "column_comment": None}],
            ["table_schema", "table_name", "column_name", "data_type", "column_comment"],
        )
        app_comments = _arrow_from_dicts([], ["schemaname", "tablename", "table_comment"])

        analytics_tables = _arrow_from_dicts(
            [{"schemaname": "public", "tablename": "events"}],
            ["schemaname", "tablename"],
        )
        analytics_cols = _arrow_from_dicts(
            [{"table_schema": "public", "table_name": "events",
              "column_name": "ts", "data_type": "timestamp", "column_comment": None}],
            ["table_schema", "table_name", "column_name", "data_type", "column_comment"],
        )
        analytics_comments = _arrow_from_dicts([], ["schemaname", "tablename", "table_comment"])

        call_count = {"app_db": 0, "analytics": 0}

        def fake_read_sql(query):
            if "pg_database" in query:
                return db_list
            return pa.table({})

        def fake_read_sql_on(query, db=None):
            if db == "app_db":
                call_count["app_db"] += 1
                n = call_count["app_db"]
                if n == 1:
                    return app_tables
                if n == 2:
                    return app_cols
                return app_comments
            if db == "analytics":
                call_count["analytics"] += 1
                n = call_count["analytics"]
                if n == 1:
                    return analytics_tables
                if n == 2:
                    return analytics_cols
                return analytics_comments
            return pa.table({})

        with (
            patch.object(loader, "_read_sql", side_effect=fake_read_sql),
            patch.object(loader, "_read_sql_on", side_effect=fake_read_sql_on),
        ):
            result = loader.sync_catalog_metadata()

        assert len(result) == 2
        names = {t["name"] for t in result}
        assert "app_db.public.users" in names
        assert "analytics.public.events" in names

        for t in result:
            assert t.get("table_key"), f"table_key missing for {t['name']}"
            assert t["metadata"]["_source_name"] == t["name"]
            assert len(t["path"]) == 3

    def test_multi_db_skips_failing_database(self, _patch_pg_connect):
        loader = self._make_loader(database="")

        db_list = _arrow_from_dicts(
            [{"datname": "good_db"}, {"datname": "bad_db"}],
            ["datname"],
        )

        good_tables = _arrow_from_dicts(
            [{"schemaname": "public", "tablename": "t1"}],
            ["schemaname", "tablename"],
        )
        good_cols = _arrow_from_dicts(
            [{"table_schema": "public", "table_name": "t1",
              "column_name": "id", "data_type": "integer", "column_comment": None}],
            ["table_schema", "table_name", "column_name", "data_type", "column_comment"],
        )
        good_comments = _arrow_from_dicts([], ["schemaname", "tablename", "table_comment"])

        good_call = {"n": 0}

        def fake_read_sql(query):
            if "pg_database" in query:
                return db_list
            return pa.table({})

        def fake_read_sql_on(query, db=None):
            if db == "bad_db":
                raise RuntimeError("permission denied")
            good_call["n"] += 1
            n = good_call["n"]
            if n == 1:
                return good_tables
            if n == 2:
                return good_cols
            return good_comments

        with (
            patch.object(loader, "_read_sql", side_effect=fake_read_sql),
            patch.object(loader, "_read_sql_on", side_effect=fake_read_sql_on),
        ):
            result = loader.sync_catalog_metadata()

        assert len(result) == 1
        assert result[0]["name"] == "good_db.public.t1"

    def test_multi_db_table_filter_applied(self, _patch_pg_connect):
        loader = self._make_loader(database="")

        db_list = _arrow_from_dicts(
            [{"datname": "mydb"}],
            ["datname"],
        )
        tables = _arrow_from_dicts(
            [{"schemaname": "public", "tablename": "orders"},
             {"schemaname": "public", "tablename": "users"}],
            ["schemaname", "tablename"],
        )
        cols = _arrow_from_dicts([], ["table_schema", "table_name", "column_name", "data_type", "column_comment"])
        comments = _arrow_from_dicts([], ["schemaname", "tablename", "table_comment"])

        call = {"n": 0}

        def fake_read_sql(query):
            if "pg_database" in query:
                return db_list
            return pa.table({})

        def fake_read_sql_on(query, db=None):
            call["n"] += 1
            if call["n"] == 1:
                return tables
            if call["n"] == 2:
                return cols
            return comments

        with (
            patch.object(loader, "_read_sql", side_effect=fake_read_sql),
            patch.object(loader, "_read_sql_on", side_effect=fake_read_sql_on),
        ):
            result = loader.sync_catalog_metadata(table_filter="orders")

        assert len(result) == 1
        assert result[0]["name"] == "mydb.public.orders"


# ── MSSQL ──────────────────────────────────────────────────────────────

class TestMSSQLSyncCatalogMetadata:
    """sync_catalog_metadata for MSSQLDataLoader."""

    @pytest.fixture()
    def _patch_mssql_connect(self):
        with patch("pyodbc.connect") as mock_conn:
            conn = MagicMock()
            mock_conn.return_value = conn
            yield mock_conn

    def _make_loader(self, *, database: str = "", _patch=None):
        from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader
        return MSSQLDataLoader({
            "server": "localhost",
            "port": "1433",
            "user": "sa",
            "password": "pass",
            "database": database,
        })

    def test_single_db_delegates_to_list_tables(self, _patch_mssql_connect):
        loader = self._make_loader(database="mydb")
        fake_tables = [
            {"name": "dbo.orders", "metadata": {"_source_name": "dbo.orders", "columns": []}},
        ]
        with patch.object(loader, "list_tables", return_value=fake_tables) as lt:
            result = loader.sync_catalog_metadata()
        lt.assert_called_once_with(None)
        assert len(result) == 1
        assert result[0].get("table_key")

    def test_multi_db_iterates_all_databases(self, _patch_mssql_connect):
        loader = self._make_loader(database="")

        db_list = _arrow_from_dicts(
            [{"name": "SalesDB"}, {"name": "HRdb"}],
            ["name"],
        )

        sales_tables = _arrow_from_dicts(
            [{"TABLE_SCHEMA": "dbo", "TABLE_NAME": "Orders"}],
            ["TABLE_SCHEMA", "TABLE_NAME"],
        )
        sales_cols = _arrow_from_dicts(
            [{"TABLE_SCHEMA": "dbo", "TABLE_NAME": "Orders",
              "COLUMN_NAME": "id", "DATA_TYPE": "int"}],
            ["TABLE_SCHEMA", "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE"],
        )

        hr_tables = _arrow_from_dicts(
            [{"TABLE_SCHEMA": "dbo", "TABLE_NAME": "Employees"}],
            ["TABLE_SCHEMA", "TABLE_NAME"],
        )
        hr_cols = _arrow_from_dicts(
            [{"TABLE_SCHEMA": "dbo", "TABLE_NAME": "Employees",
              "COLUMN_NAME": "emp_id", "DATA_TYPE": "int"}],
            ["TABLE_SCHEMA", "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE"],
        )

        empty_desc = _arrow_from_dicts([], ["schema_name", "table_name", "description"])
        empty_col_desc = _arrow_from_dicts(
            [], ["schema_name", "table_name", "column_name", "description"],
        )

        def fake_execute(query):
            q = query.strip().lower()
            if "sys.databases" in q:
                return db_list
            if "[salesdb].information_schema.tables" in q:
                return sales_tables
            if "[salesdb].information_schema.columns" in q:
                return sales_cols
            if "[salesdb].sys." in q:
                if "sys.columns" in q:
                    return empty_col_desc
                return empty_desc
            if "[hrdb].information_schema.tables" in q:
                return hr_tables
            if "[hrdb].information_schema.columns" in q:
                return hr_cols
            if "[hrdb].sys." in q:
                if "sys.columns" in q:
                    return empty_col_desc
                return empty_desc
            return pa.table({})

        with patch.object(loader, "_execute_query", side_effect=fake_execute):
            result = loader.sync_catalog_metadata()

        assert len(result) == 2
        names = {t["name"] for t in result}
        assert "SalesDB.dbo.Orders" in names
        assert "HRdb.dbo.Employees" in names

        for t in result:
            assert t.get("table_key")
            assert t["metadata"]["_source_name"] == t["name"]
            assert len(t["path"]) == 3

    def test_multi_db_skips_failing_database(self, _patch_mssql_connect):
        loader = self._make_loader(database="")

        db_list = _arrow_from_dicts(
            [{"name": "GoodDB"}, {"name": "BadDB"}],
            ["name"],
        )

        good_tables = _arrow_from_dicts(
            [{"TABLE_SCHEMA": "dbo", "TABLE_NAME": "T1"}],
            ["TABLE_SCHEMA", "TABLE_NAME"],
        )
        good_cols = _arrow_from_dicts(
            [{"TABLE_SCHEMA": "dbo", "TABLE_NAME": "T1",
              "COLUMN_NAME": "c1", "DATA_TYPE": "varchar"}],
            ["TABLE_SCHEMA", "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE"],
        )
        empty_desc = _arrow_from_dicts([], ["schema_name", "table_name", "description"])
        empty_col_desc = _arrow_from_dicts(
            [], ["schema_name", "table_name", "column_name", "description"],
        )

        def fake_execute(query):
            q = query.strip().lower()
            if "sys.databases" in q:
                return db_list
            if "[baddb]" in q:
                raise RuntimeError("permission denied")
            if "[gooddb].information_schema.tables" in q:
                return good_tables
            if "[gooddb].information_schema.columns" in q:
                return good_cols
            if "[gooddb].sys." in q:
                if "sys.columns" in q:
                    return empty_col_desc
                return empty_desc
            return pa.table({})

        with patch.object(loader, "_execute_query", side_effect=fake_execute):
            result = loader.sync_catalog_metadata()

        assert len(result) == 1
        assert result[0]["name"] == "GoodDB.dbo.T1"
