# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""GitHub OAuth 2.0 authentication provider.

GitHub is pure OAuth2 (not OIDC — there is no ``id_token``), so the
authorization-code exchange must happen server-side.  This makes it a
**stateful** (B-class) provider: the gateway blueprint handles the
redirect dance and writes the result into the Flask session; this
provider then reads the session on subsequent requests.

Configuration (environment variables)::

    GITHUB_CLIENT_ID       — OAuth App client ID  (required)
    GITHUB_CLIENT_SECRET   — OAuth App secret      (required)
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from flask import Request, session

from .base import AuthProvider, AuthResult

logger = logging.getLogger(__name__)


class GitHubOAuthProvider(AuthProvider):

    def __init__(self) -> None:
        self._client_id = os.environ.get("GITHUB_CLIENT_ID", "").strip()
        self._client_secret = os.environ.get("GITHUB_CLIENT_SECRET", "").strip()

    # -- metadata ----------------------------------------------------------

    @property
    def name(self) -> str:
        return "github"

    @property
    def enabled(self) -> bool:
        return bool(self._client_id and self._client_secret)

    # -- frontend self-description -----------------------------------------

    def get_auth_info(self) -> dict:
        return {
            "action": "redirect",
            "url": "/api/auth/github/login",
            "label": os.environ.get("AUTH_DISPLAY_NAME", "GitHub Login"),
        }

    # -- request authentication --------------------------------------------

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        """Read identity from the Flask session (set by the gateway)."""
        user_data = session.get("df_user")
        if not user_data or user_data.get("provider") != "github":
            return None

        return AuthResult(
            user_id=user_data["user_id"],
            display_name=user_data.get("display_name"),
            email=user_data.get("email"),
            raw_token=user_data.get("raw_token"),
        )
