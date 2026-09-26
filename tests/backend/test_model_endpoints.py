from __future__ import annotations

import json
import copy
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import pytest
from flask import Flask

from data_formulator.error_handler import register_error_handlers
from data_formulator.routes import model_endpoints


pytestmark = [pytest.mark.backend]


@pytest.fixture
def connection_api(monkeypatch, tmp_path):
    app = Flask(__name__)
    register_error_handlers(app)
    app.register_blueprint(model_endpoints.model_endpoints_bp)
    identity = ["user:alice"]
    stored = {}
    vault = Mock()
    vault.store.side_effect = lambda owner, key, value: stored.__setitem__((owner, key), copy.deepcopy(value))
    vault.retrieve.side_effect = lambda owner, key: copy.deepcopy(stored.get((owner, key)))
    vault.delete.side_effect = lambda owner, key: stored.pop((owner, key), None)
    monkeypatch.setattr(model_endpoints, "get_credential_vault", lambda: vault)
    monkeypatch.setattr(model_endpoints, "get_identity_id", lambda: identity[0])
    monkeypatch.setattr(model_endpoints, "is_local_mode", lambda: True)
    monkeypatch.setattr(model_endpoints, "get_data_formulator_home", lambda: tmp_path)
    return app.test_client(), identity, stored


def test_kusto_cluster_discovery_uses_explicit_subscription(connection_api, monkeypatch):
    client, _, _ = connection_api
    subscription = "00000000-0000-0000-0000-000000000001"
    resource_path = f"/subscriptions/{subscription}/providers/Microsoft.Kusto/clusters"
    next_url = f"https://management.azure.com{resource_path}?api-version=2024-04-13&$skiptoken=next"
    cli = Mock(side_effect=[
        {"value": [{"id": f"/subscriptions/{subscription}/resourceGroups/research/providers/Microsoft.Kusto/clusters/demo",
                    "name": "demo", "location": "westus", "properties": {
                        "uri": "https://demo.westus.kusto.windows.net/", "state": "Running",
                    }}], "nextLink": next_url},
        {"value": []},
    ])
    monkeypatch.setattr(model_endpoints, "_azure_catalog_cli", cli)
    response = client.post("/api/model-endpoints/azure/kusto-clusters",
                           json={"subscription_id": subscription}, headers={"X-Model-Connection": "1"})
    assert response.status_code == 200
    cluster = response.get_json()["data"]["clusters"][0]
    assert cluster["uri"] == "https://demo.westus.kusto.windows.net"
    assert cluster["resource_group"] == "research"
    assert cli.call_count == 2
    assert cli.call_args_list[0].args[0] == [
        "rest", "--method", "get", "--url", f"https://management.azure.com{resource_path}?api-version=2024-04-13",
    ]
    assert cli.call_args_list[1].args[0][-1] == next_url


def test_kusto_cluster_discovery_rejects_invalid_subscription(connection_api, monkeypatch):
    client, _, _ = connection_api
    cli = Mock()
    monkeypatch.setattr(model_endpoints, "_azure_catalog_cli", cli)
    response = client.post("/api/model-endpoints/azure/kusto-clusters",
                           json={"subscription_id": "not-a-subscription"}, headers={"X-Model-Connection": "1"})
    assert response.status_code == 400
    cli.assert_not_called()


def test_kusto_cluster_discovery_rejects_external_pagination(connection_api, monkeypatch):
    client, _, _ = connection_api
    cli = Mock(return_value={"value": [], "nextLink": "https://example.com/next"})
    monkeypatch.setattr(model_endpoints, "_azure_catalog_cli", cli)
    response = client.post("/api/model-endpoints/azure/kusto-clusters",
                           json={"subscription_id": "00000000-0000-0000-0000-000000000001"},
                           headers={"X-Model-Connection": "1"})
    assert response.status_code >= 400
    assert cli.call_count == 1


