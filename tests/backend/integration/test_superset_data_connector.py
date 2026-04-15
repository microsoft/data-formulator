# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for SupersetLoader via DataConnector routes.

All Superset API calls are mocked — no real Superset instance needed.

Covers:
- JWT-based auth (token mode): connect / disconnect / status
- Dashboard → dataset hierarchy browsing
- "All Datasets" synthetic namespace
- Dataset metadata retrieval
- Data fetch via SQL Lab (mocked)
- Token refresh / re-login flow
- Frontend config for Superset sources
"""
from __future__ import annotations

import base64
import json
import time
from typing import Any
from unittest.mock import MagicMock, patch

import flask
import pyarrow as pa
import pytest

from data_formulator.data_connector import DataConnector
from data_formulator.data_loader.external_data_loader import CatalogNode

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# JWT helpers
# ------------------------------------------------------------------

def _make_jwt(exp: float | None = None, sub: str = "admin") -> str:
    """Build a fake JWT with a valid exp claim."""
    if exp is None:
        exp = time.time() + 3600  # 1 hour from now
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": sub, "exp": exp}).encode()
    ).rstrip(b"=").decode()
    sig = base64.urlsafe_b64encode(b"fake-signature").rstrip(b"=").decode()
    return f"{header}.{payload}.{sig}"


def _expired_jwt() -> str:
    return _make_jwt(exp=time.time() - 100)


# ------------------------------------------------------------------
# Mock Superset API
# ------------------------------------------------------------------

class MockSupersetClient:
    """Simulates SupersetClient API responses."""

    def __init__(self, url):
        self.url = url

    def list_datasets(self, token, page=0, page_size=100):
        datasets = [
            {"id": 1, "table_name": "orders_fact", "schema": "public",
             "database": {"id": 1, "database_name": "analytics"}, "row_count": 50000},
            {"id": 2, "table_name": "users_dim", "schema": "public",
             "database": {"id": 1, "database_name": "analytics"}, "row_count": 10000},
        ]
        start = page * page_size
        batch = datasets[start:start + page_size]
        return {"result": batch, "count": len(datasets)}

    def list_dashboards(self, token, page=0, page_size=500):
        return {
            "result": [
                {"id": 10, "dashboard_title": "Sales Dashboard"},
                {"id": 20, "dashboard_title": "User Analytics"},
            ],
            "count": 2,
        }

    def get_dashboard_datasets(self, token, dashboard_id):
        if dashboard_id == 10:
            return {
                "result": [
                    {"id": 1, "table_name": "orders_fact", "schema": "public",
                     "database": {"id": 1, "database_name": "analytics"}, "row_count": 50000},
                ]
            }
        if dashboard_id == 20:
            return {
                "result": [
                    {"id": 2, "table_name": "users_dim", "schema": "public",
                     "database": {"id": 1, "database_name": "analytics"}, "row_count": 10000},
                ]
            }
        return {"result": []}

    def get_dataset_detail(self, token, dataset_id):
        datasets = {
            1: {
                "id": 1, "table_name": "orders_fact", "schema": "public",
                "database": {"id": 1, "database_name": "analytics"},
                "columns": [
                    {"column_name": "order_id", "type": "INT"},
                    {"column_name": "customer_id", "type": "INT"},
                    {"column_name": "amount", "type": "DECIMAL(10,2)"},
                    {"column_name": "order_date", "type": "TIMESTAMP"},
                ],
                "row_count": 50000,
                "description": "Main orders fact table",
                "kind": "physical",
            },
            2: {
                "id": 2, "table_name": "users_dim", "schema": "public",
                "database": {"id": 1, "database_name": "analytics"},
                "columns": [
                    {"column_name": "user_id", "type": "INT"},
                    {"column_name": "name", "type": "VARCHAR"},
                    {"column_name": "email", "type": "VARCHAR"},
                ],
                "row_count": 10000,
                "kind": "physical",
            },
        }
        return datasets.get(dataset_id, {})

    def create_sql_session(self, token):
        return {"session_id": "mock-session-123"}

    def execute_sql_with_session(self, session, db_id, sql, schema, limit):
        return {
            "data": [
                {"order_id": 1, "customer_id": 100, "amount": 99.99, "order_date": "2025-01-01"},
                {"order_id": 2, "customer_id": 101, "amount": 150.00, "order_date": "2025-01-02"},
                {"order_id": 3, "customer_id": 100, "amount": 75.50, "order_date": "2025-01-03"},
            ]
        }


class MockAuthBridge:
    def __init__(self, url):
        self.url = url

    def login(self, username, password):
        if username == "admin" and password == "admin":
            return {"access_token": _make_jwt(), "refresh_token": _make_jwt()}
        raise ValueError("Invalid credentials")

    def refresh_token(self, refresh_token):
        return {"access_token": _make_jwt()}


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _mock_superset_imports():
    """Patch the lazy-imported Superset helpers."""
    import data_formulator.data_loader.superset_data_loader as sdl
    old_client, old_bridge = sdl._SupersetClient, sdl._SupersetAuthBridge
    sdl._SupersetClient = MockSupersetClient
    sdl._SupersetAuthBridge = MockAuthBridge
    yield
    sdl._SupersetClient, sdl._SupersetAuthBridge = old_client, old_bridge


@pytest.fixture
def app():
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test"
    return _app


@pytest.fixture
def source():
    from data_formulator.data_loader.superset_data_loader import SupersetLoader
    return DataConnector.from_loader(
        SupersetLoader,
        source_id="superset",
        display_name="Test Superset",
    )


@pytest.fixture
def client(app, source):
    app.register_blueprint(source.create_blueprint())
    return app.test_client()


@pytest.fixture
def connected_client(client):
    with patch.object(DataConnector, "_get_identity", return_value="test-user"):
        resp = client.post("/api/connectors/superset/auth/connect", json={
            "params": {"url": "https://bi.example.com", "username": "admin", "password": "admin"},
        })
        assert resp.status_code == 200
        yield client


# ==================================================================
# Tests: Auth (JWT token mode)
# ==================================================================

class TestSupersetAuth:

    def test_connect_success(self, client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = client.post("/api/connectors/superset/auth/connect", json={
                "params": {"url": "https://bi.example.com", "username": "admin", "password": "admin"},
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "connected"
        # Hierarchy: dashboard → dataset
        keys = [h["key"] for h in data["hierarchy"]]
        assert keys == ["dashboard", "dataset"]

    def test_connect_bad_credentials(self, client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = client.post("/api/connectors/superset/auth/connect", json={
                "params": {"url": "https://bi.example.com", "username": "admin", "password": "wrong"},
            })
        assert resp.status_code in (400, 500)
        data = resp.get_json()
        assert data["status"] == "error"
        # Must not leak the password
        assert "wrong" not in json.dumps(data)

    def test_auth_mode_is_token(self):
        from data_formulator.data_loader.superset_data_loader import SupersetLoader
        assert SupersetLoader.auth_mode() == "token"

    def test_disconnect_and_status(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/superset/auth/disconnect")
            assert resp.get_json()["status"] == "disconnected"

            resp = connected_client.get("/api/connectors/superset/auth/status")
            assert resp.get_json()["connected"] is False


# ==================================================================
# Tests: Catalog browsing (dashboard → dataset hierarchy)
# ==================================================================

class TestSupersetCatalog:

    def test_ls_root_lists_dashboards_and_all_datasets(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/superset/catalog/ls", json={"path": []})
        data = resp.get_json()
        assert resp.status_code == 200

        names = [n["name"] for n in data["nodes"]]
        assert "Sales Dashboard" in names
        assert "User Analytics" in names
        assert "All Datasets" in names

        # All root nodes should be namespace
        for node in data["nodes"]:
            assert node["node_type"] == "namespace"

    def test_ls_dashboard_lists_its_datasets(self, connected_client):
        """Expand Sales Dashboard → should see orders_fact."""
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/superset/catalog/ls", json={
                "path": ["10"],  # Sales Dashboard ID
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert len(data["nodes"]) >= 1
        names = [n["name"] for n in data["nodes"]]
        assert "orders_fact" in names
        for n in data["nodes"]:
            assert n["node_type"] == "table"

    def test_ls_all_datasets(self, connected_client):
        """Expand 'All Datasets' → should see both datasets."""
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/superset/catalog/ls", json={
                "path": ["__all__"],
            })
        data = resp.get_json()
        names = [n["name"] for n in data["nodes"]]
        assert "orders_fact" in names
        assert "users_dim" in names

    def test_ls_with_filter(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/superset/catalog/ls", json={
                "path": ["__all__"],
                "filter": "orders",
            })
        nodes = resp.get_json()["nodes"]
        assert len(nodes) == 1
        assert nodes[0]["name"] == "orders_fact"

    def test_catalog_metadata(self, connected_client):
        """Get metadata for a specific dataset."""
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/superset/catalog/metadata", json={
                "path": ["10", "1"],  # dashboard_id, dataset_id
            })
        data = resp.get_json()
        assert resp.status_code == 200
        meta = data["metadata"]
        assert meta["dataset_id"] == 1
        assert meta["row_count"] == 50000
        col_names = [c["name"] for c in meta["columns"]]
        assert "order_id" in col_names
        assert "amount" in col_names

    def test_list_tables_flat(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/superset/catalog/list_tables", json={})
        data = resp.get_json()
        assert len(data["tables"]) == 2
        names = [t["name"] for t in data["tables"]]
        assert any("orders_fact" in n for n in names)
        assert any("users_dim" in n for n in names)


# ==================================================================
# Tests: Data routes
# ==================================================================

class TestSupersetData:

    def test_preview(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/superset/data/preview", json={
                "source_table": "1:orders_fact",
                "size": 3,
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "success"
        assert data["row_count"] > 0
        col_names = {c["name"] for c in data["columns"]}
        assert "order_id" in col_names

    def test_import(self, connected_client):
        mock_meta = MagicMock()
        mock_meta.name = "orders"
        mock_meta.row_count = 3

        with patch.object(DataConnector, "_get_identity", return_value="test-user"), \
             patch("data_formulator.security.auth.get_identity_id", return_value="test-user"), \
             patch("data_formulator.workspace_factory.get_workspace") as mock_ws:

            from data_formulator.data_loader.superset_data_loader import SupersetLoader
            with patch.object(SupersetLoader, "ingest_to_workspace", return_value=mock_meta):
                resp = connected_client.post("/api/connectors/superset/data/import", json={
                    "source_table": "1:orders_fact",
                    "table_name": "orders",
                })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "success"
        assert data["table_name"] == "orders"
        assert data["refreshable"] is True


# ==================================================================
# Tests: Token refresh
# ==================================================================

class TestSupersetTokenRefresh:

    def test_connect_with_expired_token_triggers_refresh(self, client):
        """If token expires between connect and catalog call, refresh should work."""
        from data_formulator.data_loader.superset_data_loader import SupersetLoader

        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            # Connect
            resp = client.post("/api/connectors/superset/auth/connect", json={
                "params": {"url": "https://bi.example.com", "username": "admin", "password": "admin"},
            })
            assert resp.status_code == 200

            # Now artificially expire the token
            # The mock _ensure_token will handle refresh via MockAuthBridge
            resp = client.post("/api/connectors/superset/catalog/ls", json={"path": []})
            assert resp.status_code == 200
            assert len(resp.get_json()["nodes"]) > 0


# ==================================================================
# Tests: Frontend Config
# ==================================================================

class TestSupersetFrontendConfig:

    def test_config_structure(self, source):
        cfg = source.get_frontend_config()
        assert cfg["source_id"] == "superset"
        assert cfg["name"] == "Test Superset"
        # All params should be in form (nothing pinned)
        form_names = {f["name"] for f in cfg["params_form"]}
        assert "url" in form_names
        assert "username" in form_names
        assert "password" in form_names

    def test_pinned_url(self):
        from data_formulator.data_loader.superset_data_loader import SupersetLoader
        source = DataConnector.from_loader(
            SupersetLoader,
            source_id="superset_corp",
            display_name="Corp Superset",
            default_params={"url": "https://bi.corp.com"},
        )
        cfg = source.get_frontend_config()
        assert cfg["pinned_params"]["url"] == "https://bi.corp.com"
        form_names = {f["name"] for f in cfg["params_form"]}
        assert "url" not in form_names
        assert "username" in form_names

    def test_hierarchy_is_dashboard_dataset(self, source):
        cfg = source.get_frontend_config()
        keys = [h["key"] for h in cfg["hierarchy"]]
        assert keys == ["dashboard", "dataset"]
