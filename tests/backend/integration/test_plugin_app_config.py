"""Integration tests for plugin information in ``/api/app-config``.

Verifies that enabled plugins appear under the ``PLUGINS`` key in the
``/api/app-config`` response, with their manifest + frontend config merged.
"""
from __future__ import annotations

import types
from unittest.mock import patch

import flask
import pytest

import data_formulator.plugins as plugins_module
from data_formulator.plugins import (
    DISABLED_PLUGINS,
    ENABLED_PLUGINS,
    discover_and_register,
)
from data_formulator.plugins.base import DataSourcePlugin
import data_formulator.security.auth as auth_module

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Stub plugin
# ------------------------------------------------------------------

class _DemoPlugin(DataSourcePlugin):

    @staticmethod
    def manifest():
        return {
            "id": "demo",
            "name": "Demo Plugin",
            "env_prefix": "PLG_DEMO",
            "required_env": [],
            "capabilities": ["datasets"],
            "auth_modes": ["password"],
            "icon": "demo-icon",
            "description": "A demo plugin for testing",
        }

    def create_blueprint(self):
        return flask.Blueprint("plugin_demo", __name__, url_prefix="/api/plugins/demo/")

    def get_frontend_config(self):
        return {"base_url": "http://demo.local", "login_url": "/api/plugins/demo/login"}


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def app():
    """Minimal Flask app with /api/app-config and plugin discovery."""
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.config["CLI_ARGS"] = {
        "sandbox": "local",
        "disable_display_keys": False,
        "project_front_page": False,
        "max_display_rows": 10000,
        "dev": False,
        "workspace_backend": "ephemeral",
        "available_languages": ["en"],
    }

    @_app.route("/api/app-config")
    def get_app_config():
        args = _app.config["CLI_ARGS"]
        config = {
            "SANDBOX": args["sandbox"],
            "DISABLE_DISPLAY_KEYS": args["disable_display_keys"],
            "PROJECT_FRONT_PAGE": args["project_front_page"],
            "MAX_DISPLAY_ROWS": args["max_display_rows"],
            "DEV_MODE": args.get("dev", False),
            "WORKSPACE_BACKEND": args.get("workspace_backend", "local"),
            "AVAILABLE_LANGUAGES": args.get("available_languages", ["en"]),
        }

        from data_formulator.plugins import ENABLED_PLUGINS as ep
        if ep:
            plugins_info: dict[str, dict] = {}
            for pid, plugin in ep.items():
                manifest = plugin.manifest()
                frontend_cfg = plugin.get_frontend_config()
                plugins_info[pid] = {
                    "id": manifest.get("id", pid),
                    "name": manifest.get("name", pid),
                    "icon": manifest.get("icon"),
                    "description": manifest.get("description"),
                    "capabilities": manifest.get("capabilities", []),
                    "auth_modes": manifest.get("auth_modes", []),
                    **frontend_cfg,
                }
            config["PLUGINS"] = plugins_info

        return flask.jsonify(config)

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


@pytest.fixture(autouse=True)
def _reset_auth(monkeypatch):
    monkeypatch.setattr(auth_module, "_provider", None)
    monkeypatch.setattr(auth_module, "_allow_anonymous", True)


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

class TestAppConfigPlugins:

    def test_no_plugins_key_when_none_enabled(self, client):
        resp = client.get("/api/app-config")
        data = resp.get_json()
        assert resp.status_code == 200
        assert "PLUGINS" not in data

    def test_plugin_info_exposed_when_enabled(self, app, client):
        plugin = _DemoPlugin()
        ENABLED_PLUGINS["demo"] = plugin

        resp = client.get("/api/app-config")
        data = resp.get_json()

        assert "PLUGINS" in data
        demo = data["PLUGINS"]["demo"]
        assert demo["id"] == "demo"
        assert demo["name"] == "Demo Plugin"
        assert demo["icon"] == "demo-icon"
        assert demo["capabilities"] == ["datasets"]
        assert demo["auth_modes"] == ["password"]
        assert demo["base_url"] == "http://demo.local"
        assert demo["login_url"] == "/api/plugins/demo/login"

    def test_multiple_plugins(self, app, client):

        class _SecondPlugin(DataSourcePlugin):
            @staticmethod
            def manifest():
                return {
                    "id": "second",
                    "name": "Second",
                    "env_prefix": "PLG_SECOND",
                    "required_env": [],
                }

            def create_blueprint(self):
                return flask.Blueprint("plugin_second", __name__, url_prefix="/api/plugins/second/")

            def get_frontend_config(self):
                return {"mode": "read-only"}

        ENABLED_PLUGINS["demo"] = _DemoPlugin()
        ENABLED_PLUGINS["second"] = _SecondPlugin()

        resp = client.get("/api/app-config")
        data = resp.get_json()

        assert len(data["PLUGINS"]) == 2
        assert "demo" in data["PLUGINS"]
        assert "second" in data["PLUGINS"]
        assert data["PLUGINS"]["second"]["mode"] == "read-only"