@pytest.mark.parametrize("url", ["https://api.github.com/copilot_internal/v2/token", "https://api.github.com/user"])
def test_copilot_github_requests_use_auth_headers(monkeypatch, url):
    get = Mock(return_value=Mock(status_code=200, json=lambda: {"ok": True}))
    monkeypatch.setattr(model_endpoints.http, "get", get)
    assert model_endpoints._copilot_get(url, "private-oauth") == {"ok": True}
    headers = get.call_args.kwargs["headers"]
    assert headers["Authorization"] == "token private-oauth"
    assert headers["accept"] == "application/json"
    assert headers["editor-plugin-version"] == "copilot/1.155.0"
    assert "x-github-api-version" not in headers
    assert "copilot-integration-id" not in headers
    assert get.call_args.kwargs["allow_redirects"] is False


@pytest.mark.parametrize("status_code", [401, 403])
def test_copilot_exchange_denial_identifies_stage_without_leaking_response(monkeypatch, status_code):
    monkeypatch.setattr(model_endpoints.http, "get", Mock(return_value=Mock(
        status_code=status_code, text="private-token", json=lambda: {"message": "private-token"})))
    with pytest.raises(model_endpoints.AppError) as caught:
        model_endpoints._copilot_credentials("private-oauth")
    assert "Copilot token exchange" in str(caught.value)
    assert f"HTTP {status_code}" in str(caught.value)
    assert "private-" not in str(caught.value)


def test_chatgpt_login_refresh_catalog_and_disconnect_are_private(connection_api, monkeypatch):
    import base64

    client, identity, stored = connection_api
    base = "/api/model-endpoints/connections/chatgpt"
    headers = {"X-Model-Connection": "1"}
    clock = [1000]
    monkeypatch.setattr(model_endpoints.time, "time", lambda: clock[0])

    def token(expiry):
        claims = {"exp": expiry, "https://api.openai.com/auth": {"chatgpt_account_id": "alice"}}
        return "header." + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=") + ".signature"

    post = Mock(side_effect=[
        Mock(status_code=200, json=lambda: {"device_auth_id": "private-device", "user_code": "ABCD-1234", "interval": "5"}),
        Mock(status_code=403),
        Mock(status_code=200, json=lambda: {"authorization_code": "private-code", "code_verifier": "private-verifier"}),
        Mock(status_code=200, json=lambda: {"access_token": token(1400), "id_token": token(1400), "refresh_token": "private-refresh"}),
        Mock(status_code=200, json=lambda: {"access_token": token(2400), "id_token": token(2400), "refresh_token": "private-rotated"}),
    ])
    monkeypatch.setattr(model_endpoints.http, "post", post)
    assert client.post(base + "/start", json={}).get_json()["error"]["code"] == "INVALID_REQUEST"
    response = client.post(base + "/start", json={}, headers=headers)
    started = response.get_json()["data"]
    assert started["authorization_url"] == "https://auth.openai.com/codex/device"
    assert "private-device" not in response.get_data(as_text=True)
    assert response.headers["Cache-Control"] == "no-store"
    body = {"flow_id": started["flow_id"]}
    assert client.post(base + "/poll", json=body, headers=headers).get_json()["data"]["flow"]["status"] == "pending"
    assert post.call_count == 1
    clock[0] += 5
    assert client.post(base + "/poll", json=body, headers=headers).get_json()["data"]["flow"]["status"] == "pending"
    identity[0] = "user:bob"
    assert client.get(base).get_json()["data"]["flow"] is None
    assert client.post(base + "/poll", json=body, headers=headers).get_json()["error"]["code"] == "INVALID_REQUEST"
    identity[0] = "user:alice"
    clock[0] += 5
    response = client.post(base + "/poll", json=body, headers=headers)
    assert response.get_json()["data"]["flow"]["status"] == "connected"
    assert "private-" not in response.get_data(as_text=True)
    clock[0] = 1380
    get = Mock(return_value=Mock(status_code=200, json=lambda: {"models": [
        {"slug": "gpt-5.4", "display_name": "GPT-5.4", "visibility": "list"},
        {"slug": "hidden", "visibility": "hide"},
    ]}))
    monkeypatch.setattr(model_endpoints.http, "get", get)
    catalog = client.get(base + "/models").get_json()["data"]
    assert catalog["models"] == [{"id": "gpt-5.4", "name": "GPT-5.4"}]
    assert stored[(identity[0], model_endpoints._CHATGPT_CONNECTION_KEY)]["refresh_token"] == "private-rotated"
    assert post.call_args.kwargs["data"]["refresh_token"] == "private-refresh"
    with client.application.test_request_context():
        from data_formulator.routes.agents import get_client

        config = {"endpoint": "chatgpt", "connection_id": "chatgpt", "model": "gpt-5.4"}
        agent_client = get_client(config)
        assert agent_client.api_type == "responses"
        assert agent_client.params["api_key"] == token(2400)
        assert "api_key" not in config
        with pytest.raises(model_endpoints.AppError):
            model_endpoints.resolve_model_connection({"endpoint": "chatgpt", "connection_id": "chatgpt", "api_base": "https://other.invalid"})
    client.post(base + "/disconnect", json={}, headers=headers)
    assert client.get(base).get_json()["data"]["connected"] is False
    assert (identity[0], model_endpoints._CHATGPT_CONNECTION_KEY) not in stored


