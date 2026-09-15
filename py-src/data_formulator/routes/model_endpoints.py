# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Per-user model endpoint history and encrypted account connections."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID
from urllib.parse import urlencode, urlsplit

import requests as http
from filelock import FileLock
from flask import Blueprint, Response, request

from data_formulator.auth.identity import get_identity_id, is_local_mode
from data_formulator.auth.vault import get_credential_vault
from data_formulator.datalake.workspace import get_data_formulator_home, get_user_home
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode


model_endpoints_bp = Blueprint("model_endpoints", __name__, url_prefix="/api/model-endpoints")

_FILENAME = "model_endpoints.json"
_MAX_ENTRIES = 20
_MAX_FIELD_LENGTH = 2048
_FIELDS = ("endpoint", "model", "api_base", "api_version", "auth_mode")
_lock = threading.Lock()
_OPENROUTER_BASE = "https://openrouter.ai/api/v1"
_CONNECTION_KEY = "model-connection:openrouter"
_FLOW_KEY = "model-connection-flow:openrouter"
_FLOW_INDEX = "model-oauth-callbacks"
_FLOW_TTL = 600
_COPILOT_CONNECTION_KEY = "model-connection:github_copilot"
_COPILOT_FLOW_KEY = "model-connection-flow:github_copilot"
_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"
_CHATGPT_CONNECTION_KEY = "model-connection:chatgpt"
_CHATGPT_FLOW_KEY = "model-connection-flow:chatgpt"
_COPILOT_BASES = {"https://api.githubcopilot.com", "https://api.individual.githubcopilot.com",
                  "https://api.business.githubcopilot.com", "https://api.enterprise.githubcopilot.com"}


def _azure_catalog_cli(arguments: list[str]):
    from data_formulator.auth.azure_cli import find_azure_cli

    if not is_local_mode():
        raise AppError(ErrorCode.ACCESS_DENIED, "Azure CLI discovery is only available in local mode.")
    executable = find_azure_cli()
    if not executable:
        raise AppError(ErrorCode.CONNECTOR_ERROR, "Azure CLI was not found. Install it and sign in first.")
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
    try:
        result = subprocess.run(
            [executable, *arguments, "--only-show-errors", "--output", "json"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=45, env=dict(os.environ, AZURE_CORE_NO_COLOR="true"), **options,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Azure discovery timed out or could not start. Retry or enter the endpoint manually.") from None
    if result.returncode:
        error = result.stderr.lower()
        if "authorizationfailed" in error or "forbidden" in error:
            raise AppError(ErrorCode.ACCESS_DENIED, "You do not have permission to list these Azure resources. You can still enter an endpoint manually.")
        if "az login" in error or "interaction_required" in error or "aadsts" in error:
            raise AppError(ErrorCode.AUTH_REQUIRED, "Sign in with Azure CLI for the intended tenant, then retry.")
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Could not list Azure resources. Retry or enter the endpoint manually.")
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Azure CLI returned an invalid discovery response.") from None


@model_endpoints_bp.route("/azure/subscriptions", methods=["POST"])
def list_azure_subscriptions():
    _connection_body()
    account = _azure_catalog_cli(["account", "show"])
    subscriptions = _azure_catalog_cli(["account", "list"])
    if not isinstance(account, dict) or not isinstance(subscriptions, list):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Azure CLI returned an invalid subscription list.")
    return json_ok({"subscriptions": [
        {"id": item["id"], "name": item.get("name") or item["id"]}
        for item in subscriptions if isinstance(item, dict) and item.get("id")
        and item.get("state") == "Enabled" and item.get("tenantId") == account.get("tenantId")
    ], "default_subscription": account.get("id")})


@model_endpoints_bp.route("/azure/kusto-clusters", methods=["POST"])
def list_azure_kusto_clusters():
    body = _connection_body()
    try:
        subscription = str(UUID(body.get("subscription_id", "")))
    except (ValueError, TypeError, AttributeError):
        raise AppError(ErrorCode.INVALID_REQUEST, "Select a valid Azure subscription.") from None
    resource_path = f"/subscriptions/{subscription}/providers/Microsoft.Kusto/clusters"
    url = f"https://management.azure.com{resource_path}?api-version=2024-04-13"
    clusters = []
    seen = set()
    while url:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.netloc != "management.azure.com"
                or parsed.path.lower() != resource_path.lower() or url in seen or len(seen) >= 20):
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Azure cluster discovery returned invalid pagination. Enter a cluster URL manually.")
        seen.add(url)
        result = _azure_catalog_cli(["rest", "--method", "get", "--url", url])
        if not isinstance(result, dict) or not isinstance(result.get("value"), list):
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Azure returned an invalid cluster list.")
        for cluster in result["value"]:
            if not isinstance(cluster, dict):
                continue
            properties = cluster.get("properties") or {}
            if not isinstance(properties, dict):
                continue
            uri = properties.get("uri")
            if not isinstance(uri, str) or not uri.startswith("https://"):
                continue
            cluster_id = cluster.get("id")
            if not isinstance(cluster_id, str):
                continue
            segments = cluster_id.split("/")
            clusters.append({
                "id": cluster_id, "name": cluster.get("name") or uri,
                "uri": uri.rstrip("/"), "region": cluster.get("location") or "",
                "resource_group": segments[4] if len(segments) > 4 else "",
                "state": properties.get("state") or properties.get("provisioningState") or "",
            })
        url = result.get("nextLink")
        if url is not None and not isinstance(url, str):
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Azure returned invalid cluster pagination.")
    return json_ok({"clusters": sorted(clusters, key=lambda item: (item["name"].casefold(), item["id"]))})


@model_endpoints_bp.route("/azure/deployments", methods=["POST"])
def list_azure_deployments():
    body = _connection_body()
    try:
        subscription = str(UUID(body.get("subscription_id", "")))
    except (ValueError, TypeError, AttributeError):
        raise AppError(ErrorCode.INVALID_REQUEST, "Select a valid Azure subscription.") from None
    accounts = _azure_catalog_cli(["cognitiveservices", "account", "list", "--subscription", subscription])
    if not isinstance(accounts, list):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Azure CLI returned an invalid resource list.")
    resources = [account for account in accounts if isinstance(account, dict)
                 and account.get("kind") in ("OpenAI", "AIServices")]

    def discover(account):
        name, group = account.get("name"), account.get("resourceGroup")
        properties = account.get("properties") or {}
        endpoints = properties.get("endpoints") or {}
        candidates = [properties.get("endpoint"), *endpoints.values()]
        endpoint = next((value.rstrip("/") for value in candidates if isinstance(value, str)
                         and urlsplit(value).scheme == "https"
                         and (urlsplit(value).hostname or "").endswith(".openai.azure.com")), None)
        if endpoint is None:
            endpoint = next((value.rstrip("/") for value in candidates if isinstance(value, str)
                             and urlsplit(value).scheme == "https"
                             and (urlsplit(value).hostname or "").endswith(".services.ai.azure.com")), None)
        if not name or not group or not endpoint:
            return [], f"{name or 'Resource'}: no supported public Azure endpoint was found."
        try:
            deployments = _azure_catalog_cli([
                "cognitiveservices", "account", "deployment", "list",
                "--subscription", subscription, "--resource-group", group, "--name", name,
            ])
            if not isinstance(deployments, list):
                raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Invalid deployment list.")
        except AppError as error:
            return [], f"{name}: {error.message}"
        models = []
        for deployment in deployments:
            if not isinstance(deployment, dict):
                continue
            details = deployment.get("properties") or {}
            model = details.get("model") or {}
            if details.get("provisioningState") != "Succeeded" or model.get("format") != "OpenAI" or not deployment.get("name"):
                continue
            models.append({
                "id": deployment.get("id") or f"{account.get('id')}/{deployment['name']}",
                "deployment": deployment["name"], "model": model.get("name") or deployment["name"],
                "resource": name, "resource_group": group, "api_base": endpoint,
                "region": account.get("location", ""),
            })
        return models, None

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(discover, resources))
    return json_ok({
        "models": sorted([model for models, _ in results for model in models], key=lambda model: (model["resource"], model["deployment"])),
        "warnings": [warning for _, warning in results if warning],
    })


