# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for DataConnector credential vault integration.

Tests:
- Credentials stored in vault on connect
- Credentials deleted from vault on disconnect
- Auto-reconnect from vault when in-memory loader is missing
- Stale vault credentials cleaned up when connection test fails
- has_stored_credentials() reflects vault state
- Vault unavailable: graceful fallback to session-only
- DATA_CONNECTORS in app-config response
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import flask
import pyarrow as pa
import pytest

from data_formulator.data_connector import (
    DATA_CONNECTORS,
    DataConnector,
    connectors_bp,
)
from data_formulator.credential_vault.base import CredentialVault
from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
)

pytestmark = [pytest.mark.backend, pytest.mark.plugin]

IDENTITY = "user:alice@test.com"


# ------------------------------------------------------------------
# Mock loader (minimal)
# ------------------------------------------------------------------

class MockLoader(ExternalDataLoader):
    """In-memory loader for testing vault integration."""

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self._connected = True

    def test_connection(self) -> bool:
        return self._connected

    @staticmethod
    def catalog_hierarchy():
        return [{"key": "database", "label": "Database"}]

    def ls(self, path=None, filter=None):
        return []

    def get_metadata(self, path):
        return {}

    def list_tables(self, table_filter=None):
        return [{"name": "t1", "metadata": {"columns": [], "row_count": 0}}]

    def fetch_data_as_arrow(self, source_table, import_options=None):
        return pa.table({"a": [1, 2, 3]})

    @staticmethod
    def list_params():
        return [
            {"name": "host", "type": "string", "required": True},
            {"name": "password", "type": "password", "required": True},
        ]

    @staticmethod
    def auth_instructions():
        return "Connect with host and password."


# ------------------------------------------------------------------
# Mock vault
# ------------------------------------------------------------------

class InMemoryVault(CredentialVault):
    """In-memory vault for testing."""

    def __init__(self):
        self._store: dict[tuple[str, str], dict] = {}

    def store(self, user_id: str, source_key: str, credentials: dict) -> None:
        self._store[(user_id, source_key)] = credentials

    def retrieve(self, user_id: str, source_key: str):
        return self._store.get((user_id, source_key))

    def delete(self, user_id: str, source_key: str) -> None:
        self._store.pop((user_id, source_key), None)

    def list_sources(self, user_id: str) -> list[str]:
        return [sk for (uid, sk) in self._store if uid == user_id]


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def vault():
    return InMemoryVault()


@pytest.fixture(autouse=True)
def _clean_data_connectors():
    """Reset the global DATA_CONNECTORS dict between tests."""
    old = dict(DATA_CONNECTORS)
    DATA_CONNECTORS.clear()
    yield
    DATA_CONNECTORS.clear()
    DATA_CONNECTORS.update(old)


@pytest.fixture
def source():
    s = DataConnector.from_loader(
        MockLoader,
        source_id="test_db",
        display_name="Test DB",
        default_params={"host": "localhost"},
    )
    DATA_CONNECTORS["test_db"] = s
    return s


@pytest.fixture
def app(source):
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"
    _app.register_blueprint(connectors_bp)
    return _app


@pytest.fixture
def client(app):
    return app.test_client()


# ==================================================================
# Tests: Vault store/retrieve/delete helpers
# ==================================================================

class TestVaultHelpers:

    def test_vault_store_and_retrieve(self, source, vault):
        with patch.object(DataConnector, "_get_vault", return_value=vault):
            stored = source._vault_store(IDENTITY, {"host": "db", "password": "secret"})
            assert stored is True
            retrieved = source._vault_retrieve(IDENTITY)
            assert retrieved == {"host": "db", "password": "secret"}

    def test_vault_retrieve_when_empty(self, source, vault):
        with patch.object(DataConnector, "_get_vault", return_value=vault):
            assert source._vault_retrieve(IDENTITY) is None

    def test_vault_delete(self, source, vault):
        with patch.object(DataConnector, "_get_vault", return_value=vault):
            source._vault_store(IDENTITY, {"host": "db"})
            source._vault_delete(IDENTITY)
            assert source._vault_retrieve(IDENTITY) is None

    def test_vault_unavailable_returns_false(self, source):
        with patch.object(DataConnector, "_get_vault", return_value=None):
            assert source._vault_store(IDENTITY, {"host": "db"}) is False
            assert source._vault_retrieve(IDENTITY) is None

    def test_has_stored_credentials(self, source, vault):
        with patch.object(DataConnector, "_get_vault", return_value=vault):
            assert source.has_stored_credentials(IDENTITY) is False
            source._vault_store(IDENTITY, {"host": "db"})
            assert source.has_stored_credentials(IDENTITY) is True

    def test_vault_exception_is_caught(self, source):
        """Vault errors should be logged but not propagated."""
        broken_vault = MagicMock(spec=CredentialVault)
        broken_vault.store.side_effect = RuntimeError("disk full")
        broken_vault.retrieve.side_effect = RuntimeError("disk full")
        broken_vault.delete.side_effect = RuntimeError("disk full")
        broken_vault.list_sources.side_effect = RuntimeError("disk full")

        with patch.object(DataConnector, "_get_vault", return_value=broken_vault):
            assert source._vault_store(IDENTITY, {"x": 1}) is False
            assert source._vault_retrieve(IDENTITY) is None
            source._vault_delete(IDENTITY)  # should not raise
            assert source.has_stored_credentials(IDENTITY) is False


