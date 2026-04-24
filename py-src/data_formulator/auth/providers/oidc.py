# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""OIDC / OAuth2 authentication provider.

Supports both standards-compliant OIDC Identity Providers (with auto-discovery)
and plain OAuth2 servers (with manually configured endpoint URLs).

Discovery strategy depends on AUTH_PROVIDER:
    AUTH_PROVIDER=oidc   → tries /.well-known/openid-configuration
    AUTH_PROVIDER=oauth2 → tries /.well-known/oauth-authorization-server

Minimal configuration::

    OIDC_ISSUER_URL   — IdP issuer URL  (e.g. https://keycloak.example.com/realms/main)
    OIDC_CLIENT_ID    — Registered client / application ID

When discovery succeeds, all endpoints are auto-discovered.
Otherwise, set the endpoints manually::

    OIDC_AUTHORIZE_URL  — Authorization endpoint
    OIDC_TOKEN_URL      — Token endpoint
    OIDC_USERINFO_URL   — UserInfo endpoint  (used for token validation fallback)
    OIDC_JWKS_URL       — JWKS endpoint      (optional — if absent, tokens are
                          validated via the UserInfo endpoint instead of local
                          JWT signature verification)

Manual values take precedence over discovery.

Security: the frontend uses PKCE (Public Client). OIDC_CLIENT_SECRET is kept
for server-side operations only and is NEVER sent to the browser.
"""

from __future__ import annotations

import json
import logging
import os
import ssl
import urllib.request
from typing import Any, Optional

import jwt
from jwt import PyJWKClient
from flask import Flask, Request

from .base import AuthProvider, AuthResult, AuthenticationError
from data_formulator.security.log_sanitizer import sanitize_url, redact_token

logger = logging.getLogger(__name__)

# Discovery path per protocol
_DISCOVERY_PATHS: dict[str, str] = {
    "oidc": "/.well-known/openid-configuration",
    "oauth2": "/.well-known/oauth-authorization-server",
}


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

        self._protocol = os.environ.get("AUTH_PROVIDER", "oidc").strip().lower()
        if self._protocol not in _DISCOVERY_PATHS:
            self._protocol = "oidc"

        self._verify_ssl = os.environ.get(
            "OIDC_VERIFY_SSL", "true"
        ).strip().lower() not in ("false", "0", "no")

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

    def _build_ssl_context(self) -> ssl.SSLContext | None:
        """Return an unverified SSL context when OIDC_VERIFY_SSL=false."""
        if self._verify_ssl:
            return None
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    def _try_discovery(self, discovery_url: str) -> dict[str, Any] | None:
        """Fetch and validate a discovery document. Returns None on failure."""
        ssl_ctx = self._build_ssl_context()
        try:
            with urllib.request.urlopen(
                discovery_url, timeout=10, context=ssl_ctx,
            ) as resp:
                doc: dict[str, Any] = json.loads(resp.read())

            if "authorization_endpoint" not in doc:
                logger.warning(
                    "Discovery response from %s missing authorization_endpoint "
                    "(likely not a valid discovery document), ignoring",
                    sanitize_url(discovery_url),
                )
                return None

            return doc
        except Exception as exc:
            logger.warning("Discovery request failed for %s: %s",
                           sanitize_url(discovery_url), type(exc).__name__)
            return None

    def on_configure(self, app: Flask) -> None:
        if not self.enabled:
            logger.info(
                "OIDC provider not configured "
                "(OIDC_ISSUER_URL / OIDC_CLIENT_ID missing)"
            )
            return

        # 1) Try discovery based on protocol (oidc or oauth2)
        primary_path = _DISCOVERY_PATHS[self._protocol]
        fallback_path = (
            _DISCOVERY_PATHS["oauth2"]
            if self._protocol == "oidc"
            else _DISCOVERY_PATHS["oidc"]
        )

        discovery = self._try_discovery(f"{self._issuer}{primary_path}")
        if not discovery:
            logger.info(
                "Primary discovery (%s) failed, trying fallback (%s)",
                primary_path, fallback_path,
            )
            discovery = self._try_discovery(f"{self._issuer}{fallback_path}")

        if discovery:
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
            logger.info("Discovery succeeded for issuer %s", sanitize_url(self._issuer))
        else:
            logger.warning(
                "All discovery attempts failed — using manual endpoints"
            )

        # 2) Initialise JWKS client (from discovery or manual OIDC_JWKS_URL)
        if self._jwks_url:
            try:
                self._jwks_client = PyJWKClient(self._jwks_url, cache_keys=True)
                logger.info("JWKS client initialised: %s", sanitize_url(self._jwks_url))
            except Exception as exc:
                logger.warning("Failed to initialise JWKS client: %s", type(exc).__name__)

        # 3) Summarise
        mode = "JWKS" if self._jwks_client else (
            "userinfo" if self._userinfo_url else "NONE"
        )
        logger.info(
            "OIDC provider ready: issuer=%s, client_id=%s..., "
            "protocol=%s, discovery=%s, token_validation=%s",
            sanitize_url(self._issuer),
            self._client_id[:4] + "..." if len(self._client_id) > 4 else self._client_id,
            self._protocol,
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

        # Always pass metadata so the browser never needs to fetch discovery
        # itself (avoids CORS / certificate issues in the browser).
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

        # NOTE: client_secret is intentionally NOT sent to the frontend.
        # The browser uses PKCE (Public Client) for secure token exchange.

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