def test_chatgpt_cancel_during_exchange_cannot_restore_connection(connection_api, monkeypatch):
    client, identity, stored = connection_api
    base = "/api/model-endpoints/connections/chatgpt"
    stored[(identity[0], model_endpoints._CHATGPT_FLOW_KEY)] = {
        "id": "flow", "status": "pending", "expires_at": model_endpoints.time.time() + 900,
        "next_poll_at": 0, "interval": 5, "device_auth_id": "private-device", "user_code": "code",
    }

    def respond(url, **kwargs):
        if url.endswith("/oauth/token"):
            client.post(base + "/cancel", json={"flow_id": "flow"}, headers={"X-Model-Connection": "1"})
            return Mock(status_code=200, json=lambda: {"access_token": "private-access"})
        return Mock(status_code=200, json=lambda: {"authorization_code": "code", "code_verifier": "verifier"})

    monkeypatch.setattr(model_endpoints.http, "post", respond)
    monkeypatch.setattr(model_endpoints, "_chatgpt_tokens", lambda result: result)
    response = client.post(base + "/poll", json={"flow_id": "flow"}, headers={"X-Model-Connection": "1"})
    assert response.get_json()["error"]["code"] == "INVALID_REQUEST"
    assert (identity[0], model_endpoints._CHATGPT_CONNECTION_KEY) not in stored
    assert client.get(base).get_json()["data"]["flow"] is None


def test_copilot_device_start_is_private_scoped_and_cancellable(connection_api, monkeypatch):
    client, identity, stored = connection_api
    monkeypatch.setattr(model_endpoints.http, "post", Mock(return_value=Mock(status_code=200, json=lambda: {
        "device_code": "private-device-code", "user_code": "ABCD-1234",
        "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 5,
    })))
    base = "/api/model-endpoints/connections/github_copilot"
    assert client.post(base + "/start", json={}).get_json()["error"]["code"] == "INVALID_REQUEST"
    response = client.post(base + "/start", json={}, headers={"X-Model-Connection": "1"})
    started = response.get_json()["data"]
    assert started["user_code"] == "ABCD-1234"
    assert "private-device-code" not in response.get_data(as_text=True)
    assert response.headers["Cache-Control"] == "no-store"
    assert stored[(identity[0], model_endpoints._COPILOT_FLOW_KEY)]["device_code"] == "private-device-code"
    identity[0] = "user:bob"
    assert client.get(base).get_json()["data"]["flow"] is None
    client.post(base + "/cancel", json={"flow_id": started["flow_id"]}, headers={"X-Model-Connection": "1"})
    identity[0] = "user:alice"
    assert client.get(base).get_json()["data"]["flow"]["status"] == "pending"
    client.post(base + "/cancel", json={"flow_id": started["flow_id"]}, headers={"X-Model-Connection": "1"})
    assert client.get(base).get_json()["data"]["flow"] is None


