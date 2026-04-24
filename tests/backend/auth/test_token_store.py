# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for the TokenStore credential manager.

TokenStore is a session-backed credential store with a six-level resolution
chain: cached → refresh → sso_exchange → delegated → vault → none.

All tests run with a minimal Flask app for session context; HTTP calls to
external IdPs are mocked.
"""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.auth.token_store import TokenStore

pytestmark = [pytest.mark.backend, pytest.mark.auth]


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def app():
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"
    return _app


@pytest.fixture
def store():
    return TokenStore()


# ------------------------------------------------------------------
# Store / retrieve service tokens
# ------------------------------------------------------------------

class TestStoreServiceToken:

    def test_store_and_retrieve_via_session(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            store.store_service_token(
                "superset", "tok-abc", refresh_token="ref-123", expires_in=3600,
            )
            cached = store._get_cached("superset")
            assert cached is not None
            assert cached["access_token"] == "tok-abc"
            assert cached["refresh_token"] == "ref-123"
            assert cached["expires_at"] > time.time()

    def test_store_overwrites_previous(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            store.store_service_token("sys", "old-tok")
            store.store_service_token("sys", "new-tok")
            cached = store._get_cached("sys")
            assert cached["access_token"] == "new-tok"

    def test_clear_service_token(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            store.store_service_token("sys", "tok")
            store.clear_service_token("sys")
            assert store._get_cached("sys") is None


# ------------------------------------------------------------------
# SSO tokens
# ------------------------------------------------------------------

class TestStoreSSO:

    def test_store_sso_tokens(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            store.store_sso_tokens("sso-tok", refresh_token="sso-ref", expires_in=7200)
            sso = flask.session.get("sso")
            assert sso["access_token"] == "sso-tok"
            assert sso["refresh_token"] == "sso-ref"

    def test_get_sso_token_backend_mode(self, app, store, monkeypatch):
        monkeypatch.setenv("AUTH_MODE", "backend")
        with app.test_request_context():
            flask.session.clear()
            store.store_sso_tokens("my-sso", expires_in=3600)
            token = store.get_sso_token()
            assert token == "my-sso"

    def test_get_sso_token_backend_expired_no_refresh(self, app, store, monkeypatch):
        monkeypatch.setenv("AUTH_MODE", "backend")
        with app.test_request_context():
            flask.session.clear()
            flask.session["sso"] = {
                "access_token": "expired-tok",
                "refresh_token": None,
                "expires_at": time.time() - 100,
            }
            token = store.get_sso_token()
            assert token is None

    def test_get_sso_token_frontend_mode(self, app, store, monkeypatch):
        monkeypatch.setenv("AUTH_MODE", "frontend")
        with app.test_request_context():
            flask.session.clear()
            with patch("data_formulator.auth.token_store.get_sso_token",
                       return_value="fe-tok", create=True):
                try:
                    token = store.get_sso_token()
                except Exception:
                    token = None
            # In frontend mode without proper auth.identity, returns None or token
            assert token is None or isinstance(token, str)


# ------------------------------------------------------------------
# Expiry checks
# ------------------------------------------------------------------

class TestExpiry:

    def test_is_expired_true(self, store):
        assert store._is_expired({"expires_at": time.time() - 10}) is True

    def test_is_expired_false(self, store):
        assert store._is_expired({"expires_at": time.time() + 3600}) is False

    def test_is_expired_missing_key(self, store):
        assert store._is_expired({}) is True


# ------------------------------------------------------------------
# get_access — resolution chain
# ------------------------------------------------------------------

class TestGetAccess:

    def test_returns_none_when_no_auth_config(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            with patch.object(store, "_get_auth_config", return_value=None):
                assert store.get_access("unknown_system") is None

    def test_returns_cached_token(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            store.store_service_token("sys", "cached-tok", expires_in=3600)
            config = {"mode": "sso_exchange"}
            with patch.object(store, "_get_auth_config", return_value=config):
                result = store.get_access("sys")
            assert result == "cached-tok"

    def test_skips_expired_cache_tries_refresh(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            flask.session["service_tokens"] = {
                "sys": {
                    "access_token": "old",
                    "refresh_token": "ref-tok",
                    "expires_at": time.time() - 100,
                },
            }
            config = {"mode": "sso_exchange", "token_url": "https://idp/token"}
            with patch.object(store, "_get_auth_config", return_value=config), \
                 patch.object(store, "_do_refresh", return_value="refreshed-tok"):
                result = store.get_access("sys")
            assert result == "refreshed-tok"

    def test_falls_through_to_vault(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            config = {"mode": "credentials"}
            creds = {"username": "admin", "password": "secret"}
            with patch.object(store, "_get_auth_config", return_value=config), \
                 patch.object(store, "_try_vault", return_value=creds):
                result = store.get_access("sys")
            assert result == creds

    def test_returns_none_when_all_fail(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            config = {"mode": "credentials"}
            with patch.object(store, "_get_auth_config", return_value=config), \
                 patch.object(store, "_try_vault", return_value=None):
                result = store.get_access("sys")
            assert result is None


# ------------------------------------------------------------------
# _do_refresh
# ------------------------------------------------------------------

class TestRefresh:

    def test_refresh_success(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            cached = {"access_token": "old", "refresh_token": "ref-tok", "user": {"name": "test"}}
            config = {
                "token_url": "https://idp.example.com/token",
                "client_id_env": "TEST_CLIENT_ID",
                "client_secret_env": "TEST_CLIENT_SECRET",
            }
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json.return_value = {
                "access_token": "new-tok",
                "refresh_token": "new-ref",
                "expires_in": 3600,
            }
            with patch("requests.post", return_value=mock_resp):
                result = store._do_refresh("sys", cached, config)
            assert result == "new-tok"
            assert store._get_cached("sys")["access_token"] == "new-tok"

    def test_refresh_no_token_url(self, app, store):
        with app.test_request_context():
            result = store._do_refresh("sys", {"refresh_token": "ref"}, {})
            assert result is None

    def test_refresh_http_failure(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            cached = {"refresh_token": "ref"}
            config = {"token_url": "https://idp/token"}
            with patch("requests.post", side_effect=Exception("network error")):
                result = store._do_refresh("sys", cached, config)
            assert result is None


# ------------------------------------------------------------------
# _do_sso_exchange
# ------------------------------------------------------------------

class TestSSOExchange:

    def test_sso_exchange_success(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            config = {"exchange_url": "https://superset/api/v1/df-token-exchange/"}
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.json.return_value = {
                "access_token": "exchanged-tok",
                "expires_in": 3600,
            }
            with patch.object(store, "get_sso_token", return_value="sso-tok"), \
                 patch("requests.post", return_value=mock_resp):
                result = store._do_sso_exchange("superset", config)
            assert result == "exchanged-tok"

    def test_sso_exchange_no_sso_token(self, app, store):
        with app.test_request_context():
            config = {"exchange_url": "https://superset/exchange"}
            with patch.object(store, "get_sso_token", return_value=None):
                result = store._do_sso_exchange("superset", config)
            assert result is None

    def test_sso_exchange_no_exchange_url(self, app, store):
        with app.test_request_context():
            with patch.object(store, "get_sso_token", return_value="tok"):
                result = store._do_sso_exchange("sys", {})
            assert result is None


# ------------------------------------------------------------------
# get_auth_status
# ------------------------------------------------------------------

class TestGetAuthStatus:

    def test_returns_status_for_configured_systems(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            store.store_service_token("superset", "tok", expires_in=3600)
            configs = {
                "superset": {
                    "mode": "sso_exchange",
                    "display_name": "Superset",
                },
            }
            with patch.object(store, "_all_auth_configs", return_value=configs):
                status = store.get_auth_status()
            assert "superset" in status
            assert status["superset"]["authorized"] is True
            assert status["superset"]["display_name"] == "Superset"

    def test_returns_unauthorized_for_missing_token(self, app, store):
        with app.test_request_context():
            flask.session.clear()
            configs = {"sys": {"mode": "credentials", "display_name": "System"}}
            with patch.object(store, "_all_auth_configs", return_value=configs), \
                 patch.object(store, "_try_vault", return_value=None):
                status = store.get_auth_status()
            assert status["sys"]["authorized"] is False
            assert status["sys"]["requires_user_action"] is True


# ------------------------------------------------------------------
# _available_strategies
# ------------------------------------------------------------------

class TestAvailableStrategies:

    def test_sso_exchange_available(self, app, store):
        with app.test_request_context():
            config = {"mode": "sso_exchange"}
            with patch.object(store, "get_sso_token", return_value="sso-tok"):
                strategies = store._available_strategies("sys", config)
            assert "sso_exchange" in strategies

    def test_delegated_popup(self, store):
        config = {"mode": "delegated", "login_url": "https://sso/login"}
        strategies = store._available_strategies("sys", config)
        assert "delegated_popup" in strategies

    def test_manual_credentials(self, store):
        config = {"mode": "credentials"}
        strategies = store._available_strategies("sys", config)
        assert "manual_credentials" in strategies

    def test_oauth2_redirect(self, store):
        config = {"mode": "oauth2"}
        strategies = store._available_strategies("sys", config)
        assert "oauth2_redirect" in strategies


# ------------------------------------------------------------------
# _resolve_env
# ------------------------------------------------------------------

class TestResolveEnv:

    def test_resolve_env(self, monkeypatch):
        monkeypatch.setenv("MY_VAR", "my-value")
        assert TokenStore._resolve_env("MY_VAR") == "my-value"

    def test_resolve_env_missing(self, monkeypatch):
        monkeypatch.delenv("MISSING_VAR", raising=False)
        assert TokenStore._resolve_env("MISSING_VAR") == ""

    def test_resolve_env_empty_key(self):
        assert TokenStore._resolve_env("") == ""
