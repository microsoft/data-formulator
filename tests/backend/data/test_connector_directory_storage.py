# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for the connectors/ directory-based storage format.

Background
----
Connector specs are persisted as individual JSON files under
``DATA_FORMULATOR_HOME/users/<identity>/connectors/<source_id>.json``.
The format enables atomic per-connector writes and matches the design doc layout.

Covers:
- _persist_user_connector writes individual JSON files
- _remove_user_connector deletes the correct file
- _load_user_specs reads from connectors/ directory
- _safe_source_filename sanitises special characters
- load_connectors integrates with directory-based storage
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from data_formulator.data_connector import (
    DATA_CONNECTORS,
    SourceSpec,
    _ADMIN_CONNECTOR_IDS,
    _LOADED_USER_IDENTITIES,
    _load_user_specs,
    _persist_user_connector,
    _remove_user_connector,
    _user_connector_key,
    load_connectors,
)
from data_formulator.datalake.naming import safe_source_id
from data_formulator.data_loader.external_data_loader import (
    ExternalDataLoader,
)

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Minimal mock loader
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
def _clean_data_connectors(monkeypatch):
    """Reset global registries between tests."""
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


# ==================================================================
# Tests: safe_source_id (single source of truth in datalake.naming)
# ==================================================================

class TestSafeSourceId:

    @pytest.mark.parametrize("raw,expected", [
        ("pg_prod", "pg_prod"),
        ("mysql:prod", "mysql--prod"),
        ("my/connector", "my_connector"),
        ("back\\slash", "back_slash"),
        ("a:b/c\\d", "a--b_c_d"),
    ])
    def test_sanitises_special_chars(self, raw: str, expected: str) -> None:
        assert safe_source_id(raw) == expected


# ==================================================================
# Tests: _persist_user_connector / _remove_user_connector
# ==================================================================

class TestPersistAndRemove:

    def test_persist_creates_directory_and_json(self, tmp_path: Path) -> None:
        user_dir = tmp_path / "users" / "alice"
        spec = SourceSpec(
            source_id="mysql:prod",
            loader_type="mysql",
            display_name="MySQL Prod",
            default_params={"host": "mysql.corp"},
            source="user",
        )

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _persist_user_connector("alice", spec)

        cdir = user_dir / "connectors"
        assert cdir.is_dir()
        json_file = cdir / "mysql--prod.json"
        assert json_file.is_file()

        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["source_id"] == "mysql:prod"
        assert data["loader_type"] == "mysql"
        assert data["display_name"] == "MySQL Prod"
        assert data["default_params"]["host"] == "mysql.corp"

    def test_persist_overwrites_existing(self, tmp_path: Path) -> None:
        user_dir = tmp_path / "users" / "alice"
        spec_v1 = SourceSpec(
            source_id="pg:dev", loader_type="postgresql",
            display_name="PG Dev v1", source="user",
        )
        spec_v2 = SourceSpec(
            source_id="pg:dev", loader_type="postgresql",
            display_name="PG Dev v2", source="user",
        )

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _persist_user_connector("alice", spec_v1)
            _persist_user_connector("alice", spec_v2)

        json_file = user_dir / "connectors" / "pg--dev.json"
        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["display_name"] == "PG Dev v2"

    def test_remove_deletes_file(self, tmp_path: Path) -> None:
        user_dir = tmp_path / "users" / "alice"
        spec = SourceSpec(
            source_id="mysql:prod", loader_type="mysql",
            display_name="MySQL Prod", source="user",
        )

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _persist_user_connector("alice", spec)
            json_file = user_dir / "connectors" / "mysql--prod.json"
            assert json_file.exists()

            _remove_user_connector("alice", "mysql:prod")
            assert not json_file.exists()

    def test_remove_nonexistent_is_silent(self, tmp_path: Path) -> None:
        user_dir = tmp_path / "users" / "alice"
        user_dir.mkdir(parents=True)

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _remove_user_connector("alice", "nonexistent")

    def test_remove_rejects_symlink_escape(self, tmp_path: Path) -> None:
        user_dir = tmp_path / "users" / "alice"
        connectors_dir = user_dir / "connectors"
        connectors_dir.mkdir(parents=True)
        outside = tmp_path / "outside.json"
        outside.write_text("do not delete", encoding="utf-8")
        link = connectors_dir / "mysql--prod.json"
        try:
            link.symlink_to(outside)
        except OSError:
            pytest.skip("symlink creation is not available on this platform")

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _remove_user_connector("alice", "mysql:prod")

        assert outside.exists()
        assert link.is_symlink()


# ==================================================================
# Tests: _load_user_specs from connectors/ directory
# ==================================================================

class TestLoadUserSpecs:

    def test_loads_from_json_directory(self, tmp_path: Path) -> None:
        user_dir = tmp_path / "users" / "alice"
        spec = SourceSpec(
            source_id="mysql:prod", loader_type="mysql",
            display_name="MySQL Prod",
            default_params={"host": "mysql.corp"},
            source="user",
        )

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            _persist_user_connector("alice", spec)
            loaded = _load_user_specs("alice")

        assert len(loaded) == 1
        assert loaded[0].source_id == "mysql:prod"
        assert loaded[0].loader_type == "mysql"
        assert loaded[0].display_name == "MySQL Prod"
        assert loaded[0].source == "user"

    def test_loads_multiple_connectors(self, tmp_path: Path) -> None:
        user_dir = tmp_path / "users" / "alice"
        specs = [
            SourceSpec(source_id="pg:prod", loader_type="postgresql",
                       display_name="PG Prod", source="user"),
            SourceSpec(source_id="mysql:dev", loader_type="mysql",
                       display_name="MySQL Dev", source="user"),
        ]

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            for s in specs:
                _persist_user_connector("alice", s)
            loaded = _load_user_specs("alice")

        assert len(loaded) == 2
        ids = {s.source_id for s in loaded}
        assert ids == {"pg:prod", "mysql:dev"}

    def test_returns_empty_when_no_connectors(self, tmp_path: Path) -> None:
        user_dir = tmp_path / "users" / "new_user"
        user_dir.mkdir(parents=True)

        with patch("data_formulator.datalake.workspace.get_user_home", return_value=user_dir):
            loaded = _load_user_specs("new_user")
        assert loaded == []



# ==================================================================
# Tests: load_connectors integration with directory storage
# ==================================================================

class TestLoadConnectorsIntegration:

    def test_loads_user_connectors_from_directory(self, tmp_path: Path) -> None:
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

