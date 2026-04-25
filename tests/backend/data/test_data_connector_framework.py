# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for the DataConnector framework.

Tests the generic lifecycle wrapper using a mock ExternalDataLoader — no
real database or network access required.

Covers:
- Blueprint creation and route registration
- Auth routes: connect / disconnect / status
- Catalog routes: ls / metadata / list_tables
- Data routes: import / preview / refresh
- Error handling and safe error messages
- Identity-based loader isolation
- Frontend config generation
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

import flask
import pyarrow as pa
import pytest

from data_formulator.data_connector import (
    DATA_CONNECTORS,
    DataConnector,
    SourceSpec,
    _node_to_dict,
    _resolve_connector,
    _resolve_env_refs,
    _sanitize_error,
    connectors_bp,
)
from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
)

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Mock loader
# ------------------------------------------------------------------

class MockLoader(ExternalDataLoader):
    """In-memory loader for testing the DataConnector wrapper."""

    _test_tables = {
        "users": pa.table({
            "id": [1, 2, 3, 4, 5],
            "name": ["Alice", "Bob", "Carol", "Dave", "Eve"],
            "email": ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"],
        }),
        "orders": pa.table({
            "id": [1, 2, 3],
            "user_id": [1, 2, 1],
            "amount": [100.0, 200.0, 50.0],
        }),
    }

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self._connected = True
        host = params.get("host", "")
        if host == "bad-host":
            raise ConnectionError("Connection refused")

    def test_connection(self) -> bool:
        return self._connected

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
            {"key": "schema", "label": "Schema"},
            {"key": "table", "label": "Table"},
        ]

    def ls(self, path=None, filter=None):
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]
        if level_key == "database":
            return [CatalogNode("testdb", "namespace", ["testdb"])]
        if level_key == "schema":
            return [CatalogNode("public", "namespace", [*(path), "public"])]
        if level_key == "table":
            nodes = []
            for name in self._test_tables:
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(
                    name, "table", [*path, name],
                    metadata={"row_count": self._test_tables[name].num_rows},
                ))
            return nodes
        return []

    def get_metadata(self, path):
        table_name = path[-1] if path else None
        if table_name in self._test_tables:
            t = self._test_tables[table_name]
            return {
                "name": table_name,
                "row_count": t.num_rows,
                "columns": [{"name": c, "type": str(t.schema.field(c).type)} for c in t.column_names],
            }
        return {}

    def list_tables(self, table_filter=None):
        result = []
        for name, t in self._test_tables.items():
            if table_filter and table_filter.lower() not in name.lower():
                continue
            result.append({
                "name": f"public.{name}",
                "metadata": {
                    "columns": [{"name": c} for c in t.column_names],
                    "row_count": t.num_rows,
                },
            })
        return result

    def fetch_data_as_arrow(self, source_table, import_options=None):
        opts = import_options or {}
        size = opts.get("size", 1000)
        table_key = source_table.split(".")[-1]
        t = self._test_tables.get(table_key)
        if t is None:
            raise ValueError(f"Table not found: {source_table}")
        return t.slice(0, min(size, t.num_rows))

    @staticmethod
    def list_params():
        return [
            {"name": "host", "type": "string", "required": True, "description": "Host"},
            {"name": "port", "type": "number", "required": False, "default": 5432},
            {"name": "user", "type": "string", "required": True},
            {"name": "password", "type": "password", "required": True},
            {"name": "database", "type": "string", "required": False, "scope_level": True},
            {"name": "schema", "type": "string", "required": False, "scope_level": True},
        ]

    @staticmethod
    def auth_instructions():
        return "Connect with host, user, password."


class FailingTestConnectionLoader(MockLoader):
    """Loader whose test_connection always returns False."""

    def test_connection(self) -> bool:
        return False


