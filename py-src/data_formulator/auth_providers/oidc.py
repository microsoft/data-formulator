# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""OIDC (OpenID Connect) authentication provider.

Supports any standards-compliant OIDC Identity Provider (Keycloak, Okta,
Auth0, Azure AD / Entra ID, Google, Authelia, Authentik, Casdoor, etc.).

Configuration (environment variables) — only two are needed::

    OIDC_ISSUER_URL   — IdP issuer URL  (e.g. https://keycloak.example.com/realms/main)
    OIDC_CLIENT_ID    — Registered client / application ID

Everything else (JWKS URI, signing algorithms) is auto-discovered via
the standard ``/.well-known/openid-configuration`` endpoint.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Optional

import jwt
from jwt import PyJWKClient
from flask import Flask, Request

from .base import AuthProvider, AuthResult, AuthenticationError

logger = logging.getLogger(__name__)


class OIDCProvider(AuthProvider):
    """Verify OIDC access-tokens sent as ``Authorization: Bearer <token>``."""

    def __init__(self) -> None:
        self._issuer = os.environ.get("OIDC_ISSUER_URL", "").strip().rstrip("/")
        self._client_id = os.environ.get("OIDC_CLIENT_ID", "").strip()
        self._jwks_client: Optional[PyJWKClient] = None
        self._algorithms: list[str] = ["RS256"]

    # -- metadata ----------------------------------------------------------

    @property
    def name(self) -> str:
        return "oidc"

    @property
    def enabled(self) -> bool:
        return bool(self._issuer and self._client_id)

    # -- lifecycle ---------------------------------------------------------

    def on_configure(self, app: Flask) -> None:
        if not self.enabled:
            logger.info(
                "OIDC provider not configured "
                "(OIDC_ISSUER_URL / OIDC_CLIENT_ID missing)"
            )
            return

        try:
            discovery_url = f"{self._issuer}/.well-known/openid-configuration"
            with urllib.request.urlopen(discovery_url, timeout=10) as resp:
                discovery = json.loads(resp.read())

            jwks_uri = discovery["jwks_uri"]
            self._jwks_client = PyJWKClient(jwks_uri, cache_keys=True)

            if "id_token_signing_alg_values_supported" in discovery:
                self._algorithms = discovery["id_token_signing_alg_values_supported"]

            logger.info(
                "OIDC provider configured: issuer=%s, client_id=%s",
                self._issuer,
                self._client_id,
            )
        except Exception as exc:
            logger.error("Failed to initialise OIDC provider: %s", exc)

    # -- frontend self-description -----------------------------------------

    def get_auth_info(self) -> dict:
        return {
            "action": "frontend",
            "label": os.environ.get("AUTH_DISPLAY_NAME", "SSO Login"),
            "oidc": {
                "authority": self._issuer,
                "clientId": self._client_id,
                "scopes": "openid profile email",
            },
        }

    # -- request authentication --------------------------------------------

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        if not self._jwks_client:
            return None

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None

        token = auth_header[7:].strip()
        if not token:
            return None

        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=self._algorithms,
                issuer=self._issuer,
                audience=self._client_id,
                options={
                    "verify_exp": True,
                    "verify_iss": True,
                    "verify_aud": True,
                },
            )
        except jwt.ExpiredSignatureError:
            raise AuthenticationError("OIDC token expired", provider=self.name)
        except jwt.InvalidTokenError as exc:
            raise AuthenticationError(
                f"Invalid OIDC token: {exc}", provider=self.name,
            )

        user_id = payload.get("sub")
        if not user_id:
            raise AuthenticationError(
                "OIDC token missing 'sub' claim", provider=self.name,
            )

        return AuthResult(
            user_id=str(user_id),
            display_name=payload.get("name"),
            email=payload.get("email"),
            raw_token=token,
        )