def test_copilot_poll_refresh_and_catalog_are_scoped(connection_api, monkeypatch):
    client, identity, stored = connection_api
    base = "/api/model-endpoints/connections/github_copilot"
    headers = {"X-Model-Connection": "1"}
    clock = [1000]
    monkeypatch.setattr(model_endpoints.time, "time", lambda: clock[0])
    post = Mock(side_effect=[Mock(status_code=200, json=lambda: {
        "device_code": "private-device", "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device",
        "expires_in": 900, "interval": 5,
    }), Mock(status_code=200, json=lambda: {"error": "slow_down"}),
        Mock(status_code=200, json=lambda: {"access_token": "private-oauth"})])
    monkeypatch.setattr(model_endpoints.http, "post", post)
    get = Mock(side_effect=[Mock(status_code=200, json=lambda: {
        "token": "private-copilot", "expires_at": 1400, "endpoints": {"api": "https://api.githubcopilot.com"},
    }), Mock(status_code=200, json=lambda: {"login": "alice"})])
    monkeypatch.setattr(model_endpoints.http, "get", get)
    flow_id = client.post(base + "/start", json={}, headers=headers).get_json()["data"]["flow_id"]
    body = {"flow_id": flow_id}
    assert client.post(base + "/poll", json=body, headers=headers).get_json()["data"]["flow"]["status"] == "pending"
    assert post.call_count == 1
    clock[0] += 5
    client.post(base + "/poll", json=body, headers=headers)
    assert stored[(identity[0], model_endpoints._COPILOT_FLOW_KEY)]["interval"] == 10
    clock[0] += 5
    client.post(base + "/poll", json=body, headers=headers)
    assert post.call_count == 2
    clock[0] += 5
    response = client.post(base + "/poll", json=body, headers=headers)
    assert response.get_json()["data"]["flow"]["status"] == "connected"
    assert "private-" not in response.get_data(as_text=True)
    assert "device_code" not in stored[(identity[0], model_endpoints._COPILOT_FLOW_KEY)]
    config = {"endpoint": "github_copilot", "connection_id": "github_copilot", "model": "gpt-4.1"}
    stored[(identity[0], model_endpoints._COPILOT_CONNECTION_KEY)]["model_api_types"] = {"gpt-4.1": "chat_completions"}
    assert model_endpoints.resolve_model_connection(config)["api_key"] == "private-copilot"
    for override in [{"api_base": "https://evil.example"}, {"api_key": "key"}, {"connection_id": "openrouter"}]:
        with pytest.raises(model_endpoints.AppError):
            model_endpoints.resolve_model_connection({**config, **override})
    identity[0] = "user:bob"
    with pytest.raises(model_endpoints.AppError):
        model_endpoints.resolve_model_connection(config)
    identity[0] = "user:alice"
    clock[0] = 1400
    get.side_effect = None
    get.return_value = Mock(status_code=200, json=lambda: {"token": "renewed", "expires_at": 2000})
    assert model_endpoints.resolve_model_connection(config)["api_key"] == "renewed"
    compatible = {"id": "gpt-4.1", "name": "GPT 4.1", "capabilities": {"type": "chat", "supports": {"tool_calls": True}},
                  "supported_endpoints": ["/chat/completions"]}
    get.return_value = Mock(status_code=200, json=lambda: {"data": [compatible,
        {**compatible, "id": "claude-test", "supported_endpoints": ["/v1/messages"]},
        {**compatible, "id": "codex", "name": "Codex", "supported_endpoints": ["/responses"]},
        {**compatible, "id": "blocked", "policy": {"state": "disabled"}}]})
    catalog = client.get(base + "/models").get_json()["data"]
    assert catalog["models"] == [{"id": "codex", "name": "Codex"}, {"id": "gpt-4.1", "name": "GPT 4.1"}]
    assert model_endpoints.resolve_model_connection({**config, "model": "codex", "api_type": "chat_completions"})["api_type"] == "responses"
    assert model_endpoints.resolve_model_connection({**config, "api_type": "responses"})["api_type"] == "chat_completions"
    with pytest.raises(model_endpoints.AppError):
        model_endpoints.resolve_model_connection({**config, "model": "claude-test"})
    assert catalog["connection"]["login"] == "alice"
    assert "private-" not in json.dumps(catalog)
    client.post(base + "/disconnect", json={}, headers=headers)
    assert client.get(base).get_json()["data"]["connected"] is False