# ==================================================================
# Tests: Connect stores credentials
# ==================================================================

class TestConnectStoresCredentials:

    def test_connect_does_not_auto_persist(self, source, vault):
        """_connect no longer stores to vault; caller must persist explicitly."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            source._connect({"password": "secret"})

            assert vault.retrieve(IDENTITY, "test_db") is None
            # But loader should be in memory
            assert source._get_loader(IDENTITY) is not None

    def test_persist_credentials_stores_in_vault(self, source, vault):
        """_persist_credentials stores after explicit call."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            source._connect({"password": "secret"})
            result = source._persist_credentials({"password": "secret"})
            assert result is True

            stored = vault.retrieve(IDENTITY, "test_db")
            assert stored is not None
            assert stored["user_params"]["password"] == "secret"

    def test_connect_via_route_stores_in_vault(self, client, source, vault):
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            resp = client.post("/api/connectors/connect", json={
                "connector_id": "test_db",
                "params": {"password": "secret"},
            })
            data = resp.get_json()
            assert data["status"] == "connected"
            assert data["persisted"] is True

            stored = vault.retrieve(IDENTITY, "test_db")
            assert stored is not None

    def test_connect_via_route_persist_false(self, client, source, vault):
        """Route with persist=false should not store in vault."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            resp = client.post("/api/connectors/connect", json={
                "connector_id": "test_db",
                "params": {"password": "secret"},
                "persist": False,
            })
            data = resp.get_json()
            assert data["status"] == "connected"
            assert data["persisted"] is False

            assert vault.retrieve(IDENTITY, "test_db") is None

    def test_connect_persist_false_clears_old_vault_entry(self, client, source, vault):
        """Reconnecting with persist=false should delete previously stored credentials."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            # First connect with persist=true
            resp = client.post("/api/connectors/connect", json={
                "connector_id": "test_db",
                "params": {"password": "secret"},
                "persist": True,
            })
            assert resp.get_json()["persisted"] is True
            assert vault.retrieve(IDENTITY, "test_db") is not None

            # Reconnect with persist=false — old entry must be deleted
            resp = client.post("/api/connectors/connect", json={
                "connector_id": "test_db",
                "params": {"password": "secret"},
                "persist": False,
            })
            assert resp.get_json()["persisted"] is False
            assert vault.retrieve(IDENTITY, "test_db") is None


# ==================================================================
# Tests: Disconnect deletes credentials
# ==================================================================