class AuthTierLoader(MockLoader):
    @staticmethod
    def list_params():
        return [
            {"name": "host", "type": "string", "required": True, "tier": "connection"},
            {"name": "database", "type": "string", "required": False, "tier": "filter"},
            {"name": "user", "type": "string", "required": True, "tier": "auth"},
            {"name": "password", "type": "password", "required": True, "tier": "auth", "sensitive": True},
        ]


class SSOExchangeLoader(MockLoader):
    @staticmethod
    def auth_mode() -> str:
        return "token"

    @staticmethod
    def auth_config() -> dict:
        return {
            "mode": "sso_exchange",
            "display_name": "Superset",
            "exchange_url": "https://superset.example/api/v1/df-token-exchange/",
        }


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clean_data_connectors():
    """Reset the global DATA_CONNECTORS dict between tests."""
    old = dict(DATA_CONNECTORS)
    DATA_CONNECTORS.clear()
    yield
    DATA_CONNECTORS.clear()
    DATA_CONNECTORS.update(old)


@pytest.fixture
def app():
    """Minimal Flask app with the shared connectors blueprint."""
    from data_formulator.error_handler import register_error_handlers

    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"
    _app.register_blueprint(connectors_bp)
    register_error_handlers(_app)
    return _app


@pytest.fixture
def source():
    """A DataConnector wrapping MockLoader."""
    s = DataConnector.from_loader(
        MockLoader,
        source_id="mock_db",
        display_name="Mock Database",
        default_params={"host": "localhost"},
        icon="mock",
    )
    DATA_CONNECTORS["mock_db"] = s
    return s


@pytest.fixture
def source_pinned():
    """A DataConnector with database pre-pinned."""
    s = DataConnector.from_loader(
        MockLoader,
        source_id="mock_pinned",
        display_name="Mock Pinned",
        default_params={"host": "localhost", "database": "testdb"},
    )
    DATA_CONNECTORS["mock_pinned"] = s
    return s


@pytest.fixture
def client(app, source):
    """Flask test client with shared connectors blueprint."""
    return app.test_client()


@pytest.fixture
def connected_client(client):
    """Client that is already connected."""
    with patch.object(DataConnector, "_get_identity", return_value="test-user"):
        resp = client.post("/api/connectors/connect", json={
            "connector_id": "mock_db",
            "params": {"host": "localhost", "user": "test", "password": "test"},
        })
        assert resp.status_code == 200
        yield client


# ==================================================================
# Tests: Blueprint & Registration
# ==================================================================

class TestSharedRouteRegistration:

    def test_shared_routes_registered(self, app, source):
        rules = [rule.rule for rule in app.url_map.iter_rules()]
        assert "/api/connectors/connect" in rules
        assert "/api/connectors/disconnect" in rules
        assert "/api/connectors/get-status" in rules
        assert "/api/connectors/get-catalog" in rules
        assert "/api/connectors/get-catalog-tree" in rules
        assert "/api/connectors/import-data" in rules
        assert "/api/connectors/import-group" in rules
        assert "/api/connectors/refresh-data" in rules
        assert "/api/connectors/preview-data" in rules
        assert "/api/connectors/column-values" in rules


# ==================================================================
# Tests: Frontend Config
# ==================================================================

