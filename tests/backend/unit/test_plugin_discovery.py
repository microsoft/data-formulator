"""Tests for the data source plugin discovery and registration system.

Verifies that :func:`discover_and_register`:

* Discovers concrete ``DataSourcePlugin`` sub-packages under ``plugins/``
* Gates enablement on ``required_env`` from the manifest
* Registers Flask Blueprints for enabled plugins
* Populates ``ENABLED_PLUGINS`` and ``DISABLED_PLUGINS`` dicts
* Gracefully handles missing env vars, import errors, and broken manifests
"""
from __future__ import annotations

import types
from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.plugins.base import DataSourcePlugin
import data_formulator.plugins as plugins_module
from data_formulator.plugins import (
    DISABLED_PLUGINS,
    ENABLED_PLUGINS,
    discover_and_register,
)

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Helpers — minimal concrete plugin subclass
# ------------------------------------------------------------------

class _StubPlugin(DataSourcePlugin):
    """Minimal concrete plugin for test purposes."""

    @staticmethod
    def manifest():
        return {
            "id": "stub",
            "name": "Stub Plugin",
            "env_prefix": "PLG_STUB",
            "required_env": ["PLG_STUB_HOST"],
        }

    def create_blueprint(self):
        bp = flask.Blueprint("plugin_stub", __name__, url_prefix="/api/plugins/stub/")

        @bp.route("/ping")
        def ping():
            return flask.jsonify({"ok": True})

        return bp

    def get_frontend_config(self):
        return {"base_url": "http://stub.local"}


class _NoEnvPlugin(DataSourcePlugin):
    """Plugin with no required_env — always enabled."""

    @staticmethod
    def manifest():
        return {
            "id": "no_env",
            "name": "Always-On",
            "env_prefix": "PLG_NOENV",
            "required_env": [],
        }

    def create_blueprint(self):
        return flask.Blueprint("plugin_noenv", __name__, url_prefix="/api/plugins/no_env/")

    def get_frontend_config(self):
        return {}


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def app():
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    return _app


@pytest.fixture(autouse=True)
def _clean_plugin_state():
    """Reset global dicts before every test."""
    ENABLED_PLUGINS.clear()
    DISABLED_PLUGINS.clear()
    yield
    ENABLED_PLUGINS.clear()
    DISABLED_PLUGINS.clear()


def _fake_iter_modules(path):
    """Simulate pkgutil.iter_modules finding one sub-package."""
    yield None, "stub", True


def _fake_iter_modules_noenv(path):
    yield None, "no_env", True


# ------------------------------------------------------------------
# Tests — enablement gating
# ------------------------------------------------------------------

class TestPluginEnablement:

    def test_enabled_when_env_set(self, app, monkeypatch):
        monkeypatch.setenv("PLG_STUB_HOST", "http://stub.example.com")

        stub_mod = types.ModuleType("data_formulator.plugins.stub")
        stub_mod.plugin_class = _StubPlugin

        with (
            patch("pkgutil.iter_modules", side_effect=_fake_iter_modules),
            patch("importlib.import_module", return_value=stub_mod),
        ):
            discover_and_register(app)

        assert "stub" in ENABLED_PLUGINS
        assert isinstance(ENABLED_PLUGINS["stub"], _StubPlugin)
        assert "stub" not in DISABLED_PLUGINS

    def test_disabled_when_env_missing(self, app, monkeypatch):
        monkeypatch.delenv("PLG_STUB_HOST", raising=False)

        stub_mod = types.ModuleType("data_formulator.plugins.stub")
        stub_mod.plugin_class = _StubPlugin

        with (
            patch("pkgutil.iter_modules", side_effect=_fake_iter_modules),
            patch("importlib.import_module", return_value=stub_mod),
        ):
            discover_and_register(app)

        assert "stub" not in ENABLED_PLUGINS
        assert "stub" in DISABLED_PLUGINS
        assert "PLG_STUB_HOST" in DISABLED_PLUGINS["stub"]

    def test_always_enabled_when_no_required_env(self, app):
        noenv_mod = types.ModuleType("data_formulator.plugins.no_env")
        noenv_mod.plugin_class = _NoEnvPlugin

        with (
            patch("pkgutil.iter_modules", side_effect=_fake_iter_modules_noenv),
            patch("importlib.import_module", return_value=noenv_mod),
        ):
            discover_and_register(app)

        assert "no_env" in ENABLED_PLUGINS


