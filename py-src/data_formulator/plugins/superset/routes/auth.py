# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Authentication routes for the Superset plugin.

Uses :class:`PluginAuthHandler` for standard auth lifecycle (login, logout,
status, me) with built-in Credential Vault support.  Superset-specific routes
(guest login, SSO save-tokens) are added to the same Blueprint.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from flask import current_app, jsonify, request

from data_formulator.plugins.auth_base import PluginAuthHandler
from data_formulator.plugins.superset.session_helpers import (
    clear_session,
    get_user,
    require_auth,
    save_session,
    user_from_jwt_fallback,
)

logger = logging.getLogger(__name__)


def _bridge():
    return current_app.extensions["plugin_superset_bridge"]


def _format_user(user: dict, *, is_guest: bool = False) -> dict:
    info = {
        "id": user.get("id"),
        "username": user.get("username", ""),
        "first_name": user.get("first_name", ""),
        "last_name": user.get("last_name", ""),
    }
    if is_guest:
        info["is_guest"] = True
    return info


# ------------------------------------------------------------------
# Superset-specific auth handler
# ------------------------------------------------------------------

class SupersetAuthHandler(PluginAuthHandler):
    """Superset auth: proxies login to Superset JWT API."""

    def do_login(self, username: str, password: str) -> dict[str, Any]:
        result = _bridge().login(username, password)
        access_token = result["access_token"]
        refresh_token = result.get("refresh_token")

        try:
            user_info = _bridge().get_user_info(access_token)
        except Exception as exc:
            logger.warning("Superset /api/v1/me unavailable, using JWT fallback: %s", exc)
            user_info = user_from_jwt_fallback(access_token, username)

        save_session(access_token, user_info, refresh_token)
        return {"user": _format_user(user_info)}

    def do_clear_session(self) -> None:
        clear_session()

    def get_session_auth(self) -> Optional[dict[str, Any]]:
        token, user = require_auth()
        if token and user:
            return {"authenticated": True, "mode": "session", "user": _format_user(user)}
        if user:
            return {
                "authenticated": True,
                "mode": "session",
                "user": _format_user(user, is_guest=user.get("_guest", False)),
            }
        return None

    def get_current_user(self) -> Optional[dict[str, Any]]:
        user = get_user()
        return user if user else None


# ------------------------------------------------------------------
# Blueprint (standard routes via base class + Superset extras)
# ------------------------------------------------------------------

_handler = SupersetAuthHandler("superset")
auth_bp = _handler.create_auth_blueprint("/api/plugins/superset/auth")


@auth_bp.route("/guest", methods=["POST"])
def guest_login():
    """Enter guest mode — browse public data without Superset credentials."""
    guest_user = {"id": None, "username": "guest", "first_name": "Guest", "last_name": "", "_guest": True}
    save_session("", guest_user, None)

    return jsonify({
        "status": "ok",
        "user": _format_user(guest_user, is_guest=True),
    })


@auth_bp.route("/sso/save-tokens", methods=["POST"])
def sso_save_tokens():
    """Receive Superset JWT tokens obtained via the Popup SSO flow."""
    data = request.get_json(force=True)
    access_token = data.get("access_token")
    refresh_token = data.get("refresh_token")
    user_from_popup = data.get("user", {})

    if not access_token:
        return jsonify({"status": "error", "message": "Missing access_token"}), 400

    try:
        user_info = _bridge().get_user_info(access_token)
    except Exception:
        user_info = user_from_popup

    if not user_info or not user_info.get("id"):
        user_info = user_from_jwt_fallback(access_token, user_from_popup.get("username", ""))

    save_session(access_token, user_info, refresh_token)

    return jsonify({"status": "ok", "user": _format_user(user_info)})