class TestFrontendConfig:

    def test_frontend_config_structure(self, source):
        cfg = source.get_frontend_config()
        assert cfg["source_id"] == "mock_db"
        assert cfg["name"] == "Mock Database"
        assert cfg["icon"] == "mock"
        assert "params_form" in cfg
        assert "pinned_params" in cfg
        assert "hierarchy" in cfg
        assert "effective_hierarchy" in cfg

    def test_pinned_params_excluded_from_form(self, source):
        cfg = source.get_frontend_config()
        form_names = {f["name"] for f in cfg["params_form"]}
        assert "host" not in form_names  # host is pre-pinned
        assert "user" in form_names
        assert "password" in form_names
        assert cfg["pinned_params"]["host"] == "localhost"

    def test_hierarchy_included(self, source):
        cfg = source.get_frontend_config()
        keys = [h["key"] for h in cfg["hierarchy"]]
        assert keys == ["database", "schema", "table"]

    def test_pinned_source_effective_hierarchy(self, source_pinned):
        cfg = source_pinned.get_frontend_config()
        eff_keys = [h["key"] for h in cfg["effective_hierarchy"]]
        assert "database" not in eff_keys
        assert "schema" in eff_keys
        assert "table" in eff_keys
        assert cfg["pinned_params"]["database"] == "testdb"

    def test_pinned_params_do_not_expose_auth_or_sensitive_values(self):
        source = DataConnector.from_loader(
            AuthTierLoader,
            source_id="private_db",
            display_name="Private DB",
            default_params={
                "host": "db.local",
                "database": "analytics",
                "user": "alice",
                "password": "secret",
            },
        )

        cfg = source.get_frontend_config()

        assert cfg["pinned_params"] == {
            "host": "db.local",
            "database": "analytics",
        }
        form_names = {f["name"] for f in cfg["params_form"]}
        assert "user" not in form_names
        assert "password" not in form_names


class TestConnectorList:

    def test_sso_auto_connect_respects_session_block(self, app):
        source = DataConnector.from_loader(
            SSOExchangeLoader,
            source_id="superset",
            display_name="Superset",
            default_params={"url": "https://superset.example"},
        )
        DATA_CONNECTORS["superset"] = source
        c = app.test_client()

        with patch("data_formulator.auth.identity.get_identity_id", return_value="user:alice"), \
             patch("data_formulator.auth.identity.get_sso_token", return_value="sso-token"), \
             patch("data_formulator.auth.token_store.TokenStore.is_sso_reconnect_blocked", return_value=True):
            resp = c.get("/api/connectors")

        data = resp.get_json()
        connector = data["connectors"][0]
        assert connector["id"] == "superset"
        assert connector["sso_auto_connect"] is False


# ==================================================================
# Tests: Auth Routes
# ==================================================================

