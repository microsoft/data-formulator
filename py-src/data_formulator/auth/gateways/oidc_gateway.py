# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Backend OIDC Confidential Client gateway.

When ``OIDC_CLIENT_SECRET`` is set (or ``AUTH_MODE=backend`` is forced),
DF acts as a Confidential Client and handles the full Authorization Code
flow server-side.  The browser never sees ``client_secret`` or raw
tokens — only a session cookie.

Endpoint URLs are resolved from ``OIDCProvider.get_resolved_config()``,
which supports auto-discovery via ``.well-known/openid-configuration``.
Manual ``OIDC_*_URL`` env vars are NOT required when the SSO server
exposes a standard discovery endpoint.

Callback URL (``/auth/callback``) is shared with the frontend PKCE flow
so that only one redirect URI needs to be registered in the IdP.
"""

from __future__ import annotations

import logging
import secrets
import urllib.parse

import requests as http
from flask import Blueprint, Response, redirect, request, session, jsonify

from data_formulator.auth.providers.oidc import is_backend_oidc_mode
from data_formulator.auth.token_store import TokenStore

logger = logging.getLogger(__name__)

# Backend OIDC routes (login / status / logout).
oidc_bp = Blueprint("oidc_gateway", __name__, url_prefix="/api/auth/oidc")

# Callback at /auth/callback — registered separately so the path is shared
# with the frontend PKCE flow and only one redirect URI is needed in the IdP.
oidc_callback_bp = Blueprint("oidc_callback", __name__)


def _get_oidc_config() -> dict[str, str]:
    """Return resolved OIDC config from the active OIDCProvider.

    The provider runs auto-discovery during ``on_configure()``, so endpoint
    URLs are available even when the ``OIDC_*_URL`` env vars are not set.
    """
    from data_formulator.auth.identity import get_active_provider
    provider = get_active_provider()
    if provider and hasattr(provider, "get_resolved_config"):
        return provider.get_resolved_config()
    return {}


def _callback_url() -> str:
    return request.url_root.rstrip("/") + "/auth/callback"


def _fetch_userinfo(access_token: str, userinfo_url: str) -> dict | None:
    if not userinfo_url:
        return None
    try:
        resp = http.get(userinfo_url, headers={
            "Authorization": f"Bearer {access_token}",
        }, timeout=10)
        return resp.json() if resp.ok else None
    except Exception:
        return None


@oidc_bp.route("/login")
def oidc_login():
    """Redirect user to SSO authorization page."""
    if not is_backend_oidc_mode():
        return jsonify({"error": "backend OIDC not enabled"}), 400

    cfg = _get_oidc_config()
    authorize_url = cfg.get("authorize_url", "")
    client_id = cfg.get("client_id", "")

    if not authorize_url:
        return jsonify({"error": "OIDC authorize endpoint not available (discovery failed and OIDC_AUTHORIZE_URL not set)"}), 500

    state = secrets.token_urlsafe(32)
    session["_oauth_state"] = state

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": _callback_url(),
        "scope": "openid profile email offline_access",
        "state": state,
    }

    return redirect(f"{authorize_url}?{urllib.parse.urlencode(params)}")


def _error_redirect(code: str) -> Response:
    """Redirect to the SPA root with an ``auth_error`` query param.

    This lets the frontend display a translated, user-friendly message
    instead of showing raw JSON to end-users.
    """
    return redirect(f"/?auth_error={urllib.parse.quote(code)}")


@oidc_callback_bp.route("/auth/callback")
def oidc_callback():
    """Exchange authorization code for tokens (backend confidential flow)."""
    if not is_backend_oidc_mode():
        return jsonify({"error": "backend OIDC not enabled"}), 400

    code = request.args.get("code")
    state = request.args.get("state")

    if not code or state != session.pop("_oauth_state", None):
        logger.warning("OIDC callback: invalid or missing state")
        return _error_redirect("invalid_state")

    cfg = _get_oidc_config()
    token_url = cfg.get("token_url", "")
    if not token_url:
        logger.error("OIDC token endpoint not available (discovery failed and OIDC_TOKEN_URL not set)")
        return _error_redirect("missing_token_endpoint")

    resp = http.post(token_url, data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _callback_url(),
        "client_id": cfg.get("client_id", ""),
        "client_secret": cfg.get("client_secret", ""),
    }, timeout=10)

    if not resp.ok:
        logger.error("OIDC token exchange failed: %s %s",
                      resp.status_code, resp.text[:200])
        try:
            body = resp.json()
            sso_error = body.get("error", "")
        except Exception:
            sso_error = ""
        if sso_error == "invalid_client":
            return _error_redirect("invalid_client")
        return _error_redirect("token_exchange_failed")

    tokens = resp.json()
    token_store = TokenStore()
    user_info = _fetch_userinfo(tokens["access_token"], cfg.get("userinfo_url", ""))

    token_store.store_sso_tokens(
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token"),
        expires_in=tokens.get("expires_in", 3600),
        user_info=user_info,
    )

    for system_id, config in token_store._all_auth_configs().items():
        if config.get("mode") == "sso_exchange":
            token_store._do_sso_exchange(system_id, config)

    return redirect("/")


@oidc_bp.route("/status")
def oidc_status():
    """Check SSO login status."""
    if not is_backend_oidc_mode():
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
    """Clear current-session tokens (SSO + all services), preserving vault."""
    token_store = TokenStore()
    token_store.clear_session_tokens()
    session.pop("_oauth_state", None)
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


@auth_tokens_bp.route("/tokens/<system_id>", methods=["DELETE"])
def clear_service_token(system_id: str):
    """Disconnect from a specific service (clear its cached token)."""
    token_store = TokenStore()
    token_store.clear_service_token(system_id)
    return jsonify({"status": "ok"})


@auth_tokens_bp.route("/service-status", methods=["GET"])
def auth_service_status():
    """Return authorization status for all configured systems.

    Agent calls this before starting analysis.
    Frontend calls this to show connection indicators.
    """
    token_store = TokenStore()
    return jsonify(token_store.get_auth_status())