def _copilot_get(url: str, token: str) -> dict:
    from litellm.llms.github_copilot.common_utils import get_copilot_default_headers

    try:
        if url.startswith("https://api.github.com/"):
            headers = {
                "accept": "application/json",
                "content-type": "application/json",
                "editor-version": "vscode/1.85.1",
                "editor-plugin-version": "copilot/1.155.0",
                "user-agent": "GithubCopilot/1.155.0",
                "Authorization": "token " + token,
            }
        else:
            headers = get_copilot_default_headers(token)
        response = http.get(url, headers=headers, timeout=20, allow_redirects=False)
        if response.status_code in (401, 403):
            stage = ("Copilot token exchange" if url.endswith("/copilot_internal/v2/token")
                     else "GitHub profile lookup" if url == "https://api.github.com/user" else "Copilot model access")
            raise AppError(ErrorCode.AUTH_EXPIRED,
                           f"{stage} was rejected (HTTP {response.status_code}). "
                           "GitHub sign-in alone does not confirm Copilot access. Check account access and organization policies, then reconnect.")
        if response.status_code != 200:
            raise ValueError("Copilot unavailable")
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("Invalid Copilot response")
        return result
    except (http.RequestException, ValueError):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Could not contact GitHub Copilot. Try again.") from None


def _copilot_credentials(access_token: str) -> dict:
    result = _copilot_get("https://api.github.com/copilot_internal/v2/token", access_token)
    endpoints = result.get("endpoints") or {}
    api_base = endpoints.get("api", "https://api.githubcopilot.com") if isinstance(endpoints, dict) else None
    if (not isinstance(api_base, str) or api_base not in _COPILOT_BASES
            or not isinstance(result.get("token"), str) or not result["token"]
            or not isinstance(result.get("expires_at"), int) or result["expires_at"] <= time.time() + 60):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Invalid GitHub Copilot credentials or unsupported API host.")
    return {"api_key": result["token"], "expires_at": result["expires_at"], "api_base": api_base}


