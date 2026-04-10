# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Authentication routes for the Superset plugin.

Migrated from 0.6 ``superset/auth_routes.py`` with:
- Plugin-namespaced session keys (``plugin_superset_*``)
- Routes under ``/api/plugins/superset/auth/``
- Extensions keyed as ``plugin_superset_*``
"""

from __future__ import annotations

import logging

from flask import Blueprint, current_app, jsonify, request

from data_formulator.plugins.superset.session_helpers import (
    clear_session,
    get_token,
    get_user,
    require_auth,
    save_session,
    user_from_jwt_fallback,
)

logger = logging.getLogger(__name__)

auth_bp = Blueprint(
    "plugin_superset_auth",
    __name__,
    url_prefix="/api/plugins/superset/auth",
)


def _bridge():
    return current_app.extensions["plugin_superset_bridge"]


def _do_login(username: str, password: str, is_guest: bool = False):
    """Shared login logic for both normal and guest login."""
    result = _bridge().login(username, password)
    access_token = result["access_token"]
    refresh_token = result.get("refresh_token")

    try:
        user_info = _bridge().get_user_info(access_token)
    except Exception as exc:
        logger.warning("Superset /api/v1/me unavailable, using JWT fallback: %s", exc)
        user_info = user_from_jwt_fallback(access_token, username)

    if is_guest:
        user_info["_guest"] = True

    save_session(access_token, user_info, refresh_token)

    return {
        "status": "ok",
        "user": {
            "id": user_info.get("id"),
            "username": user_info.get("username", ""),
            "first_name": user_info.get("first_name", ""),
            "last_name": user_info.get("last_name", ""),
            "is_guest": is_guest,
        },
    }


@auth_bp.route("/login", methods=["POST"])
def login():
    """Proxy login: frontend -> DF backend -> Superset JWT."""
    data = request.get_json(force=True)
    username = data.get("username", "")
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"status": "error", "message": "Missing credentials"}), 400

    try:
        return jsonify(_do_login(username, password))
    except Exception as exc:
        logger.warning("Login failed for %s: %s", username, exc)
        return jsonify({"status": "error", "message": str(exc)}), 401


@auth_bp.route("/guest", methods=["POST"])
def guest_login():
    """Enter guest mode — browse public data without Superset credentials.

    No actual Superset login is performed.  Catalog routes will call the
    Superset API without an Authorization header; Superset's Public Role
    determines what data is visible.
    """
    guest_user = {"id": None, "username": "guest", "first_name": "Guest", "last_name": "", "_guest": True}
    save_session("", guest_user, None)

    return jsonify({
        "status": "ok",
        "user": {
            "id": None,
            "username": "guest",
            "first_name": "Guest",
            "last_name": "",
            "is_guest": True,
        },
    })


@auth_bp.route("/me", methods=["GET"])
def me():
    """Return the current authenticated Superset user (from session)."""
    user = get_user()
    if not user:
        return jsonify({"status": "error", "message": "Not authenticated"}), 401
    return jsonify({"status": "ok", "user": user})


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

    return jsonify({
        "status": "ok",
        "user": {
            "id": user_info.get("id"),
            "username": user_info.get("username", ""),
            "first_name": user_info.get("first_name", ""),
            "last_name": user_info.get("last_name", ""),
        },
    })


@auth_bp.route("/status", methods=["GET"])
def auth_status():
    """Check if the user has a valid Superset session."""
    token, user = require_auth()
    if token and user:
        return jsonify({
            "status": "ok",
            "authenticated": True,
            "user": {
                "id": user.get("id"),
                "username": user.get("username", ""),
                "first_name": user.get("first_name", ""),
                "last_name": user.get("last_name", ""),
            },
        })
    return jsonify({"status": "ok", "authenticated": False})


@auth_bp.route("/logout", methods=["POST"])
def logout():
    """Clear Superset plugin session data."""
    clear_session()
    return jsonify({"status": "ok"})
