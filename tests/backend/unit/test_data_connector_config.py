# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for config-driven data source registration.

Covers:
- YAML configuration parsing and source spec generation
- Environment variable parsing (DF_SOURCES__<id>__<key>=<value>)
- Auto-discovery of installed loaders
- Config priority: env > YAML > auto-discovery
- Multiple instances of the same loader type
- DF_AUTO_DISCOVER_SOURCES=false
- ${ENV_REF} expansion in params
- register_data_connectors() end-to-end
"""
from __future__ import annotations

import os
import textwrap
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.data_connector import (
    DATA_CONNECTORS,
    DataConnector,
    SourceSpec,
    _build_source_specs,
    _load_yaml_config,
    _parse_env_sources,
    _resolve_env_refs,
    register_data_connectors,
)
from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
)

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Minimal mock loader for registration tests
# ------------------------------------------------------------------

class _StubLoader(ExternalDataLoader):
    def __init__(self, params):
        self.params = params

    def test_connection(self):
        return True

    def list_tables(self, table_filter=None):
        return []

    def fetch_data_as_arrow(self, source_table, import_options=None):
        import pyarrow as pa
        return pa.table({"x": [1]})

    @staticmethod
    def list_params():
        return [
            {"name": "host", "type": "string", "required": True},
            {"name": "database", "type": "string", "required": False},
        ]

    @staticmethod
    def auth_instructions():
        return "Stub loader"


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
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test"
    return _app


# ==================================================================
# Tests: Environment Variable Parsing
# ==================================================================

class TestEnvVarParsing:

    def test_parse_env_sources_basic(self, monkeypatch):
        monkeypatch.setenv("DF_SOURCES__pg_prod__type", "postgresql")
        monkeypatch.setenv("DF_SOURCES__pg_prod__name", "Production DB")
        monkeypatch.setenv("DF_SOURCES__pg_prod__params__host", "db.example.com")
        monkeypatch.setenv("DF_SOURCES__pg_prod__params__database", "prod")

        specs = _parse_env_sources()
        assert len(specs) == 1
        s = specs[0]
        assert s.source_id == "pg_prod"
        assert s.loader_type == "postgresql"
        assert s.display_name == "Production DB"
        assert s.default_params["host"] == "db.example.com"
        assert s.default_params["database"] == "prod"

    def test_parse_env_sources_multiple(self, monkeypatch):
        monkeypatch.setenv("DF_SOURCES__pg__type", "postgresql")
        monkeypatch.setenv("DF_SOURCES__pg__params__host", "pg.local")
        monkeypatch.setenv("DF_SOURCES__mysql__type", "mysql")
        monkeypatch.setenv("DF_SOURCES__mysql__params__host", "mysql.local")

        specs = _parse_env_sources()
        assert len(specs) == 2
        types = {s.loader_type for s in specs}
        assert types == {"postgresql", "mysql"}

    def test_parse_env_sources_missing_type_skipped(self, monkeypatch):
        monkeypatch.setenv("DF_SOURCES__broken__params__host", "localhost")
        # No DF_SOURCES__broken__type set
        specs = _parse_env_sources()
        assert len(specs) == 0

    def test_parse_env_sources_default_name(self, monkeypatch):
        monkeypatch.setenv("DF_SOURCES__pg__type", "postgresql")
        specs = _parse_env_sources()
        assert specs[0].display_name == "Postgresql"


# ==================================================================
# Tests: YAML Config Loading
# ==================================================================

class TestYamlConfigLoading:

    def test_load_yaml_from_cwd(self, tmp_path, monkeypatch):
        yaml_content = textwrap.dedent("""\
            auto_discover: false
            sources:
              - type: postgresql
                name: "My PG"
                params:
                  host: pg.example.com
                  database: mydb
              - type: mysql
                name: "My MySQL"
                params:
                  host: mysql.example.com
        """)
        yaml_file = tmp_path / "data-sources.yml"
        yaml_file.write_text(yaml_content)
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("DATA_FORMULATOR_HOME", raising=False)

        config = _load_yaml_config()
        assert config is not None
        assert config["auto_discover"] is False
        assert len(config["sources"]) == 2
        assert config["sources"][0]["type"] == "postgresql"
        assert config["sources"][0]["params"]["host"] == "pg.example.com"

    def test_load_yaml_from_df_home(self, tmp_path, monkeypatch):
        yaml_content = textwrap.dedent("""\
            sources:
              - type: bigquery
                params:
                  project: my-gcp-project
        """)
        yaml_file = tmp_path / "data-sources.yml"
        yaml_file.write_text(yaml_content)
        monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
        # Make sure cwd doesn't have one too
        monkeypatch.chdir(Path(__file__).parent)

        config = _load_yaml_config()
        assert config is not None
        assert config["sources"][0]["type"] == "bigquery"

    def test_load_yaml_returns_none_if_missing(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("DATA_FORMULATOR_HOME", raising=False)
        config = _load_yaml_config()
        assert config is None


# ==================================================================
# Tests: _build_source_specs
# ==================================================================

class TestBuildSourceSpecs:

    def test_auto_discovery_includes_all_data_loaders(self, monkeypatch):
        """Without config, all DATA_LOADERS should appear."""
        monkeypatch.delenv("DATA_FORMULATOR_HOME", raising=False)
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)
        # Clear env source vars
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        mock_loaders = {"stub_a": _StubLoader, "stub_b": _StubLoader}

        with patch("data_formulator.data_connector._load_yaml_config", return_value=None), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            specs, auto_discover = _build_source_specs()

        assert auto_discover is True
        ids = {s.source_id for s in specs}
        assert "stub_a" in ids
        assert "stub_b" in ids

    def test_auto_discovery_disabled_by_env(self, monkeypatch):
        monkeypatch.setenv("DF_AUTO_DISCOVER_SOURCES", "false")
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        mock_loaders = {"stub": _StubLoader}
        with patch("data_formulator.data_connector._load_yaml_config", return_value=None), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            specs, auto_discover = _build_source_specs()

        assert auto_discover is False
        # No env specs + no yaml specs + no auto-discovery → empty
        assert len(specs) == 0

    def test_auto_discovery_disabled_by_yaml(self, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)

        yaml_config = {
            "auto_discover": False,
            "sources": [{"type": "stub", "name": "My Stub"}],
        }
        mock_loaders = {"stub": _StubLoader, "other": _StubLoader}

        with patch("data_formulator.data_connector._load_yaml_config", return_value=yaml_config), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            specs, auto_discover = _build_source_specs()

        assert auto_discover is False
        assert len(specs) == 1
        assert specs[0].loader_type == "stub"

    def test_env_overrides_yaml(self, monkeypatch):
        """Env var source with same ID overrides YAML source."""
        monkeypatch.setenv("DF_SOURCES__pg__type", "postgresql")
        monkeypatch.setenv("DF_SOURCES__pg__name", "Env PG")
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)

        yaml_config = {
            "auto_discover": False,
            "sources": [
                {"type": "postgresql", "id": "pg", "name": "YAML PG"},
            ],
        }
        mock_loaders = {"postgresql": _StubLoader}
        with patch("data_formulator.data_connector._load_yaml_config", return_value=yaml_config), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            specs, _ = _build_source_specs()

        # Env wins
        pg_spec = next(s for s in specs if s.source_id == "pg")
        assert pg_spec.display_name == "Env PG"

    def test_multiple_instances_same_type(self, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)

        yaml_config = {
            "auto_discover": False,
            "sources": [
                {"type": "stub", "id": "stub_prod", "name": "Production", "params": {"host": "prod.corp"}},
                {"type": "stub", "id": "stub_stage", "name": "Staging", "params": {"host": "stage.corp"}},
            ],
        }
        mock_loaders = {"stub": _StubLoader}
        with patch("data_formulator.data_connector._load_yaml_config", return_value=yaml_config), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            specs, _ = _build_source_specs()

        assert len(specs) == 2
        ids = {s.source_id for s in specs}
        assert ids == {"stub_prod", "stub_stage"}

    def test_env_ref_resolution_in_yaml_params(self, monkeypatch):
        monkeypatch.setenv("DB_PASSWORD", "s3cret")
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)

        yaml_config = {
            "auto_discover": False,
            "sources": [
                {"type": "stub", "params": {"host": "db.corp", "password": "${DB_PASSWORD}"}},
            ],
        }
        mock_loaders = {"stub": _StubLoader}
        with patch("data_formulator.data_connector._load_yaml_config", return_value=yaml_config), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            specs, _ = _build_source_specs()

        assert specs[0].default_params["password"] == "s3cret"
        assert specs[0].default_params["host"] == "db.corp"


# ==================================================================
# Tests: register_data_connectors
# ==================================================================

class TestRegisterConnectedSources:

    def test_registers_blueprints(self, app, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)

        mock_loaders = {"stub": _StubLoader}
        mock_disabled = {}
        yaml_config = {
            "auto_discover": False,
            "sources": [{"type": "stub", "name": "Test Stub"}],
        }

        with patch("data_formulator.data_connector._load_yaml_config", return_value=yaml_config), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders), \
             patch("data_formulator.data_loader.DISABLED_LOADERS", mock_disabled):
            register_data_connectors(app)

        assert "stub" in DATA_CONNECTORS
        rules = [rule.rule for rule in app.url_map.iter_rules()]
        assert "/api/connectors/stub/auth/connect" in rules

    def test_skips_unknown_loader_type(self, app, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)

        yaml_config = {
            "auto_discover": False,
            "sources": [{"type": "nonexistent"}],
        }

        with patch("data_formulator.data_connector._load_yaml_config", return_value=yaml_config), \
             patch("data_formulator.data_loader.DATA_LOADERS", {}), \
             patch("data_formulator.data_loader.DISABLED_LOADERS", {}):
            register_data_connectors(app)

        assert len(DATA_CONNECTORS) == 0

    def test_logs_disabled_loaders(self, app, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)

        yaml_config = {
            "auto_discover": False,
            "sources": [{"type": "kusto"}],
        }

        with patch("data_formulator.data_connector._load_yaml_config", return_value=yaml_config), \
             patch("data_formulator.data_loader.DATA_LOADERS", {}), \
             patch("data_formulator.data_loader.DISABLED_LOADERS", {"kusto": "pip install azure-kusto-data"}):
            register_data_connectors(app)

        assert len(DATA_CONNECTORS) == 0

    def test_frontend_config_in_sources(self, app, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)
        monkeypatch.delenv("DF_AUTO_DISCOVER_SOURCES", raising=False)

        mock_loaders = {"stub": _StubLoader}
        yaml_config = {
            "auto_discover": False,
            "sources": [
                {"type": "stub", "name": "My Stub", "params": {"host": "db.corp"}},
            ],
        }

        with patch("data_formulator.data_connector._load_yaml_config", return_value=yaml_config), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders), \
             patch("data_formulator.data_loader.DISABLED_LOADERS", {}):
            register_data_connectors(app)

        source = DATA_CONNECTORS["stub"]
        cfg = source.get_frontend_config()
        assert cfg["name"] == "My Stub"
        assert cfg["pinned_params"]["host"] == "db.corp"
        # host should NOT be in form fields
        form_names = {f["name"] for f in cfg["params_form"]}
        assert "host" not in form_names
        assert "database" in form_names