@pytest.mark.parametrize("action", ["cancel", "expire", "denied", "untrusted_host"])
def test_copilot_failed_exchange_never_stores_credentials(connection_api, monkeypatch, action):
    client, identity, stored = connection_api
    base = "/api/model-endpoints/connections/github_copilot"
    headers = {"X-Model-Connection": "1"}
    stored[(identity[0], model_endpoints._COPILOT_FLOW_KEY)] = {
        "id": "flow", "device_code": "private-device", "client_id": "client", "status": "pending",
        "interval": 5, "next_poll_at": 0, "expires_at": model_endpoints.time.time() + 600,
    }
    def exchange(*args, **kwargs):
        if action == "cancel":
            client.post(base + "/cancel", json={"flow_id": "flow"}, headers=headers)
        elif action == "expire":
            stored[(identity[0], model_endpoints._COPILOT_FLOW_KEY)]["expires_at"] = 0
        return Mock(status_code=200, json=lambda: {"access_token": "private-oauth"})
    monkeypatch.setattr(model_endpoints.http, "post", exchange)
    monkeypatch.setattr(model_endpoints.http, "get", Mock(return_value=Mock(
        status_code=403 if action == "denied" else 200, json=lambda: {
            "token": "private-copilot", "expires_at": model_endpoints.time.time() + 3600,
            "endpoints": {"api": "https://evil.example" if action == "untrusted_host" else "https://api.githubcopilot.com"},
        })))
    response = client.post(base + "/poll", json={"flow_id": "flow"}, headers=headers)
    assert "error" in response.get_json()
    assert "private-" not in response.get_data(as_text=True)
    assert (identity[0], model_endpoints._COPILOT_CONNECTION_KEY) not in stored


def start_connection(client):
    response = client.post("/api/model-endpoints/connections/openrouter/start",
                           json={"origin": "http://localhost"}, headers={"X-Model-Connection": "1"})
    assert response.status_code == 200
    return response.get_json()["data"]


def test_openrouter_pkce_callback_stores_key_only_in_vault(connection_api, monkeypatch):
    client, identity, stored = connection_api
    started = start_connection(client)
    query = parse_qs(urlsplit(started["authorization_url"]).query)
    assert query["code_challenge_method"] == ["S256"]
    flow = stored[(identity[0], model_endpoints._FLOW_KEY)]
    assert flow["verifier"] not in json.dumps(started)
    assert query["code_challenge"] == [model_endpoints.base64.urlsafe_b64encode(
        model_endpoints.hashlib.sha256(flow["verifier"].encode()).digest()).rstrip(b"=").decode()]
    exchange = Mock(return_value=Mock(status_code=200, json=lambda: {"key": "private-key"}))
    monkeypatch.setattr(model_endpoints.http, "post", exchange)
    callback = query["callback_url"][0] + "&code=one-use-code"
    identity[0] = "user:bob"
    response = client.get(callback)
    assert response.status_code == 200
    assert ("user:bob", model_endpoints._CONNECTION_KEY) not in stored
    identity[0] = "user:alice"
    assert "private-key" not in response.get_data(as_text=True)
    body = response.get_data(as_text=True)
    assert "one-use-code" not in body
    assert flow["verifier"] not in body
    assert f'new BroadcastChannel("df-model-auth:{started["flow_id"]}")' in body
    assert "history.replaceState(null, '', location.pathname)" in body
    assert "if (true) window.close()" in body
    assert 'href="/">Return to Data Formulator</a>' in body
    assert "opener" not in body
    nonce = body.split('<script nonce="', 1)[1].split('"', 1)[0]
    assert f"script-src 'nonce-{nonce}'" in response.headers["Content-Security-Policy"]
    assert "'unsafe-inline'" not in response.headers["Content-Security-Policy"]
    exchange.assert_called_once_with(model_endpoints._OPENROUTER_BASE + "/auth/keys",
        json={"code": "one-use-code", "code_verifier": flow["verifier"], "code_challenge_method": "S256"},
        timeout=30, allow_redirects=False)
    assert client.get(callback).get_json()["error"]["code"] == "INVALID_REQUEST"
    public = client.get("/api/model-endpoints/connections/openrouter").get_json()["data"]
    assert public["connected"] is True
    assert "private-key" not in json.dumps(public)
    assert "verifier" not in stored[(identity[0], model_endpoints._FLOW_KEY)]
    identity[0] = "user:bob"
    assert client.get("/api/model-endpoints/connections/openrouter").get_json()["data"]["connected"] is False


