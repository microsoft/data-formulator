# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import urllib.parse
from unittest.mock import Mock, patch

import flask
import pytest

from data_formulator.auth.gateways.kusto_oauth_gateway import kusto_oauth_bp
from data_formulator.error_handler import register_error_handlers


pytestmark = [pytest.mark.backend, pytest.mark.auth]


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("KUSTO_OAUTH_CLIENT_ID", "kusto-client")
    monkeypatch.setenv("KUSTO_OAUTH_TENANT_ID", "test-tenant")
    test_app = flask.Flask(__name__)
    test_app.config["TESTING"] = True
    test_app.secret_key = "test-secret"
    test_app.register_blueprint(kusto_oauth_bp)
    register_error_handlers(test_app)
    return test_app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def kusto_auth_metadata():
    response = Mock(ok=True)
    response.raise_for_status.return_value = None
    response.json.return_value = {
        "AzureAD": {
            "KustoServiceResourceId": "https://kusto.kusto.windows.net",
            "LoginEndpoint": "https://login.microsoftonline.com",
        },
    }
    with patch(
        "data_formulator.auth.gateways.kusto_oauth_gateway.http.get",
        return_value=response,
    ):
        yield


def _start_login(client):
    return client.get(
        "/api/auth/kusto/login",
        query_string={
            "kusto_cluster": "https://help.kusto.windows.net",
            "df_origin": "http://localhost:5173",
        },
    )


def test_login_uses_cluster_scope_and_pkce(client) -> None:
    response = _start_login(client)

    assert response.status_code == 302
    location = urllib.parse.urlparse(response.headers["Location"])
    query = urllib.parse.parse_qs(location.query)
    assert location.netloc == "login.microsoftonline.com"
    assert query["client_id"] == ["kusto-client"]
    assert "https://kusto.kusto.windows.net/.default" in query["scope"][0]
    assert query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"][0]
    with client.session_transaction() as current_session:
        pending = current_session["kusto_oauth_state"][query["state"][0]]
        assert pending["origin"] == "http://localhost:5173"
        assert pending["verifier"]


@pytest.mark.parametrize("cluster", [
    "http://help.kusto.windows.net",
    "https://help.kusto.windows.net/path",
    "https://help.kusto.windows.net.evil.example",
])
def test_login_rejects_untrusted_cluster_urls(client, cluster) -> None:
    response = client.get(
        "/api/auth/kusto/login",
        query_string={
            "kusto_cluster": cluster,
            "df_origin": "http://localhost:5173",
        },
    )

    body = response.get_json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "INVALID_REQUEST"


def test_callback_exchanges_code_and_posts_token_to_opener(client) -> None:
    login_response = _start_login(client)
    query = urllib.parse.parse_qs(
        urllib.parse.urlparse(login_response.headers["Location"]).query,
    )
    state = query["state"][0]
    token_response = Mock(ok=True)
    token_response.json.return_value = {
        "access_token": "kusto-access",
        "refresh_token": "kusto-refresh",
        "expires_in": 1234,
    }

    with patch(
        "data_formulator.auth.gateways.kusto_oauth_gateway.http.post",
        return_value=token_response,
    ) as post:
        response = client.get(
            "/api/auth/kusto/callback",
            query_string={"state": state, "code": "authorization-code"},
        )

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert "kusto-access" in response.get_data(as_text=True)
    token_request = post.call_args.kwargs["data"]
    assert token_request["code"] == "authorization-code"
    assert token_request["code_verifier"]
    assert "client_secret" not in token_request


def test_callback_state_cannot_be_replayed(client) -> None:
    login_response = _start_login(client)
    query = urllib.parse.parse_qs(
        urllib.parse.urlparse(login_response.headers["Location"]).query,
    )
    state = query["state"][0]

    client.get(
        "/api/auth/kusto/callback",
        query_string={"state": state, "error": "access_denied"},
    )
    replay = client.get(
        "/api/auth/kusto/callback",
        query_string={"state": state, "code": "replayed-code"},
    )

    body = replay.get_json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "INVALID_REQUEST"