def _resolve_copilot_connection(model_config: dict) -> dict:
    if (model_config.get("connection_id") != "github_copilot" or model_config.get("endpoint") != "github_copilot"
            or any(model_config.get(field) for field in ("api_base", "api_key", "api_version"))):
        raise AppError(ErrorCode.ACCESS_DENIED, "Invalid model connection configuration")
    vault = _connection_vault()
    identity = get_identity_id()
    with _connection_lock():
        stored = vault.retrieve(identity, _COPILOT_CONNECTION_KEY)
    if not stored or not stored.get("access_token"):
        raise AppError(ErrorCode.AUTH_REQUIRED, "Connect GitHub Copilot in Select Model")
    if stored.get("expires_at", 0) <= time.time() + 60:
        credentials = _copilot_credentials(stored["access_token"])
        with _connection_lock():
            current = vault.retrieve(identity, _COPILOT_CONNECTION_KEY)
            if not current or current.get("id") != stored.get("id"):
                raise AppError(ErrorCode.AUTH_REQUIRED, "GitHub Copilot connection changed. Try again.")
            stored.update(credentials)
            vault.store(identity, _COPILOT_CONNECTION_KEY, stored)
    if stored.get("api_base") not in _COPILOT_BASES:
        raise AppError(ErrorCode.ACCESS_DENIED, "Invalid GitHub Copilot API host")
    resolved = {**model_config, "api_key": stored["api_key"], "api_base": stored["api_base"]}
    model = model_config.get("model")
    if model:
        api_types = stored.get("model_api_types", {})
        if model not in api_types:
            _, api_types = _load_copilot_catalog(resolved)
        if model not in api_types:
            raise AppError(ErrorCode.INVALID_REQUEST, "This Copilot model is unavailable or uses an unsupported API. Refresh the model list.")
        resolved["api_type"] = api_types[model]
    return resolved


@model_endpoints_bp.route("/connections/github_copilot/poll", methods=["POST"])
def poll_copilot_connection():
    body = _connection_body()
    vault = _connection_vault()
    identity = get_identity_id()
    with _connection_lock():
        flow = vault.retrieve(identity, _COPILOT_FLOW_KEY)
        if not flow or flow["id"] != body.get("flow_id") or flow["expires_at"] <= time.time():
            raise AppError(ErrorCode.INVALID_REQUEST, "Authorization expired or was cancelled. Start again.")
        if flow["status"] != "pending" or flow["next_poll_at"] > time.time():
            return json_ok({"id": "github_copilot", "flow": {"id": flow["id"], "status": flow["status"]}})
        flow["next_poll_at"] = time.time() + max(flow["interval"], 90)
        flow["poll_id"] = secrets.token_urlsafe(16)
        vault.store(identity, _COPILOT_FLOW_KEY, flow)
    connection = None
    error = None
    try:
        result = _github_auth_request("https://github.com/login/oauth/access_token", {
            "client_id": flow["client_id"], "device_code": flow["device_code"],
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        })
        if result.get("error") == "slow_down":
            flow["interval"] += 5
        elif result.get("error") == "authorization_pending":
            pass
        elif isinstance(result.get("access_token"), str) and result["access_token"]:
            credentials = _copilot_credentials(result["access_token"])
            profile = _copilot_get("https://api.github.com/user", result["access_token"])
            connection = {"id": flow["id"], "access_token": result["access_token"], **credentials,
                          "login": profile.get("login") if isinstance(profile.get("login"), str) else None}
            flow["status"] = "connected"
        else:
            flow["status"] = "error"
    except AppError as caught:
        flow["status"] = "error"
        error = caught
    if flow["status"] != "pending":
        flow.pop("device_code", None)
    flow["next_poll_at"] = time.time() + flow["interval"]
    with _connection_lock():
        current = vault.retrieve(identity, _COPILOT_FLOW_KEY)
        if (not current or current["id"] != flow["id"] or current["expires_at"] <= time.time()
            or current.get("poll_id") != flow["poll_id"]):
            raise AppError(ErrorCode.INVALID_REQUEST, "Authorization was cancelled or expired")
        if connection:
            vault.store(identity, _COPILOT_CONNECTION_KEY, connection)
        vault.store(identity, _COPILOT_FLOW_KEY, flow)
    if error:
        raise error
    return json_ok({"id": "github_copilot", "flow": {"id": flow["id"], "status": flow["status"]}})


def _load_copilot_catalog(config: dict) -> tuple[list[dict], dict[str, str]]:
    result = _copilot_get(config["api_base"] + "/models", config["api_key"])
    if not isinstance(result.get("data"), list):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Could not load GitHub Copilot models. Try again.")
    models = []
    api_types = {}
    for model in result["data"]:
        if not isinstance(model, dict) or not isinstance(model.get("id"), str) or not model["id"]:
            continue
        capabilities = model.get("capabilities") or {}
        supports = capabilities.get("supports") if isinstance(capabilities, dict) else None
        endpoints = model.get("supported_endpoints")
        policy = model.get("policy") or {}
        if (isinstance(supports, dict) and capabilities.get("type") == "chat" and supports.get("tool_calls") is True
                and isinstance(endpoints, list) and any(endpoint in endpoints for endpoint in ("/chat/completions", "/responses"))
                and isinstance(policy, dict) and policy.get("state") != "disabled"):
            models.append({"id": model["id"], "name": model["name"] if isinstance(model.get("name"), str) else model["id"]})
            api_types[model["id"]] = "chat_completions" if "/chat/completions" in endpoints else "responses"
    return models, api_types