@pytest.mark.parametrize("action", ["cancel", "expire", "restart"])
def test_openrouter_invalidated_flow_cannot_exchange(connection_api, monkeypatch, action):
    client, identity, stored = connection_api
    started = start_connection(client)
    if action == "cancel":
        client.post("/api/model-endpoints/connections/openrouter/cancel", json={"flow_id": started["flow_id"]},
                    headers={"X-Model-Connection": "1"})
    elif action == "expire":
        stored[(identity[0], model_endpoints._FLOW_KEY)]["expires_at"] = 0
    else:
        start_connection(client)
    exchange = Mock()
    monkeypatch.setattr(model_endpoints.http, "post", exchange)
    assert client.get("/api/model-endpoints/connections/openrouter/callback",
                      query_string={"state": started["flow_id"], "code": "code"}).get_json()["error"]["code"] == "INVALID_REQUEST"
    exchange.assert_not_called()


def test_openrouter_failure_is_sanitized_and_can_retry(connection_api, monkeypatch):
    client, identity, stored = connection_api
    started = start_connection(client)
    monkeypatch.setattr(model_endpoints.http, "post", Mock(side_effect=model_endpoints.http.RequestException("private-key")))
    response = client.get("/api/model-endpoints/connections/openrouter/callback",
                          query_string={"state": started["flow_id"], "code": "code"})
    assert "private-key" not in response.get_data(as_text=True)
    assert "if (false) window.close()" in response.get_data(as_text=True)
    assert stored[(identity[0], model_endpoints._FLOW_KEY)]["status"] == "error"
    assert start_connection(client)["flow_id"] != started["flow_id"]


def test_openrouter_requires_explicit_json_request_and_trusted_callback(connection_api):
    client, _, _ = connection_api
    assert client.post("/api/model-endpoints/connections/openrouter/start", json={"origin": "http://localhost"}).get_json()["error"]["code"] == "INVALID_REQUEST"
    for origin in ["https://evil.example", "http://localhost/path", "http://user@localhost", "javascript://localhost"]:
        assert client.post("/api/model-endpoints/connections/openrouter/start", json={"origin": origin},
                           headers={"X-Model-Connection": "1"}).get_json()["error"]["code"] == "ACCESS_DENIED"


def test_openrouter_resolution_is_identity_scoped_and_pins_destination(connection_api):
    _, identity, stored = connection_api
    stored[(identity[0], model_endpoints._CONNECTION_KEY)] = {"api_key": "private-key"}
    config = {"connection_id": "openrouter", "endpoint": "openrouter", "model": "openai/gpt-4o"}
    resolved = model_endpoints.resolve_model_connection(config)
    assert resolved["api_key"] == "private-key"
    assert resolved["api_base"] == model_endpoints._OPENROUTER_BASE
    assert "api_key" not in config
    for override in [{"endpoint": "openai"}, {"api_base": "https://evil.example"}, {"connection_id": "other"}]:
        with pytest.raises(model_endpoints.AppError):
            model_endpoints.resolve_model_connection({**config, **override})
    identity[0] = "user:bob"
    with pytest.raises(model_endpoints.AppError):
        model_endpoints.resolve_model_connection(config)


