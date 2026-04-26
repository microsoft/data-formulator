# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for config-driven data source registration.

Covers:
- connectors.yaml parsing and source spec generation (admin)
- Environment variable parsing (DF_SOURCES__<id>__<key>=<value>)
- Config priority: env > connectors.yaml
- Multiple instances of the same loader type
- ${ENV_REF} expansion in params
- register_data_connectors() end-to-end
- _ensure_connectors_loaded() lazy user hydration
- Admin connector immutability
- User connector persistence via connectors/ directory
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
    _ADMIN_CONNECTOR_IDS,
    _LOADED_USER_IDENTITIES,
    _load_admin_specs,
    _load_connectors_yaml,
    _load_user_specs,
    _persist_user_connector,
    _resolve_connector,
    _resolve_env_refs,
    _user_connector_key,
    _visible_connector_items,
    connectors_bp,
    load_connectors,
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


class _CredentialStubLoader(_StubLoader):
    @staticmethod
    def list_params():
        return [
            {"name": "host", "type": "string", "required": True, "tier": "connection"},
            {"name": "database", "type": "string", "required": False, "tier": "filter"},
            {"name": "user", "type": "string", "required": True, "tier": "auth"},
            {"name": "password", "type": "password", "required": True, "tier": "auth", "sensitive": True},
        ]


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clean_data_connectors(monkeypatch):
    """Reset the global DATA_CONNECTORS dict, _ADMIN_CONNECTOR_IDS, and _LOADED_USER_IDENTITIES between tests."""
    monkeypatch.delenv("PLG_SUPERSET_URL", raising=False)
    old = dict(DATA_CONNECTORS)
    old_admin = set(_ADMIN_CONNECTOR_IDS)
    old_loaded = set(_LOADED_USER_IDENTITIES)
    DATA_CONNECTORS.clear()
    _ADMIN_CONNECTOR_IDS.clear()
    _LOADED_USER_IDENTITIES.clear()
    yield
    DATA_CONNECTORS.clear()
    DATA_CONNECTORS.update(old)
    _ADMIN_CONNECTOR_IDS.clear()
    _ADMIN_CONNECTOR_IDS.update(old_admin)
    _LOADED_USER_IDENTITIES.clear()
    _LOADED_USER_IDENTITIES.update(old_loaded)


@pytest.fixture
def app():
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test"
    return _app


# ==================================================================
# Tests: _resolve_env_refs
# ==================================================================

class TestResolveEnvRefs:

    def test_resolves_env_var(self, monkeypatch):
        monkeypatch.setenv("DB_PASSWORD", "s3cret")
        result = _resolve_env_refs({"password": "${DB_PASSWORD}", "host": "db.corp"})
        assert result["password"] == "s3cret"
        assert result["host"] == "db.corp"

    def test_missing_env_var_becomes_empty(self, monkeypatch):
        monkeypatch.delenv("MISSING_VAR", raising=False)
        result = _resolve_env_refs({"val": "${MISSING_VAR}"})
        assert result["val"] == ""

    def test_non_env_ref_passed_through(self):
        result = _resolve_env_refs({"host": "db.corp", "port": "3306"})
        assert result == {"host": "db.corp", "port": "3306"}


# ==================================================================
# Tests: _load_connectors_yaml
# ==================================================================

