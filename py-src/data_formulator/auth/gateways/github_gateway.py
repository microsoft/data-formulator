# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""GitHub OAuth authorization-code exchange gateway.

Provides ``/api/auth/github/login`` (redirect to GitHub) and
``/api/auth/github/callback`` (exchange code → token → user info →
write Flask session).  The :class:`GitHubOAuthProvider` then reads
from this session on subsequent requests.
"""

from __future__ import annotations

import logging
import os
import urllib.parse

import requests as http_requests
from flask import Blueprint, redirect, request, session

from data_formulator.error_handler import json_ok

logger = logging.getLogger(__name__)

github_bp = Blueprint("github_auth", __name__, url_prefix="/api/auth/github")


def _error_redirect(code: str):
    return redirect(f"/?auth_error={urllib.parse.quote(code)}")


@github_bp.route("/login")
def github_login():
    """Redirect the browser to GitHub's authorization page."""
    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    redirect_uri = request.url_root.rstrip("/") + "/api/auth/github/callback"
    scope = "read:user user:email"
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
    })
    return redirect(f"https://github.com/login/oauth/authorize?{params}")


@github_bp.route("/callback")
def github_callback():
    """Handle the OAuth callback — exchange code for token, fetch user."""
    code = request.args.get("code")
    if not code:
        return _error_redirect("missing_authorization_code")

    client_id = os.environ.get("GITHUB_CLIENT_ID", "")
    client_secret = os.environ.get("GITHUB_CLIENT_SECRET", "")
    redirect_uri = request.url_root.rstrip("/") + "/api/auth/github/callback"

    token_resp = http_requests.post(
        "https://github.com/login/oauth/access_token",
        json={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        headers={"Accept": "application/json"},
        timeout=10,
    )
    if not token_resp.ok:
        return _error_redirect("token_exchange_failed")

    access_token = token_resp.json().get("access_token")
    if not access_token:
        return _error_redirect("missing_access_token")

    user_resp = http_requests.get(
        "https://api.github.com/user",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
        timeout=10,
    )
    if not user_resp.ok:
        return _error_redirect("userinfo_failed")

    user_info = user_resp.json()
    user_id = str(user_info.get("id", ""))
    login = user_info.get("login", "")

    session["df_user"] = {
        "user_id": f"github:{user_id}",
        "display_name": user_info.get("name") or login,
        "email": user_info.get("email"),
        "raw_token": access_token,
        "provider": "github",
    }
    logger.info("GitHub login successful: user=%s (id=%s...)",
                 login, user_id[:8] if len(user_id) > 8 else user_id)

    return redirect("/")


@github_bp.route("/logout", methods=["POST"])
def github_logout():
    """Clear the GitHub session data."""
    session.pop("df_user", None)
    return json_ok({"logged_out": True})
