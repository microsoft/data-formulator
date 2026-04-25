# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Tests for PostgreSQL data loader using workspace/datalake design.

Requires PostgreSQL running (e.g. ./tests/database-dockers/run_test_dbs.sh start postgres).
Environment: PG_HOST, PG_PORT (default 5433), PG_USER, PG_PASSWORD, PG_DATABASE (default testdb).

Run from repo root:
  python -m pytest tests/plugin/test_postgres/ -v
"""

import os
import shutil
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest.mock import patch

from data_formulator.data_loader.external_data_loader import build_source_filter_where_clause_inline
from data_formulator.data_loader.postgresql_data_loader import PostgreSQLDataLoader

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


def get_test_config() -> Dict[str, Any]:
    return {
        "host": os.getenv("PG_HOST", "localhost"),
        "port": os.getenv("PG_PORT", "5433"),
        "user": os.getenv("PG_USER", "postgres"),
        "password": os.getenv("PG_PASSWORD", "postgres"),
        "database": os.getenv("PG_DATABASE", "testdb"),
    }


def postgres_available() -> bool:
    """Return True if PostgreSQL is reachable."""
    import socket
    host = get_test_config().get("host", "localhost")
    port = int(get_test_config().get("port", "5433"))
    if host in ("localhost", "127.0.0.1"):
        host = "127.0.0.1"
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect((host, port))
        sock.close()
        return True
    except (socket.error, OSError):
        return False


@unittest.skipUnless(
    postgres_available(),
    "PostgreSQL not available (start with ./tests/database-dockers/run_test_dbs.sh start postgres).",
)
class TestPostgreSQLDataLoader(unittest.TestCase):
    """Test PostgreSQLDataLoader against test DB using workspace/datalake."""

    def setUp(self) -> None:
        self._workspace_root = None

    def _workspace_root_path(self) -> str:
        if self._workspace_root is None:
            self._workspace_root = __import__("tempfile").mkdtemp(prefix="df_test_pg_")
            self.addCleanup(self._cleanup_workspace)
        return self._workspace_root

    def _cleanup_workspace(self) -> None:
        if self._workspace_root is not None:
            p = Path(self._workspace_root)
            if p.exists():
                shutil.rmtree(p, ignore_errors=True)

    def _get_workspace(self):
        from data_formulator.datalake.workspace import Workspace
        return Workspace("test-identity-pg", root_dir=self._workspace_root_path())

    def test_list_tables(self) -> None:
        loader = PostgreSQLDataLoader(get_test_config())
        tables = loader.list_tables()

        self.assertIsInstance(tables, list)
        self.assertGreater(len(tables), 0)
        names = [t["name"] for t in tables]
        for t in tables:
            self.assertIn("name", t)
            self.assertIn("metadata", t)
            self.assertIn("columns", t["metadata"])
            self.assertIn("row_count", t["metadata"])

        # init.sql creates sample.products, sample.customers, sample.orders, sample.order_items, public.app_settings
        self.assertTrue(any("products" in n for n in names))
        self.assertTrue(any("customers" in n for n in names))
        self.assertTrue(any("app_settings" in n for n in names))

    def test_list_tables_with_filter(self) -> None:
        loader = PostgreSQLDataLoader(get_test_config())
        tables = loader.list_tables(table_filter="product")

        self.assertIsInstance(tables, list)
        for t in tables:
            self.assertIn("product", t["name"].lower())

    def test_fetch_data_as_arrow_from_table(self) -> None:
        loader = PostgreSQLDataLoader(get_test_config())
        # Table name from list_tables is schema.table (e.g. sample.products)
        table = loader.fetch_data_as_arrow(source_table="sample.products", import_options={"size": 20})

        self.assertIsNotNone(table)
        self.assertGreater(table.num_rows, 0)
        self.assertIn("name", table.column_names)
        self.assertIn("category", table.column_names)
        self.assertIn("price", table.column_names)

    def test_fetch_data_respects_size(self) -> None:
        loader = PostgreSQLDataLoader(get_test_config())
        table = loader.fetch_data_as_arrow(source_table="sample.products", import_options={"size": 5})
        self.assertLessEqual(table.num_rows, 5)

    def test_ingest_table_to_workspace(self) -> None:
        loader = PostgreSQLDataLoader(get_test_config())
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "products_test", source_table="sample.products", import_options={"size": 100}
        )

        self.assertEqual(meta.name, "products_test")
        self.assertEqual(meta.file_type, "parquet")
        self.assertGreater(meta.row_count, 0)
        self.assertTrue(workspace.file_exists(meta.filename))

        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)
        self.assertIn("name", df.columns)
        self.assertIn("category", df.columns)

    def test_ingest_products_table(self) -> None:
        loader = PostgreSQLDataLoader(get_test_config())
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "electronics_products", source_table="sample.products", import_options={"size": 1000}
        )

        self.assertGreater(meta.row_count, 0)
        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)
        self.assertIn("id", df.columns)
        self.assertIn("name", df.columns)
        self.assertIn("category", df.columns)
        self.assertIn("price", df.columns)

    def test_get_table_info_from_datalake(self) -> None:
        loader = PostgreSQLDataLoader(get_test_config())
        workspace = self._get_workspace()
        loader.ingest_to_workspace(
            workspace, "my_table", source_table="sample.customers", import_options={"size": 5_000}
        )

        self.assertIn("my_table", workspace.list_tables())
        meta = workspace.get_table_metadata("my_table")
        self.assertIsNotNone(meta)
        self.assertEqual(meta.name, "my_table")
        self.assertGreater(len(meta.columns), 0)

        schema_info = workspace.get_parquet_schema("my_table")
        self.assertIn("columns", schema_info)
        self.assertIn("num_rows", schema_info)
        df = workspace.read_data_as_df("my_table")
        self.assertGreater(len(df), 0)


class TestPostgreSQLDataLoaderStatic(unittest.TestCase):
    """Static methods (no DB required)."""

    def test_list_params(self) -> None:
        params = PostgreSQLDataLoader.list_params()
        self.assertIsInstance(params, list)
        self.assertGreater(len(params), 0)
        names = [p["name"] for p in params]
        self.assertIn("host", names)
        self.assertIn("user", names)
        self.assertIn("database", names)

    def test_auth_instructions(self) -> None:
        instructions = PostgreSQLDataLoader.auth_instructions()
        self.assertIsInstance(instructions, str)
        self.assertIn("PostgreSQL", instructions)

    def test_connect_forces_utf8_client_encoding(self) -> None:
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect") as mock_connect:
            loader = PostgreSQLDataLoader({
                "host": "localhost",
                "port": "5432",
                "user": "postgres",
                "password": "secret",
                "database": "postgres",
            })

        self.assertIs(loader._conn, mock_connect.return_value)
        self.assertTrue(loader._conn.autocommit)
        mock_connect.assert_called_once_with(
            host="127.0.0.1",
            port=5432,
            user="postgres",
            password="secret",
            dbname="postgres",
            client_encoding="UTF8",
            options="-c client_encoding=UTF8",
        )

    def test_resolve_source_table_three_parts(self) -> None:
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect"):
            loader = PostgreSQLDataLoader({
                "host": "localhost", "port": "5432",
                "user": "postgres", "password": "", "database": "mydb",
            })
        db, schema, table = loader._resolve_source_table("analytics.public.events")
        self.assertEqual(db, "analytics")
        self.assertEqual(schema, "public")
        self.assertEqual(table, "events")

    def test_resolve_source_table_three_parts_same_db(self) -> None:
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect"):
            loader = PostgreSQLDataLoader({
                "host": "localhost", "port": "5432",
                "user": "postgres", "password": "", "database": "mydb",
            })
        db, schema, table = loader._resolve_source_table("mydb.public.events")
        self.assertIsNone(db)
        self.assertEqual(schema, "public")
        self.assertEqual(table, "events")

    def test_resolve_source_table_two_parts(self) -> None:
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect"):
            loader = PostgreSQLDataLoader({
                "host": "localhost", "port": "5432",
                "user": "postgres", "password": "", "database": "mydb",
            })
        db, schema, table = loader._resolve_source_table("public.events")
        self.assertIsNone(db)
        self.assertEqual(schema, "public")
        self.assertEqual(table, "events")

    def test_resolve_source_table_one_part(self) -> None:
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect"):
            loader = PostgreSQLDataLoader({
                "host": "localhost", "port": "5432",
                "user": "postgres", "password": "", "database": "mydb",
            })
        db, schema, table = loader._resolve_source_table("events")
        self.assertIsNone(db)
        self.assertEqual(schema, "public")
        self.assertEqual(table, "events")

    def test_ls_table_nodes_include_source_name(self) -> None:
        """Table nodes from ls() should carry _source_name = db.schema.table."""
        import pandas as pd
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect"):
            loader = PostgreSQLDataLoader({
                "host": "localhost", "port": "5432",
                "user": "postgres", "password": "", "database": "",
            })
        fake_df = pd.DataFrame({"table_name": ["users", "orders"]})
        with patch.object(loader, "_read_sql_on", return_value=__import__("pyarrow").Table.from_pandas(fake_df)):
            nodes = loader.ls(path=["mydb", "public"])
        self.assertEqual(len(nodes), 2)
        self.assertEqual(nodes[0].metadata["_source_name"], "mydb.public.users")
        self.assertEqual(nodes[1].metadata["_source_name"], "mydb.public.orders")

    def test_ls_schema_filters_postgresql_temp_schemas(self) -> None:
        import pandas as pd
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect"):
            loader = PostgreSQLDataLoader({
                "host": "localhost", "port": "5432",
                "user": "postgres", "password": "", "database": "",
            })
        fake_arrow = __import__("pyarrow").Table.from_pandas(pd.DataFrame({"schema_name": []}))
        with patch.object(loader, "_read_sql_on", return_value=fake_arrow) as mock_read:
            loader.ls(path=["mydb"])
        query = mock_read.call_args.args[0]
        self.assertIn("schema_name !~ '^pg_temp_[0-9]+$'", query)
        self.assertIn("schema_name !~ '^pg_toast_temp_[0-9]+$'", query)

    def test_ls_table_level_supports_limit_offset(self) -> None:
        import pandas as pd
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect"):
            loader = PostgreSQLDataLoader({
                "host": "localhost", "port": "5432",
                "user": "postgres", "password": "", "database": "",
            })
        fake_df = pd.DataFrame({"table_name": ["users"]})
        with patch.object(loader, "_read_sql_on", return_value=__import__("pyarrow").Table.from_pandas(fake_df)) as mock_read:
            nodes = loader.ls(path=["mydb", "public"], limit=201, offset=200)
        query = mock_read.call_args.args[0]
        self.assertIn("LIMIT 201 OFFSET 200", query)
        self.assertEqual(nodes[0].metadata["_source_name"], "mydb.public.users")

    def test_source_filter_helper_compiles_postgres_operators(self) -> None:
        where_clause = build_source_filter_where_clause_inline(
            [
                {"column": "name", "operator": "ILIKE", "value": "acct"},
                {"column": "amount", "operator": "GTE", "value": 10},
                {"column": "deleted_at", "operator": "IS_NULL"},
            ],
            quote_char='"',
            dialect="postgres",
        )
        self.assertEqual(
            where_clause,
            'WHERE "name" ILIKE \'%acct%\' AND "amount" >= 10 AND "deleted_at" IS NULL',
        )

    def test_fetch_data_as_arrow_uses_source_filters(self) -> None:
        import pyarrow as pa
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect"):
            loader = PostgreSQLDataLoader({
                "host": "localhost", "port": "5432",
                "user": "postgres", "password": "", "database": "mydb",
            })
        with (
            patch.object(loader, "_safe_select_list", return_value="*"),
            patch.object(loader, "_read_sql", return_value=pa.table({"id": []})) as mock_read,
        ):
            loader.fetch_data_as_arrow(
                "public.users",
                {"size": 10, "source_filters": [{"column": "name", "operator": "EQ", "value": "alice"}]},
            )
        query = mock_read.call_args.args[0]
        self.assertIn('WHERE "name" = \'alice\'', query)
        self.assertIn("LIMIT 10", query)

    def test_secondary_connection_forces_utf8_client_encoding(self) -> None:
        with patch("data_formulator.data_loader.postgresql_data_loader.psycopg2.connect") as mock_connect:
            loader = PostgreSQLDataLoader({
                "host": "db.example.com",
                "port": "5432",
                "user": "postgres",
                "password": "",
                "database": "postgres",
            })
            mock_connect.reset_mock()
            conn = loader._connect_to_db("analytics")

        self.assertIs(conn, mock_connect.return_value)
        self.assertTrue(conn.autocommit)
        mock_connect.assert_called_once_with(
            host="db.example.com",
            port=5432,
            user="postgres",
            password="",
            dbname="analytics",
            client_encoding="UTF8",
            options="-c client_encoding=UTF8",
        )


def run_tests() -> bool:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestPostgreSQLDataLoaderStatic))
    suite.addTests(loader.loadTestsFromTestCase(TestPostgreSQLDataLoader))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return len(result.failures) == 0 and len(result.errors) == 0


if __name__ == "__main__":
    exit(0 if run_tests() else 1)