@model_endpoints_bp.route("/connections/github_copilot/models", methods=["GET"])
def list_copilot_models():
    config = _resolve_copilot_connection({"endpoint": "github_copilot", "connection_id": "github_copilot"})
    vault = _connection_vault()
    identity = get_identity_id()
    with _connection_lock():
        before = vault.retrieve(identity, _COPILOT_CONNECTION_KEY)
    models, api_types = _load_copilot_catalog(config)
    with _connection_lock():
        stored = vault.retrieve(identity, _COPILOT_CONNECTION_KEY)
        if (not stored or not before or stored.get("id") != before.get("id")
            or before.get("api_key") != config["api_key"]):
            raise AppError(ErrorCode.AUTH_REQUIRED, "GitHub Copilot connection changed. Try again.")
        stored["model_api_types"] = api_types
        vault.store(identity, _COPILOT_CONNECTION_KEY, stored)
    return json_ok({"models": sorted(models, key=lambda model: model["name"].casefold()),
                    "connection": {"login": stored.get("login") if stored else None,
                                   "settings_url": "https://github.com/settings/copilot"}})


def _github_auth_request(url: str, payload: dict) -> dict:
    try:
        response = http.post(url, json=payload, headers={"Accept": "application/json"},
                             timeout=20, allow_redirects=False)
        if response.status_code != 200:
            raise ValueError("GitHub authorization unavailable")
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("Invalid authorization response")
        return result
    except (http.RequestException, ValueError):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Could not contact GitHub. Try again.") from None


@model_endpoints_bp.route("/connections/github_copilot/start", methods=["POST"])
def start_copilot_connection():
    _connection_body()
    identity = get_identity_id()
    vault = _connection_vault()
    flow_id = secrets.token_urlsafe(32)
    client_id = os.environ.get("GITHUB_COPILOT_CLIENT_ID", _COPILOT_CLIENT_ID)
    with _connection_lock():
        vault.store(identity, _COPILOT_FLOW_KEY, {
            "id": flow_id, "status": "starting", "expires_at": time.time() + _FLOW_TTL,
        })
    result = _github_auth_request("https://github.com/login/device/code", {
        "client_id": client_id, "scope": "read:user",
    })
    if (not all(isinstance(result.get(field), str) and result[field]
                for field in ("device_code", "user_code"))
            or result.get("verification_uri") != "https://github.com/login/device"
            or not isinstance(result.get("expires_in"), int)
            or not 0 < result["expires_in"] <= 3600
            or not isinstance(result.get("interval", 5), int)
            or not 0 < result.get("interval", 5) <= 60):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Invalid GitHub authorization response. Try again.")
    interval = max(5, result.get("interval", 5))
    with _connection_lock():
        current = vault.retrieve(identity, _COPILOT_FLOW_KEY)
        if not current or current["id"] != flow_id:
            raise AppError(ErrorCode.INVALID_REQUEST, "Authorization was cancelled")
        vault.store(identity, _COPILOT_FLOW_KEY, {
            "id": flow_id, "client_id": client_id, "status": "pending",
            "device_code": result["device_code"], "user_code": result["user_code"],
            "expires_at": time.time() + result["expires_in"],
            "interval": interval, "next_poll_at": time.time() + interval,
        })
    return json_ok({"flow_id": flow_id, "user_code": result["user_code"],
                    "authorization_url": result["verification_uri"],
                    "expires_in": result["expires_in"], "interval": interval})


@model_endpoints_bp.route("/connections/github_copilot", methods=["GET"])
def copilot_connection_status():
    identity = get_identity_id()
    vault = _connection_vault()
    with _connection_lock():
        flow = vault.retrieve(identity, _COPILOT_FLOW_KEY)
        if flow and flow["expires_at"] <= time.time():
            vault.delete(identity, _COPILOT_FLOW_KEY)
            flow = None
        connected = bool(vault.retrieve(identity, _COPILOT_CONNECTION_KEY))
    return json_ok({"id": "github_copilot", "connected": connected,
                    "flow": {"id": flow["id"], "status": flow["status"]} if flow else None})


@model_endpoints_bp.route("/connections/github_copilot/cancel", methods=["POST"])
def cancel_copilot_connection():
    body = _connection_body()
    vault = _connection_vault()
    identity = get_identity_id()
    with _connection_lock():
        flow = vault.retrieve(identity, _COPILOT_FLOW_KEY)
        if flow and flow["id"] == body.get("flow_id"):
            vault.delete(identity, _COPILOT_FLOW_KEY)
    return json_ok({})


@model_endpoints_bp.route("/connections/github_copilot/disconnect", methods=["POST"])
def disconnect_copilot_connection():
    _connection_body()
    vault = _connection_vault()
    identity = get_identity_id()
    with _connection_lock():
        vault.delete(identity, _COPILOT_FLOW_KEY)
        vault.delete(identity, _COPILOT_CONNECTION_KEY)
    return json_ok({})


def _connection_lock():
    home = get_data_formulator_home()
    home.mkdir(parents=True, exist_ok=True)
    return FileLock(home / ".model-connections.lock", timeout=10)


@model_endpoints_bp.after_request
def protect_model_connection_response(response):
    if "/connections/" in request.path:
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


def _connection_vault():
    vault = get_credential_vault()
    if vault is None:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Secure credential storage is unavailable")
    return vault


def resolve_model_connection(model_config: dict) -> dict:
    if model_config.get("endpoint") == "chatgpt" or model_config.get("connection_id") == "chatgpt":
        return _resolve_chatgpt_connection(model_config)
    if model_config.get("endpoint") == "github_copilot" or model_config.get("connection_id") == "github_copilot":
        return _resolve_copilot_connection(model_config)
    if not model_config.get("connection_id") and model_config.get("auth_mode") != "account":
        return model_config
    if (model_config.get("connection_id") != "openrouter"
            or model_config.get("endpoint") != "openrouter"
            or model_config.get("api_base") not in (None, "", _OPENROUTER_BASE)
            or model_config.get("api_key") or model_config.get("api_version")):
        raise AppError(ErrorCode.ACCESS_DENIED, "Invalid model connection configuration")
    stored = _connection_vault().retrieve(get_identity_id(), _CONNECTION_KEY)
    if not stored or not stored.get("api_key"):
        raise AppError(ErrorCode.AUTH_REQUIRED, "Connect your OpenRouter account in Select Model")
    return {**model_config, "api_key": stored["api_key"], "api_base": _OPENROUTER_BASE}


