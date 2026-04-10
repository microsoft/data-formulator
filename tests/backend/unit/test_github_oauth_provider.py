"""Unit tests for the GitHub OAuth authentication provider.

Background
----------
``GitHubOAuthProvider`` is a stateful (B-class) provider that reads
identity from the Flask session (written by the GitHub gateway blueprint).
No real GitHub API calls are needed — we only test session reading.
"""
from __future__ import annotations

import flask
import pytest

from data_formulator.auth_providers.github_oauth import GitHubOAuthProvider

pytestmark = [pytest.mark.backend, pytest.mark.auth]


@pytest.fixture
def app():
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"
    return _app


@pytest.fixture
def provider(monkeypatch) -> GitHubOAuthProvider:
    monkeypatch.setenv("GITHUB_CLIENT_ID", "gh-test-id")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "gh-test-secret")
    return GitHubOAuthProvider()


# ------------------------------------------------------------------
# Metadata
# ------------------------------------------------------------------

class TestGitHubProviderMetadata:

    def test_name(self, provider):
        assert provider.name == "github"

    def test_enabled_with_both_vars(self, provider):
        assert provider.enabled is True

    def test_disabled_without_client_id(self, monkeypatch):
        monkeypatch.delenv("GITHUB_CLIENT_ID", raising=False)
        monkeypatch.setenv("GITHUB_CLIENT_SECRET", "s")
        assert GitHubOAuthProvider().enabled is False

    def test_disabled_without_client_secret(self, monkeypatch):
        monkeypatch.setenv("GITHUB_CLIENT_ID", "id")
        monkeypatch.delenv("GITHUB_CLIENT_SECRET", raising=False)
        assert GitHubOAuthProvider().enabled is False

    def test_get_auth_info_is_redirect(self, provider):
        info = provider.get_auth_info()
        assert info["action"] == "redirect"
        assert info["url"] == "/api/auth/github/login"


# ------------------------------------------------------------------
# Authenticate from session
# ------------------------------------------------------------------

class TestGitHubAuthenticate:

    def test_session_with_github_user(self, app, provider):
        with app.test_request_context():
            flask.session["df_user"] = {
                "user_id": "github:12345",
                "display_name": "octocat",
                "email": "octocat@github.com",
                "raw_token": "gho_abc123",
                "provider": "github",
            }
            result = provider.authenticate(flask.request)
            assert result is not None
            assert result.user_id == "github:12345"
            assert result.display_name == "octocat"
            assert result.email == "octocat@github.com"
            assert result.raw_token == "gho_abc123"

    def test_empty_session_returns_none(self, app, provider):
        with app.test_request_context():
            result = provider.authenticate(flask.request)
            assert result is None

    def test_wrong_provider_in_session_returns_none(self, app, provider):
        with app.test_request_context():
            flask.session["df_user"] = {
                "user_id": "saml:alice",
                "provider": "saml",
            }
            result = provider.authenticate(flask.request)
            assert result is None

    def test_missing_provider_key_returns_none(self, app, provider):
        with app.test_request_context():
            flask.session["df_user"] = {"user_id": "some-id"}
            result = provider.authenticate(flask.request)
            assert result is None
