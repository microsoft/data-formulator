# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Backend delegated OAuth gateway for Azure SQL access tokens."""

from __future__ import annotations

import hmac
import json
import logging
import secrets
import threading
import time
import urllib.parse
from typing import Any

import requests as http
from flask import Blueprint, Response, redirect, request, session

from data_formulator.auth.gateways.oidc_gateway import _get_oidc_config
from data_formulator.auth.identity import get_identity_id
from data_formulator.auth.token_store import TokenStore
from data_formulator.data_connector import _resolve_connector
from data_formulator.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

azure_sql_bp = Blueprint("azure_sql_gateway", __name__, url_prefix="/api/auth/azure-sql")

_SQL_AUDIENCE = "https://database.windows.net/"
_SQL_SCOPES = f"{_SQL_AUDIENCE}.default"
_STATE_NAMESPACE = "_azure_sql_oauth_states"
_STATE_TTL_SECONDS = 10 * 60
_MAX_PENDING_STATES = 8
_STATE_LOCK = threading.Lock()
_PENDING_STATES: dict[str, dict[str, Any]] = {}


def _callback_url() -> str:
    return request.url_root.rstrip("/") + "/api/auth/azure-sql/callback"


def _request_origin() -> str:
    parsed = urllib.parse.urlsplit(request.url_root)
    return f"{parsed.scheme}://{parsed.netloc}"


def _store_state(state: str, record: dict[str, Any]) -> None:
    now = time.time()
    stored = {**record, "created_at": now}
    with _STATE_LOCK:
        expired = [
            key for key, value in _PENDING_STATES.items()
            if now - value.get("created_at", 0) > _STATE_TTL_SECONDS
        ]
        for key in expired:
            _PENDING_STATES.pop(key, None)
        _PENDING_STATES[state] = stored
        while len(_PENDING_STATES) > _MAX_PENDING_STATES:
            oldest = min(_PENDING_STATES, key=lambda key: _PENDING_STATES[key]["created_at"])
            _PENDING_STATES.pop(oldest, None)
    states = session.get(_STATE_NAMESPACE, {})
    if not isinstance(states, dict):
        states = {}
    states[state] = stored
    session[_STATE_NAMESPACE] = states


def _consume_state(state: str | None) -> dict[str, Any] | None:
    if not state:
        return None
    with _STATE_LOCK:
        matched = next((key for key in _PENDING_STATES if hmac.compare_digest(key, state)), None)
        record = _PENDING_STATES.pop(matched, None) if matched is not None else None
    states = session.get(_STATE_NAMESPACE, {})
    if isinstance(states, dict) and matched is not None:
        states.pop(matched, None)
        session[_STATE_NAMESPACE] = states
    created_at = record.get("created_at") if isinstance(record, dict) else None
    if not isinstance(created_at, (int, float)) or time.time() - created_at > _STATE_TTL_SECONDS:
        return None
    return record


def _popup_response(origin: str, authenticated: bool) -> Response:
    payload = json.dumps({"type": "df-sso-auth", "authenticated": authenticated})
    target_origin = json.dumps(origin)
    html = f"""<!doctype html>
<html><body><script>
if (window.opener) {{ window.opener.postMessage({payload}, {target_origin}); }}
window.close();
</script></body></html>"""
    return Response(html, mimetype="text/html")


@azure_sql_bp.route("/login")
def azure_sql_login():
    connector_id = request.args.get("connector_id", "").strip()
    origin = request.args.get("df_origin", "").strip()
    if not connector_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "connector_id is required")
    if origin != _request_origin():
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid return origin")

    connector = _resolve_connector({"connector_id": connector_id})
    auth_config = connector._loader_class.auth_config()
    if auth_config.get("mode") != "delegated" or auth_config.get("audience") != _SQL_AUDIENCE:
        raise AppError(ErrorCode.INVALID_REQUEST, "Connector does not support Azure SQL delegated login")
    identity = get_identity_id()
    config = _get_oidc_config()
    authorize_url = config.get("authorize_url", "")
    client_id = config.get("client_id", "")
    if not authorize_url or not client_id or not config.get("client_secret"):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Microsoft Entra login is not configured")

    state = secrets.token_urlsafe(32)
    _store_state(state, {
        "connector_id": connector_id,
        "identity": identity,
        "origin": origin,
    })
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": _callback_url(),
        "scope": _SQL_SCOPES,
        "state": state,
    }
    return redirect(f"{authorize_url}?{urllib.parse.urlencode(params)}")


@azure_sql_bp.route("/callback")
def azure_sql_callback():
    state_record = _consume_state(request.args.get("state"))
    origin = state_record.get("origin", _request_origin()) if state_record else _request_origin()
    if not state_record or request.args.get("error"):
        return _popup_response(origin, False)
    if state_record.get("identity") != get_identity_id():
        return _popup_response(origin, False)

    code = request.args.get("code", "")
    config = _get_oidc_config()
    token_url = config.get("token_url", "")
    if not code or not token_url:
        return _popup_response(origin, False)

    try:
        response = http.post(token_url, data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _callback_url(),
            "client_id": config.get("client_id", ""),
            "client_secret": config.get("client_secret", ""),
            "scope": _SQL_SCOPES,
        }, timeout=10)
        if not response.ok:
            logger.warning("Azure SQL token exchange failed status=%s", response.status_code)
            return _popup_response(origin, False)
        tokens = response.json()
        access_token = tokens.get("access_token")
        if not access_token:
            return _popup_response(origin, False)
        TokenStore().store_service_token(
            system_id=state_record["connector_id"],
            access_token=access_token,
            refresh_token=None,
            expires_in=tokens.get("expires_in", 3600),
            audience=_SQL_AUDIENCE,
        )
        return _popup_response(origin, True)
    except Exception as exc:
        logger.warning("Azure SQL token exchange failed: %s", type(exc).__name__)
        return _popup_response(origin, False)
