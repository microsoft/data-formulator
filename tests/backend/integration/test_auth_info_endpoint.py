"""Integration tests for the ``/api/auth/info`` endpoint.

Background
----------
The ``/api/auth/info`` endpoint delegates to the active provider's
``get_auth_info()`` method, letting the frontend discover how to
initiate the login flow without hard-coding provider details.
"""
from __future__ import annotations

import flask
import pytest

import data_formulator.security.auth as auth_module
from data_formulator.auth_providers.azure_easyauth import AzureEasyAuthProvider
from data_formulator.auth_providers.github_oauth import GitHubOAuthProvider
from data_formulator.auth_providers.oidc import OIDCProvider

pytestmark = [pytest.mark.backend, pytest.mark.auth]


@pytest.fixture
def app():
    """Minimal Flask app with the /api/auth/info route registered."""
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True

    @_app.route("/api/auth/info")
    def auth_info():
        provider = auth_module.get_active_provider()
        if provider:
            return flask.jsonify(provider.get_auth_info())
        return flask.jsonify({"action": "none"})

    return _app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def _reset_auth(monkeypatch):
    monkeypatch.setattr(auth_module, "_provider", None)
    monkeypatch.setattr(auth_module, "_allow_anonymous", True)


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

class TestAuthInfoEndpoint:

    def test_anonymous_mode_returns_none_action(self, client):
        resp = client.get("/api/auth/info")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["action"] == "none"

    def test_oidc_provider_returns_frontend_action(self, client, monkeypatch):
        monkeypatch.setenv("OIDC_ISSUER_URL", "https://idp.example.com")
        monkeypatch.setenv("OIDC_CLIENT_ID", "my-client")
        provider = OIDCProvider()
        monkeypatch.setattr(auth_module, "_provider", provider)

        resp = client.get("/api/auth/info")
        data = resp.get_json()
        assert data["action"] == "frontend"
        assert data["oidc"]["authority"] == "https://idp.example.com"
        assert data["oidc"]["clientId"] == "my-client"

    def test_github_provider_returns_redirect_action(self, client, monkeypatch):
        monkeypatch.setenv("GITHUB_CLIENT_ID", "gh-id")
        monkeypatch.setenv("GITHUB_CLIENT_SECRET", "gh-secret")
        provider = GitHubOAuthProvider()
        monkeypatch.setattr(auth_module, "_provider", provider)

        resp = client.get("/api/auth/info")
        data = resp.get_json()
        assert data["action"] == "redirect"
        assert data["url"] == "/api/auth/github/login"

    def test_azure_provider_returns_transparent_action(self, client, monkeypatch):
        provider = AzureEasyAuthProvider()
        monkeypatch.setattr(auth_module, "_provider", provider)

        resp = client.get("/api/auth/info")
        data = resp.get_json()
        assert data["action"] == "transparent"