def test_openrouter_cancel_during_exchange_does_not_store_credentials(connection_api, monkeypatch):
    client, identity, stored = connection_api
    started = start_connection(client)

    def exchange(*args, **kwargs):
        client.post("/api/model-endpoints/connections/openrouter/cancel",
                    json={"flow_id": started["flow_id"]}, headers={"X-Model-Connection": "1"})
        return Mock(status_code=200, json=lambda: {"key": "private-key"})

    monkeypatch.setattr(model_endpoints.http, "post", exchange)
    response = client.get("/api/model-endpoints/connections/openrouter/callback",
                          query_string={"state": started["flow_id"], "code": "code"})
    assert response.get_json()["error"]["code"] == "INVALID_REQUEST"
    assert (identity[0], model_endpoints._CONNECTION_KEY) not in stored


@pytest.mark.parametrize("response_status, expected_error", [(401, "AUTH_EXPIRED"), (403, "AUTH_EXPIRED"), (500, "SERVICE_UNAVAILABLE")])
def test_openrouter_account_failure_preserves_stored_key(connection_api, monkeypatch, response_status, expected_error):
    client, identity, stored = connection_api
    stored[(identity[0], model_endpoints._CONNECTION_KEY)] = {"api_key": "private-key"}
    request_model = Mock(return_value=Mock(status_code=response_status))
    monkeypatch.setattr(model_endpoints.http, "get", request_model)
    response = client.get("/api/model-endpoints/connections/openrouter/models")
    assert response.get_json()["error"]["code"] == expected_error
    assert "private-key" not in response.get_data(as_text=True)
    assert (identity[0], model_endpoints._CONNECTION_KEY) in stored
    assert response.headers["Cache-Control"] == "no-store"
    assert request_model.call_count == 1


def test_account_models_reach_existing_agent_client_without_mutating_public_config(connection_api, monkeypatch):
    from data_formulator.routes.agents import get_client

    _, identity, stored = connection_api
    monkeypatch.delenv("DF_ALLOWED_API_BASES", raising=False)
    stored[(identity[0], model_endpoints._CONNECTION_KEY)] = {"api_key": "private-key"}
    config = {"id": "my-model", "endpoint": "openrouter", "model": "openai/test-model",
              "connection_id": "openrouter", "auth_mode": "account"}
    client = get_client(config)
    assert client.model == "openrouter/openai/test-model"
    assert client.params["api_key"] == "private-key"
    assert client.params["api_base"] == model_endpoints._OPENROUTER_BASE
    assert "api_key" not in config
    monkeypatch.setenv("DF_ALLOWED_API_BASES", "https://api.openai.com/*")
    with pytest.raises(model_endpoints.AppError, match="allowlist"):
        get_client(config)
    with pytest.raises(model_endpoints.AppError):
        get_client({**config, "connection_id": None})


