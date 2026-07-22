# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Microsoft delegated OAuth flow for Kusto connector access."""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import re
import secrets
import time
import urllib.parse
from typing import Any

import requests as http
from flask import Blueprint, Response, request, session

from data_formulator.errors import AppError, ErrorCode


kusto_oauth_bp = Blueprint(
    "kusto_oauth", __name__, url_prefix="/api/auth/kusto",
)

_STATE_KEY = "kusto_oauth_state"
_KUSTO_HOST_SUFFIXES = (
    ".kusto.windows.net",
    ".kusto.chinacloudapi.cn",
    ".kusto.usgovcloudapi.net",
)
_LOGIN_HOSTS = {
    "login.microsoftonline.com",
    "login.microsoftonline.us",
    "login.chinacloudapi.cn",
    "login.windows.net",
}


def _oauth_config(authority_host: str | None = None) -> dict[str, str]:
    tenant_id = os.environ.get("KUSTO_OAUTH_TENANT_ID", "organizations")
    if not re.fullmatch(r"[A-Za-z0-9.-]+", tenant_id):
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid Kusto OAuth tenant")
    authority_host = os.environ.get("KUSTO_OAUTH_AUTHORITY_HOST") or authority_host
    authority_host = (authority_host or "https://login.microsoftonline.com").rstrip("/")
    parsed_authority = urllib.parse.urlparse(authority_host)
    if parsed_authority.scheme != "https" or parsed_authority.hostname not in _LOGIN_HOSTS:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid Kusto OAuth authority")
    return {
        "client_id": os.environ.get("KUSTO_OAUTH_CLIENT_ID", ""),
        "client_secret": os.environ.get("KUSTO_OAUTH_CLIENT_SECRET", ""),
        "authorize_url": f"{authority_host}/{tenant_id}/oauth2/v2.0/authorize",
        "token_url": f"{authority_host}/{tenant_id}/oauth2/v2.0/token",
    }


def _callback_url() -> str:
    return os.environ.get(
        "KUSTO_OAUTH_REDIRECT_URI",
        request.url_root.rstrip("/") + "/api/auth/kusto/callback",
    )


def _normalize_cluster(cluster: str) -> str:
    parsed = urllib.parse.urlparse(cluster.strip())
    hostname = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or not hostname.endswith(_KUSTO_HOST_SUFFIXES)
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise AppError(
            ErrorCode.INVALID_REQUEST,
            "Enter a valid HTTPS Azure Data Explorer cluster URL",
        )
    origin = f"https://{hostname}"
    if parsed.port:
        origin += f":{parsed.port}"
    return origin


def _cluster_auth_metadata(cluster: str) -> tuple[str, str]:
    """Return the SDK-compatible resource scope and login endpoint."""
    origin = _normalize_cluster(cluster)
    try:
        response = http.get(
            f"{origin}/v1/rest/auth/metadata",
            allow_redirects=False,
            timeout=10,
        )
        response.raise_for_status()
        azure_ad = response.json()["AzureAD"]
        resource = str(azure_ad["KustoServiceResourceId"]).rstrip("/")
        login_endpoint = str(azure_ad["LoginEndpoint"]).rstrip("/")
        resource_url = urllib.parse.urlparse(resource)
        login_url = urllib.parse.urlparse(login_endpoint)
        if (
            resource_url.scheme != "https"
            or not (resource_url.hostname or "").endswith(_KUSTO_HOST_SUFFIXES)
            or login_url.scheme != "https"
            or login_url.hostname not in _LOGIN_HOSTS
        ):
            raise ValueError("untrusted Kusto authentication metadata")
        return f"{resource}/.default", login_endpoint
    except Exception:
        if origin.endswith(".kusto.windows.net"):
            return "https://kusto.kusto.windows.net/.default", "https://login.microsoftonline.com"
        raise AppError(
            ErrorCode.SERVICE_UNAVAILABLE,
            "Could not discover authentication settings for this Kusto cloud",
        )


