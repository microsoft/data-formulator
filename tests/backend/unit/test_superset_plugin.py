"""Tests for the Superset data source plugin.

Covers:
- Plugin manifest & discovery integration
- Blueprint registration and route accessibility
- Session helper isolation (plugin-namespaced keys)
- Auth routes (login, logout, me, status)
- Catalog route contract (mocked Superset API)
- Data route contract (mocked SQL Lab → PluginDataWriter)
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import flask
import pytest

import data_formulator.plugins as plugins_module
from data_formulator.plugins import (
    DISABLED_PLUGINS,
    ENABLED_PLUGINS,
    discover_and_register,
)
from data_formulator.plugins.superset import SupersetPlugin
from data_formulator.plugins.superset.session_helpers import (
    KEY_REFRESH_TOKEN,
    KEY_TOKEN,
    KEY_USER,
    clear_session,
    get_token,
    get_user,
    save_session,
)

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def app(monkeypatch):
    """Flask app with Superset plugin registered via on_enable."""
    monkeypatch.setenv("PLG_SUPERSET_URL", "http://superset.test")

    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"

    plugin = SupersetPlugin()
    bp = plugin.create_blueprint()
    _app.register_blueprint(bp)
    plugin.on_enable(_app)

    return _app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _clean_plugin_state():
    ENABLED_PLUGINS.clear()
    DISABLED_PLUGINS.clear()
    yield
    ENABLED_PLUGINS.clear()
    DISABLED_PLUGINS.clear()


# ------------------------------------------------------------------
# Manifest & discovery
# ------------------------------------------------------------------

class TestSupersetManifest:

    def test_manifest_keys(self):
        m = SupersetPlugin.manifest()
        assert m["id"] == "superset"
        assert "PLG_SUPERSET_URL" in m["required_env"]
        assert "datasets" in m["capabilities"]
        assert "password" in m["auth_modes"]

    def test_discovery_disabled_without_env(self, monkeypatch):
        monkeypatch.delenv("PLG_SUPERSET_URL", raising=False)

        _app = flask.Flask(__name__)
        _app.config["TESTING"] = True

        with (
            patch("pkgutil.iter_modules") as mock_iter,
            patch("importlib.import_module") as mock_import,
        ):
            import types
            stub = types.ModuleType("data_formulator.plugins.superset")
            stub.plugin_class = SupersetPlugin
            mock_iter.return_value = [(None, "superset", True)]
            mock_import.return_value = stub

            discover_and_register(_app)

        assert "superset" not in ENABLED_PLUGINS
        assert "superset" in DISABLED_PLUGINS
        assert "PLG_SUPERSET_URL" in DISABLED_PLUGINS["superset"]

    def test_discovery_enabled_with_env(self, monkeypatch):
        monkeypatch.setenv("PLG_SUPERSET_URL", "http://superset.test")

        _app = flask.Flask(__name__)
        _app.config["TESTING"] = True
        _app.secret_key = "test"

        with (
            patch("pkgutil.iter_modules") as mock_iter,
            patch("importlib.import_module") as mock_import,
        ):
            import types
            stub = types.ModuleType("data_formulator.plugins.superset")
            stub.plugin_class = SupersetPlugin
            mock_iter.return_value = [(None, "superset", True)]
            mock_import.return_value = stub

            discover_and_register(_app)

        assert "superset" in ENABLED_PLUGINS


# ------------------------------------------------------------------
# Blueprint registration
# ------------------------------------------------------------------

class TestBlueprintRegistration:

    def test_auth_routes_registered(self, app):
        rules = [r.rule for r in app.url_map.iter_rules()]
        assert "/api/plugins/superset/auth/login" in rules
        assert "/api/plugins/superset/auth/me" in rules
        assert "/api/plugins/superset/auth/logout" in rules
        assert "/api/plugins/superset/auth/status" in rules

    def test_catalog_routes_registered(self, app):
        rules = [r.rule for r in app.url_map.iter_rules()]
        assert "/api/plugins/superset/catalog/datasets" in rules
        assert "/api/plugins/superset/catalog/dashboards" in rules

    def test_data_routes_registered(self, app):
        rules = [r.rule for r in app.url_map.iter_rules()]
        assert "/api/plugins/superset/data/load-dataset" in rules


# ------------------------------------------------------------------
# Session helpers
# ------------------------------------------------------------------

class TestSessionHelpers:

    def test_save_and_read_session(self, app):
        with app.test_request_context():
            save_session("tok123", {"id": 1, "username": "alice"}, "refresh456")
            assert get_token() == "tok123"
            assert get_user()["username"] == "alice"

    def test_clear_session(self, app):
        with app.test_request_context():
            save_session("tok", {"id": 1}, "ref")
            clear_session()
            assert get_token() is None
            assert get_user() is None

    def test_keys_are_namespaced(self):
        assert "plugin_superset_" in KEY_TOKEN
        assert "plugin_superset_" in KEY_USER


# ------------------------------------------------------------------
# Auth routes
# ------------------------------------------------------------------

class TestAuthRoutes:

    def test_login_missing_credentials(self, client):
        resp = client.post(
            "/api/plugins/superset/auth/login",
            json={"username": ""},
        )
        assert resp.status_code == 400

    def test_login_success(self, client, app):
        bridge = app.extensions["plugin_superset_bridge"]
        bridge.login = MagicMock(return_value={
            "access_token": "jwt-token",
            "refresh_token": "refresh-token",
        })
        bridge.get_user_info = MagicMock(return_value={
            "id": 1,
            "username": "admin",
            "first_name": "Admin",
            "last_name": "User",
        })

        resp = client.post(
            "/api/plugins/superset/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["user"]["username"] == "admin"

    def test_me_unauthenticated(self, client):
        resp = client.get("/api/plugins/superset/auth/me")
        assert resp.status_code == 401

    def test_status_unauthenticated(self, client):
        resp = client.get("/api/plugins/superset/auth/status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["authenticated"] is False

    def test_logout(self, client, app):
        bridge = app.extensions["plugin_superset_bridge"]
        bridge.login = MagicMock(return_value={"access_token": "tok", "refresh_token": "ref"})
        bridge.get_user_info = MagicMock(return_value={"id": 1, "username": "a"})
        client.post("/api/plugins/superset/auth/login", json={"username": "a", "password": "p"})

        resp = client.post("/api/plugins/superset/auth/logout")
        assert resp.status_code == 200

        resp = client.get("/api/plugins/superset/auth/me")
        assert resp.status_code == 401


# ------------------------------------------------------------------
# Catalog routes (mocked)
# ------------------------------------------------------------------

class TestCatalogRoutes:

    def _login(self, client, app):
        bridge = app.extensions["plugin_superset_bridge"]
        bridge.login = MagicMock(return_value={"access_token": "valid-jwt.eyJleHAiOjk5OTk5OTk5OTl9.sig", "refresh_token": "ref"})
        bridge.get_user_info = MagicMock(return_value={"id": 1, "username": "admin"})
        client.post("/api/plugins/superset/auth/login", json={"username": "admin", "password": "p"})

    def test_datasets_unauthenticated(self, client):
        resp = client.get("/api/plugins/superset/catalog/datasets")
        assert resp.status_code == 401

    def test_datasets_success(self, client, app):
        self._login(client, app)
        catalog = app.extensions["plugin_superset_catalog"]
        catalog.get_catalog_summary = MagicMock(return_value=[
            {"id": 1, "name": "sales", "column_count": 5},
        ])

        resp = client.get("/api/plugins/superset/catalog/datasets")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["count"] == 1


# ------------------------------------------------------------------
# Data routes (mocked)
# ------------------------------------------------------------------

class TestDataRoutes:

    def _login(self, client, app):
        bridge = app.extensions["plugin_superset_bridge"]
        bridge.login = MagicMock(return_value={"access_token": "valid-jwt.eyJleHAiOjk5OTk5OTk5OTl9.sig", "refresh_token": "ref"})
        bridge.get_user_info = MagicMock(return_value={"id": 1, "username": "admin"})
        client.post("/api/plugins/superset/auth/login", json={"username": "admin", "password": "p"})

    def test_load_unauthenticated(self, client):
        resp = client.post(
            "/api/plugins/superset/data/load-dataset",
            json={"dataset_id": 1},
        )
        assert resp.status_code == 401

    def test_load_missing_dataset_id(self, client, app):
        self._login(client, app)
        resp = client.post(
            "/api/plugins/superset/data/load-dataset",
            json={},
        )
        assert resp.status_code == 400

    @patch("data_formulator.plugins.superset.routes.data.PluginDataWriter")
    def test_load_success(self, MockWriter, client, app):
        self._login(client, app)

        sc = app.extensions["plugin_superset_client"]
        sc.get_dataset_detail = MagicMock(return_value={
            "table_name": "test_table",
            "database": {"id": 1},
            "schema": "public",
            "kind": "physical",
            "columns": [{"column_name": "id"}, {"column_name": "name"}],
        })
        sc.create_sql_session = MagicMock(return_value=MagicMock())
        sc.execute_sql_with_session = MagicMock(return_value={
            "data": [{"id": 1, "name": "a"}, {"id": 2, "name": "b"}],
            "columns": [{"column_name": "id"}, {"column_name": "name"}],
        })

        mock_writer_inst = MagicMock()
        mock_writer_inst.write_dataframe.return_value = {
            "table_name": "test_table",
            "row_count": 2,
            "columns": [{"name": "id", "type": "int64"}, {"name": "name", "type": "object"}],
            "is_renamed": False,
        }
        MockWriter.return_value = mock_writer_inst

        resp = client.post(
            "/api/plugins/superset/data/load-dataset",
            json={"dataset_id": 42},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["row_count"] == 2
        assert data["table_name"] == "test_table"
        mock_writer_inst.write_dataframe.assert_called_once()


# ------------------------------------------------------------------
# Frontend config
# ------------------------------------------------------------------

class TestFrontendConfig:

    def test_config_has_required_urls(self, monkeypatch):
        monkeypatch.setenv("PLG_SUPERSET_URL", "http://superset.test")
        plugin = SupersetPlugin()
        cfg = plugin.get_frontend_config()
        assert cfg["base_url"] == "http://superset.test"
        assert "/api/plugins/superset/auth/login" in cfg["auth_url"]
        assert "/api/plugins/superset/catalog/datasets" in cfg["catalog_url"]

    def test_sso_url_derived_from_base(self, monkeypatch):
        monkeypatch.setenv("PLG_SUPERSET_URL", "http://superset.test")
        monkeypatch.delenv("PLG_SUPERSET_SSO_LOGIN_URL", raising=False)
        plugin = SupersetPlugin()
        cfg = plugin.get_frontend_config()
        assert cfg["sso_login_url"] == "http://superset.test/df-sso-bridge/"

    def test_sso_url_override(self, monkeypatch):
        monkeypatch.setenv("PLG_SUPERSET_URL", "http://superset.test")
        monkeypatch.setenv("PLG_SUPERSET_SSO_LOGIN_URL", "http://custom-sso.test/bridge")
        plugin = SupersetPlugin()
        cfg = plugin.get_frontend_config()
        assert cfg["sso_login_url"] == "http://custom-sso.test/bridge"
