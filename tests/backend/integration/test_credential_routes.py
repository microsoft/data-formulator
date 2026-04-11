"""Integration tests for the credential management API endpoints.

Verifies:
- POST /api/credentials/store → stores credential in Vault
- GET  /api/credentials/list  → returns source_key list (no secrets)
- POST /api/credentials/delete → removes credential
- Vault not configured → /store and /delete return 503, /list returns empty
- User isolation (different X-Identity-Id headers)
"""
from __future__ import annotations

import flask
import pytest
from cryptography.fernet import Fernet
from unittest.mock import patch

pytestmark = [pytest.mark.backend, pytest.mark.vault]


@pytest.fixture
def vault(tmp_path):
    from data_formulator.credential_vault.local_vault import LocalCredentialVault

    key = Fernet.generate_key().decode()
    return LocalCredentialVault(tmp_path / "test_creds.db", key)


@pytest.fixture
def app_with_vault(vault):
    """Flask app with credential routes and a real Vault."""
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"

    from data_formulator.credential_routes import credential_bp
    _app.register_blueprint(credential_bp)

    with patch("data_formulator.credential_routes.get_credential_vault", return_value=vault), \
         patch("data_formulator.credential_routes.get_identity_id") as mock_id:
        mock_id.return_value = "user:alice"
        yield _app, mock_id


@pytest.fixture
def app_no_vault():
    """Flask app with credential routes but no Vault configured."""
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"

    from data_formulator.credential_routes import credential_bp
    _app.register_blueprint(credential_bp)

    with patch("data_formulator.credential_routes.get_credential_vault", return_value=None), \
         patch("data_formulator.credential_routes.get_identity_id", return_value="user:alice"):
        yield _app


class TestStoreEndpoint:

    def test_store_success(self, app_with_vault):
        app, _ = app_with_vault
        with app.test_client() as c:
            resp = c.post("/api/credentials/store", json={
                "source_key": "superset",
                "credentials": {"username": "alice", "password": "pw"},
            })
            assert resp.status_code == 200
            data = resp.get_json()
            assert data["status"] == "stored"
            assert data["source_key"] == "superset"

    def test_store_missing_fields(self, app_with_vault):
        app, _ = app_with_vault
        with app.test_client() as c:
            resp = c.post("/api/credentials/store", json={"source_key": "superset"})
            assert resp.status_code == 400

    def test_store_no_vault_returns_503(self, app_no_vault):
        with app_no_vault.test_client() as c:
            resp = c.post("/api/credentials/store", json={
                "source_key": "superset",
                "credentials": {"username": "alice", "password": "pw"},
            })
            assert resp.status_code == 503


class TestListEndpoint:

    def test_list_empty(self, app_with_vault):
        app, _ = app_with_vault
        with app.test_client() as c:
            resp = c.get("/api/credentials/list")
            assert resp.status_code == 200
            assert resp.get_json()["sources"] == []

    def test_list_after_store(self, app_with_vault, vault):
        app, _ = app_with_vault
        vault.store("user:alice", "superset", {"pw": "x"})
        vault.store("user:alice", "metabase", {"pw": "y"})
        with app.test_client() as c:
            resp = c.get("/api/credentials/list")
            sources = resp.get_json()["sources"]
            assert set(sources) == {"superset", "metabase"}

    def test_list_no_vault_returns_empty(self, app_no_vault):
        with app_no_vault.test_client() as c:
            resp = c.get("/api/credentials/list")
            assert resp.status_code == 200
            assert resp.get_json()["sources"] == []


class TestDeleteEndpoint:

    def test_delete_success(self, app_with_vault, vault):
        app, _ = app_with_vault
        vault.store("user:alice", "superset", {"pw": "x"})
        with app.test_client() as c:
            resp = c.post("/api/credentials/delete", json={"source_key": "superset"})
            assert resp.status_code == 200
            assert resp.get_json()["status"] == "deleted"
        assert vault.retrieve("user:alice", "superset") is None

    def test_delete_missing_key(self, app_with_vault):
        app, _ = app_with_vault
        with app.test_client() as c:
            resp = c.post("/api/credentials/delete", json={})
            assert resp.status_code == 400

    def test_delete_no_vault_returns_503(self, app_no_vault):
        with app_no_vault.test_client() as c:
            resp = c.post("/api/credentials/delete", json={"source_key": "superset"})
            assert resp.status_code == 503


class TestUserIsolation:

    def test_different_users_see_own_credentials(self, app_with_vault, vault):
        app, mock_id = app_with_vault

        vault.store("user:alice", "superset", {"pw": "alice"})
        vault.store("user:bob", "superset", {"pw": "bob"})

        with app.test_client() as c:
            mock_id.return_value = "user:alice"
            resp = c.get("/api/credentials/list")
            assert "superset" in resp.get_json()["sources"]

        with app.test_client() as c:
            mock_id.return_value = "user:bob"
            resp = c.get("/api/credentials/list")
            assert "superset" in resp.get_json()["sources"]

    def test_delete_only_affects_own(self, app_with_vault, vault):
        app, mock_id = app_with_vault

        vault.store("user:alice", "superset", {"pw": "alice"})
        vault.store("user:bob", "superset", {"pw": "bob"})

        with app.test_client() as c:
            mock_id.return_value = "user:alice"
            c.post("/api/credentials/delete", json={"source_key": "superset"})

        assert vault.retrieve("user:alice", "superset") is None
        assert vault.retrieve("user:bob", "superset") == {"pw": "bob"}
