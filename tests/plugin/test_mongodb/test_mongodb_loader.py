# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Tests for MongoDB data loader using workspace/datalake design.

Requires MongoDB running (e.g. ./tests/run_test_dbs.sh start mongodb).
Environment: MONGO_HOST, MONGO_PORT (default 27018), MONGO_USERNAME, MONGO_PASSWORD, MONGO_DATABASE (default testdb).

Run from repo root:
  python -m pytest tests/plugin/test_mongodb/ -v
"""

import os
import shutil
import unittest
from pathlib import Path
from typing import Any, Dict
import pymongo


from data_formulator.data_loader.mongodb_data_loader import MongoDBDataLoader

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)


def get_test_config() -> Dict[str, Any]:
    return {
        "host": os.getenv("MONGO_HOST", "localhost"),
        "port": int(os.getenv("MONGO_PORT", "27018")),
        "username": os.getenv("MONGO_USERNAME", "testuser"),
        "password": os.getenv("MONGO_PASSWORD", "testpass"),
        "database": os.getenv("MONGO_DATABASE", "testdb"),
        "collection": "",
    }


def mongo_available() -> bool:
    try:
        cfg = get_test_config()
        client = pymongo.MongoClient(
            host=cfg["host"],
            port=cfg["port"],
            username=cfg["username"],
            password=cfg["password"],
            serverSelectionTimeoutMS=3000,
        )
        client.admin.command("ping")
        client.close()
        return True
    except Exception:
        return False


class TestMongoDBDataLoader(unittest.TestCase):
    """Test MongoDBDataLoader against test DB using workspace/datalake."""

    def setUp(self) -> None:
        self._workspace_root = None
        self._loader = None

    def _workspace_root_path(self) -> str:
        if self._workspace_root is None:
            self._workspace_root = __import__("tempfile").mkdtemp(prefix="df_test_mongo_")
            self.addCleanup(self._cleanup_workspace)
        return self._workspace_root

    def _cleanup_workspace(self) -> None:
        if self._workspace_root is not None:
            p = Path(self._workspace_root)
            if p.exists():
                shutil.rmtree(p, ignore_errors=True)

    def _get_loader(self) -> MongoDBDataLoader:
        if self._loader is None:
            self._loader = MongoDBDataLoader(get_test_config())
            self.addCleanup(self._close_loader)
        return self._loader

    def _close_loader(self) -> None:
        if self._loader is not None:
            self._loader.close()
            self._loader = None

    def _get_workspace(self):
        from data_formulator.datalake.workspace import Workspace
        return Workspace("test-identity-mongo", root_dir=self._workspace_root_path())

    def test_list_tables(self) -> None:
        loader = self._get_loader()
        tables = loader.list_tables()

        self.assertIsInstance(tables, list)
        self.assertGreater(len(tables), 0)
        names = [t["name"] for t in tables]
        for expected in ["products", "customers", "orders", "app_settings"]:
            self.assertIn(expected, names, f"Should find collection '{expected}'")
        for t in tables:
            self.assertIn("name", t)
            self.assertIn("metadata", t)
            self.assertIn("columns", t["metadata"])
            self.assertIn("row_count", t["metadata"])

    def test_list_tables_with_filter(self) -> None:
        loader = self._get_loader()
        tables = loader.list_tables(table_filter="prod")
        self.assertIsInstance(tables, list)
        for t in tables:
            self.assertIn("prod", t["name"].lower())

    def test_list_tables_specific_collection(self) -> None:
        config = get_test_config()
        config = {**config, "collection": "products"}
        loader = MongoDBDataLoader(config)
        self.addCleanup(loader.close)
        tables = loader.list_tables()
        self.assertEqual(len(tables), 1)
        self.assertEqual(tables[0]["name"], "products")

    def test_list_tables_row_count(self) -> None:
        loader = self._get_loader()
        tables = loader.list_tables()
        products = next((t for t in tables if t["name"] == "products"), None)
        self.assertIsNotNone(products)
        self.assertEqual(products["metadata"]["row_count"], 12)

    def test_fetch_data_as_arrow(self) -> None:
        loader = self._get_loader()
        table = loader.fetch_data_as_arrow(source_table="products", size=20)
        self.assertIsNotNone(table)
        self.assertGreater(table.num_rows, 0)
        self.assertIn("name", table.column_names)
        self.assertIn("category", table.column_names)
        self.assertIn("price", table.column_names)

    def test_fetch_data_respects_size(self) -> None:
        loader = self._get_loader()
        table = loader.fetch_data_as_arrow(source_table="products", size=5)
        self.assertLessEqual(table.num_rows, 5)

    def test_ingest_table_to_workspace(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "products_test", source_table="products", size=100
        )

        self.assertEqual(meta.name, "products_test")
        self.assertEqual(meta.file_type, "parquet")
        self.assertGreater(meta.row_count, 0)
        self.assertTrue(workspace.file_exists(meta.filename))

        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)
        self.assertIn("name", df.columns)
        self.assertIn("category", df.columns)
        self.assertEqual(len(df), 12)

    def test_ingest_nested_documents_flattened(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "products_nested", source_table="products", size=100
        )
        df = workspace.read_data_as_df(meta.name)
        spec_cols = [c for c in df.columns if c.startswith("specs_")]
        self.assertGreater(len(spec_cols), 0)

    def test_ingest_with_arrays_flattened(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "products_arrays", source_table="products", size=100
        )
        df = workspace.read_data_as_df(meta.name)
        tag_cols = [c for c in df.columns if c.startswith("tags_")]
        self.assertGreater(len(tag_cols), 0)

    def test_ingest_sanitizes_table_name(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "test-table-with-dashes", source_table="products", size=10
        )
        self.assertIn(meta.name, workspace.list_tables())
        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)

    def test_get_table_info_from_datalake(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        loader.ingest_to_workspace(workspace, "my_table", source_table="customers", size=5_000)

        self.assertIn("my_table", workspace.list_tables())
        meta = workspace.get_table_metadata("my_table")
        self.assertIsNotNone(meta)
        self.assertEqual(meta.name, "my_table")
        schema_info = workspace.get_parquet_schema("my_table")
        self.assertIn("columns", schema_info)
        self.assertIn("num_rows", schema_info)
        df = workspace.read_data_as_df("my_table")
        self.assertGreater(len(df), 0)

    def test_connection_close(self) -> None:
        loader = MongoDBDataLoader(get_test_config())
        self.assertIsNotNone(loader.mongo_client)
        loader.close()
        self.assertIsNone(loader.mongo_client)

    def test_context_manager(self) -> None:
        with MongoDBDataLoader(get_test_config()) as loader:
            tables = loader.list_tables()
            self.assertGreater(len(tables), 0)
        self.assertIsNone(loader.mongo_client)

    def test_flatten_document(self) -> None:
        doc = {
            "name": "Test",
            "nested": {"level1": "value1", "deeper": {"level2": "value2"}},
            "array": [1, 2, 3],
        }
        result = MongoDBDataLoader._flatten_document(doc)
        self.assertEqual(result["name"], "Test")
        self.assertEqual(result["nested_level1"], "value1")
        self.assertEqual(result["nested_deeper_level2"], "value2")
        self.assertEqual(result["array_1"], 1)
        self.assertEqual(result["array_2"], 2)
        self.assertEqual(result["array_3"], 3)

    def test_convert_special_types(self) -> None:
        from bson import ObjectId
        from datetime import datetime

        doc = {
            "_id": ObjectId(),
            "created_at": datetime(2024, 1, 15, 10, 30, 0),
            "data": b"binary data",
        }
        result = MongoDBDataLoader._convert_special_types(doc)
        self.assertIsInstance(result["_id"], str)
        self.assertIsInstance(result["created_at"], str)
        self.assertIn("2024-01-15", result["created_at"])
        self.assertIsInstance(result["data"], str)


class TestMongoDBDataLoaderStatic(unittest.TestCase):
    """Static methods (no DB required)."""

    def test_list_params(self) -> None:
        params = MongoDBDataLoader.list_params()
        self.assertIsInstance(params, list)
        self.assertGreater(len(params), 0)
        names = [p["name"] for p in params]
        self.assertIn("host", names)
        self.assertIn("port", names)
        self.assertIn("database", names)
        self.assertIn("collection", names)
        host_param = next(p for p in params if p["name"] == "host")
        self.assertTrue(host_param["required"])

    def test_auth_instructions(self) -> None:
        instructions = MongoDBDataLoader.auth_instructions()
        self.assertIsInstance(instructions, str)
        self.assertGreater(len(instructions), 100)
        self.assertIn("MongoDB", instructions)
        self.assertIn("host", instructions)


def run_tests() -> bool:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestMongoDBDataLoaderStatic))
    suite.addTests(loader.loadTestsFromTestCase(TestMongoDBDataLoader))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return len(result.failures) == 0 and len(result.errors) == 0


if __name__ == "__main__":
    exit(0 if run_tests() else 1)
