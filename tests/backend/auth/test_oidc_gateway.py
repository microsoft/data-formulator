# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for the OIDC gateway blueprints.

Tests ``oidc_bp`` (backend OIDC Confidential Client flow) and
``auth_tokens_bp`` (token management routes) using a minimal Flask app
with mocked HTTP calls to the IdP.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.auth.gateways.oidc_gateway import (
    auth_tokens_bp,
    oidc_bp,
)

pytestmark = [pytest.mark.backend, pytest.mark.auth]


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "backend")
    monkeypatch.setenv("OIDC_CLIENT_ID", "df-test-client")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("OIDC_AUTHORIZE_URL", "https://idp.example.com/authorize")
    monkeypatch.setenv("OIDC_TOKEN_URL", "https://idp.example.com/token")
    monkeypatch.setenv("OIDC_USERINFO_URL", "https://idp.example.com/userinfo")

    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret-key"
    _app.register_blueprint(oidc_bp)
    _app.register_blueprint(auth_tokens_bp)
    return _app


@pytest.fixture
def client(app):
    return app.test_client()


# ==================================================================
# oidc_bp: /api/auth/oidc/login
# ==================================================================

class TestOIDCLogin:

    def test_login_redirects_to_authorize_url(self, client):
        resp = client.get("/api/auth/oidc/login")
        assert resp.status_code == 302
        location = resp.headers["Location"]
        assert "idp.example.com/authorize" in location
        assert "response_type=code" in location
        assert "client_id=df-test-client" in location

    def test_login_sets_state_in_session(self, client):
        with client.session_transaction() as sess:
            assert "_oauth_state" not in sess
        client.get("/api/auth/oidc/login")
        with client.session_transaction() as sess:
            assert "_oauth_state" in sess
            assert len(sess["_oauth_state"]) > 10

    def test_login_disabled_in_frontend_mode(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_MODE", "frontend")
        c = app.test_client()
        resp = c.get("/api/auth/oidc/login")
        assert resp.status_code == 400
        assert "not enabled" in resp.get_json()["error"]

    def test_login_fails_without_authorize_url(self, app, monkeypatch):
        monkeypatch.delenv("OIDC_AUTHORIZE_URL", raising=False)
        c = app.test_client()
        resp = c.get("/api/auth/oidc/login")
        assert resp.status_code == 500
        assert "OIDC_AUTHORIZE_URL" in resp.get_json()["error"]


# ==================================================================
# oidc_bp: /api/auth/oidc/callback
# ==================================================================

class TestOIDCCallback:

    def test_callback_rejects_missing_code(self, client):
        with client.session_transaction() as sess:
            sess["_oauth_state"] = "test-state"
        resp = client.get("/api/auth/oidc/callback?state=test-state")
        assert resp.status_code == 400

    def test_callback_rejects_invalid_state(self, client):
        with client.session_transaction() as sess:
            sess["_oauth_state"] = "correct-state"
        resp = client.get("/api/auth/oidc/callback?code=auth-code&state=wrong-state")
        assert resp.status_code == 400

    def test_callback_success_stores_tokens_and_redirects(self, client):
        with client.session_transaction() as sess:
            sess["_oauth_state"] = "valid-state"

        mock_token_resp = MagicMock()
        mock_token_resp.ok = True
        mock_token_resp.json.return_value = {
            "access_token": "sso-access-tok",
            "refresh_token": "sso-ref-tok",
            "expires_in": 3600,
        }
        mock_userinfo_resp = MagicMock()
        mock_userinfo_resp.ok = True
        mock_userinfo_resp.json.return_value = {
            "sub": "user-42",
            "name": "Alice",
            "email": "alice@example.com",
        }

        with patch("data_formulator.auth.gateways.oidc_gateway.http.post",
                    return_value=mock_token_resp), \
             patch("data_formulator.auth.gateways.oidc_gateway.http.get",
                   return_value=mock_userinfo_resp):
            resp = client.get("/api/auth/oidc/callback?code=auth-code&state=valid-state")

        assert resp.status_code == 302
        assert resp.headers["Location"].endswith("/")

        with client.session_transaction() as sess:
            assert "sso" in sess
            assert sess["sso"]["access_token"] == "sso-access-tok"

    def test_callback_token_exchange_failure(self, client):
        with client.session_transaction() as sess:
            sess["_oauth_state"] = "valid-state"

        mock_resp = MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 400
        mock_resp.text = "invalid_grant"

        with patch("data_formulator.auth.gateways.oidc_gateway.http.post",
                    return_value=mock_resp):
            resp = client.get("/api/auth/oidc/callback?code=bad-code&state=valid-state")
        assert resp.status_code == 502
        assert resp.get_json()["error"] == "token_exchange_failed"

    def test_callback_disabled_in_frontend_mode(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_MODE", "frontend")
        c = app.test_client()
        resp = c.get("/api/auth/oidc/callback?code=x&state=y")
        assert resp.status_code == 400


# ==================================================================
# oidc_bp: /api/auth/oidc/status
# ==================================================================

class TestOIDCStatus:

    def test_status_authenticated(self, client):
        with client.session_transaction() as sess:
            import time
            sess["sso"] = {
                "access_token": "valid-tok",
                "refresh_token": None,
                "expires_at": time.time() + 3600,
                "user": {"name": "Alice"},
            }
        resp = client.get("/api/auth/oidc/status")
        data = resp.get_json()
        assert data["authenticated"] is True

    def test_status_not_authenticated(self, client):
        resp = client.get("/api/auth/oidc/status")
        data = resp.get_json()
        assert data["authenticated"] is False

    def test_status_frontend_mode(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_MODE", "frontend")
        c = app.test_client()
        resp = c.get("/api/auth/oidc/status")
        data = resp.get_json()
        assert data["authenticated"] is False
        assert data["mode"] == "frontend"


# ==================================================================
# oidc_bp: /api/auth/oidc/logout
# ==================================================================

class TestOIDCLogout:

    def test_logout_clears_session(self, client):
        with client.session_transaction() as sess:
            sess["sso"] = {"access_token": "tok"}
            sess["service_tokens"] = {"superset": {"access_token": "s-tok"}}
        resp = client.post("/api/auth/oidc/logout")
        assert resp.get_json()["status"] == "ok"
        with client.session_transaction() as sess:
            assert "sso" not in sess
            assert "service_tokens" not in sess


# ==================================================================
# auth_tokens_bp: /api/auth/tokens/save
# ==================================================================

class TestSaveDelegatedToken:

    def test_save_token_success(self, client):
        resp = client.post("/api/auth/tokens/save", json={
            "system_id": "superset",
            "access_token": "popup-tok",
            "refresh_token": "popup-ref",
            "expires_in": 7200,
        })
        data = resp.get_json()
        assert data["status"] == "ok"

        with client.session_transaction() as sess:
            tokens = sess.get("service_tokens", {})
            assert "superset" in tokens
            assert tokens["superset"]["access_token"] == "popup-tok"

    def test_save_token_missing_fields(self, client):
        resp = client.post("/api/auth/tokens/save", json={
            "system_id": "superset",
        })
        assert resp.status_code == 400

    def test_save_token_missing_system_id(self, client):
        resp = client.post("/api/auth/tokens/save", json={
            "access_token": "tok",
        })
        assert resp.status_code == 400


# ==================================================================
# auth_tokens_bp: /api/auth/service-status
# ==================================================================

class TestAuthServiceStatus:

    def test_service_status_returns_dict(self, client):
        with patch("data_formulator.auth.gateways.oidc_gateway.TokenStore") as MockTS:
            instance = MockTS.return_value
            instance.get_auth_status.return_value = {
                "superset": {
                    "authorized": False,
                    "mode": "sso_exchange",
                    "display_name": "Superset",
                    "requires_user_action": True,
                    "available_strategies": [],
                },
            }
            resp = client.get("/api/auth/service-status")
        data = resp.get_json()
        assert "superset" in data
        assert data["superset"]["display_name"] == "Superset"
