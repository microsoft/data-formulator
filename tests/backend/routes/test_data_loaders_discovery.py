# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Integration test: plugin loaders appear in /api/data-loaders.

This is the end-to-end "drop a file → connector card appears" contract.
It guards against future refactors of the discovery endpoint silently
dropping plugins.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import flask
import pytest

pytestmark = [pytest.mark.backend]


PLUGIN_BODY = '''\
from data_formulator.data_loader.external_data_loader import ExternalDataLoader
import pyarrow as pa


class FakeWarehouseLoader(ExternalDataLoader):
    DISPLAY_NAME = "Fake Warehouse"

    @staticmethod
    def list_params():
        return [
            {"name": "endpoint", "type": "string", "required": True,
             "tier": "connection", "description": "Server URL"},
        ]

    @staticmethod
    def auth_instructions():
        return "Test plugin — no auth required."

    def __init__(self, params=None):
        self.params = params or {}

    def list_tables(self, table_filter=None):
        return []

    def fetch_data_as_arrow(self, source_table, import_options=None):
        return pa.table({})
'''


def _reload_data_loader_module():
    """Purge cached state and reimport so the scanner runs against the
    current env vars."""
    for mod_name in list(sys.modules):
        if mod_name == "data_formulator.data_loader" or mod_name.startswith("df_plugin_"):
            sys.modules.pop(mod_name, None)
    return importlib.import_module("data_formulator.data_loader")


@pytest.fixture()
def client_with_plugin(tmp_path, monkeypatch):
    """Spin up a Flask app whose data_loader registry includes a fake plugin."""
    plugins_dir = tmp_path / "plugins"
    plugins_dir.mkdir()
    (plugins_dir / "fake_warehouse_data_loader.py").write_text(PLUGIN_BODY)

    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")
    monkeypatch.delenv("DF_PLUGIN_DIR", raising=False)

    dl = _reload_data_loader_module()
    assert "fake_warehouse" in dl.PLUGIN_LOADERS, "plugin scanner didn't pick up fixture"

    # Mount just the discovery blueprint on a minimal Flask app.
    from data_formulator.data_connector import connectors_bp
    from data_formulator.error_handler import register_error_handlers

    test_app = flask.Flask(__name__)
    test_app.config["TESTING"] = True
    test_app.register_blueprint(connectors_bp)
    register_error_handlers(test_app)
    return test_app.test_client()


def _loaders_by_type(payload):
    """Normalize the response envelope and return loaders keyed by type."""
    body = payload.get("data", payload) if isinstance(payload, dict) else payload
    return {ldr["type"]: ldr for ldr in body["loaders"]}


def test_plugin_appears_in_discovery_endpoint(client_with_plugin):
    resp = client_with_plugin.get("/api/data-loaders")
    assert resp.status_code == 200

    loaders = _loaders_by_type(resp.get_json())
    assert "fake_warehouse" in loaders

    plugin = loaders["fake_warehouse"]
    # DISPLAY_NAME class attr overrides the title-cased default.
    assert plugin["name"] == "Fake Warehouse"
    # Source attribution: plugin file path surfaces in the API.
    assert plugin["source"] == "plugin"
    assert plugin["source_path"].endswith("fake_warehouse_data_loader.py")
    # User-declared params come through (plus the common table_filter row).
    param_names = {p["name"] for p in plugin["params"]}
    assert "endpoint" in param_names
    assert "table_filter" in param_names
    # Auth instructions surface verbatim.
    assert "Test plugin" in plugin["auth_instructions"]
    assert plugin["auth_paths"] == []