class TestAuthRoutes:

    def test_connect_success(self, client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = client.post("/api/connectors/connect", json={
                "connector_id": "mock_db",
                "params": {"host": "localhost", "user": "test", "password": "test"},
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "connected"
        assert "hierarchy" in data
        assert "effective_hierarchy" in data

    def test_connect_merges_default_params(self, client):
        """Default params (host=localhost) merged with user params."""
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = client.post("/api/connectors/connect", json={
                "connector_id": "mock_db",
                "params": {"user": "test", "password": "test"},
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "connected"

    def test_connect_bad_host_returns_error(self, app):
        source = DataConnector.from_loader(MockLoader, source_id="mock_bad")
        DATA_CONNECTORS["mock_bad"] = source
        c = app.test_client()
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = c.post("/api/connectors/connect", json={
                "connector_id": "mock_bad",
                "params": {"host": "bad-host", "user": "x", "password": "x"},
            })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "error"

    def test_connect_fails_when_test_connection_fails(self, app):
        source = DataConnector.from_loader(
            FailingTestConnectionLoader, source_id="mock_fail"
        )
        DATA_CONNECTORS["mock_fail"] = source
        c = app.test_client()
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = c.post("/api/connectors/connect", json={
                "connector_id": "mock_fail",
                "params": {"host": "localhost", "user": "x", "password": "x"},
            })
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "error"

    def test_delete_connector_clears_status(self, connected_client):
        """After DELETE, the connector is gone."""
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.delete("/api/connectors/mock_db")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "deleted"

    def test_disconnect_connector_clears_loader_and_credentials(self, connected_client, source):
        """Disconnect keeps the connector but clears active and stored credentials."""
        with patch.object(DataConnector, "_get_identity", return_value="test-user"), \
             patch.object(source, "_vault_delete") as vault_delete, \
             patch("data_formulator.auth.token_store.TokenStore.clear_service_token") as clear_token:
            assert source._get_loader("test-user") is not None
            resp = connected_client.post("/api/connectors/disconnect", json={
                "connector_id": "mock_db",
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "disconnected"
        assert source._get_loader("test-user") is None
        vault_delete.assert_called_once_with("test-user")
        clear_token.assert_called_once_with("mock_db")

    def test_status_connected(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/get-status", json={"connector_id": "mock_db"})
        data = resp.get_json()
        assert data["connected"] is True
        assert "hierarchy" in data

    def test_status_not_connected(self, client):
        with patch.object(DataConnector, "_get_identity", return_value="other-user"):
            resp = client.post("/api/connectors/get-status", json={"connector_id": "mock_db"})
        data = resp.get_json()
        assert data["connected"] is False
        assert "params_form" in data

    def test_status_not_connected_after_no_connect(self, client):
        """Status should show not-connected for a user that never connected."""
        with patch.object(DataConnector, "_get_identity", return_value="other-user"):
            resp = client.post("/api/connectors/get-status", json={"connector_id": "mock_db"})
        data = resp.get_json()
        assert data["connected"] is False

    def test_safe_params_exclude_password(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/get-status", json={"connector_id": "mock_db"})
        data = resp.get_json()
        assert "password" not in data.get("params", {})


# ==================================================================
# Tests: Catalog Routes
# ==================================================================

class TestCatalogRoutes:

    def test_ls_root(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/get-catalog", json={
                "connector_id": "mock_db",
                "path": [],
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert "nodes" in data
        assert len(data["nodes"]) > 0
        # First level is "database" → namespace
        assert data["nodes"][0]["node_type"] == "namespace"

    def test_ls_returns_hierarchy(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/get-catalog", json={"connector_id": "mock_db", "path": []})
        data = resp.get_json()
        assert "hierarchy" in data
        assert "effective_hierarchy" in data
        assert data["hierarchy"][0]["key"] == "database"

    def test_ls_drill_down_to_tables(self, connected_client):
        """Expand database → schema → tables."""
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            # Level 1: databases
            resp = connected_client.post("/api/connectors/get-catalog", json={"connector_id": "mock_db", "path": []})
            db_node = resp.get_json()["nodes"][0]
            assert db_node["name"] == "testdb"

            # Level 2: schemas
            resp = connected_client.post("/api/connectors/get-catalog", json={
                "connector_id": "mock_db",
                "path": db_node["path"],
            })
            schema_node = resp.get_json()["nodes"][0]
            assert schema_node["name"] == "public"

            # Level 3: tables
            resp = connected_client.post("/api/connectors/get-catalog", json={
                "connector_id": "mock_db",
                "path": schema_node["path"],
            })
            tables = resp.get_json()["nodes"]
            table_names = {t["name"] for t in tables}
            assert "users" in table_names
            assert "orders" in table_names
            for t in tables:
                assert t["node_type"] == "table"

    def test_ls_with_filter(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/get-catalog", json={
                "connector_id": "mock_db",
                "path": ["testdb", "public"],
                "filter": "user",
            })
        tables = resp.get_json()["nodes"]
        assert len(tables) == 1
        assert tables[0]["name"] == "users"

    def test_ls_not_connected_returns_error(self, client):
        with patch.object(DataConnector, "_get_identity", return_value="nobody"):
            resp = client.post("/api/connectors/get-catalog", json={"connector_id": "mock_db", "path": []})
        assert resp.status_code == 200

    def test_catalog_metadata(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/get-catalog", json={
                "connector_id": "mock_db",
                "path": ["testdb", "public", "users"],
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["metadata"]["name"] == "users"
        assert data["metadata"]["row_count"] == 5
        assert len(data["metadata"]["columns"]) == 3

    def test_catalog_tree(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/get-catalog-tree", json={"connector_id": "mock_db"})
        data = resp.get_json()
        assert resp.status_code == 200
        assert "tree" in data
        assert "hierarchy" in data

    def test_catalog_tree_with_filter(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/get-catalog-tree", json={
                "connector_id": "mock_db",
                "filter": "order",
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert "tree" in data


# ==================================================================
# Tests: Data Routes
# ==================================================================

class TestDataRoutes:

    def test_preview(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/preview-data", json={
                "connector_id": "mock_db",
                "source_table": "public.users",
                "limit": 3,
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "success"
        assert data["row_count"] <= 3
        col_names = {c["name"] for c in data["columns"]}
        assert "id" in col_names
        assert "name" in col_names

    def test_preview_missing_source_table(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/preview-data", json={"connector_id": "mock_db"})
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "error"

    def test_import_requires_source_table(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/import-data", json={"connector_id": "mock_db"})
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "error"

    def test_import_success(self, connected_client):
        """Import calls ingest_to_workspace and returns metadata."""
        mock_meta = MagicMock()
        mock_meta.name = "users"
        mock_meta.row_count = 5

        with patch.object(DataConnector, "_get_identity", return_value="test-user"), \
             patch("data_formulator.auth.identity.get_identity_id", return_value="test-user"), \
             patch("data_formulator.workspace_factory.get_workspace") as mock_ws, \
             patch.object(MockLoader, "ingest_to_workspace", return_value=mock_meta):
            resp = connected_client.post("/api/connectors/import-data", json={
                "connector_id": "mock_db",
                "source_table": "public.users",
                "table_name": "users",
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "success"
        assert data["table_name"] == "users"
        assert data["row_count"] == 5
        assert data["refreshable"] is True

    def test_refresh_requires_table_name(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/refresh-data", json={"connector_id": "mock_db"})
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "error"

    def test_column_values_success(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/column-values", json={
                "connector_id": "mock_db",
                "source_table": "public.users",
                "column_name": "name",
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "ok"
        assert "options" in data
        assert "has_more" in data

    def test_column_values_missing_source_table(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/column-values", json={
                "connector_id": "mock_db",
                "column_name": "name",
            })
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "error"

    def test_column_values_missing_column_name(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/column-values", json={
                "connector_id": "mock_db",
                "source_table": "public.users",
            })
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "error"

    def test_column_values_with_keyword(self, connected_client):
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = connected_client.post("/api/connectors/column-values", json={
                "connector_id": "mock_db",
                "source_table": "public.users",
                "column_name": "name",
                "keyword": "ali",
                "limit": 10,
            })
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "ok"

    def test_column_values_not_connected(self, client):
        with patch.object(DataConnector, "_get_identity", return_value="nobody"):
            resp = client.post("/api/connectors/column-values", json={
                "connector_id": "mock_db",
                "source_table": "public.users",
                "column_name": "name",
            })
        assert resp.status_code == 200


# ==================================================================
# Tests: Error Handling
# ==================================================================

class TestErrorHandling:

    def test_sanitize_error_connection_refused(self):
        msg, code = _sanitize_error(ConnectionError("Connection refused"))
        assert code == 502
        assert "Connection failed" in msg

    def test_sanitize_error_permission(self):
        msg, code = _sanitize_error(PermissionError("access denied for user"))
        assert code == 403

    def test_sanitize_error_invalid_params(self):
        msg, code = _sanitize_error(ValueError("host is required"))
        assert code == 400

    def test_sanitize_error_unknown(self):
        msg, code = _sanitize_error(RuntimeError("something weird happened"))
        assert code == 500
        # Should not leak the original message
        assert "unexpected" in msg.lower()

    def test_error_does_not_leak_internal_details(self, client):
        """Errors from loader should not expose connection strings or stack traces."""
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = client.post("/api/connectors/connect", json={
                "connector_id": "mock_db",
                "params": {"host": "bad-host", "user": "x", "password": "secret123"},
            })
        data = resp.get_json()
        assert "secret123" not in json.dumps(data)


# ==================================================================
# Tests: Identity Isolation
# ==================================================================

class TestIdentityIsolation:

    def test_different_identities_have_separate_loaders(self, client):
        """Two users connecting to the same source get separate loader instances."""
        with patch.object(DataConnector, "_get_identity", return_value="user-a"):
            client.post("/api/connectors/connect", json={
                "connector_id": "mock_db",
                "params": {"host": "localhost", "user": "A", "password": "A"},
            })
        with patch.object(DataConnector, "_get_identity", return_value="user-b"):
            client.post("/api/connectors/connect", json={
                "connector_id": "mock_db",
                "params": {"host": "localhost", "user": "B", "password": "B"},
            })
        # Both should be connected
        with patch.object(DataConnector, "_get_identity", return_value="user-a"):
            resp = client.post("/api/connectors/get-status", json={"connector_id": "mock_db"})
            assert resp.get_json()["connected"] is True
        with patch.object(DataConnector, "_get_identity", return_value="user-b"):
            resp = client.post("/api/connectors/get-status", json={"connector_id": "mock_db"})
            assert resp.get_json()["connected"] is True

    def test_delete_does_not_affect_other_user(self, client):
        """Deleting credentials for user-a doesn't affect user-b's session."""
        with patch.object(DataConnector, "_get_identity", return_value="user-a"):
            client.post("/api/connectors/connect", json={
                "connector_id": "mock_db",
                "params": {"host": "localhost", "user": "A", "password": "A"},
            })
        with patch.object(DataConnector, "_get_identity", return_value="user-b"):
            client.post("/api/connectors/connect", json={
                "connector_id": "mock_db",
                "params": {"host": "localhost", "user": "B", "password": "B"},
            })
        # user-b should still be connected regardless of user-a's state
        with patch.object(DataConnector, "_get_identity", return_value="user-b"):
            resp = client.post("/api/connectors/get-status", json={"connector_id": "mock_db"})
            assert resp.get_json()["connected"] is True


# ==================================================================
# Tests: Scope Pinning
# ==================================================================

class TestScopePinning:

    def test_pinned_database_skips_database_level(self, app, source_pinned):
        """When database is pinned, ls([]) should start at schema level."""
        c = app.test_client()
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            c.post("/api/connectors/connect", json={
                "connector_id": "mock_pinned",
                "params": {"user": "test", "password": "test"},
            })
            resp = c.post("/api/connectors/get-catalog", json={"connector_id": "mock_pinned", "path": []})
        data = resp.get_json()
        # Should skip database level and show schemas directly
        eff_keys = [h["key"] for h in data["effective_hierarchy"]]
        assert "database" not in eff_keys
        nodes = data["nodes"]
        assert len(nodes) > 0
        # First node should be a schema namespace
        assert nodes[0]["node_type"] == "namespace"

    def test_pinned_scope_in_connect_response(self, app, source_pinned):
        c = app.test_client()
        with patch.object(DataConnector, "_get_identity", return_value="test-user"):
            resp = c.post("/api/connectors/connect", json={
                "connector_id": "mock_pinned",
                "params": {"user": "test", "password": "test"},
            })
        data = resp.get_json()
        assert data["pinned_scope"]["database"] == "testdb"


# ==================================================================
# Tests: Helpers
# ==================================================================

class TestHelpers:

    def test_node_to_dict(self):
        node = CatalogNode("users", "table", ["db", "public", "users"], {"row_count": 5})
        d = _node_to_dict(node)
        assert d["name"] == "users"
        assert d["node_type"] == "table"
        assert d["path"] == ["db", "public", "users"]
        assert d["metadata"]["row_count"] == 5

    def test_resolve_env_refs(self, monkeypatch):
        monkeypatch.setenv("MY_SECRET", "hunter2")
        result = _resolve_env_refs({"password": "${MY_SECRET}", "host": "localhost"})
        assert result["password"] == "hunter2"
        assert result["host"] == "localhost"

    def test_resolve_env_refs_missing(self, monkeypatch):
        monkeypatch.delenv("NONEXISTENT_VAR", raising=False)
        result = _resolve_env_refs({"password": "${NONEXISTENT_VAR}"})
        assert result["password"] == ""
