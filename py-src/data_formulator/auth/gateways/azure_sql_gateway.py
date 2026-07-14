# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Backend delegated OAuth gateway for Azure SQL access tokens."""

from __future__ import annotations

import hmac
import base64
import hashlib
import itertools
import json
import logging
import os
import secrets
import threading
import time
import urllib.parse
from typing import Any

import requests as http
from azure.identity import ManagedIdentityCredential
from flask import Blueprint, Response, redirect, request, session

from data_formulator.auth.identity import get_identity_id
from data_formulator.auth.token_store import TokenStore
from data_formulator.data_connector import _resolve_connector
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

azure_sql_bp = Blueprint("azure_sql_gateway", __name__, url_prefix="/api/auth/azure-sql")

_SQL_AUDIENCE = "https://database.windows.net/"
_SQL_SCOPES = f"{_SQL_AUDIENCE}.default"
_STATE_NAMESPACE = "_azure_sql_oauth_states"
_STATE_TTL_SECONDS = 10 * 60
_MAX_PENDING_STATES = 8
_STATE_LOCK = threading.Lock()
_STATE_SEQUENCE = itertools.count()
_PENDING_STATES: dict[str, dict[str, Any]] = {}


def _get_azure_sql_entra_config() -> dict[str, str]:
    tenant_id = os.environ.get("AZURE_SQL_ENTRA_TENANT_ID", "").strip()
    client_id = os.environ.get("AZURE_SQL_ENTRA_CLIENT_ID", "").strip()
    client_secret = os.environ.get("AZURE_SQL_ENTRA_CLIENT_SECRET", "").strip()
    managed_identity_client_id = os.environ.get(
        "AZURE_SQL_ENTRA_MANAGED_IDENTITY_CLIENT_ID", ""
    ).strip()
    if not tenant_id or not client_id or not (client_secret or managed_identity_client_id):
        return {}

    authority = f"https://login.microsoftonline.com/{tenant_id}"
    return {
        "authorize_url": f"{authority}/oauth2/v2.0/authorize",
        "token_url": f"{authority}/oauth2/v2.0/token",
        "client_id": client_id,
        "client_secret": client_secret,
        "managed_identity_client_id": managed_identity_client_id,
    }


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _callback_url() -> str:
    return request.url_root.rstrip("/") + "/api/auth/azure-sql/callback"


def _request_origin() -> str:
    parsed = urllib.parse.urlsplit(request.url_root)
    return f"{parsed.scheme}://{parsed.netloc}"


def _store_state(state: str, record: dict[str, Any]) -> None:
    now = time.time()
    with _STATE_LOCK:
        created_order = next(_STATE_SEQUENCE)
    stored = {**record, "created_at": now, "created_order": created_order}
    states = session.get(_STATE_NAMESPACE, {})
    if not isinstance(states, dict):
        states = {}
    removed_session_states = [
        key for key, value in states.items()
        if now - value.get("created_at", 0) > _STATE_TTL_SECONDS
    ]
    for key in removed_session_states:
        states.pop(key, None)
    states[state] = stored
    while len(states) > _MAX_PENDING_STATES:
        oldest = min(
            states,
            key=lambda key: (
                states[key].get("created_at", 0),
                states[key].get("created_order", -1),
            ),
        )
        states.pop(oldest, None)
        removed_session_states.append(oldest)
    session[_STATE_NAMESPACE] = states

    with _STATE_LOCK:
        expired = [
            key for key, value in _PENDING_STATES.items()
            if now - value.get("created_at", 0) > _STATE_TTL_SECONDS
        ]
        for key in {*expired, *removed_session_states}:
            _PENDING_STATES.pop(key, None)
        _PENDING_STATES[state] = stored


def _consume_state(state: str | None) -> dict[str, Any] | None:
    if not state:
        return None
    states = session.get(_STATE_NAMESPACE, {})
    if not isinstance(states, dict):
        return None
    session_match = next((key for key in states if hmac.compare_digest(key, state)), None)
    if session_match is None:
        return None
    states.pop(session_match, None)
    session[_STATE_NAMESPACE] = states
    with _STATE_LOCK:
        matched = next((key for key in _PENDING_STATES if hmac.compare_digest(key, state)), None)
        record = _PENDING_STATES.pop(matched, None) if matched is not None else None
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
    if (
        auth_config.get("mode") != "delegated"
        or auth_config.get("profile") != "azure_sql"
        or auth_config.get("audience") != _SQL_AUDIENCE
    ):
        raise AppError(ErrorCode.INVALID_REQUEST, "Connector does not support Azure SQL delegated login")
    identity = get_identity_id()
    config = _get_azure_sql_entra_config()
    authorize_url = config.get("authorize_url", "")
    client_id = config.get("client_id", "")
    if (
        not authorize_url
        or not client_id
        or not (config.get("client_secret") or config.get("managed_identity_client_id"))
    ):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Microsoft Entra login is not configured")

    state = secrets.token_urlsafe(32)
    code_verifier, code_challenge = _pkce_pair()
    _store_state(state, {
        "connector_id": connector_id,
        "identity": identity,
        "origin": origin,
        "code_verifier": code_verifier,
    })
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": _callback_url(),
        "scope": _SQL_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    target = f"{authorize_url}?{urllib.parse.urlencode(params)}"
    if request.accept_mimetypes.best == "application/json":
        return json_ok({"authorize_url": target})
    return redirect(target)


@azure_sql_bp.route("/callback")
def azure_sql_callback():
    state_record = _consume_state(request.args.get("state"))
    origin = state_record.get("origin", _request_origin()) if state_record else _request_origin()
    if not state_record or request.args.get("error"):
        return _popup_response(origin, False)
    try:
        callback_identity = get_identity_id()
    except ValueError:
        callback_identity = None
    if callback_identity is not None and state_record.get("identity") != callback_identity:
        return _popup_response(origin, False)

    code = request.args.get("code", "")
    config = _get_azure_sql_entra_config()
    token_url = config.get("token_url", "")
    if not code or not token_url:
        return _popup_response(origin, False)

    try:
        token_data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _callback_url(),
            "client_id": config.get("client_id", ""),
            "scope": _SQL_SCOPES,
            "code_verifier": state_record["code_verifier"],
        }
        client_secret = config.get("client_secret", "")
        if client_secret:
            token_data["client_secret"] = client_secret
        else:
            credential = ManagedIdentityCredential(
                client_id=config["managed_identity_client_id"]
            )
            assertion = credential.get_token(
                "api://AzureADTokenExchange/.default"
            ).token
            token_data.update({
                "client_assertion": assertion,
                "client_assertion_type": (
                    "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
                ),
            })

        response = http.post(token_url, data=token_data, timeout=10)
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