def _chatgpt_post(url: str, payload: dict, *, form: bool = False, pending: bool = False) -> dict:
    try:
        response = http.post(url, **({"data": payload} if form else {"json": payload}),
                             timeout=20, allow_redirects=False)
        if pending and response.status_code in (403, 404):
            return {}
        if response.status_code in (400, 401, 403):
            raise AppError(ErrorCode.AUTH_REQUIRED, "ChatGPT authorization was rejected. Enable device-code login in ChatGPT settings and reconnect.")
        if response.status_code != 200:
            raise ValueError("Authorization unavailable")
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("Invalid response")
        return result
    except (http.RequestException, ValueError):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Could not contact ChatGPT. Try again.") from None


def _chatgpt_tokens(result: dict, previous: dict | None = None) -> dict:
    from litellm.llms.chatgpt.authenticator import Authenticator

    if not isinstance(result.get("access_token"), str) or not result["access_token"]:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Invalid ChatGPT credentials")
    parser = object.__new__(Authenticator)
    record = parser._build_auth_record({**(previous or {}), **result})
    if (not record.get("refresh_token") or not record.get("account_id")
            or not isinstance(record.get("expires_at"), (int, float))
            or record["expires_at"] <= time.time() + 60):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Invalid ChatGPT credentials")
    return record


def _chatgpt_connection_details(stored: dict) -> dict:
    from litellm.llms.chatgpt.authenticator import Authenticator

    claims = object.__new__(Authenticator)._decode_jwt_claims(stored.get("id_token") or "")
    claims = claims if isinstance(claims, dict) else {}
    account_label = next((value.strip() for value in (
        claims.get("email"), claims.get("name"), stored.get("account_id"),
    ) if isinstance(value, str) and value.strip()), None)
    return {"settings_url": "https://chatgpt.com/#settings", "account_label": account_label}


def _resolve_chatgpt_connection(model_config: dict) -> dict:
    from litellm.llms.chatgpt.common_utils import CHATGPT_CLIENT_ID, CHATGPT_OAUTH_TOKEN_URL

    if (model_config.get("endpoint") != "chatgpt" or model_config.get("connection_id") != "chatgpt"
            or any(model_config.get(field) for field in ("api_base", "api_key", "api_version"))):
        raise AppError(ErrorCode.ACCESS_DENIED, "Invalid model connection configuration")
    with _connection_lock():
        vault = _connection_vault()
        identity = get_identity_id()
        stored = vault.retrieve(identity, _CHATGPT_CONNECTION_KEY)
        if not stored:
            raise AppError(ErrorCode.AUTH_REQUIRED, "Connect ChatGPT in Select Model")
        if stored.get("expires_at", 0) <= time.time() + 60:
            tokens = _chatgpt_post(CHATGPT_OAUTH_TOKEN_URL, {
                "client_id": CHATGPT_CLIENT_ID, "grant_type": "refresh_token",
                "refresh_token": stored["refresh_token"],
            }, form=True)
            stored.update(_chatgpt_tokens(tokens, stored))
            vault.store(identity, _CHATGPT_CONNECTION_KEY, stored)
    return {**model_config, "api_key": stored["access_token"],
            "chatgpt_account_id": stored["account_id"], "api_type": "responses"}


@model_endpoints_bp.route("/connections/chatgpt/start", methods=["POST"])
def start_chatgpt_connection():
    from litellm.llms.chatgpt.common_utils import CHATGPT_CLIENT_ID, CHATGPT_DEVICE_CODE_URL, CHATGPT_DEVICE_VERIFY_URL

    _connection_body()
    vault, identity = _connection_vault(), get_identity_id()
    flow_id = secrets.token_urlsafe(32)
    with _connection_lock():
        vault.store(identity, _CHATGPT_FLOW_KEY, {"id": flow_id, "status": "starting", "expires_at": time.time() + 900})
    result = _chatgpt_post(CHATGPT_DEVICE_CODE_URL, {"client_id": CHATGPT_CLIENT_ID})
    user_code = result.get("user_code") or result.get("usercode")
    try:
        interval = max(5, min(60, int(result.get("interval") or 5)))
    except (ValueError, TypeError):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Invalid ChatGPT authorization response") from None
    if not all(isinstance(value, str) and value for value in (user_code, result.get("device_auth_id"))):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Invalid ChatGPT authorization response")
    with _connection_lock():
        current = vault.retrieve(identity, _CHATGPT_FLOW_KEY)
        if not current or current["id"] != flow_id:
            raise AppError(ErrorCode.INVALID_REQUEST, "Authorization was cancelled")
        vault.store(identity, _CHATGPT_FLOW_KEY, {
            "id": flow_id, "status": "pending", "device_auth_id": result["device_auth_id"],
            "user_code": user_code, "expires_at": time.time() + 900,
            "interval": interval, "next_poll_at": time.time() + interval,
        })
    return json_ok({"flow_id": flow_id, "user_code": user_code, "authorization_url": CHATGPT_DEVICE_VERIFY_URL,
                    "expires_in": 900, "interval": interval})


