# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""OIDC / OAuth2 authentication provider.

Supports both standards-compliant OIDC Identity Providers (with auto-discovery)
and plain OAuth2 servers (with manually configured endpoint URLs).

Minimal configuration::

    OIDC_ISSUER_URL   — IdP issuer URL  (e.g. https://keycloak.example.com/realms/main)
    OIDC_CLIENT_ID    — Registered client / application ID

When the IdP exposes ``/.well-known/openid-configuration``, all endpoints are
auto-discovered.  Otherwise, set the endpoints manually::

    OIDC_AUTHORIZE_URL  — Authorization endpoint
    OIDC_TOKEN_URL      — Token endpoint
    OIDC_USERINFO_URL   — UserInfo endpoint  (used for token validation fallback)
    OIDC_JWKS_URL       — JWKS endpoint      (optional — if absent, tokens are
                          validated via the UserInfo endpoint instead of local
                          JWT signature verification)

Manual values take precedence over discovery.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any, Optional

import jwt
from jwt import PyJWKClient
from flask import Flask, Request

from .base import AuthProvider, AuthResult, AuthenticationError

logger = logging.getLogger(__name__)


class OIDCProvider(AuthProvider):
    """Verify access-tokens via JWKS signature or UserInfo introspection."""

    def __init__(self) -> None:
        self._issuer = os.environ.get("OIDC_ISSUER_URL", "").strip().rstrip("/")
        self._client_id = os.environ.get("OIDC_CLIENT_ID", "").strip()
        self._client_secret = os.environ.get("OIDC_CLIENT_SECRET", "").strip()

        self._authorize_url = os.environ.get("OIDC_AUTHORIZE_URL", "").strip()
        self._token_url = os.environ.get("OIDC_TOKEN_URL", "").strip()
        self._userinfo_url = os.environ.get("OIDC_USERINFO_URL", "").strip()
        self._jwks_url = os.environ.get("OIDC_JWKS_URL", "").strip()
        self._scopes = os.environ.get("OIDC_SCOPES", "").strip()

        self._jwks_client: Optional[PyJWKClient] = None
        self._algorithms: list[str] = ["RS256"]
        self._discovery_ok = False

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

        # 1) Try OpenID Discovery
        try:
            discovery_url = f"{self._issuer}/.well-known/openid-configuration"
            with urllib.request.urlopen(discovery_url, timeout=10) as resp:
                discovery: dict[str, Any] = json.loads(resp.read())

            if not self._authorize_url:
                self._authorize_url = discovery.get("authorization_endpoint", "")
            if not self._token_url:
                self._token_url = discovery.get("token_endpoint", "")
            if not self._userinfo_url:
                self._userinfo_url = discovery.get("userinfo_endpoint", "")
            if not self._jwks_url:
                self._jwks_url = discovery.get("jwks_uri", "")

            if "id_token_signing_alg_values_supported" in discovery:
                self._algorithms = discovery["id_token_signing_alg_values_supported"]

            self._discovery_ok = True
            logger.info("OIDC discovery succeeded: %s", discovery_url)
        except Exception as exc:
            logger.warning(
                "OIDC discovery unavailable (%s) — using manual endpoints", exc,
            )

        # 2) Initialise JWKS client (from discovery or manual OIDC_JWKS_URL)
        if self._jwks_url:
            try:
                self._jwks_client = PyJWKClient(self._jwks_url, cache_keys=True)
                logger.info("JWKS client initialised: %s", self._jwks_url)
            except Exception as exc:
                logger.warning("Failed to initialise JWKS client: %s", exc)

        # 3) Summarise
        mode = "JWKS" if self._jwks_client else (
            "userinfo" if self._userinfo_url else "NONE"
        )
        logger.info(
            "OIDC provider ready: issuer=%s, client_id=%s, "
            "discovery=%s, token_validation=%s",
            self._issuer, self._client_id,
            "ok" if self._discovery_ok else "manual",
            mode,
        )
        if mode == "NONE":
            logger.error(
                "OIDC provider has neither JWKS nor UserInfo URL — "
                "token validation will be skipped!"
            )

    # -- frontend self-description -----------------------------------------

    def _effective_scopes(self) -> str:
        if self._scopes:
            return self._scopes
        if self._jwks_client:
            return "openid profile email offline_access"
        # No JWKS → SSO likely doesn't issue JWT id_tokens;
        # requesting 'openid' would cause oidc-client-ts to fail parsing.
        return "profile email offline_access"

    def get_auth_info(self) -> dict:
        info: dict[str, Any] = {
            "action": "frontend",
            "label": os.environ.get("AUTH_DISPLAY_NAME", "SSO Login"),
            "oidc": {
                "authority": self._issuer,
                "clientId": self._client_id,
                "scopes": self._effective_scopes(),
            },
        }

        if not self._discovery_ok:
            metadata: dict[str, str] = {}
            if self._authorize_url:
                metadata["authorization_endpoint"] = self._authorize_url
            if self._token_url:
                metadata["token_endpoint"] = self._token_url
            if self._userinfo_url:
                metadata["userinfo_endpoint"] = self._userinfo_url
            if self._jwks_url:
                metadata["jwks_uri"] = self._jwks_url
            if metadata:
                info["oidc"]["metadata"] = metadata

        if self._client_secret:
            info["oidc"]["clientSecret"] = self._client_secret

        return info

    # -- request authentication --------------------------------------------

    def authenticate(self, request: Request) -> Optional[AuthResult]:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return None

        token = auth_header[7:].strip()
        if not token:
            return None

        # Strategy 1: local JWT verification via JWKS
        if self._jwks_client:
            return self._authenticate_jwt(token)

        # Strategy 2: remote token validation via UserInfo endpoint
        if self._userinfo_url:
            return self._authenticate_userinfo(token)

        return None

    def _authenticate_jwt(self, token: str) -> AuthResult:
        """Verify JWT signature locally using JWKS."""
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)  # type: ignore[union-attr]
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

    def _authenticate_userinfo(self, token: str) -> AuthResult:
        """Validate token by calling the IdP's UserInfo endpoint."""
        req = urllib.request.Request(
            self._userinfo_url,
            headers={"Authorization": f"Bearer {token}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                userinfo: dict[str, Any] = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise AuthenticationError(
                    "Token rejected by UserInfo endpoint", provider=self.name,
                )
            raise AuthenticationError(
                f"UserInfo request failed (HTTP {exc.code})", provider=self.name,
            )
        except Exception as exc:
            raise AuthenticationError(
                f"UserInfo request failed: {exc}", provider=self.name,
            )

        user_id = userinfo.get("sub") or userinfo.get("id") or userinfo.get("user_id")
        if not user_id:
            raise AuthenticationError(
                "UserInfo response missing user identifier", provider=self.name,
            )

        return AuthResult(
            user_id=str(user_id),
            display_name=userinfo.get("name") or userinfo.get("username"),
            email=userinfo.get("email"),
            raw_token=token,
        )
