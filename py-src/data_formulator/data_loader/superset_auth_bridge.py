# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Authenticate users via the Superset REST API (JWT)."""

from __future__ import annotations

import logging
from typing import Optional

import requests

logger = logging.getLogger(__name__)


class SupersetAuthBridge:
    """Proxy authentication through Superset's public JWT API."""

    def __init__(self, superset_url: str, timeout: int = 30):
        self.superset_url = superset_url.rstrip("/")
        self.timeout = timeout

    def login(self, username: str, password: str) -> dict:
        """Forward credentials to Superset and return the JWT payload."""
        resp = requests.post(
            f"{self.superset_url}/api/v1/security/login",
            json={
                "username": username,
                "password": password,
                "provider": "db",
                "refresh": True,
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def get_user_info(self, access_token: str) -> dict:
        """Fetch the authenticated user's profile."""
        resp = requests.get(
            f"{self.superset_url}/api/v1/me/",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json().get("result", {})

    def validate_token(self, access_token: str) -> Optional[dict]:
        """Return user info when the token is still valid, else *None*."""
        try:
            return self.get_user_info(access_token)
        except Exception:
            logger.debug("Token validation failed", exc_info=True)
            return None

    def refresh_token(self, refresh_tok: str) -> dict:
        """Exchange a refresh token for a new access token.

        Superset (flask-jwt-extended) expects the refresh token as a
        Bearer header, not in the JSON body.
        """
        resp = requests.post(
            f"{self.superset_url}/api/v1/security/refresh",
            headers={"Authorization": f"Bearer {refresh_tok}"},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def exchange_sso_token(self, sso_access_token: str) -> dict:
        """Exchange an SSO access token for a Superset JWT.

        Requires ``TokenExchangeView`` deployed on the Superset side
        (see design doc 8, Phase 2).  Returns the same dict shape as
        :meth:`login` — ``{"access_token": ..., "refresh_token": ...}``.

        Raises on network errors or when the endpoint is unavailable.
        """
        resp = requests.post(
            f"{self.superset_url}/api/v1/df-token-exchange/",
            json={"sso_access_token": sso_access_token},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        if "access_token" not in data:
            raise ValueError("Token exchange response missing access_token")
        return data
