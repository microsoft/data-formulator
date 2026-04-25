# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Tests for MySQL data loader using workspace/datalake design.

Requires MySQL running (e.g. ./tests/run_test_dbs.sh start mysql).
Environment: MYSQL_HOST, MYSQL_PORT (default 3307), MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE (default testdb).

Run from repo root:
  python -m pytest tests/plugin/test_mysql/ -v
"""

import os
import shutil
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest.mock import patch

from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


def get_test_config() -> Dict[str, Any]:
    return {
        "host": os.getenv("MYSQL_HOST", "localhost"),
        "port": os.getenv("MYSQL_PORT", "3307"),
        "user": os.getenv("MYSQL_USER", "root"),
        "password": os.getenv("MYSQL_PASSWORD", "mysql"),
        "database": os.getenv("MYSQL_DATABASE", "testdb"),
    }


def mysql_available() -> bool:
    """Return True if MySQL is reachable."""
    import socket
    host = get_test_config().get("host", "localhost")
    port = int(get_test_config().get("port", "3307"))
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
    mysql_available(),
    "MySQL not available (start with ./tests/run_test_dbs.sh start mysql).",
)
class TestMySQLDataLoader(unittest.TestCase):
    """Test MySQLDataLoader against test DB using workspace/datalake."""

    def setUp(self) -> None:
        self._workspace_root = None

    def _workspace_root_path(self) -> str:
        if self._workspace_root is None:
            self._workspace_root = __import__("tempfile").mkdtemp(prefix="df_test_mysql_")
            self.addCleanup(self._cleanup_workspace)
        return self._workspace_root

    def _cleanup_workspace(self) -> None:
        if self._workspace_root is not None:
            p = Path(self._workspace_root)
            if p.exists():
                shutil.rmtree(p, ignore_errors=True)

    def _get_workspace(self):
        from data_formulator.datalake.workspace import Workspace
        return Workspace("test-identity-mysql", root_dir=self._workspace_root_path())

    def test_list_tables(self) -> None:
        loader = MySQLDataLoader(get_test_config())
        tables = loader.list_tables()

        self.assertIsInstance(tables, list)
        self.assertGreater(len(tables), 0)
        names = [t["name"] for t in tables]
        for t in tables:
            self.assertIn("name", t)
            self.assertIn("metadata", t)
            self.assertIn("columns", t["metadata"])
            self.assertIn("row_count", t["metadata"])

        # init.sql creates products, customers, orders, order_items, app_settings in testdb
        self.assertTrue(any("products" in n for n in names))
        self.assertTrue(any("customers" in n for n in names))
        self.assertTrue(any("app_settings" in n for n in names))

    def test_list_tables_with_filter(self) -> None:
        loader = MySQLDataLoader(get_test_config())
        tables = loader.list_tables(table_filter="product")

        self.assertIsInstance(tables, list)
        for t in tables:
            self.assertIn("product", t["name"].lower())

    def test_fetch_data_as_arrow_from_table(self) -> None:
        loader = MySQLDataLoader(get_test_config())
        # Table name from list_tables is database.table (e.g. testdb.products)
        table = loader.fetch_data_as_arrow(source_table="testdb.products", import_options={"size": 20})

        self.assertIsNotNone(table)
        self.assertGreater(table.num_rows, 0)
        self.assertIn("name", table.column_names)
        self.assertIn("category", table.column_names)
        self.assertIn("price", table.column_names)

    def test_fetch_data_respects_size(self) -> None:
        loader = MySQLDataLoader(get_test_config())
        table = loader.fetch_data_as_arrow(source_table="testdb.products", import_options={"size": 5})
        self.assertLessEqual(table.num_rows, 5)

    def test_ingest_table_to_workspace(self) -> None:
        loader = MySQLDataLoader(get_test_config())
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "products_test", source_table="testdb.products", import_options={"size": 100}
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
        loader = MySQLDataLoader(get_test_config())
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "electronics_products", source_table="testdb.products", import_options={"size": 1000}
        )

        self.assertGreater(meta.row_count, 0)
        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)
        self.assertIn("id", df.columns)
        self.assertIn("name", df.columns)
        self.assertIn("category", df.columns)
        self.assertIn("price", df.columns)

    def test_get_table_info_from_datalake(self) -> None:
        loader = MySQLDataLoader(get_test_config())
        workspace = self._get_workspace()
        loader.ingest_to_workspace(
            workspace, "my_table", source_table="testdb.customers", import_options={"size": 5_000}
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


class TestMySQLDataLoaderStatic(unittest.TestCase):
    """Static methods (no DB required)."""

    def test_list_params(self) -> None:
        params = MySQLDataLoader.list_params()
        self.assertIsInstance(params, list)
        self.assertGreater(len(params), 0)
        names = [p["name"] for p in params]
        self.assertIn("host", names)
        self.assertIn("user", names)
        self.assertIn("database", names)

    def test_auth_instructions(self) -> None:
        instructions = MySQLDataLoader.auth_instructions()
        self.assertIsInstance(instructions, str)
        self.assertIn("MySQL", instructions)

    def test_fetch_data_as_arrow_uses_source_filters(self) -> None:
        import pyarrow as pa
        with patch("data_formulator.data_loader.mysql_data_loader.pymysql.connect"):
            loader = MySQLDataLoader({
                "host": "localhost",
                "port": "3306",
                "user": "root",
                "password": "",
                "database": "testdb",
            })
        with (
            patch.object(loader, "_safe_select_list", return_value="*"),
            patch.object(loader, "_read_sql", return_value=pa.table({"id": []})) as mock_read,
        ):
            loader.fetch_data_as_arrow(
                "users",
                {"size": 10, "source_filters": [{"column": "name", "operator": "ILIKE", "value": "alice"}]},
            )
        query = mock_read.call_args.args[0]
        self.assertIn("WHERE LOWER(`name`) LIKE LOWER('%alice%')", query)
        self.assertIn("LIMIT 10", query)


def run_tests() -> bool:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestMySQLDataLoaderStatic))
    suite.addTests(loader.loadTestsFromTestCase(TestMySQLDataLoader))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return len(result.failures) == 0 and len(result.errors) == 0


if __name__ == "__main__":
    exit(0 if run_tests() else 1)
