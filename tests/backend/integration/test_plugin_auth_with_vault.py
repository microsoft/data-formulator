"""Integration tests for plugin authentication + CredentialVault interplay.

Verifies:
- Vault has valid credentials → plugin auto-login succeeds (mode=vault)
- Vault has stale credentials (password changed) → returns vault_stale
- User manually logs in with remember=true → credentials stored in Vault
- User manually logs in with remember=false → old Vault credentials deleted
- Vault not configured → status endpoint still works (skips Vault step)
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import flask
import pytest
from cryptography.fernet import Fernet

pytestmark = [pytest.mark.backend, pytest.mark.vault, pytest.mark.plugin]


@pytest.fixture
def vault(tmp_path):
    from data_formulator.credential_vault.local_vault import LocalCredentialVault

    key = Fernet.generate_key().decode()
    return LocalCredentialVault(tmp_path / "test_creds.db", key)


@pytest.fixture
def superset_app(vault):
    """Flask app with Superset plugin auth routes and a mocked bridge."""
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"

    mock_bridge = MagicMock()
    _app.extensions = {"plugin_superset_bridge": mock_bridge}

    from data_formulator.plugins.superset.routes.auth import auth_bp
    _app.register_blueprint(auth_bp)

    yield _app, mock_bridge, vault


class TestVaultAutoLogin:

    def test_vault_credentials_valid_auto_login(self, superset_app):
        """Vault has valid credentials → auth/status returns authenticated + mode=vault."""
        app, mock_bridge, vault = superset_app

        mock_bridge.login.return_value = {
            "access_token": "tok_valid",
            "refresh_token": "ref_valid",
        }
        mock_bridge.get_user_info.return_value = {
            "id": 1, "username": "alice", "first_name": "Alice", "last_name": "W",
        }

        vault.store("user:alice", "superset", {"username": "alice", "password": "correct_pw"})

        with app.test_client() as c, \
             patch("data_formulator.credential_vault.get_credential_vault", return_value=vault), \
             patch("data_formulator.security.auth.get_identity_id", return_value="user:alice"):
            resp = c.get("/api/plugins/superset/auth/status")
            data = resp.get_json()

        assert data["authenticated"] is True
        assert data.get("mode") == "vault"

    def test_vault_credentials_stale(self, superset_app):
        """Vault credentials are stale (password changed) → vault_stale=true."""
        app, mock_bridge, vault = superset_app

        mock_bridge.login.side_effect = Exception("Invalid credentials")

        vault.store("user:alice", "superset", {"username": "alice", "password": "old_pw"})

        with app.test_client() as c, \
             patch("data_formulator.credential_vault.get_credential_vault", return_value=vault), \
             patch("data_formulator.security.auth.get_identity_id", return_value="user:alice"):
            resp = c.get("/api/plugins/superset/auth/status")
            data = resp.get_json()

        assert data["authenticated"] is False
        assert data["vault_stale"] is True


class TestLoginWithRemember:

    def test_remember_true_stores_in_vault(self, superset_app):
        """Login with remember=true → credentials written to Vault."""
        app, mock_bridge, vault = superset_app

        mock_bridge.login.return_value = {"access_token": "tok", "refresh_token": "ref"}
        mock_bridge.get_user_info.return_value = {
            "id": 1, "username": "alice", "first_name": "Alice", "last_name": "W",
        }

        with app.test_client() as c, \
             patch("data_formulator.credential_vault.get_credential_vault", return_value=vault), \
             patch("data_formulator.security.auth.get_identity_id", return_value="user:alice"):
            resp = c.post("/api/plugins/superset/auth/login", json={
                "username": "alice",
                "password": "new_pw",
                "remember": True,
            })
            assert resp.status_code == 200

        stored = vault.retrieve("user:alice", "superset")
        assert stored is not None
        assert stored["username"] == "alice"
        assert stored["password"] == "new_pw"

    def test_remember_false_deletes_vault_credential(self, superset_app):
        """Login with remember=false → old Vault credential removed."""
        app, mock_bridge, vault = superset_app

        vault.store("user:alice", "superset", {"username": "alice", "password": "old"})

        mock_bridge.login.return_value = {"access_token": "tok", "refresh_token": "ref"}
        mock_bridge.get_user_info.return_value = {
            "id": 1, "username": "alice", "first_name": "Alice", "last_name": "W",
        }

        with app.test_client() as c, \
             patch("data_formulator.credential_vault.get_credential_vault", return_value=vault), \
             patch("data_formulator.security.auth.get_identity_id", return_value="user:alice"):
            resp = c.post("/api/plugins/superset/auth/login", json={
                "username": "alice",
                "password": "new_pw",
                "remember": False,
            })
            assert resp.status_code == 200

        assert vault.retrieve("user:alice", "superset") is None


class TestVaultNotConfigured:

    def test_status_works_without_vault(self, superset_app):
        """No Vault configured → status still works, no crash."""
        app, mock_bridge, _ = superset_app

        with app.test_client() as c, \
             patch("data_formulator.credential_vault.get_credential_vault", return_value=None), \
             patch("data_formulator.security.auth.get_identity_id", return_value="user:alice"):
            resp = c.get("/api/plugins/superset/auth/status")
            data = resp.get_json()

        assert data["authenticated"] is False
        assert "vault_stale" not in data

    def test_login_remember_without_vault_still_succeeds(self, superset_app):
        """Login with remember=true but no Vault → login works, no crash."""
        app, mock_bridge, _ = superset_app

        mock_bridge.login.return_value = {"access_token": "tok", "refresh_token": "ref"}
        mock_bridge.get_user_info.return_value = {
            "id": 1, "username": "alice", "first_name": "Alice", "last_name": "W",
        }

        with app.test_client() as c, \
             patch("data_formulator.credential_vault.get_credential_vault", return_value=None), \
             patch("data_formulator.security.auth.get_identity_id", return_value="user:alice"):
            resp = c.post("/api/plugins/superset/auth/login", json={
                "username": "alice",
                "password": "pw",
                "remember": True,
            })
            assert resp.status_code == 200
