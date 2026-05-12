"""Contract tests for non-OIDC OAuth providers.

GitHub's normal web login is OAuth2 rather than OIDC, so it gets a separate
contract test instead of sharing the OIDC discovery/JWKS fixtures.
"""
from __future__ import annotations

import urllib.parse
from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.auth.gateways.github_gateway import github_bp

from .provider_fixtures import GITHUB_OAUTH_CONTRACT

pytestmark = [pytest.mark.backend, pytest.mark.auth]


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("GITHUB_CLIENT_ID", "github-contract-client")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "github-contract-secret")
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"
    _app.register_blueprint(github_bp)
    from data_formulator.error_handler import register_error_handlers

    register_error_handlers(_app)
    return _app


class TestGitHubOAuthContract:
    def test_login_redirect_matches_github_oauth_contract(self, app):
        resp = app.test_client().get("/api/auth/github/login")

        assert resp.status_code == 302
        parsed = urllib.parse.urlparse(resp.headers["Location"])
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == (
            GITHUB_OAUTH_CONTRACT["authorize_url"]
        )

        query = urllib.parse.parse_qs(parsed.query)
        assert query["client_id"] == ["github-contract-client"]
        assert query["scope"] == [GITHUB_OAUTH_CONTRACT["scope"]]
        assert query["redirect_uri"][0].endswith("/api/auth/github/callback")
        assert query["state"][0]

        with app.test_client() as client:
            client.get("/api/auth/github/login")
            with client.session_transaction() as sess:
                assert sess["_github_oauth_state"]

    def test_callback_exchanges_code_and_stores_github_session(self, app):
        token_resp = MagicMock()
        token_resp.ok = True
        token_resp.json.return_value = {
            "access_token": GITHUB_OAUTH_CONTRACT["access_token"],
            "token_type": "bearer",
            "scope": GITHUB_OAUTH_CONTRACT["scope"],
        }
        user_resp = MagicMock()
        user_resp.ok = True
        user_resp.json.return_value = GITHUB_OAUTH_CONTRACT["user"]

        client = app.test_client()
        with client.session_transaction() as sess:
            sess["_github_oauth_state"] = "github-state"
        with patch(
            "data_formulator.auth.gateways.github_gateway.http_requests.post",
            return_value=token_resp,
        ) as post, patch(
            "data_formulator.auth.gateways.github_gateway.http_requests.get",
            return_value=user_resp,
        ) as get:
            resp = client.get(
                "/api/auth/github/callback?code=github-code&state=github-state",
            )

        assert resp.status_code == 302
        assert resp.headers["Location"].endswith("/")
        assert post.call_args[0][0] == GITHUB_OAUTH_CONTRACT["token_url"]
        assert get.call_args[0][0] == GITHUB_OAUTH_CONTRACT["user_url"]

        with client.session_transaction() as sess:
            user = sess["df_user"]
            assert user["provider"] == "github"
            assert user["user_id"] == "github:12345678"
            assert user["display_name"] == "The Octocat"
            assert user["email"] == "octocat@github.example"
            assert user["raw_token"] == GITHUB_OAUTH_CONTRACT["access_token"]

    def test_callback_fetches_primary_email_when_github_user_email_is_private(
        self,
        app,
    ):
        token_resp = MagicMock()
        token_resp.ok = True
        token_resp.json.return_value = {
            "access_token": GITHUB_OAUTH_CONTRACT["access_token"],
            "token_type": "bearer",
            "scope": GITHUB_OAUTH_CONTRACT["scope"],
        }
        user_resp = MagicMock()
        user_resp.ok = True
        user_resp.json.return_value = {
            **GITHUB_OAUTH_CONTRACT["user"],
            "email": None,
        }
        email_resp = MagicMock()
        email_resp.ok = True
        email_resp.json.return_value = [
            {
                "email": "secondary@github.example",
                "primary": False,
                "verified": True,
                "visibility": None,
            },
            {
                "email": "primary@github.example",
                "primary": True,
                "verified": True,
                "visibility": "private",
            },
        ]

        client = app.test_client()
        with client.session_transaction() as sess:
            sess["_github_oauth_state"] = "github-state"
        with patch(
            "data_formulator.auth.gateways.github_gateway.http_requests.post",
            return_value=token_resp,
        ), patch(
            "data_formulator.auth.gateways.github_gateway.http_requests.get",
            side_effect=[user_resp, email_resp],
        ) as get:
            resp = client.get(
                "/api/auth/github/callback?code=github-code&state=github-state",
            )

        assert resp.status_code == 302
        assert get.call_args_list[0][0][0] == GITHUB_OAUTH_CONTRACT["user_url"]
        assert get.call_args_list[1][0][0] == GITHUB_OAUTH_CONTRACT["emails_url"]
        with client.session_transaction() as sess:
            assert sess["df_user"]["email"] == "primary@github.example"

    def test_callback_rejects_invalid_github_oauth_state(self, app):
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["_github_oauth_state"] = "expected-state"

        resp = client.get(
            "/api/auth/github/callback?code=github-code&state=wrong-state",
        )

        assert resp.status_code == 302
        assert "auth_error=invalid_state" in resp.headers["Location"]

    def test_callback_rejects_missing_github_access_token(self, app):
        token_resp = MagicMock()
        token_resp.ok = True
        token_resp.json.return_value = {"error": "bad_verification_code"}

        client = app.test_client()
        with client.session_transaction() as sess:
            sess["_github_oauth_state"] = "github-state"
        with patch(
            "data_formulator.auth.gateways.github_gateway.http_requests.post",
            return_value=token_resp,
        ):
            resp = client.get(
                "/api/auth/github/callback?code=bad-code&state=github-state",
            )

        assert resp.status_code == 302
        assert "auth_error=missing_access_token" in resp.headers["Location"]
