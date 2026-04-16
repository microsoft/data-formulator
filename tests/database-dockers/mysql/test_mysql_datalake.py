# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Tests for MySQL data loader: connect to MySQL, read data into the datalake,
and get information about the data tables.

Requires:
  - MySQL running at localhost:3306
  - Database named 'test' (create with: CREATE DATABASE test;)
  - At least one table in 'test' for ingest tests (e.g. CREATE TABLE test.foo (id INT, name VARCHAR(100));)

Run from repo root:
  python -m pytest tests/plugin/test_mysql_datalake.py -v
"""

import os
import tempfile
import unittest
from pathlib import Path

# MySQL connection params used by all tests
MYSQL_PARAMS = {
    "user": "root",
    "password": "",
    "host": "localhost",
    "port": 3306,
    "database": "test",
}


def mysql_available() -> bool:
    """Return True if something is listening on localhost:3306 (avoids calling ConnectorX when down)."""
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    try:
        sock.connect(("localhost", MYSQL_PARAMS["port"]))
        sock.close()
        return True
    except (socket.error, OSError):
        return False


@unittest.skipUnless(
    mysql_available(),
    "MySQL not available at localhost:3306 (database 'test'). Start MySQL to run these tests.",
)
class TestMySQLDataLake(unittest.TestCase):
    """Test MySQL connection, ingest into datalake, and table info."""

    def setUp(self) -> None:
        """Use a temporary directory as workspace root for each test."""
        self._workspace_root = tempfile.mkdtemp(prefix="df_test_mysql_")
        self.addCleanup(self._cleanup_workspace)

    def _cleanup_workspace(self) -> None:
        import shutil
        path = Path(self._workspace_root)
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)

    def test_connect_and_list_tables(self) -> None:
        """Connect to MySQL and list tables in database 'test'."""
        from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader

        loader = MySQLDataLoader(MYSQL_PARAMS)
        tables = loader.list_tables()

        self.assertIsInstance(tables, list)
        # Each entry: {"name": "schema.table", "metadata": {"row_count", "columns", "sample_rows"}}
        for t in tables:
            self.assertIn("name", t)
            self.assertIn("metadata", t)
            meta = t["metadata"]
            self.assertIn("columns", meta)
            self.assertIn("row_count", meta)

    def test_ingest_table_into_datalake(self) -> None:
        """Ingest a MySQL table into the datalake workspace."""
        from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
        from data_formulator.datalake.workspace import Workspace

        loader = MySQLDataLoader(MYSQL_PARAMS)
        tables = loader.list_tables()
        if not tables:
            self.skipTest("Database 'test' has no tables; create one to run this test (e.g. CREATE TABLE test.foo (id INT);)")

        workspace = Workspace("test-identity-mysql", root_dir=self._workspace_root)
        table_name = tables[0]["name"]
        # Ingest using the loader's ingest_to_workspace (writes parquet)
        meta = loader.ingest_to_workspace(
            workspace,
            "ingested_table",
            source_table=table_name, import_options={"size": 10_000},
        )

        self.assertEqual(meta.name, "ingested_table")
        self.assertEqual(meta.file_type, "parquet")
        self.assertIsNotNone(meta.row_count)
        self.assertIsNotNone(meta.columns)
        self.assertTrue(workspace.file_exists(meta.filename))

    def test_get_table_info_from_datalake(self) -> None:
        """After ingest, get table info from the datalake (list_tables, metadata, schema)."""
        from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
        from data_formulator.datalake.workspace import Workspace

        loader = MySQLDataLoader(MYSQL_PARAMS)
        tables = loader.list_tables()
        if not tables:
            self.skipTest("Database 'test' has no tables; create one to run this test.")

        workspace = Workspace("test-identity-mysql-info", root_dir=self._workspace_root)
        source_table = tables[0]["name"]
        loader.ingest_to_workspace(workspace, "my_table", source_table=source_table, import_options={"size": 5_000})

        # List tables in workspace
        names = workspace.list_tables()
        self.assertIn("my_table", names)

        # Get table metadata from workspace
        meta = workspace.get_table_metadata("my_table")
        self.assertIsNotNone(meta)
        self.assertEqual(meta.name, "my_table")
        self.assertIsNotNone(meta.row_count)
        self.assertIsNotNone(meta.columns)
        self.assertGreater(len(meta.columns), 0)

        # Get parquet schema (no full read)
        schema_info = workspace.get_parquet_schema("my_table")
        self.assertIn("columns", schema_info)
        self.assertIn("num_rows", schema_info)
        self.assertGreater(schema_info["num_rows"], 0)

        # Read data from datalake and print
        df = workspace.read_data_as_df("my_table")
        self.assertGreater(len(df), 0)
        self.assertEqual(len(df.columns), len(meta.columns))

        print("\n--- Retrieved data from datalake ---")
        print(f"Shape: {df.shape}")
        print(df.head(10).to_string())
        print("--- end ---\n")


if __name__ == "__main__":
    unittest.main()