def _frontend_origin(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    request_origin = request.url_root.rstrip("/")
    configured = {
        item.strip().rstrip("/")
        for item in os.environ.get("KUSTO_OAUTH_ALLOWED_ORIGINS", "").split(",")
        if item.strip()
    }
    is_local = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    if not parsed.netloc or parsed.path or parsed.params or parsed.query or parsed.fragment:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid Data Formulator origin")
    if origin != request_origin and origin not in configured and not is_local:
        raise AppError(ErrorCode.INVALID_REQUEST, "Data Formulator origin is not allowed")
    return origin


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _popup_response(origin: str, payload: dict[str, Any]) -> Response:
    nonce = secrets.token_urlsafe(16)
    payload_json = json.dumps(payload).replace("<", "\\u003c")
    origin_json = json.dumps(origin).replace("<", "\\u003c")
    body = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Microsoft sign-in</title></head>
<body><p>You can close this window.</p><script nonce="{html.escape(nonce)}">
if (window.opener) {{ window.opener.postMessage({payload_json}, {origin_json}); }}
window.close();
</script></body></html>"""
    response = Response(body, content_type="text/html; charset=utf-8")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = f"default-src 'none'; script-src 'nonce-{nonce}'"
    return response


@kusto_oauth_bp.route("/login")
def kusto_login():
    """Start an Authorization Code + PKCE flow for the selected cluster."""
    scope, login_endpoint = _cluster_auth_metadata(
        request.args.get("kusto_cluster", ""),
    )
    config = _oauth_config(login_endpoint)
    if not config["client_id"]:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Kusto Microsoft sign-in is not configured")

    origin = _frontend_origin(request.args.get("df_origin", ""))
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    states = {
        key: value
        for key, value in session.get(_STATE_KEY, {}).items()
        if time.time() - value.get("created_at", 0) <= 600
    }
    states[state] = {
        "verifier": verifier,
        "origin": origin,
        "scope": scope,
        "token_url": config["token_url"],
        "created_at": time.time(),
    }
    session[_STATE_KEY] = states

    params = {
        "client_id": config["client_id"],
        "response_type": "code",
        "redirect_uri": _callback_url(),
        "response_mode": "query",
        "scope": f"openid profile offline_access {scope}",
        "state": state,
        "code_challenge": _pkce_challenge(verifier),
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    location = f"{config['authorize_url']}?{urllib.parse.urlencode(params)}"
    response = Response(status=302)
    response.headers["Location"] = location
    return response


@kusto_oauth_bp.route("/callback")
def kusto_callback():
    """Exchange the Microsoft authorization code and notify the opener."""
    state = request.args.get("state", "")
    states = session.get(_STATE_KEY, {})
    pending = states.pop(state, None)
    session[_STATE_KEY] = states
    if not pending or time.time() - pending.get("created_at", 0) > 600:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid or expired Kusto OAuth state")

    origin = pending["origin"]
    idp_error = request.args.get("error")
    if idp_error:
        return _popup_response(origin, {
            "type": "df-sso-auth",
            "error": request.args.get("error_description") or idp_error,
        })

    code = request.args.get("code")
    if not code:
        return _popup_response(origin, {
            "type": "df-sso-auth",
            "error": "Microsoft did not return an authorization code",
        })

    config = _oauth_config()
    token_data = {
        "client_id": config["client_id"],
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _callback_url(),
        "scope": f"openid profile offline_access {pending['scope']}",
        "code_verifier": pending["verifier"],
    }
    if config["client_secret"]:
        token_data["client_secret"] = config["client_secret"]
    token_response = http.post(pending["token_url"], data=token_data, timeout=15)
    if not token_response.ok:
        return _popup_response(origin, {
            "type": "df-sso-auth",
            "error": "Microsoft token exchange failed",
        })

    tokens = token_response.json()
    return _popup_response(origin, {
        "type": "df-sso-auth",
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "expires_in": tokens.get("expires_in", 3600),
    })