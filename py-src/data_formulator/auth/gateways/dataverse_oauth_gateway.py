# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Microsoft delegated OAuth flow (Authorization Code + PKCE) for Dataverse connector access."""

from __future__ import annotations

import os
import secrets
import time
import urllib.parse

import requests as http
from flask import Blueprint, Response, request, session

from data_formulator.auth.gateways.kusto_oauth_gateway import _frontend_origin, _pkce_challenge, _popup_response
from data_formulator.data_loader.dataverse_data_loader import (
    discover_environment_auth,
    normalize_environment_url,
    oauth_client_id,
)
from data_formulator.errors import AppError, ErrorCode

dataverse_oauth_bp = Blueprint("dataverse_oauth", __name__, url_prefix="/api/auth/dataverse")

_STATE_KEY = "dataverse_oauth_state"


def _callback_url() -> str:
    return os.environ.get(
        "DATAVERSE_OAUTH_REDIRECT_URI",
        request.url_root.rstrip("/") + "/api/auth/dataverse/callback",
    )


def _scope(resource_scope: str) -> str:
    return f"openid profile offline_access {resource_scope}"


@dataverse_oauth_bp.route("/login")
def dataverse_login():
    """Start sign-in against the tenant that owns the selected environment."""
    if not oauth_client_id():
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Dataverse Microsoft sign-in is not configured")
    try:
        origin_url = normalize_environment_url(request.args.get("environment_url", ""))
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    auth = discover_environment_auth(origin_url)
    tenant = os.environ.get("DATAVERSE_OAUTH_TENANT_ID") or auth.tenant_id or "organizations"
    token_url = f"{auth.login_host}/{tenant}/oauth2/v2.0/token"

    origin = _frontend_origin(request.args.get("df_origin", ""), "DATAVERSE_OAUTH_ALLOWED_ORIGINS")
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
        "scope": auth.scope,
        "token_url": token_url,
        "created_at": time.time(),
    }
    session[_STATE_KEY] = states

    params = {
        "client_id": oauth_client_id(),
        "response_type": "code",
        "redirect_uri": _callback_url(),
        "response_mode": "query",
        "scope": _scope(auth.scope),
        "state": state,
        "code_challenge": _pkce_challenge(verifier),
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    response = Response(status=302)
    response.headers["Location"] = f"{auth.login_host}/{tenant}/oauth2/v2.0/authorize?{urllib.parse.urlencode(params)}"
    return response


@dataverse_oauth_bp.route("/callback")
def dataverse_callback():
    """Exchange the authorization code and hand the tokens to the opener window."""
    state = request.args.get("state", "")
    states = session.get(_STATE_KEY, {})
    pending = states.pop(state, None)
    session[_STATE_KEY] = states
    if not pending or time.time() - pending.get("created_at", 0) > 600:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid or expired Dataverse OAuth state")

    origin = pending["origin"]
    if request.args.get("error"):
        return _popup_response(origin, {"type": "df-sso-auth", "error": "Microsoft sign-in failed"})
    code = request.args.get("code")
    if not code:
        return _popup_response(origin, {"type": "df-sso-auth", "error": "Microsoft did not return an authorization code"})

    token_data = {
        "client_id": oauth_client_id(),
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _callback_url(),
        "scope": _scope(pending["scope"]),
        "code_verifier": pending["verifier"],
    }
    client_secret = os.environ.get("DATAVERSE_OAUTH_CLIENT_SECRET", "")
    if client_secret:
        token_data["client_secret"] = client_secret
    token_response = http.post(pending["token_url"], data=token_data, timeout=15)
    if not token_response.ok:
        return _popup_response(origin, {"type": "df-sso-auth", "error": "Microsoft token exchange failed"})

    tokens = token_response.json()
    return _popup_response(origin, {
        "type": "df-sso-auth",
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token"),
        "expires_in": tokens.get("expires_in", 3600),
    })
