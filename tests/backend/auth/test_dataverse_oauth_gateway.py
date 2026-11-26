# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from __future__ import annotations

import urllib.parse

import flask
import pytest

from data_formulator.auth.gateways import dataverse_oauth_gateway as gateway
from data_formulator.data_loader.dataverse_data_loader import EnvironmentAuth
from data_formulator.error_handler import register_error_handlers

pytestmark = [pytest.mark.backend, pytest.mark.auth]

_TENANT = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DATAVERSE_OAUTH_CLIENT_ID", "dv-client")
    monkeypatch.setattr(gateway, "discover_environment_auth", lambda origin: EnvironmentAuth(_TENANT, origin))
    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.secret_key = "test-secret"
    app.register_blueprint(gateway.dataverse_oauth_bp)
    register_error_handlers(app)
    return app.test_client()


def test_login_signs_in_to_the_environment_tenant(client) -> None:
    response = client.get("/api/auth/dataverse/login", query_string={
        "environment_url": "contoso.crm.dynamics.com", "df_origin": "http://localhost:5173",
    })

    assert response.status_code == 302
    location = urllib.parse.urlparse(response.headers["Location"])
    query = urllib.parse.parse_qs(location.query)
    assert location.path == f"/{_TENANT}/oauth2/v2.0/authorize"
    assert query["client_id"] == ["dv-client"]
    assert "https://contoso.crm.dynamics.com/.default" in query["scope"][0]
    assert query["code_challenge_method"] == ["S256"]


@pytest.mark.parametrize("url", ["https://169.254.169.254", "https://contoso.crm.dynamics.com.evil.example"])
def test_login_rejects_non_dataverse_hosts(client, url) -> None:
    response = client.get("/api/auth/dataverse/login", query_string={
        "environment_url": url, "df_origin": "http://localhost:5173",
    })

    body = response.get_json()
    assert body["status"] == "error"
    assert body["error"]["code"] == "INVALID_REQUEST"