class TestLoadConnectorsYaml:

    def test_load_valid_file(self, tmp_path):
        yaml_content = textwrap.dedent("""\
            connectors:
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
        yaml_file = tmp_path / "connectors.yaml"
        yaml_file.write_text(yaml_content)
        entries = _load_connectors_yaml(yaml_file)
        assert len(entries) == 2
        assert entries[0]["type"] == "postgresql"
        assert entries[0]["params"]["host"] == "pg.example.com"

    def test_returns_empty_for_missing_file(self, tmp_path):
        entries = _load_connectors_yaml(tmp_path / "nonexistent.yaml")
        assert entries == []

    def test_returns_empty_for_bad_yaml(self, tmp_path):
        yaml_file = tmp_path / "connectors.yaml"
        yaml_file.write_text("connectors: not-a-list")
        entries = _load_connectors_yaml(yaml_file)
        assert entries == []


# ==================================================================
# Tests: Environment Variable Parsing (via _load_admin_specs)
# ==================================================================

class TestEnvVarParsing:

    def test_parse_env_sources_basic(self, monkeypatch, tmp_path):
        monkeypatch.setenv("DF_SOURCES__pg_prod__type", "postgresql")
        monkeypatch.setenv("DF_SOURCES__pg_prod__name", "Production DB")
        monkeypatch.setenv("DF_SOURCES__pg_prod__params__host", "db.example.com")
        monkeypatch.setenv("DF_SOURCES__pg_prod__params__database", "prod")

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path):
            specs = _load_admin_specs()

        assert len(specs) == 1
        s = specs[0]
        assert s.source_id == "pg_prod"
        assert s.loader_type == "postgresql"
        assert s.display_name == "Production DB"
        assert s.default_params["host"] == "db.example.com"
        assert s.default_params["database"] == "prod"
        assert s.source == "admin"

    def test_parse_env_sources_multiple(self, monkeypatch, tmp_path):
        monkeypatch.setenv("DF_SOURCES__pg__type", "postgresql")
        monkeypatch.setenv("DF_SOURCES__pg__params__host", "pg.local")
        monkeypatch.setenv("DF_SOURCES__mysql__type", "mysql")
        monkeypatch.setenv("DF_SOURCES__mysql__params__host", "mysql.local")

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path):
            specs = _load_admin_specs()

        assert len(specs) == 2
        types = {s.loader_type for s in specs}
        assert types == {"postgresql", "mysql"}

    def test_parse_env_sources_missing_type_skipped(self, monkeypatch, tmp_path):
        monkeypatch.setenv("DF_SOURCES__broken__params__host", "localhost")

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path):
            specs = _load_admin_specs()

        assert len(specs) == 0

    def test_parse_env_sources_default_name(self, monkeypatch, tmp_path):
        monkeypatch.setenv("DF_SOURCES__pg__type", "postgresql")

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path):
            specs = _load_admin_specs()

        assert specs[0].display_name == "Postgresql"


# ==================================================================
# Tests: _load_admin_specs (YAML + env priority)
# ==================================================================

class TestLoadAdminSpecs:

    def test_load_from_connectors_yaml(self, tmp_path, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        yaml_content = textwrap.dedent("""\
            connectors:
              - type: postgresql
                name: "My PG"
                params:
                  host: pg.example.com
        """)
        (tmp_path / "connectors.yaml").write_text(yaml_content)

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path):
            specs = _load_admin_specs()

        assert len(specs) == 1
        assert specs[0].loader_type == "postgresql"
        assert specs[0].display_name == "My PG"
        assert specs[0].source == "admin"

    def test_env_overrides_yaml(self, tmp_path, monkeypatch):
        """Env var source with same ID overrides YAML source."""
        monkeypatch.setenv("DF_SOURCES__pg__type", "postgresql")
        monkeypatch.setenv("DF_SOURCES__pg__name", "Env PG")

        yaml_content = textwrap.dedent("""\
            connectors:
              - type: postgresql
                id: pg
                name: "YAML PG"
        """)
        (tmp_path / "connectors.yaml").write_text(yaml_content)

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path):
            specs = _load_admin_specs()

        pg_spec = next(s for s in specs if s.source_id == "pg")
        assert pg_spec.display_name == "Env PG"

    def test_multiple_instances_same_type(self, tmp_path, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        yaml_content = textwrap.dedent("""\
            connectors:
              - type: stub
                id: stub_prod
                name: Production
                params:
                  host: prod.corp
              - type: stub
                id: stub_stage
                name: Staging
                params:
                  host: stage.corp
        """)
        (tmp_path / "connectors.yaml").write_text(yaml_content)

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path):
            specs = _load_admin_specs()

        assert len(specs) == 2
        ids = {s.source_id for s in specs}
        assert ids == {"stub_prod", "stub_stage"}

    def test_env_ref_resolution_in_yaml_params(self, tmp_path, monkeypatch):
        monkeypatch.setenv("DB_PASSWORD", "s3cret")
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        yaml_content = textwrap.dedent("""\
            connectors:
              - type: stub
                params:
                  host: db.corp
                  password: "${DB_PASSWORD}"
        """)
        (tmp_path / "connectors.yaml").write_text(yaml_content)

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path):
            specs = _load_admin_specs()

        assert specs[0].default_params["password"] == "s3cret"
        assert specs[0].default_params["host"] == "db.corp"


# ==================================================================
# Tests: User connector persistence
# ==================================================================

class TestUserConnectorPersistence:

    def test_save_and_load_user_connectors(self, tmp_path):
        from data_formulator.data_connector import _persist_user_connector
        user_dir = tmp_path / "users" / "test-user"

        spec = SourceSpec(
            source_id="mysql:prod",
            loader_type="mysql",
            display_name="MySQL Prod",
            default_params={"host": "mysql.corp"},
            source="user",
        )

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _persist_user_connector("test-user", spec)

        assert (user_dir / "connectors" / "mysql--prod.json").is_file()

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            loaded = _load_user_specs("test-user")

        assert len(loaded) == 1
        assert loaded[0].source_id == "mysql:prod"
        assert loaded[0].loader_type == "mysql"
        assert loaded[0].display_name == "MySQL Prod"
        assert loaded[0].source == "user"

    def test_load_user_specs_returns_empty_if_no_file(self, tmp_path):
        user_dir = tmp_path / "users" / "new-user"
        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            specs = _load_user_specs("new-user")
        assert specs == []


# ==================================================================
# Tests: load_connectors
# ==================================================================

class TestLoadConnectors:

    def test_loads_user_connectors_on_first_call(self, tmp_path):
        """User connectors should be lazily loaded on first call with identity."""
        user_dir = tmp_path / "users" / "alice"
        spec = SourceSpec(
            source_id="user_db", loader_type="stub",
            display_name="Alice DB", source="user",
        )

        mock_loaders = {"stub": _StubLoader}

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _persist_user_connector("alice", spec)

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            load_connectors("alice")

        assert _user_connector_key("alice", "user_db") in DATA_CONNECTORS

    def test_does_not_overwrite_admin_connectors(self, tmp_path):
        """Admin connector should not be replaced by user connector with same ID."""
        user_dir = tmp_path / "users" / "alice"
        spec = SourceSpec(
            source_id="shared_db", loader_type="stub",
            display_name="User version", source="user",
        )

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _persist_user_connector("alice", spec)

        admin_connector = DataConnector.from_loader(
            _StubLoader, source_id="shared_db", display_name="Admin version",
        )
        DATA_CONNECTORS["shared_db"] = admin_connector
        _ADMIN_CONNECTOR_IDS.add("shared_db")

        mock_loaders = {"stub": _StubLoader}

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            load_connectors("alice")

        assert DATA_CONNECTORS["shared_db"]._display_name == "Admin version"

    def test_second_call_is_noop(self, tmp_path):
        """Second call with same identity should be a no-op."""
        user_dir = tmp_path / "users" / "alice"
        user_dir.mkdir(parents=True)

        mock_loaders = {"stub": _StubLoader}
        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            load_connectors("alice")
            assert "alice" in _LOADED_USER_IDENTITIES
            load_connectors("alice")

    def test_user_connectors_are_scoped_by_identity(self, tmp_path):
        """Anonymous and authenticated users may have same public connector ID."""
        browser_dir = tmp_path / "users" / "browser_anon"
        user_dir = tmp_path / "users" / "user_alice"

        def user_home(identity: str):
            return browser_dir if identity == "browser:anon" else user_dir

        spec_browser = SourceSpec(
            source_id="postgresql:local", loader_type="stub",
            display_name="Anonymous PG", source="user",
        )
        spec_user = SourceSpec(
            source_id="postgresql:local", loader_type="stub",
            display_name="Alice PG", source="user",
        )

        with patch("data_formulator.datalake.workspace.get_user_home", side_effect=user_home):
            _persist_user_connector("browser:anon", spec_browser)
            _persist_user_connector("user:alice", spec_user)

        mock_loaders = {"stub": _StubLoader}
        with patch("data_formulator.datalake.workspace.get_user_home", side_effect=user_home), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders):
            load_connectors("browser:anon")
            load_connectors("user:alice")

        browser_key = _user_connector_key("browser:anon", "postgresql:local")
        user_key = _user_connector_key("user:alice", "postgresql:local")
        assert browser_key in DATA_CONNECTORS
        assert user_key in DATA_CONNECTORS
        assert DATA_CONNECTORS[browser_key]._display_name == "Anonymous PG"
        assert DATA_CONNECTORS[user_key]._display_name == "Alice PG"

        visible_to_user = [
            connector._display_name
            for _key, connector, _is_admin in _visible_connector_items("user:alice")
        ]
        assert visible_to_user == ["Alice PG"]

        with patch.object(DataConnector, "_get_identity", return_value="user:alice"):
            assert _resolve_connector({"connector_id": "postgresql:local"})._display_name == "Alice PG"
        with patch.object(DataConnector, "_get_identity", return_value="browser:anon"):
            assert _resolve_connector({"connector_id": "postgresql:local"})._display_name == "Anonymous PG"

    def test_create_connector_persists_only_non_auth_params(self, app, tmp_path):
        """User/password are credentials, not connector metadata."""
        app.register_blueprint(connectors_bp)
        user_dir = tmp_path / "users" / "alice"
        mock_loaders = {"stub": _CredentialStubLoader}

        with patch.object(DataConnector, "_get_identity", return_value="user:alice"), \
             patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders), \
             patch.object(DataConnector, "_get_vault", return_value=None):
            resp = app.test_client().post("/api/connectors", json={
                "loader_type": "stub",
                "display_name": "Private DB",
                "params": {
                    "host": "db.local",
                    "database": "analytics",
                    "user": "alice",
                    "password": "secret",
                },
                "persist": False,
            })

        assert resp.status_code == 201
        connector_id = resp.get_json()["id"]
        assert _user_connector_key("user:alice", connector_id) in DATA_CONNECTORS

        # Connector spec is persisted as individual JSON in connectors/ dir
        import json as _json
        cdir = user_dir / "connectors"
        assert cdir.is_dir()
        json_files = list(cdir.glob("*.json"))
        assert len(json_files) == 1
        with open(json_files[0], "r", encoding="utf-8") as f:
            entry = _json.load(f)
        assert entry["default_params"] == {
            "host": "db.local",
            "database": "analytics",
        }


# ==================================================================
# Tests: register_data_connectors
# ==================================================================

class TestRegisterConnectedSources:

    def test_registers_blueprints(self, app, tmp_path, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        mock_loaders = {"stub": _StubLoader}
        mock_disabled = {}
        yaml_content = textwrap.dedent("""\
            connectors:
              - type: stub
                name: "Test Stub"
        """)
        (tmp_path / "connectors.yaml").write_text(yaml_content)

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders), \
             patch("data_formulator.data_loader.DISABLED_LOADERS", mock_disabled):
            register_data_connectors(app)

        assert "stub" in DATA_CONNECTORS
        assert "stub" in _ADMIN_CONNECTOR_IDS
        rules = [rule.rule for rule in app.url_map.iter_rules()]
        assert "/api/connectors/connect" in rules
        assert "/api/connectors/get-status" in rules

    def test_skips_unknown_loader_type(self, app, tmp_path, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        yaml_content = textwrap.dedent("""\
            connectors:
              - type: nonexistent
        """)
        (tmp_path / "connectors.yaml").write_text(yaml_content)

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path), \
             patch("data_formulator.data_loader.DATA_LOADERS", {}), \
             patch("data_formulator.data_loader.DISABLED_LOADERS", {}):
            register_data_connectors(app)

        assert len(DATA_CONNECTORS) == 0

    def test_logs_disabled_loaders(self, app, tmp_path, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        yaml_content = textwrap.dedent("""\
            connectors:
              - type: kusto
        """)
        (tmp_path / "connectors.yaml").write_text(yaml_content)

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path), \
             patch("data_formulator.data_loader.DATA_LOADERS", {}), \
             patch("data_formulator.data_loader.DISABLED_LOADERS", {"kusto": "pip install azure-kusto-data"}):
            register_data_connectors(app)

        assert len(DATA_CONNECTORS) == 0

    def test_frontend_config_in_sources(self, app, tmp_path, monkeypatch):
        for key in list(os.environ):
            if key.startswith("DF_SOURCES__"):
                monkeypatch.delenv(key)

        mock_loaders = {"stub": _StubLoader}
        yaml_content = textwrap.dedent("""\
            connectors:
              - type: stub
                name: "My Stub"
                params:
                  host: db.corp
        """)
        (tmp_path / "connectors.yaml").write_text(yaml_content)

        with patch("data_formulator.data_connector._get_df_home", return_value=tmp_path), \
             patch("data_formulator.data_loader.DATA_LOADERS", mock_loaders), \
             patch("data_formulator.data_loader.DISABLED_LOADERS", {}):
            register_data_connectors(app)

        source = DATA_CONNECTORS["stub"]
        cfg = source.get_frontend_config()
        assert cfg["name"] == "My Stub"
        assert cfg["pinned_params"]["host"] == "db.corp"
        form_names = {f["name"] for f in cfg["params_form"]}
        assert "host" not in form_names
        assert "database" in form_names
