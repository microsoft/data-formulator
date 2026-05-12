# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Tests for Cosmos DB data loader using workspace/datalake design.

Requires the Cosmos DB emulator running:
  ./tests/database-dockers/run_test_dbs.sh start cosmosdb

Environment: COSMOS_ENDPOINT, COSMOS_KEY, COSMOS_DATABASE (default testdb).

Run from repo root:
  python -m pytest tests/database-dockers/cosmosdb/test_cosmosdb_loader.py -v
"""

import os
import shutil
import unittest
from pathlib import Path
from typing import Any, Dict

import urllib3

from data_formulator.data_loader.cosmosdb_data_loader import CosmosDBDataLoader

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
log = logging.getLogger(__name__)

EMULATOR_KEY = "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="


def get_test_config() -> Dict[str, Any]:
    return {
        "endpoint": os.getenv("COSMOS_ENDPOINT", "https://localhost:8081"),
        "key": os.getenv("COSMOS_KEY", EMULATOR_KEY),
        "database": os.getenv("COSMOS_DATABASE", "testdb"),
        "container": "",
    }


def cosmos_available() -> bool:
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    try:
        from azure.cosmos import CosmosClient
        cfg = get_test_config()
        client = CosmosClient(
            url=cfg["endpoint"],
            credential=cfg["key"],
            connection_verify=False,
        )
        # Check if the database exists (seed_data.py must have run)
        db = client.get_database_client(cfg["database"])
        db.read()
        client.close()
        return True
    except Exception:
        return False


class TestCosmosDBDataLoader(unittest.TestCase):
    """Test CosmosDBDataLoader against the emulator using workspace/datalake."""

    def setUp(self) -> None:
        self._workspace_root = None
        self._loader = None

    def _workspace_root_path(self) -> str:
        if self._workspace_root is None:
            self._workspace_root = __import__("tempfile").mkdtemp(prefix="df_test_cosmos_")
            self.addCleanup(self._cleanup_workspace)
        return self._workspace_root

    def _cleanup_workspace(self) -> None:
        if self._workspace_root is not None:
            p = Path(self._workspace_root)
            if p.exists():
                shutil.rmtree(p, ignore_errors=True)

    def _get_loader(self) -> CosmosDBDataLoader:
        if self._loader is None:
            self._loader = CosmosDBDataLoader(get_test_config())
            self.addCleanup(self._close_loader)
        return self._loader

    def _close_loader(self) -> None:
        if self._loader is not None:
            self._loader.close()
            self._loader = None

    def _get_workspace(self):
        from data_formulator.datalake.workspace import Workspace
        return Workspace("test-identity-cosmos", root_dir=self._workspace_root_path())

    def test_list_tables(self) -> None:
        loader = self._get_loader()
        tables = loader.list_tables()

        self.assertIsInstance(tables, list)
        self.assertGreater(len(tables), 0)
        names = [t["name"] for t in tables]
        for expected in ["products", "customers", "orders", "app_settings"]:
            self.assertIn(expected, names, f"Should find container '{expected}'")
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

    def test_list_tables_specific_container(self) -> None:
        config = get_test_config()
        config = {**config, "container": "products"}
        loader = CosmosDBDataLoader(config)
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
        table = loader.fetch_data_as_arrow(source_table="products", import_options={"size": 20})
        self.assertIsNotNone(table)
        self.assertGreater(table.num_rows, 0)
        self.assertIn("name", table.column_names)
        self.assertIn("category", table.column_names)
        self.assertIn("price", table.column_names)

    def test_fetch_data_respects_size(self) -> None:
        loader = self._get_loader()
        table = loader.fetch_data_as_arrow(source_table="products", import_options={"size": 5})
        self.assertLessEqual(table.num_rows, 5)

    def test_ingest_table_to_workspace(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "products_test", source_table="products", import_options={"size": 100}
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
            workspace, "products_nested", source_table="products", import_options={"size": 100}
        )
        df = workspace.read_data_as_df(meta.name)
        spec_cols = [c for c in df.columns if c.startswith("specs_")]
        self.assertGreater(len(spec_cols), 0)

    def test_ingest_with_arrays_flattened(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "products_arrays", source_table="products", import_options={"size": 100}
        )
        df = workspace.read_data_as_df(meta.name)
        tag_cols = [c for c in df.columns if c.startswith("tags_")]
        self.assertGreater(len(tag_cols), 0)

    def test_ingest_sanitizes_table_name(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "test-table-with-dashes", source_table="products", import_options={"size": 10}
        )
        self.assertIn(meta.name, workspace.list_tables())
        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)

    def test_get_table_info_from_datalake(self) -> None:
        loader = self._get_loader()
        workspace = self._get_workspace()
        loader.ingest_to_workspace(workspace, "my_table", source_table="customers", import_options={"size": 5_000})

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
        loader = CosmosDBDataLoader(get_test_config())
        self.assertIsNotNone(loader.client)
        loader.close()
        self.assertIsNone(loader.client)

    def test_context_manager(self) -> None:
        with CosmosDBDataLoader(get_test_config()) as loader:
            tables = loader.list_tables()
            self.assertGreater(len(tables), 0)
        self.assertIsNone(loader.client)

    def test_flatten_document(self) -> None:
        doc = {
            "id": "1",
            "name": "Test",
            "nested": {"level1": "value1", "deeper": {"level2": "value2"}},
            "array": [1, 2, 3],
            "_rid": "should_be_skipped",
            "_self": "should_be_skipped",
            "_etag": "should_be_skipped",
        }
        result = CosmosDBDataLoader._flatten_document(doc)
        self.assertEqual(result["name"], "Test")
        self.assertEqual(result["nested_level1"], "value1")
        self.assertEqual(result["nested_deeper_level2"], "value2")
        self.assertEqual(result["array_1"], 1)
        self.assertEqual(result["array_2"], 2)
        self.assertEqual(result["array_3"], 3)
        # Internal Cosmos fields should be stripped
        self.assertNotIn("_rid", result)
        self.assertNotIn("_self", result)
        self.assertNotIn("_etag", result)

    def test_convert_special_types(self) -> None:
        from datetime import datetime

        doc = {
            "created_at": datetime(2024, 1, 15, 10, 30, 0),
            "data": b"binary data",
        }
        result = CosmosDBDataLoader._convert_special_types(doc)
        self.assertIsInstance(result["created_at"], str)
        self.assertIn("2024-01-15", result["created_at"])
        self.assertIsInstance(result["data"], str)

    def test_catalog_hierarchy(self) -> None:
        hierarchy = CosmosDBDataLoader.catalog_hierarchy()
        self.assertEqual(len(hierarchy), 2)
        self.assertEqual(hierarchy[0]["key"], "database")
        self.assertEqual(hierarchy[1]["key"], "container")

    def test_ls_containers(self) -> None:
        loader = self._get_loader()
        # database is pinned, so ls([]) should return containers
        nodes = loader.ls([])
        self.assertGreater(len(nodes), 0)
        names = [n.name for n in nodes]
        self.assertIn("products", names)
        # All should be table type (leaf nodes)
        for node in nodes:
            self.assertEqual(node.node_type, "table")

    def test_test_connection(self) -> None:
        loader = self._get_loader()
        self.assertTrue(loader.test_connection())

    def test_get_metadata(self) -> None:
        loader = self._get_loader()
        meta = loader.get_metadata(["products"])
        self.assertIn("row_count", meta)
        self.assertIn("columns", meta)
        self.assertEqual(meta["row_count"], 12)


class TestCosmosDBDataLoaderStatic(unittest.TestCase):
    """Static methods (no DB required)."""

    def test_list_params(self) -> None:
        params = CosmosDBDataLoader.list_params()
        self.assertIsInstance(params, list)
        self.assertGreater(len(params), 0)
        names = [p["name"] for p in params]
        self.assertIn("endpoint", names)
        self.assertIn("key", names)
        self.assertIn("database", names)
        self.assertIn("container", names)
        endpoint_param = next(p for p in params if p["name"] == "endpoint")
        self.assertTrue(endpoint_param["required"])

    def test_auth_instructions(self) -> None:
        instructions = CosmosDBDataLoader.auth_instructions()
        self.assertIsInstance(instructions, str)
        self.assertGreater(len(instructions), 50)
        self.assertIn("Cosmos", instructions)
        self.assertIn("endpoint", instructions)

    def test_flatten_strips_cosmos_metadata(self) -> None:
        """_flatten_document should skip internal Cosmos fields."""
        doc = {
            "id": "1",
            "name": "test",
            "_rid": "abc",
            "_self": "dbs/testdb/colls/products/docs/1",
            "_etag": "\"00000000-0000-0000-0000-000000000000\"",
            "_attachments": "attachments/",
            "_ts": 1700000000,
        }
        result = CosmosDBDataLoader._flatten_document(doc)
        self.assertEqual(result["id"], "1")
        self.assertEqual(result["name"], "test")
        for key in ("_rid", "_self", "_etag", "_attachments", "_ts"):
            self.assertNotIn(key, result)


def run_tests() -> bool:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestCosmosDBDataLoaderStatic))
    suite.addTests(loader.loadTestsFromTestCase(TestCosmosDBDataLoader))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return len(result.failures) == 0 and len(result.errors) == 0


if __name__ == "__main__":
    exit(0 if run_tests() else 1)
