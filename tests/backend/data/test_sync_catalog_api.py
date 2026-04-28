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
            assert data["status"] == "ok"
            assert isinstance(data["tree"], list)
            assert len(data["tree"]) == 2

            summary = data["sync_summary"]
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

    def test_missing_connector_returns_error(self, app):
        client = app.test_client()
        resp = client.post("/api/connectors/sync-catalog-metadata", json={
            "connector_id": "nonexistent",
        })
        data = resp.get_json()
        assert data["status"] == "error"