class TestDeleteCredentials:

    def test_delete_credentials_clears_vault(self, source, vault):
        """_delete_credentials clears both in-memory loader AND vault."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            source._connect({"password": "secret"})
            source._persist_credentials({"password": "secret"})
            assert vault.retrieve(IDENTITY, "test_db") is not None

            source._delete_credentials()
            assert vault.retrieve(IDENTITY, "test_db") is None
            assert source._get_loader(IDENTITY) is None


# ==================================================================
# Tests: Auto-reconnect from vault
# ==================================================================

class TestAutoReconnect:

    def test_require_loader_auto_reconnects(self, source, vault):
        """When in-memory loader is gone but vault has creds, auto-reconnect."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            # Store credentials directly in vault
            vault.store(IDENTITY, "test_db", {
                "user_params": {"password": "secret"},
                "source_id": "test_db",
            })
            # No in-memory loader
            assert source._get_loader(IDENTITY) is None

            # _require_loader should auto-reconnect
            loader = source._require_loader()
            assert loader is not None
            assert loader.test_connection() is True
            # Should now be in memory too
            assert source._get_loader(IDENTITY) is not None

    def test_auto_reconnect_cleans_stale_creds(self, source, vault):
        """If stored credentials fail to connect, delete them."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            # Store creds that will fail (test_connection patched to False)
            vault.store(IDENTITY, "test_db", {
                "user_params": {"password": "wrong"},
                "source_id": "test_db",
            })

            # Patch MockLoader.test_connection to fail
            with patch.object(MockLoader, "test_connection", return_value=False):
                loader = source._try_auto_reconnect(IDENTITY)
                assert loader is None
                # Stale credentials should be deleted
                assert vault.retrieve(IDENTITY, "test_db") is None

    def test_auto_reconnect_exception_cleans_stale_creds(self, source, vault):
        """If auto-reconnect raises, delete stale creds."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            vault.store(IDENTITY, "test_db", {
                "user_params": {"password": "x"},
                "source_id": "test_db",
            })

            with patch.object(MockLoader, "__init__", side_effect=RuntimeError("bad creds")):
                loader = source._try_auto_reconnect(IDENTITY)
                assert loader is None
                assert vault.retrieve(IDENTITY, "test_db") is None

    def test_status_reports_stored_credentials(self, client, source, vault):
        """POST /get-status is side-effect-free: reports has_stored_credentials but does not reconnect."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=vault):
            # Store credentials in vault (simulating a previous session)
            vault.store(IDENTITY, "test_db", {
                "user_params": {"password": "secret"},
                "source_id": "test_db",
            })
            # Clear any in-memory loader
            source._loaders.clear()

            resp = client.post("/api/connectors/get-status", json={"connector_id": "test_db"})
            data = resp.get_json()
            assert data["connected"] is False
            assert data["has_stored_credentials"] is True

    def test_auth_status_not_connected_no_vault(self, client, source):
        """POST /get-status with no loader and no vault = not connected."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=None):
            source._loaders.clear()
            resp = client.post("/api/connectors/get-status", json={"connector_id": "test_db"})
            data = resp.get_json()
            assert data["connected"] is False
            assert data.get("has_stored_credentials") is False


# ==================================================================
# Tests: Vault unavailable (graceful fallback)
# ==================================================================

class TestNoVaultFallback:

    def test_connect_without_vault(self, source):
        """Connection works fine without vault, just in-memory."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=None):
            loader = source._connect({"password": "secret"})
            assert loader is not None
            assert source._get_loader(IDENTITY) is not None

    def test_connect_route_without_vault_not_persisted(self, client, source):
        """Route returns persisted=False when no vault."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=None):
            resp = client.post("/api/connectors/connect", json={
                "connector_id": "test_db",
                "params": {"password": "secret"},
            })
            data = resp.get_json()
            assert data["status"] == "connected"
            assert data["persisted"] is False

    def test_require_loader_no_vault_raises(self, source):
        """Without vault and without in-memory loader, require_loader raises."""
        with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
             patch.object(DataConnector, "_get_vault", return_value=None):
            source._loaders.clear()
            with pytest.raises(ValueError, match="Not connected"):
                source._require_loader()


# ==================================================================
# Tests: Identity isolation
# ==================================================================

class TestIdentityIsolation:

    def test_different_users_separate_vault_entries(self, source, vault):
        """Two users connecting store separate vault entries."""
        with patch.object(DataConnector, "_get_vault", return_value=vault):
            with patch.object(DataConnector, "_get_identity", return_value="user:alice"):
                source._connect({"password": "alice-pw"})
                source._persist_credentials({"password": "alice-pw"})

            with patch.object(DataConnector, "_get_identity", return_value="user:bob"):
                source._connect({"password": "bob-pw"})
                source._persist_credentials({"password": "bob-pw"})

            alice_creds = vault.retrieve("user:alice", "test_db")
            bob_creds = vault.retrieve("user:bob", "test_db")
            assert alice_creds["user_params"]["password"] == "alice-pw"
            assert bob_creds["user_params"]["password"] == "bob-pw"

    def test_delete_only_affects_own_user(self, source, vault):
        """Deleting one user's credentials doesn't affect another's."""
        with patch.object(DataConnector, "_get_vault", return_value=vault):
            with patch.object(DataConnector, "_get_identity", return_value="user:alice"):
                source._connect({"password": "alice-pw"})
                source._persist_credentials({"password": "alice-pw"})
            with patch.object(DataConnector, "_get_identity", return_value="user:bob"):
                source._connect({"password": "bob-pw"})
                source._persist_credentials({"password": "bob-pw"})

            with patch.object(DataConnector, "_get_identity", return_value="user:alice"):
                source._delete_credentials()

            # Alice's credentials are gone (memory + vault), Bob's are untouched
            assert vault.retrieve("user:alice", "test_db") is None
            assert vault.retrieve("user:bob", "test_db") is not None
            assert source._get_loader("user:alice") is None
            assert source._get_loader("user:bob") is not None