@model_endpoints_bp.route("/connections/chatgpt/poll", methods=["POST"])
def poll_chatgpt_connection():
    from litellm.llms.chatgpt.common_utils import CHATGPT_AUTH_BASE, CHATGPT_CLIENT_ID, CHATGPT_DEVICE_TOKEN_URL, CHATGPT_OAUTH_TOKEN_URL

    body = _connection_body()
    vault, identity = _connection_vault(), get_identity_id()
    with _connection_lock():
        flow = vault.retrieve(identity, _CHATGPT_FLOW_KEY)
        if not flow or flow["id"] != body.get("flow_id") or flow["expires_at"] <= time.time():
            raise AppError(ErrorCode.INVALID_REQUEST, "Authorization expired or was cancelled. Start again.")
        if flow["status"] != "pending" or flow["next_poll_at"] > time.time():
            return json_ok({"flow": {"id": flow["id"], "status": flow["status"]}})
        flow["next_poll_at"] = time.time() + 90
        flow["poll_id"] = secrets.token_urlsafe(16)
        vault.store(identity, _CHATGPT_FLOW_KEY, flow)
    connection = None
    error = None
    try:
        code = _chatgpt_post(CHATGPT_DEVICE_TOKEN_URL, {
            "device_auth_id": flow["device_auth_id"], "user_code": flow["user_code"],
        }, pending=True)
        if code:
            if not all(isinstance(code.get(field), str) and code[field] for field in ("authorization_code", "code_verifier")):
                raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Invalid ChatGPT authorization response")
            tokens = _chatgpt_post(CHATGPT_OAUTH_TOKEN_URL, {
                "grant_type": "authorization_code", "code": code["authorization_code"],
                "redirect_uri": CHATGPT_AUTH_BASE + "/deviceauth/callback",
                "client_id": CHATGPT_CLIENT_ID, "code_verifier": code["code_verifier"],
            }, form=True)
            connection = {"id": flow["id"], **_chatgpt_tokens(tokens)}
            flow["status"] = "connected"
    except AppError as caught:
        flow["status"] = "error"
        error = caught
    flow["next_poll_at"] = time.time() + flow["interval"]
    if flow["status"] != "pending":
        flow.pop("device_auth_id", None)
        flow.pop("user_code", None)
    with _connection_lock():
        current = vault.retrieve(identity, _CHATGPT_FLOW_KEY)
        if (not current or current["id"] != flow["id"] or current["expires_at"] <= time.time()
                or current.get("poll_id") != flow["poll_id"]):
            raise AppError(ErrorCode.INVALID_REQUEST, "Authorization was cancelled or expired")
        if connection:
            vault.store(identity, _CHATGPT_CONNECTION_KEY, connection)
        vault.store(identity, _CHATGPT_FLOW_KEY, flow)
    if error:
        raise error
    return json_ok({"flow": {"id": flow["id"], "status": flow["status"]}})


@model_endpoints_bp.route("/connections/chatgpt", methods=["GET"])
def chatgpt_connection_status():
    vault, identity = _connection_vault(), get_identity_id()
    with _connection_lock():
        flow = vault.retrieve(identity, _CHATGPT_FLOW_KEY)
        if flow and flow["expires_at"] <= time.time():
            vault.delete(identity, _CHATGPT_FLOW_KEY)
            flow = None
        stored = vault.retrieve(identity, _CHATGPT_CONNECTION_KEY)
    return json_ok({"id": "chatgpt", "connected": bool(stored),
                    "connection": _chatgpt_connection_details(stored) if stored else None,
                    "flow": {"id": flow["id"], "status": flow["status"]} if flow else None})


@model_endpoints_bp.route("/connections/chatgpt/cancel", methods=["POST"])
def cancel_chatgpt_connection():
    body = _connection_body()
    vault, identity = _connection_vault(), get_identity_id()
    with _connection_lock():
        flow = vault.retrieve(identity, _CHATGPT_FLOW_KEY)
        if flow and flow["id"] == body.get("flow_id"):
            vault.delete(identity, _CHATGPT_FLOW_KEY)
    return json_ok({})


@model_endpoints_bp.route("/connections/chatgpt/models", methods=["GET"])
def list_chatgpt_models():
    from data_formulator.agents.chatgpt_transport import (
        CHATGPT_API_BASE, CHATGPT_CLIENT_VERSION, get_account_chatgpt_headers,
    )

    config = _resolve_chatgpt_connection({"endpoint": "chatgpt", "connection_id": "chatgpt"})
    try:
        response = http.get(CHATGPT_API_BASE + "/models", params={"client_version": CHATGPT_CLIENT_VERSION},
                            headers={**get_account_chatgpt_headers(config["api_key"], config["chatgpt_account_id"]),
                                     "accept": "application/json"},
                            timeout=20, allow_redirects=False)
        if response.status_code in (401, 403):
            raise AppError(ErrorCode.AUTH_REQUIRED, "ChatGPT model access was rejected. Check subscription access and reconnect.")
        if response.status_code != 200:
            raise ValueError("Catalog unavailable")
        result = response.json()
        if not isinstance(result, dict) or not isinstance(result.get("models"), list):
            raise ValueError("Invalid catalog")
        valid_models = [model for model in result["models"] if isinstance(model, dict)
                and isinstance(model.get("slug"), str) and model["slug"]]
        picker_models = [model for model in valid_models if model.get("visibility", "list") == "list"]
        models = [{"id": model["slug"], "name": model.get("display_name") or model["slug"]}
              for model in picker_models]
        if not models:
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Could not load ChatGPT models. Try again.")
    except (http.RequestException, ValueError):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Could not load ChatGPT models. Try again.") from None
    with _connection_lock():
        stored = _connection_vault().retrieve(get_identity_id(), _CHATGPT_CONNECTION_KEY) or {}
    return json_ok({"models": models, "connection": _chatgpt_connection_details(stored)})


