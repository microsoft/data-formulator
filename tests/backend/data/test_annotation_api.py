"""Tests for PATCH/GET /api/connectors/catalog-annotations endpoints.

Background
----
Annotation API endpoints allow users to read and modify per-table metadata
annotations. PATCH uses optimistic concurrency (expected_version). GET
returns the current annotations for a source.
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

pytestmark = [pytest.mark.backend]


class _StubLoader(ExternalDataLoader):
    def __init__(self, params):
        self.params = params

    @staticmethod
    def list_params():
        return [{"name": "host", "type": "string", "required": True, "tier": "connection"}]

    @staticmethod
    def auth_instructions():
        return ""

    def list_tables(self, table_filter=None):
        return [{"name": "t1", "table_key": "uuid-1", "metadata": {}}]

    def fetch_data_as_arrow(self, source_table, import_options=None):
        return pa.table({"x": [1]})

    def test_connection(self):
        return True


@pytest.fixture()
def app(tmp_path):
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.register_blueprint(connectors_bp)
    register_error_handlers(_app)
    return _app


@pytest.fixture()
def connected_app(app, tmp_path):
    """App with a connected stub connector and all identity patches."""
    connector = DataConnector.from_loader(
        _StubLoader, source_id="test_pg", display_name="Test PG",
    )
    DATA_CONNECTORS["test_pg"] = connector
    user_home = tmp_path / "users" / "test_user"

    with patch.object(DataConnector, "_get_identity", return_value="test_user"), \
         patch.object(DataConnector, "_get_vault", return_value=None), \
         patch("data_formulator.datalake.workspace.get_user_home", return_value=user_home), \
         patch("data_formulator.auth.identity.get_identity_id", return_value="test_user"):
        client = app.test_client()
        client.post("/api/connectors/connect", json={
            "connector_id": "test_pg",
            "params": {"host": "localhost"},
            "persist": False,
        })
        yield client, user_home

    DATA_CONNECTORS.pop("test_pg", None)


class TestPatchAnnotations:

    def test_create_new_annotation(self, connected_app):
        client, _ = connected_app
        resp = client.patch("/api/connectors/catalog-annotations", json={
            "connector_id": "test_pg",
            "table_key": "uuid-1",
            "expected_version": 0,
            "description": "My orders table",
        })
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["version"] == 1
        assert data["message_code"] == "catalog.annotationSaved"
        assert "message" in data

    def test_version_conflict(self, connected_app):
        client, _ = connected_app
        client.patch("/api/connectors/catalog-annotations", json={
            "connector_id": "test_pg",
            "table_key": "uuid-1",
            "expected_version": 0,
            "description": "v1",
        })
        resp = client.patch("/api/connectors/catalog-annotations", json={
            "connector_id": "test_pg",
            "table_key": "uuid-1",
            "expected_version": 99,
            "description": "conflict!",
        })
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == "ANNOTATION_CONFLICT"

    def test_missing_table_key(self, connected_app):
        client, _ = connected_app
        resp = client.patch("/api/connectors/catalog-annotations", json={
            "connector_id": "test_pg",
            "description": "no key",
        })
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == "ANNOTATION_INVALID_PATCH"

    def test_no_fields(self, connected_app):
        client, _ = connected_app
        resp = client.patch("/api/connectors/catalog-annotations", json={
            "connector_id": "test_pg",
            "table_key": "uuid-1",
        })
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == "ANNOTATION_INVALID_PATCH"


class TestGetAnnotations:

    def test_empty_annotations(self, connected_app):
        client, _ = connected_app
        resp = client.get("/api/connectors/catalog-annotations?connector_id=test_pg")
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["version"] == 0
        assert data["tables"] == {}

    def test_after_patch(self, connected_app):
        client, _ = connected_app
        client.patch("/api/connectors/catalog-annotations", json={
            "connector_id": "test_pg",
            "table_key": "uuid-1",
            "expected_version": 0,
            "description": "Order table",
            "columns": {"order_id": {"description": "PK"}},
        })
        resp = client.get("/api/connectors/catalog-annotations?connector_id=test_pg")
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["version"] == 1
        assert "uuid-1" in data["tables"]
        assert data["tables"]["uuid-1"]["description"] == "Order table"
        assert data["tables"]["uuid-1"]["columns"]["order_id"]["description"] == "PK"
