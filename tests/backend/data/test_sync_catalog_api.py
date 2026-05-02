"""Tests for the POST /api/connectors/sync-catalog-metadata endpoint.

Background
----
The sync-catalog-metadata endpoint calls loader.sync_catalog_metadata(),
builds a tree, writes catalog_cache, and returns the complete tree with
a sync_summary to the frontend.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import flask
import pyarrow as pa
import pytest

from data_formulator.data_connector import (
    DataConnector,
    DATA_CONNECTORS,
    connectors_bp,
)
from data_formulator.datalake.catalog_annotations import patch_annotation
from data_formulator.datalake.catalog_cache import save_catalog
from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from data_formulator.error_handler import register_error_handlers

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ── Stub loader ───────────────────────────────────────────────────────

class _StubLoader(ExternalDataLoader):
    def __init__(self, params):
        self.params = params
        self._sync_tables = [
            {
                "name": "orders",
                "table_key": "uuid-1",
                "metadata": {
                    "_source_name": "orders",
                    "description": "Order table",
                    "columns": [{"name": "id", "description": "PK"}],
                    "source_metadata_status": "synced",
                },
            },
            {
                "name": "users",
                "table_key": "uuid-2",
                "metadata": {
                    "_source_name": "users",
                    "source_metadata_status": "unavailable",
                },
            },
        ]

    @staticmethod
    def list_params():
        return [{"name": "host", "type": "string", "required": True, "tier": "connection"}]

    @staticmethod
    def auth_instructions():
        return ""

    def list_tables(self, table_filter=None):
        return self._sync_tables

    def sync_catalog_metadata(self, table_filter=None):
        return list(self._sync_tables)

    def fetch_data_as_arrow(self, source_table, import_options=None):
        return pa.table({"x": [1]})

    def test_connection(self):
        return True


# ── Fixtures ──────────────────────────────────────────────────────────

@pytest.fixture()
def app(tmp_path):
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.register_blueprint(connectors_bp)
    register_error_handlers(_app)
    return _app


# ── Tests ─────────────────────────────────────────────────────────────

class TestSyncCatalogMetadataEndpoint:

    def test_returns_tree_and_summary(self, app, tmp_path):
        connector = DataConnector.from_loader(
            _StubLoader, source_id="test_pg", display_name="Test PG",
        )
        DATA_CONNECTORS["test_pg"] = connector

        user_home = tmp_path / "users" / "test_user"

        try:
            with patch.object(DataConnector, "_get_identity", return_value="test_user"), \
                 patch.object(DataConnector, "_get_vault", return_value=None), \
                 patch("data_formulator.datalake.workspace.get_user_home", return_value=user_home):

                # Connect first
                client = app.test_client()
                client.post("/api/connectors/connect", json={
                    "connector_id": "test_pg",
                    "params": {"host": "localhost"},
                    "persist": False,
                })

                # Now call sync
                resp = client.post("/api/connectors/sync-catalog-metadata", json={
                    "connector_id": "test_pg",
                })

            data = resp.get_json()
            assert data["status"] == "success"
            assert isinstance(data["data"]["tree"], list)
            assert len(data["data"]["tree"]) == 2

            summary = data["data"]["sync_summary"]
            assert summary["total"] == 2
            assert summary["synced"] == 1
            assert summary["failed"] == 1

            # Verify cache was written
            cache_file = user_home / "catalog_cache" / "test_pg.json"
            assert cache_file.is_file()
            with open(cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            assert "synced_at" in cached
            assert len(cached["tables"]) == 2
        finally:
            DATA_CONNECTORS.pop("test_pg", None)

    def test_partial_sync_returns_message_code(self, app, tmp_path):
        """sync_summary with failures → message_code = catalog.syncPartial."""
        connector = DataConnector.from_loader(
            _StubLoader, source_id="test_pg2", display_name="Test PG2",
        )
        DATA_CONNECTORS["test_pg2"] = connector
        user_home = tmp_path / "users" / "test_user"

        try:
            with patch.object(DataConnector, "_get_identity", return_value="test_user"), \
                 patch.object(DataConnector, "_get_vault", return_value=None), \
                 patch("data_formulator.datalake.workspace.get_user_home", return_value=user_home):
                client = app.test_client()
                client.post("/api/connectors/connect", json={
                    "connector_id": "test_pg2",
                    "params": {"host": "localhost"},
                    "persist": False,
                })
                resp = client.post("/api/connectors/sync-catalog-metadata", json={
                    "connector_id": "test_pg2",
                })

            data = resp.get_json()
            assert data["status"] == "success"
            assert data["data"]["message_code"] == "catalog.syncPartial"
            assert "message" in data["data"]
            assert data["data"]["message_params"]["failed"] == 1
            assert data["data"]["message_params"]["total"] == 2
        finally:
            DATA_CONNECTORS.pop("test_pg2", None)

    def test_full_sync_returns_complete_message_code(self, app, tmp_path):
        """All tables synced → message_code = catalog.syncComplete."""

        class _AllSyncedLoader(_StubLoader):
            def sync_catalog_metadata(self, table_filter=None):
                return [
                    {
                        "name": "t1", "table_key": "k1",
                        "metadata": {"source_metadata_status": "synced"},
                    },
                ]

        connector = DataConnector.from_loader(
            _AllSyncedLoader, source_id="test_full", display_name="Full",
        )
        DATA_CONNECTORS["test_full"] = connector
        user_home = tmp_path / "users" / "test_user"

        try:
            with patch.object(DataConnector, "_get_identity", return_value="test_user"), \
                 patch.object(DataConnector, "_get_vault", return_value=None), \
                 patch("data_formulator.datalake.workspace.get_user_home", return_value=user_home):
                client = app.test_client()
                client.post("/api/connectors/connect", json={
                    "connector_id": "test_full",
                    "params": {"host": "localhost"},
                    "persist": False,
                })
                resp = client.post("/api/connectors/sync-catalog-metadata", json={
                    "connector_id": "test_full",
                })

            data = resp.get_json()
            assert data["status"] == "success"
            assert data["data"]["message_code"] == "catalog.syncComplete"
        finally:
            DATA_CONNECTORS.pop("test_full", None)

    def test_timeout_returns_catalog_sync_timeout(self, app, tmp_path):
        """TimeoutError during sync → CATALOG_SYNC_TIMEOUT error."""

        class _TimeoutLoader(_StubLoader):
            def sync_catalog_metadata(self, table_filter=None):
                raise TimeoutError("sync timed out")

        connector = DataConnector.from_loader(
            _TimeoutLoader, source_id="test_to", display_name="Timeout",
        )
        DATA_CONNECTORS["test_to"] = connector
        user_home = tmp_path / "users" / "test_user"

        try:
            with patch.object(DataConnector, "_get_identity", return_value="test_user"), \
                 patch.object(DataConnector, "_get_vault", return_value=None), \
                 patch("data_formulator.datalake.workspace.get_user_home", return_value=user_home):
                client = app.test_client()
                client.post("/api/connectors/connect", json={
                    "connector_id": "test_to",
                    "params": {"host": "localhost"},
                    "persist": False,
                })
                resp = client.post("/api/connectors/sync-catalog-metadata", json={
                    "connector_id": "test_to",
                })

            data = resp.get_json()
            assert resp.status_code == 200
            assert data["status"] == "error"
            assert data["error"]["code"] == "CATALOG_SYNC_TIMEOUT"
        finally:
            DATA_CONNECTORS.pop("test_to", None)

    def test_missing_connector_returns_error(self, app):
        client = app.test_client()
        resp = client.post("/api/connectors/sync-catalog-metadata", json={
            "connector_id": "nonexistent",
        })
        data = resp.get_json()
        assert data["status"] == "error"

    def test_sync_then_catalog_tree_preserves_column_metadata_in_cache(self, app, tmp_path):
        """A post-sync tree refresh must not replace rich metadata with list_tables output."""

        class _RichSyncLeanListLoader(_StubLoader):
            def list_tables(self, table_filter=None):
                return [
                    {
                        "name": "orders",
                        "table_key": "uuid-1",
                        "metadata": {
                            "_source_name": "orders",
                            "description": "Order table",
                        },
                    },
                ]

            def sync_catalog_metadata(self, table_filter=None):
                return [
                    {
                        "name": "orders",
                        "table_key": "uuid-1",
                        "metadata": {
                            "_source_name": "orders",
                            "description": "Order table",
                            "columns": [{"name": "id", "description": "PK"}],
                            "source_metadata_status": "synced",
                        },
                    },
                ]

        connector = DataConnector.from_loader(
            _RichSyncLeanListLoader, source_id="test_rich", display_name="Rich",
        )
        DATA_CONNECTORS["test_rich"] = connector
        user_home = tmp_path / "users" / "test_user"

        try:
            with patch.object(DataConnector, "_get_identity", return_value="test_user"), \
                 patch.object(DataConnector, "_get_vault", return_value=None), \
                 patch("data_formulator.datalake.workspace.get_user_home", return_value=user_home):
                client = app.test_client()
                client.post("/api/connectors/connect", json={
                    "connector_id": "test_rich",
                    "params": {"host": "localhost"},
                    "persist": False,
                })
                sync_resp = client.post("/api/connectors/sync-catalog-metadata", json={
                    "connector_id": "test_rich",
                })
                assert sync_resp.get_json()["status"] == "success"

                tree_resp = client.post("/api/connectors/get-catalog-tree", json={
                    "connector_id": "test_rich",
                })
                assert tree_resp.get_json()["status"] == "success"

            cache_file = user_home / "catalog_cache" / "test_rich.json"
            with open(cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)

            meta = cached["tables"][0]["metadata"]
            assert meta["source_metadata_status"] == "synced"
            assert meta["columns"] == [{"name": "id", "description": "PK"}]
        finally:
            DATA_CONNECTORS.pop("test_rich", None)

    def test_catalog_tree_returns_merged_annotations_from_cache(self, app, tmp_path):
        """Catalog tree responses should expose source/user/display descriptions."""
        connector = DataConnector.from_loader(
            _StubLoader, source_id="test_merged", display_name="Merged",
        )
        DATA_CONNECTORS["test_merged"] = connector
        user_home = tmp_path / "users" / "test_user"

        save_catalog(user_home, "test_merged", [
            {
                "name": "orders",
                "table_key": "uuid-1",
                "metadata": {
                    "_source_name": "orders",
                    "description": "Source order table",
                    "columns": [{"name": "id"}],
                    "source_metadata_status": "synced",
                },
            },
        ])
        patch_annotation(
            user_home,
            "test_merged",
            "uuid-1",
            {
                "description": "User order annotation",
                "notes": "Prefer settled orders",
                "tags": ["finance"],
            },
            expected_version=0,
        )

        try:
            with patch.object(DataConnector, "_get_identity", return_value="test_user"), \
                 patch.object(DataConnector, "_get_vault", return_value=None), \
                 patch("data_formulator.datalake.workspace.get_user_home", return_value=user_home):
                client = app.test_client()
                client.post("/api/connectors/connect", json={
                    "connector_id": "test_merged",
                    "params": {"host": "localhost"},
                    "persist": False,
                })
                resp = client.post("/api/connectors/get-catalog-tree", json={
                    "connector_id": "test_merged",
                })

            data = resp.get_json()
            assert data["status"] == "success"
            meta = data["data"]["tree"][0]["metadata"]
            assert meta["source_description"] == "Source order table"
            assert meta["user_description"] == "User order annotation"
            assert meta["display_description"] == "User order annotation"
            assert meta["notes"] == "Prefer settled orders"
            assert meta["tags"] == ["finance"]
            assert "columns" not in meta
        finally:
            DATA_CONNECTORS.pop("test_merged", None)