@model_endpoints_bp.route("/connections/chatgpt/disconnect", methods=["POST"])
def disconnect_chatgpt_connection():
    _connection_body()
    with _connection_lock():
        vault, identity = _connection_vault(), get_identity_id()
        vault.delete(identity, _CHATGPT_FLOW_KEY)
        vault.delete(identity, _CHATGPT_CONNECTION_KEY)
    return json_ok({})


def _connection_body() -> dict:
    if not request.is_json or request.headers.get("X-Model-Connection") != "1":
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid model connection request")
    body = request.get_json()
    if not isinstance(body, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid model connection request")
    return body


def _callback_origin(value: str) -> str:
    parsed = urlsplit(value)
    configured = {origin.strip().rstrip("/") for origin in os.environ.get(
        "MODEL_CONNECTION_ALLOWED_ORIGINS", ""
    ).split(",") if origin.strip()}
    local = is_local_mode() and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (parsed.username or parsed.password or not parsed.netloc
            or parsed.path or parsed.query or parsed.fragment
            or (parsed.scheme != "https" and not (local and parsed.scheme == "http"))
            or (value != request.host_url.rstrip("/") and value not in configured and not local)):
        raise AppError(ErrorCode.ACCESS_DENIED, "Data Formulator callback origin is not allowed")
    return value


def _clear_connection_flow(vault, identity: str) -> None:
    flow = vault.retrieve(identity, _FLOW_KEY)
    if flow:
        vault.delete(_FLOW_INDEX, flow["id"])
    vault.delete(identity, _FLOW_KEY)


@model_endpoints_bp.route("/connections/openrouter/start", methods=["POST"])
def start_openrouter_connection():
    body = _connection_body()
    origin = _callback_origin(str(body.get("origin", "")))
    identity = get_identity_id()
    vault = _connection_vault()
    verifier = secrets.token_urlsafe(48)
    flow_id = secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    with _connection_lock():
        _clear_connection_flow(vault, identity)
        vault.store(identity, _FLOW_KEY, {
            "id": flow_id, "verifier": verifier,
            "expires_at": time.time() + _FLOW_TTL, "status": "pending",
        })
        vault.store(_FLOW_INDEX, flow_id, {"identity": identity})
    callback = origin + "/api/model-endpoints/connections/openrouter/callback?" + urlencode({"state": flow_id})
    return json_ok({
        "flow_id": flow_id,
        "authorization_url": "https://openrouter.ai/auth?" + urlencode({
            "callback_url": callback, "code_challenge": challenge, "code_challenge_method": "S256",
        }),
        "expires_in": _FLOW_TTL,
    })


@model_endpoints_bp.route("/connections/openrouter/callback", methods=["GET"])
def openrouter_connection_callback():
    vault = _connection_vault()
    flow_id = request.args.get("state", "")
    with _connection_lock():
        index = vault.retrieve(_FLOW_INDEX, flow_id) if flow_id else None
        identity = index.get("identity") if index else None
        flow = vault.retrieve(identity, _FLOW_KEY) if identity else None
        if not flow or flow["id"] != flow_id or flow["expires_at"] < time.time() or flow["status"] != "pending":
            raise AppError(ErrorCode.INVALID_REQUEST, "Authorization expired or was cancelled. Start again in Select Model.")
        verifier = flow.pop("verifier")
        flow["status"] = "exchanging"
        vault.store(identity, _FLOW_KEY, flow)
        vault.delete(_FLOW_INDEX, flow_id)
    api_key = None
    try:
        code = request.args.get("code", "")
        if not code or len(code) > 4096:
            raise ValueError("Missing authorization code")
        response = http.post(
            _OPENROUTER_BASE + "/auth/keys",
            json={"code": code, "code_verifier": verifier, "code_challenge_method": "S256"},
            timeout=30, allow_redirects=False,
        )
        if response.status_code != 200:
            raise ValueError("Authorization failed")
        api_key = response.json().get("key")
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("Missing authorization key")
    except (http.RequestException, ValueError, AttributeError):
        api_key = None
    with _connection_lock():
        current = vault.retrieve(identity, _FLOW_KEY)
        if not current or current["id"] != flow_id or current["expires_at"] < time.time():
            raise AppError(ErrorCode.INVALID_REQUEST, "Authorization was cancelled")
        if api_key:
            vault.store(identity, _CONNECTION_KEY, {"api_key": api_key})
        flow["status"] = "connected" if api_key else "error"
        vault.store(identity, _FLOW_KEY, flow)
    message = "OpenRouter connected. Returning to Data Formulator..." if api_key else "OpenRouter authorization failed. Return to Select Model and try again."
    nonce = secrets.token_urlsafe(16)
    channel_name = json.dumps(f"df-model-auth:{flow_id}").replace("<", "\\u003c")
    script = f"""
history.replaceState(null, '', location.pathname);
try {{
    const channel = new BroadcastChannel({channel_name});
    channel.postMessage({{type: 'complete'}});
    channel.close();
}} catch {{}}
if ({json.dumps(bool(api_key))}) window.close();
"""
    return Response(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        '<title>OpenRouter</title></head><body><p>' + message + '</p>'
        '<a href="/">Return to Data Formulator</a>'
        f'<script nonce="{nonce}">{script}</script></body></html>',
        content_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                 "Content-Security-Policy": f"default-src 'none'; script-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'"},
    )