# ------------------------------------------------------------------
# Tests — Blueprint registration
# ------------------------------------------------------------------

class TestBlueprintRegistration:

    def test_blueprint_registered_on_app(self, app, monkeypatch):
        monkeypatch.setenv("PLG_STUB_HOST", "http://stub.example.com")

        stub_mod = types.ModuleType("data_formulator.plugins.stub")
        stub_mod.plugin_class = _StubPlugin

        with (
            patch("pkgutil.iter_modules", side_effect=_fake_iter_modules),
            patch("importlib.import_module", return_value=stub_mod),
        ):
            discover_and_register(app)

        assert "plugin_stub" in app.blueprints

    def test_ping_route_accessible(self, app, monkeypatch):
        monkeypatch.setenv("PLG_STUB_HOST", "http://stub.example.com")

        stub_mod = types.ModuleType("data_formulator.plugins.stub")
        stub_mod.plugin_class = _StubPlugin

        with (
            patch("pkgutil.iter_modules", side_effect=_fake_iter_modules),
            patch("importlib.import_module", return_value=stub_mod),
        ):
            discover_and_register(app)

        with app.test_client() as client:
            resp = client.get("/api/plugins/stub/ping")
            assert resp.status_code == 200
            assert resp.get_json() == {"ok": True}


# ------------------------------------------------------------------
# Tests — on_enable callback
# ------------------------------------------------------------------

class TestOnEnableCallback:

    def test_on_enable_called_with_app(self, app, monkeypatch):
        monkeypatch.setenv("PLG_STUB_HOST", "http://stub.example.com")

        stub_mod = types.ModuleType("data_formulator.plugins.stub")
        stub_mod.plugin_class = _StubPlugin

        with (
            patch("pkgutil.iter_modules", side_effect=_fake_iter_modules),
            patch("importlib.import_module", return_value=stub_mod),
            patch.object(_StubPlugin, "on_enable") as mock_on_enable,
        ):
            discover_and_register(app)
            mock_on_enable.assert_called_once_with(app)


# ------------------------------------------------------------------
# Tests — error handling
# ------------------------------------------------------------------

class TestErrorHandling:

    def test_import_error_is_caught(self, app):
        def _fail_import(name):
            raise ImportError(name="missing_lib")

        with (
            patch("pkgutil.iter_modules", side_effect=_fake_iter_modules),
            patch("importlib.import_module", side_effect=_fail_import),
        ):
            discover_and_register(app)

        assert "stub" in DISABLED_PLUGINS
        assert "Missing dependency" in DISABLED_PLUGINS["stub"]
        assert len(ENABLED_PLUGINS) == 0

    def test_broken_manifest_is_caught(self, app, monkeypatch):
        monkeypatch.setenv("PLG_STUB_HOST", "http://stub.example.com")

        class _BrokenPlugin(DataSourcePlugin):
            @staticmethod
            def manifest():
                raise RuntimeError("boom")

            def create_blueprint(self):
                return flask.Blueprint("x", __name__)

            def get_frontend_config(self):
                return {}

        stub_mod = types.ModuleType("data_formulator.plugins.stub")
        stub_mod.plugin_class = _BrokenPlugin

        with (
            patch("pkgutil.iter_modules", side_effect=_fake_iter_modules),
            patch("importlib.import_module", return_value=stub_mod),
        ):
            discover_and_register(app)

        assert "stub" in DISABLED_PLUGINS
        assert "manifest() failed" in DISABLED_PLUGINS["stub"]

    def test_non_package_modules_skipped(self, app):
        """Files (not sub-packages) under plugins/ should be ignored."""

        def _non_pkg(_path):
            yield None, "helper_utils", False

        with patch("pkgutil.iter_modules", side_effect=_non_pkg):
            discover_and_register(app)

        assert len(ENABLED_PLUGINS) == 0
        assert len(DISABLED_PLUGINS) == 0

    def test_module_without_plugin_class_skipped(self, app):
        empty_mod = types.ModuleType("data_formulator.plugins.empty")

        def _iter(_path):
            yield None, "empty", True

        with (
            patch("pkgutil.iter_modules", side_effect=_iter),
            patch("importlib.import_module", return_value=empty_mod),
        ):
            discover_and_register(app)

        assert len(ENABLED_PLUGINS) == 0
        assert len(DISABLED_PLUGINS) == 0