@pytest.mark.parametrize("creator_id", ["user_alice", None])
def test_openrouter_discovery_filters_tools_and_disconnect_removes_only_current_account(connection_api, monkeypatch, creator_id):
    client, identity, stored = connection_api
    stored[(identity[0], model_endpoints._CONNECTION_KEY)] = {"api_key": "private-key"}
    stored[("user:bob", model_endpoints._CONNECTION_KEY)] = {"api_key": "other-key"}
    monkeypatch.setattr(model_endpoints.http, "get", Mock(side_effect=[
        Mock(status_code=200, json=lambda: {"data": {"creator_user_id": creator_id, "label": "private-label"}}),
        Mock(status_code=200, json=lambda: {"data": [
        {"id": "compatible", "name": "Compatible", "supported_parameters": ["tools"], "architecture": {"output_modalities": ["text"]}},
        {"id": "no-tools", "supported_parameters": [], "architecture": {"output_modalities": ["text"]}},
    ]})]))
    response = client.get("/api/model-endpoints/connections/openrouter/models")
    assert response.get_json()["data"] == {
        "models": [{"id": "compatible", "name": "Compatible"}],
        "connection": {"creator_user_id": creator_id,
                       "settings_url": "https://openrouter.ai/keys/" + model_endpoints.hashlib.sha256(b"private-key").hexdigest()},
    }
    assert "private-key" not in response.get_data(as_text=True)
    assert "private-label" not in response.get_data(as_text=True)
    client.post("/api/model-endpoints/connections/openrouter/disconnect", json={}, headers={"X-Model-Connection": "1"})
    assert (identity[0], model_endpoints._CONNECTION_KEY) not in stored
    assert ("user:bob", model_endpoints._CONNECTION_KEY) in stored


def test_sanitize_entry_keeps_only_non_secret_fields():
    entry = model_endpoints._sanitize_entry({
        "endpoint": "azure",
        "model": "gpt-5",
        "api_base": "https://example.openai.azure.com",
        "api_version": "preview",
        "auth_mode": "azure_identity",
        "api_key": "must-not-be-stored",
        "access_token": "also-secret",
    })

    assert entry == {
        "endpoint": "azure",
        "model": "gpt-5",
        "api_base": "https://example.openai.azure.com",
        "api_version": "preview",
        "auth_mode": "azure_identity",
    }


def test_history_round_trip_and_deduplication(tmp_path):
    path = tmp_path / "model_endpoints.json"
    first = model_endpoints._sanitize_entry({"endpoint": "openai", "model": "gpt-5"})
    second = model_endpoints._sanitize_entry({"endpoint": "azure", "model": "deployment"})

    model_endpoints._write_history(path, [second, first, second])

    assert model_endpoints._read_history(path) == [second, first, second]
    assert "api_key" not in path.read_text(encoding="utf-8")


def test_invalid_history_is_treated_as_empty(tmp_path):
    path = tmp_path / "model_endpoints.json"
    path.write_text("not-json", encoding="utf-8")

    assert model_endpoints._read_history(path) == []


def test_history_file_contains_no_unrecognized_fields(tmp_path):
    path = tmp_path / "model_endpoints.json"
    entry = model_endpoints._sanitize_entry({
        "endpoint": "ollama",
        "model": "llama3",
        "api_base": "http://localhost:11434",
        "api_key": "secret",
    })
    model_endpoints._write_history(path, [entry])

    stored = json.loads(path.read_text(encoding="utf-8"))
    assert set(stored[0]) == set(model_endpoints._FIELDS)
    assert "secret" not in path.read_text(encoding="utf-8")


def test_api_isolates_history_by_identity_and_drops_keys(tmp_path, monkeypatch):
    app = Flask(__name__)
    register_error_handlers(app)
    app.register_blueprint(model_endpoints.model_endpoints_bp)
    current_identity = ["user:alice"]
    monkeypatch.setattr(model_endpoints, "get_identity_id", lambda: current_identity[0])
    monkeypatch.setattr(
        model_endpoints,
        "_history_path",
        lambda identity: tmp_path / identity.replace(":", "_") / "model_endpoints.json",
    )
    client = app.test_client()

    response = client.post("/api/model-endpoints", json={
        "endpoint": "azure",
        "model": "sales-deployment",
        "api_base": "https://example.openai.azure.com",
        "api_key": "never-write-this",
    })
    assert response.get_json()["status"] == "success"
    assert "never-write-this" not in (tmp_path / "user_alice" / "model_endpoints.json").read_text()

    current_identity[0] = "user:bob"
    assert client.get("/api/model-endpoints").get_json()["data"] == []

    current_identity[0] = "user:alice"
    entries = client.get("/api/model-endpoints").get_json()["data"]
    assert entries[0]["model"] == "sales-deployment"
    assert "api_key" not in entries[0]