@model_endpoints_bp.route("/connections/openrouter", methods=["GET"])
def openrouter_connection_status():
    identity = get_identity_id()
    vault = _connection_vault()
    with _connection_lock():
        flow = vault.retrieve(identity, _FLOW_KEY)
        if flow and flow["expires_at"] < time.time():
            _clear_connection_flow(vault, identity)
            flow = None
        connected = bool(vault.retrieve(identity, _CONNECTION_KEY))
    return json_ok({
        "id": "openrouter", "provider": "openrouter", "connected": connected,
        "flow": {"id": flow["id"], "status": flow["status"]} if flow else None,
    })


@model_endpoints_bp.route("/connections/openrouter/cancel", methods=["POST"])
def cancel_openrouter_connection():
    body = _connection_body()
    identity = get_identity_id()
    vault = _connection_vault()
    with _connection_lock():
        flow = vault.retrieve(identity, _FLOW_KEY)
        if flow and flow["id"] == body.get("flow_id"):
            _clear_connection_flow(vault, identity)
    return json_ok({})


@model_endpoints_bp.route("/connections/openrouter/disconnect", methods=["POST"])
def disconnect_openrouter_connection():
    _connection_body()
    identity = get_identity_id()
    vault = _connection_vault()
    with _connection_lock():
        _clear_connection_flow(vault, identity)
        vault.delete(identity, _CONNECTION_KEY)
    return json_ok({})


@model_endpoints_bp.route("/connections/openrouter/models", methods=["GET"])
def list_openrouter_models():
    config = resolve_model_connection({"endpoint": "openrouter", "connection_id": "openrouter"})
    try:
        key_response = http.get(
            _OPENROUTER_BASE + "/key",
            headers={"Authorization": "Bearer " + config["api_key"]},
            timeout=20, allow_redirects=False,
        )
        if key_response.status_code in (401, 403):
            raise AppError(ErrorCode.AUTH_EXPIRED, "OpenRouter authorization is no longer valid. Connect again.")
        if key_response.status_code != 200:
            raise ValueError("Account verification failed")
        key_info = key_response.json()["data"]
        creator_id = key_info.get("creator_user_id")
        connection = {
            "creator_user_id": creator_id if isinstance(creator_id, str) else None,
            "settings_url": "https://openrouter.ai/keys/" + hashlib.sha256(config["api_key"].encode()).hexdigest(),
        }
        response = http.get(
            _OPENROUTER_BASE + "/models",
            headers={"Authorization": "Bearer " + config["api_key"]},
            params={"supported_parameters": "tools", "output_modalities": "text"},
            timeout=20, allow_redirects=False,
        )
        if response.status_code in (401, 403):
            raise AppError(ErrorCode.AUTH_EXPIRED, "OpenRouter authorization is no longer valid. Connect again.")
        if response.status_code != 200:
            raise ValueError("Model discovery failed")
        models = [{"id": model["id"], "name": model.get("name", model["id"])}
                  for model in response.json()["data"]
                  if "tools" in (model.get("supported_parameters") or [])
                  and "text" in (model.get("architecture", {}).get("output_modalities") or [])]
    except (http.RequestException, ValueError, KeyError, TypeError, AttributeError):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Could not load OpenRouter models. Try again.") from None
    return json_ok({"models": sorted(models, key=lambda model: model["name"].casefold()), "connection": connection})


def _history_path(identity_id: str) -> Path:
    return get_user_home(identity_id) / _FILENAME


def _sanitize_entry(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid model endpoint configuration")
    entry = {field: str(value.get(field) or "").strip() for field in _FIELDS}
    if not entry["endpoint"] or not entry["model"]:
        raise AppError(ErrorCode.INVALID_REQUEST, "Provider and model are required")
    if any(len(field_value) > _MAX_FIELD_LENGTH for field_value in entry.values()):
        raise AppError(ErrorCode.INVALID_REQUEST, "Model endpoint configuration is too long")
    return entry


def _read_history(path: Path) -> list[dict[str, str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    if not isinstance(data, list):
        return []
    result: list[dict[str, str]] = []
    for item in data:
        try:
            result.append(_sanitize_entry(item))
        except AppError:
            continue
    return result[:_MAX_ENTRIES]


def _write_history(path: Path, entries: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=f".{_FILENAME}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(entries, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


@model_endpoints_bp.route("", methods=["GET"])
def list_model_endpoints():
    with _lock:
        entries = _read_history(_history_path(get_identity_id()))
    return json_ok(entries)


@model_endpoints_bp.route("", methods=["POST"])
def remember_model_endpoint():
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")
    entry = _sanitize_entry(request.get_json())
    path = _history_path(get_identity_id())
    with _lock:
        entries = _read_history(path)
        entries = [existing for existing in entries if existing != entry]
        entries.insert(0, entry)
        entries = entries[:_MAX_ENTRIES]
        _write_history(path, entries)
    return json_ok(entry)