"""Dedicated Microsoft Entra caller verification for the internal gateway."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import logging
import os
from urllib.parse import urlsplit

import jwt
from jwt import PyJWKClient
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken

from data_formulator.mcp.errors import (
    McpGatewayAuthenticationError,
    McpProfileValidationError,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GatewayAuthConfig:
    """Issuer, audience, and JWKS endpoint for the dedicated gateway app."""

    issuer: str
    audience: str
    jwks_url: str
    resource_server_url: str

    @classmethod
    def from_environment(cls) -> "GatewayAuthConfig":
        issuer = _required_https_url("MCP_GATEWAY_ISSUER_URL")
        audience = _required_value("MCP_GATEWAY_AUDIENCE")
        jwks_url = _required_https_url("MCP_GATEWAY_JWKS_URL")
        resource_server_url = _required_https_url("MCP_GATEWAY_RESOURCE_URL")
        return cls(
            issuer=issuer,
            audience=audience,
            jwks_url=jwks_url,
            resource_server_url=resource_server_url,
        )


class GatewayCallerVerifier:
    """Verify a caller token against the dedicated gateway application."""

    def __init__(
        self, config: GatewayAuthConfig, *, jwks_client: PyJWKClient | None = None
    ) -> None:
        self._config = config
        self._jwks_client = jwks_client or PyJWKClient(config.jwks_url, cache_keys=True)

    def verify_authorization_header(self, authorization_header: str) -> str:
        """Return the authenticated caller subject without exposing token details."""
        if not authorization_header.startswith("Bearer "):
            raise McpGatewayAuthenticationError("A bearer token is required")

        token = authorization_header[7:].strip()
        if not token:
            raise McpGatewayAuthenticationError("A bearer token is required")

        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=("RS256",),
                issuer=self._config.issuer,
                audience=self._config.audience,
                options={"verify_exp": True, "verify_iss": True, "verify_aud": True},
            )
        except Exception as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            logger.warning("Gateway caller token verification failed: %s", type(exc).__name__)
            raise McpGatewayAuthenticationError("Gateway caller token is invalid") from exc

        subject = payload.get("sub")
        if not isinstance(subject, str) or not subject.strip():
            raise McpGatewayAuthenticationError("Gateway caller token has no valid subject")
        return subject


class GatewayTokenVerifier:
    """Adapt dedicated caller verification to FastMCP's token-verifier protocol."""

    def __init__(
        self,
        config: GatewayAuthConfig,
        *,
        caller_verifier: GatewayCallerVerifier | None = None,
    ) -> None:
        self._config = config
        self._caller_verifier = caller_verifier or GatewayCallerVerifier(config)

    async def verify_token(self, token: str) -> AccessToken | None:
        """Return FastMCP access information only for a verified caller."""
        try:
            subject = self._caller_verifier.verify_authorization_header(
                f"Bearer {token}"
            )
        except McpGatewayAuthenticationError:
            return None

        return AccessToken(
            token=token,
            client_id=subject,
            subject=subject,
            scopes=[],
            resource=self._config.audience,
        )


def get_authenticated_caller_subject(
    *,
    access_token_provider: Callable[[], AccessToken | None] = get_access_token,
) -> str:
    """Return the verified FastMCP caller subject for a protected request."""
    access_token = access_token_provider()
    subject = access_token.subject if access_token is not None else None
    if not isinstance(subject, str) or not subject.strip():
        raise McpGatewayAuthenticationError(
            "Gateway caller token has no valid subject"
        )
    return subject


def _required_value(variable_name: str) -> str:
    value = os.environ.get(variable_name, "").strip()
    if not value:
        raise McpProfileValidationError(
            "gateway authentication configuration is incomplete"
        )
    return value


def _required_https_url(variable_name: str) -> str:
    value = _required_value(variable_name)
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.query or parsed.fragment:
        raise McpProfileValidationError(
            "gateway authentication configuration is incomplete"
        )
    return value.rstrip("/")