def test_builtin_loader_marked_as_builtin(client_with_plugin):
    """Built-ins must be tagged source='builtin' (regression guard)."""
    resp = client_with_plugin.get("/api/data-loaders")
    loaders = _loaders_by_type(resp.get_json())

    # Find any built-in that's available in the test env. sample_datasets and
    # local_folder are intentionally hidden from discovery, so use superset
    # (requests-only, always available) as the guaranteed fallback.
    builtin_candidates = ["mysql", "postgresql", "s3", "superset"]
    builtin = next((loaders[k] for k in builtin_candidates if k in loaders), None)
    assert builtin is not None, "no built-in loader available in test env"

    assert builtin["source"] == "builtin"
    assert builtin["source_path"] is None


def test_mysql_auth_path_surfaces_in_discovery(client_with_plugin):
    resp = client_with_plugin.get("/api/data-loaders")
    loaders = _loaders_by_type(resp.get_json())
    if "mysql" not in loaders:
        pytest.skip("MySQL optional dependency unavailable")

    paths = loaders["mysql"]["auth_paths"]
    assert [path["id"] for path in paths] == ["password"]
    assert paths[0]["fields"] == ["user", "password"]


def test_display_name_default_titlecases_registry_key(tmp_path, monkeypatch):
    """A plugin without DISPLAY_NAME gets title-cased registry-key as name."""
    plugins_dir = tmp_path / "plugins"
    plugins_dir.mkdir()
    (plugins_dir / "my_thing_data_loader.py").write_text(
        PLUGIN_BODY.replace('DISPLAY_NAME = "Fake Warehouse"', "")
                   .replace("FakeWarehouseLoader", "MyThingLoader")
    )

    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")
    monkeypatch.delenv("DF_PLUGIN_DIR", raising=False)

    _reload_data_loader_module()

    from data_formulator.data_connector import connectors_bp
    from data_formulator.error_handler import register_error_handlers

    test_app = flask.Flask(__name__)
    test_app.config["TESTING"] = True
    test_app.register_blueprint(connectors_bp)
    register_error_handlers(test_app)

    resp = test_app.test_client().get("/api/data-loaders")
    loaders = _loaders_by_type(resp.get_json())

    assert loaders["my_thing"]["name"] == "My Thing"


def test_plugins_block_surfaces_loaded_and_rejected(tmp_path, monkeypatch):
    """The discovery endpoint must expose a ``plugins`` summary containing
    both successfully-loaded plugins and rejected override attempts. The
    frontend uses this to render the security-status alert."""
    plugins_dir = tmp_path / "plugins"
    plugins_dir.mkdir()
    # One legitimate plugin and one that tries to override a built-in.
    (plugins_dir / "fake_warehouse_data_loader.py").write_text(PLUGIN_BODY)
    (plugins_dir / "mysql_data_loader.py").write_text(
        PLUGIN_BODY.replace("FakeWarehouseLoader", "BadMysql")
                   .replace('DISPLAY_NAME = "Fake Warehouse"', "")
    )

    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")
    monkeypatch.delenv("DF_PLUGIN_DIR", raising=False)

    _reload_data_loader_module()

    from data_formulator.data_connector import connectors_bp
    from data_formulator.error_handler import register_error_handlers

    test_app = flask.Flask(__name__)
    test_app.config["TESTING"] = True
    test_app.register_blueprint(connectors_bp)
    register_error_handlers(test_app)

    resp = test_app.test_client().get("/api/data-loaders")
    body = resp.get_json()
    body = body.get("data", body)
    assert "plugins" in body
    plugins = body["plugins"]
    assert plugins["enabled"] is True
    assert plugins["dir"].endswith("plugins")
    # Loaded list contains the legitimate plugin.
    loaded_types = {p["type"] for p in plugins["loaded"]}
    assert "fake_warehouse" in loaded_types
    # The mysql override attempt must NOT appear in loaded.
    assert "mysql" not in loaded_types
    # ...and must appear in the errors list with the override_builtin kind.
    err_files = [Path(e["file"]).name for e in plugins["errors"]]
    assert "mysql_data_loader.py" in err_files
    kinds = {e["kind"] for e in plugins["errors"]}
    assert "override_builtin" in kinds
