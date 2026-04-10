# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Plugin-namespaced Flask session helpers for the Superset plugin.

All session keys are prefixed with ``plugin_superset_`` to avoid
collisions with other plugins or the core app.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any, Optional

from flask import current_app, session

logger = logging.getLogger(__name__)

# Session key prefix — isolates Superset plugin state from other plugins
_PREFIX = "plugin_superset_"

# Session keys
KEY_TOKEN = f"{_PREFIX}token"
KEY_REFRESH_TOKEN = f"{_PREFIX}refresh_token"
KEY_USER = f"{_PREFIX}user"


def get_token() -> Optional[str]:
    return session.get(KEY_TOKEN)


def get_refresh_token() -> Optional[str]:
    return session.get(KEY_REFRESH_TOKEN)


def get_user() -> Optional[dict]:
    return session.get(KEY_USER)


def save_session(
    access_token: str,
    user_info: dict[str, Any],
    refresh_token: Optional[str] = None,
) -> None:
    """Persist Superset auth state in the Flask session."""
    session[KEY_TOKEN] = access_token
    session[KEY_USER] = user_info
    if refresh_token is not None:
        session[KEY_REFRESH_TOKEN] = refresh_token
    session.permanent = True


def clear_session() -> None:
    """Remove all Superset plugin keys from the session."""
    for key in (KEY_TOKEN, KEY_REFRESH_TOKEN, KEY_USER):
        session.pop(key, None)


def is_token_expired(token: str, buffer_seconds: int = 60) -> bool:
    """Decode the JWT exp claim and check if it's expired (or about to).
    Returns True on parse failure (conservative: prefer refresh over stale use)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
        return time.time() > claims.get("exp", 0) - buffer_seconds
    except Exception:
        return True


def try_refresh() -> Optional[str]:
    """Attempt to refresh the Superset access_token.  Returns the new token
    on success, or None on failure."""
    refresh_tok = get_refresh_token()
    if not refresh_tok:
        logger.warning("Superset access_token expired with no refresh_token")
        return None
    try:
        bridge = current_app.extensions["plugin_superset_bridge"]
        result = bridge.refresh_token(refresh_tok)
        new_token = result.get("access_token")
        if new_token:
            session[KEY_TOKEN] = new_token
            logger.info("Superset access_token refreshed automatically")
            return new_token
    except Exception as e:
        logger.warning("Superset token refresh failed: %s", e)
    return None


def require_auth() -> tuple[Optional[str], Optional[dict]]:
    """Return ``(token, user)`` or ``(None, None)`` if no session exists.

    Guest sessions have an empty token but a valid user dict with
    ``_guest=True``.  In that case ``(None, user)`` is returned so that
    catalog routes can call Superset without an Authorization header.

    For normal sessions, the token is automatically refreshed if expired.
    """
    token = get_token()
    user = get_user()
    if not user:
        return None, None

    # Guest mode: user present but token is empty
    if not token:
        return None, user

    if is_token_expired(token):
        token = try_refresh()
        if not token:
            return None, None

    return token, user


def user_from_jwt_fallback(access_token: str, username: str) -> dict:
    """Build minimal user info from JWT claims when /api/v1/me is unavailable."""
    try:
        parts = access_token.split(".")
        if len(parts) < 2:
            return {"id": None, "username": username, "first_name": "", "last_name": ""}
        payload = parts[1]
        padding = "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload + padding).decode("utf-8")
        claims = json.loads(decoded)
        user_id = claims.get("sub")
        try:
            user_id = int(user_id) if user_id is not None else None
        except (TypeError, ValueError):
            user_id = None
        return {"id": user_id, "username": username, "first_name": "", "last_name": ""}
    except Exception:
        logger.debug("JWT fallback parse failed", exc_info=True)
        return {"id": None, "username": username, "first_name": "", "last_name": ""}
