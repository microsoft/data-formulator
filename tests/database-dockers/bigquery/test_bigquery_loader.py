# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Tests for BigQuery Data Loader using BigQuery Emulator and the workspace/datalake design.

Requires:
  - BigQuery emulator running (e.g. ./tests/run_test_dbs.sh start bigquery)
  - google-cloud-bigquery installed

Environment variables:
  BQ_PROJECT_ID: BigQuery project ID (default: test-project)
  BQ_HTTP_ENDPOINT: BigQuery emulator HTTP endpoint (default: http://localhost:9050)

Run from repo root:
  python -m pytest tests/plugin/test_bigquery/ -v
"""

import os
import shutil
import unittest
from pathlib import Path
from typing import Any, Dict

from data_formulator.data_loader.bigquery_data_loader import BigQueryDataLoader

# Optional: configure logging
import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
log = logging.getLogger(__name__)


def get_test_config() -> Dict[str, Any]:
    """Get test configuration from environment variables."""
    return {
        "project_id": os.getenv("BQ_PROJECT_ID", "test-project"),
        "http_endpoint": os.getenv("BQ_HTTP_ENDPOINT", "http://localhost:9050"),
        "dataset_id": "",
        "location": "US",
        "credentials_path": "",
    }


def bq_emulator_available() -> bool:
    """Return True if BigQuery emulator is reachable."""
    try:
        from google.cloud import bigquery
        from google.auth.credentials import AnonymousCredentials
        config = get_test_config()
        client = bigquery.Client(
            project=config["project_id"],
            credentials=AnonymousCredentials(),
            client_options={"api_endpoint": config["http_endpoint"]},
        )
        list(client.list_datasets(max_results=1))
        return True
    except Exception:
        return False


def create_emulator_client(config: Dict[str, Any]):
    """Create a BigQuery client configured for the emulator."""
    from google.cloud import bigquery
    from google.auth.credentials import AnonymousCredentials

    return bigquery.Client(
        project=config["project_id"],
        credentials=AnonymousCredentials(),
        client_options={"api_endpoint": config["http_endpoint"]},
    )


def create_loader_for_emulator(config: Dict[str, Any], dataset_ids: list | None = None):
    """
    Create a BigQueryDataLoader that uses the emulator (without calling __init__ which
    would create a real client). Sets params, project_id, dataset_ids, location, client.
    """
    loader = object.__new__(BigQueryDataLoader)
    loader.params = config
    loader.project_id = config["project_id"]
    loader.dataset_ids = dataset_ids if dataset_ids is not None else []
    loader.location = config["location"]
    loader.client = create_emulator_client(config)
    return loader


@unittest.skipUnless(
    bq_emulator_available(),
    "BigQuery emulator not available (start with ./tests/run_test_dbs.sh start bigquery)",
)
class TestBigQueryDataLoader(unittest.TestCase):
    """Test BigQueryDataLoader against the emulator using workspace/datalake."""

    def setUp(self) -> None:
        self._workspace_root = None

    def _workspace_root_path(self) -> str:
        if self._workspace_root is None:
            self._workspace_root = __import__("tempfile").mkdtemp(prefix="df_test_bq_")
            self.addCleanup(self._cleanup_workspace)
        return self._workspace_root

    def _cleanup_workspace(self) -> None:
        if self._workspace_root is not None:
            p = Path(self._workspace_root)
            if p.exists():
                shutil.rmtree(p, ignore_errors=True)

    def _get_workspace(self):
        from data_formulator.datalake.workspace import Workspace
        return Workspace("test-identity-bq", root_dir=self._workspace_root_path())

    def test_list_tables(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        tables = loader.list_tables()

        self.assertIsInstance(tables, list)
        self.assertGreater(len(tables), 0)
        for table in tables:
            self.assertIn("name", table)
            self.assertIn("metadata", table)
            self.assertIn("columns", table["metadata"])
            self.assertIn("row_count", table["metadata"])

        table_names = [t["name"] for t in tables]
        expected = ["products", "customers", "orders", "page_views"]
        for expected_name in expected:
            found = any(expected_name in name for name in table_names)
            self.assertTrue(found, f"Should find table containing '{expected_name}'")

    def test_list_tables_with_filter(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        tables = loader.list_tables(table_filter="product")

        self.assertIsInstance(tables, list)
        for table in tables:
            self.assertIn("product", table["name"].lower())

    def test_list_tables_specific_dataset(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config, dataset_ids=["sample"])
        tables = loader.list_tables()

        for table in tables:
            self.assertIn("sample", table["name"])

    def test_fetch_data_as_arrow_from_table(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        source_table = "test-project.sample.products"
        table = loader.fetch_data_as_arrow(source_table=source_table, import_options={"size": 20})

        self.assertIsNotNone(table)
        self.assertGreater(table.num_rows, 0)
        self.assertIn("id", table.column_names)
        self.assertIn("name", table.column_names)
        self.assertIn("category", table.column_names)
        self.assertIn("price", table.column_names)

    def test_fetch_data_respects_size(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        table = loader.fetch_data_as_arrow(
            source_table="test-project.sample.products", import_options={"size": 5}
        )

        self.assertLessEqual(table.num_rows, 5)

    def test_fetch_data_invalid_table_raises(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        with self.assertRaises(Exception):
            loader.fetch_data_as_arrow(
                source_table="test-project.sample.nonexistent_table_xyz",
                import_options={"size": 10},
            )

    def test_ingest_table_to_workspace(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        workspace = self._get_workspace()
        table_name = "test-project.sample.customers"
        target_name = "customers_test"

        meta = loader.ingest_to_workspace(
            workspace, target_name, source_table=table_name, import_options={"size": 100}
        )

        self.assertEqual(meta.name, "customers_test")
        self.assertEqual(meta.file_type, "parquet")
        self.assertIsNotNone(meta.row_count)
        self.assertGreater(meta.row_count, 0)
        self.assertTrue(workspace.file_exists(meta.filename))

        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)
        self.assertIn("id", df.columns)
        self.assertIn("first_name", df.columns)

    def test_ingest_table_auto_name(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        workspace = self._get_workspace()
        table_name = "test-project.sample.customers"

        meta = loader.ingest_to_workspace(
            workspace, "customers", source_table=table_name, import_options={"size": 100}
        )

        self.assertEqual(meta.name, "customers")
        df = workspace.read_data_as_df("customers")
        self.assertGreater(len(df), 0)

    def test_ingest_products_table(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        workspace = self._get_workspace()
        target_name = "electronics_products"
        source_table = "test-project.sample.products"

        meta = loader.ingest_to_workspace(
            workspace, target_name, source_table=source_table, import_options={"size": 1000}
        )

        self.assertGreater(meta.row_count, 0)
        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)
        self.assertIn("id", df.columns)
        self.assertIn("name", df.columns)
        self.assertIn("category", df.columns)
        self.assertIn("price", df.columns)

    def test_ingest_orders_table(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        workspace = self._get_workspace()
        meta = loader.ingest_to_workspace(
            workspace, "order_details", source_table="test-project.sample.orders", import_options={"size": 1000}
        )

        self.assertGreater(meta.row_count, 0)
        df = workspace.read_data_as_df("order_details")
        self.assertIn("id", df.columns)
        self.assertIn("total_amount", df.columns)
        self.assertIn("status", df.columns)

    def test_ingest_sanitizes_table_name(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        workspace = self._get_workspace()
        # Name with dashes is sanitized to underscores (and lowercased)
        meta = loader.ingest_to_workspace(
            workspace,
            "test-table-with-dashes",
            source_table="test-project.sample.customers", import_options={"size": 10},
        )

        # sanitize_table_name produces lowercase with underscores
        self.assertIn(meta.name, workspace.list_tables())
        self.assertTrue(workspace.file_exists(meta.filename))
        df = workspace.read_data_as_df(meta.name)
        self.assertGreater(len(df), 0)

    def test_get_table_info_from_datalake(self) -> None:
        config = get_test_config()
        loader = create_loader_for_emulator(config)
        workspace = self._get_workspace()
        loader.ingest_to_workspace(
            workspace,
            "my_table",
            source_table="test-project.sample.customers", import_options={"size": 5_000},
        )

        self.assertIn("my_table", workspace.list_tables())
        meta = workspace.get_table_metadata("my_table")
        self.assertIsNotNone(meta)
        self.assertEqual(meta.name, "my_table")
        self.assertIsNotNone(meta.row_count)
        self.assertIsNotNone(meta.columns)
        self.assertGreater(len(meta.columns), 0)

        schema_info = workspace.get_parquet_schema("my_table")
        self.assertIn("columns", schema_info)
        self.assertIn("num_rows", schema_info)
        self.assertGreater(schema_info["num_rows"], 0)

        df = workspace.read_data_as_df("my_table")
        self.assertGreater(len(df), 0)
        self.assertEqual(len(df.columns), len(meta.columns))


class TestBigQueryDataLoaderStatic(unittest.TestCase):
    """Test static methods of BigQueryDataLoader (no emulator required)."""

    def test_list_params(self) -> None:
        params = BigQueryDataLoader.list_params()
        self.assertIsInstance(params, list)
        self.assertGreater(len(params), 0)
        param_names = [p["name"] for p in params]
        self.assertIn("project_id", param_names)
        self.assertIn("dataset_id", param_names)
        self.assertIn("credentials_path", param_names)
        self.assertIn("location", param_names)
        project_param = next(p for p in params if p["name"] == "project_id")
        self.assertTrue(project_param["required"])

    def test_auth_instructions(self) -> None:
        instructions = BigQueryDataLoader.auth_instructions()
        self.assertIsInstance(instructions, str)
        self.assertGreater(len(instructions), 100)
        self.assertIn("Authentication", instructions)
        self.assertIn("project_id", instructions)


def run_tests() -> bool:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestBigQueryDataLoaderStatic))
    suite.addTests(loader.loadTestsFromTestCase(TestBigQueryDataLoader))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return len(result.failures) == 0 and len(result.errors) == 0


if __name__ == "__main__":
    success = run_tests()
    exit(0 if success else 1)
