# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Backend OIDC Confidential Client gateway.

When ``AUTH_MODE=backend``, DF acts as a Confidential Client and handles
the full Authorization Code flow server-side.  The browser never sees
``client_secret`` or raw tokens — only a session cookie.

Environment variables:
    OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_AUTHORIZE_URL,
    OIDC_TOKEN_URL, OIDC_USERINFO_URL  (all required for backend mode).
"""

from __future__ import annotations

import logging
import os
import secrets
import urllib.parse

import requests as http
from flask import Blueprint, redirect, request, session, jsonify

from data_formulator.auth.token_store import TokenStore

logger = logging.getLogger(__name__)

oidc_bp = Blueprint("oidc_gateway", __name__, url_prefix="/api/auth/oidc")


def _is_backend_mode() -> bool:
    return os.environ.get("AUTH_MODE", "").lower() == "backend"


def _callback_url() -> str:
    return request.url_root.rstrip("/") + "/api/auth/oidc/callback"


def _fetch_userinfo(access_token: str) -> dict | None:
    url = os.environ.get("OIDC_USERINFO_URL", "")
    if not url:
        return None
    try:
        resp = http.get(url, headers={
            "Authorization": f"Bearer {access_token}",
        }, timeout=10)
        return resp.json() if resp.ok else None
    except Exception:
        return None


@oidc_bp.route("/login")
def oidc_login():
    """Redirect user to SSO authorization page."""
    if not _is_backend_mode():
        return jsonify({"error": "backend OIDC not enabled"}), 400

    state = secrets.token_urlsafe(32)
    session["_oauth_state"] = state

    params = {
        "response_type": "code",
        "client_id": os.environ.get("OIDC_CLIENT_ID", ""),
        "redirect_uri": _callback_url(),
        "scope": "openid profile email offline_access",
        "state": state,
    }
    authorize_url = os.environ.get("OIDC_AUTHORIZE_URL", "")
    if not authorize_url:
        return jsonify({"error": "OIDC_AUTHORIZE_URL not configured"}), 500

    return redirect(f"{authorize_url}?{urllib.parse.urlencode(params)}")


@oidc_bp.route("/callback")
def oidc_callback():
    """Exchange authorization code for tokens."""
    if not _is_backend_mode():
        return jsonify({"error": "backend OIDC not enabled"}), 400

    code = request.args.get("code")
    state = request.args.get("state")

    if not code or state != session.pop("_oauth_state", None):
        return jsonify({"error": "invalid_state"}), 400

    token_url = os.environ.get("OIDC_TOKEN_URL", "")
    if not token_url:
        return jsonify({"error": "OIDC_TOKEN_URL not configured"}), 500

    resp = http.post(token_url, data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _callback_url(),
        "client_id": os.environ.get("OIDC_CLIENT_ID", ""),
        "client_secret": os.environ.get("OIDC_CLIENT_SECRET", ""),
    }, timeout=10)

    if not resp.ok:
        logger.error("OIDC token exchange failed: %s %s",
                      resp.status_code, resp.text[:200])
        return jsonify({"error": "token_exchange_failed"}), 502

    tokens = resp.json()
    token_store = TokenStore()
    user_info = _fetch_userinfo(tokens["access_token"])

    token_store.store_sso_tokens(
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token"),
        expires_in=tokens.get("expires_in", 3600),
        user_info=user_info,
    )

    # Auto-exchange for all sso_exchange systems
    for system_id, config in token_store._all_auth_configs().items():
        if config.get("mode") == "sso_exchange":
            token_store._do_sso_exchange(system_id, config)

    return redirect("/")


@oidc_bp.route("/status")
def oidc_status():
    """Check SSO login status."""
    if not _is_backend_mode():
        return jsonify({"authenticated": False, "mode": "frontend"})

    token_store = TokenStore()
    sso_token = token_store.get_sso_token()
    sso_data = session.get("sso", {})
    if sso_token:
        return jsonify({
            "authenticated": True,
            "user": sso_data.get("user"),
        })
    return jsonify({"authenticated": False})


@oidc_bp.route("/logout", methods=["POST"])
def oidc_logout():
    """Clear all tokens (SSO + all services)."""
    token_store = TokenStore()
    for system_id in list(session.get("service_tokens", {}).keys()):
        token_store.clear_service_token(system_id)
    session.pop("sso", None)
    session.pop("service_tokens", None)
    return jsonify({"status": "ok"})


# ── Token management routes (work in all AUTH_MODE settings) ──────


auth_tokens_bp = Blueprint(
    "auth_tokens", __name__, url_prefix="/api/auth",
)


@auth_tokens_bp.route("/tokens/save", methods=["POST"])
def save_delegated_token():
    """Receive token from frontend popup and store in TokenStore.

    Called after the popup postMessage flow completes.
    """
    data = request.get_json(force=True)
    system_id = data.get("system_id")
    access_token = data.get("access_token")
    if not system_id or not access_token:
        return jsonify({"error": "system_id and access_token required"}), 400

    token_store = TokenStore()
    token_store.store_service_token(
        system_id=system_id,
        access_token=access_token,
        refresh_token=data.get("refresh_token"),
        expires_in=data.get("expires_in", 3600),
        user=data.get("user"),
    )

    if data.get("remember"):
        token_store._vault_store(system_id, {
            "access_token": access_token,
            "refresh_token": data.get("refresh_token"),
        })

    return jsonify({"status": "ok"})


@auth_tokens_bp.route("/service-status", methods=["GET"])
def auth_service_status():
    """Return authorization status for all configured systems.

    Agent calls this before starting analysis.
    Frontend calls this to show connection indicators.
    """
    token_store = TokenStore()
    return jsonify(token_store.get_auth_status())
