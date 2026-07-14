"""Tests for dedicated Entra caller authentication at the MCP gateway."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest
from mcp.server.auth.provider import AccessToken

from data_formulator.mcp.errors import McpGatewayAuthenticationError, McpProfileValidationError
from data_formulator.mcp_gateway.auth import (
    GatewayAuthConfig,
    GatewayCallerVerifier,
    GatewayTokenVerifier,
)

pytestmark = [pytest.mark.backend]


@pytest.fixture
def auth_config(monkeypatch):
    monkeypatch.setenv("MCP_GATEWAY_ISSUER_URL", "https://login.example.com/tenant/v2.0")
    monkeypatch.setenv("MCP_GATEWAY_AUDIENCE", "api://data-formulator-mcp-gateway")
    monkeypatch.setenv("MCP_GATEWAY_JWKS_URL", "https://login.example.com/tenant/keys")
    monkeypatch.setenv("MCP_GATEWAY_RESOURCE_URL", "https://gateway.example.com/mcp")
    return GatewayAuthConfig.from_environment()


class TestGatewayAuthConfig:
    @pytest.mark.parametrize(
        "variable_name",
        [
            "MCP_GATEWAY_ISSUER_URL",
            "MCP_GATEWAY_AUDIENCE",
            "MCP_GATEWAY_JWKS_URL",
            "MCP_GATEWAY_RESOURCE_URL",
        ],
    )
    def test_rejects_missing_required_configuration(self, monkeypatch, variable_name):
        monkeypatch.setenv("MCP_GATEWAY_ISSUER_URL", "https://login.example.com/tenant/v2.0")
        monkeypatch.setenv("MCP_GATEWAY_AUDIENCE", "api://data-formulator-mcp-gateway")
        monkeypatch.setenv("MCP_GATEWAY_JWKS_URL", "https://login.example.com/tenant/keys")
        monkeypatch.setenv("MCP_GATEWAY_RESOURCE_URL", "https://gateway.example.com/mcp")
        monkeypatch.delenv(variable_name)

        with pytest.raises(McpProfileValidationError, match="gateway authentication"):
            GatewayAuthConfig.from_environment()

    def test_reads_dedicated_gateway_audience(self, auth_config):
        assert auth_config.audience == "api://data-formulator-mcp-gateway"
        assert auth_config.resource_server_url == "https://gateway.example.com/mcp"


class TestGatewayCallerVerifier:
    def test_requires_bearer_header(self, auth_config):
        verifier = GatewayCallerVerifier(auth_config, jwks_client=MagicMock())

        with pytest.raises(McpGatewayAuthenticationError, match="bearer token"):
            verifier.verify_authorization_header("")

    def test_rejects_malformed_bearer_header_without_echoing_token(self, auth_config):
        verifier = GatewayCallerVerifier(auth_config, jwks_client=MagicMock())

        with pytest.raises(McpGatewayAuthenticationError) as error:
            verifier.verify_authorization_header("Bearer secret-token")

        assert "secret-token" not in str(error.value)

    def test_verifies_issuer_audience_and_subject(self, auth_config):
        signing_key = MagicMock()
        signing_key.key = "verification-key"
        jwks_client = MagicMock()
        jwks_client.get_signing_key_from_jwt.return_value = signing_key
        verifier = GatewayCallerVerifier(auth_config, jwks_client=jwks_client)

        with patch("data_formulator.mcp_gateway.auth.jwt.decode", return_value={"sub": "web-app"}) as decode:
            subject = verifier.verify_authorization_header("Bearer signed-token")

        assert subject == "web-app"
        decode.assert_called_once_with(
            "signed-token",
            "verification-key",
            algorithms=("RS256",),
            issuer="https://login.example.com/tenant/v2.0",
            audience="api://data-formulator-mcp-gateway",
            options={"verify_exp": True, "verify_iss": True, "verify_aud": True},
        )

    def test_rejects_missing_subject_claim(self, auth_config):
        signing_key = MagicMock()
        signing_key.key = "verification-key"
        jwks_client = MagicMock()
        jwks_client.get_signing_key_from_jwt.return_value = signing_key
        verifier = GatewayCallerVerifier(auth_config, jwks_client=jwks_client)

        with patch("data_formulator.mcp_gateway.auth.jwt.decode", return_value={}):
            with pytest.raises(McpGatewayAuthenticationError, match="subject"):
                verifier.verify_authorization_header("Bearer signed-token")


class TestGatewayTokenVerifier:
    def test_maps_verified_subject_to_fastmcp_access_token(self, auth_config):
        caller_verifier = MagicMock()
        caller_verifier.verify_authorization_header.return_value = "data-formulator-web"
        verifier = GatewayTokenVerifier(auth_config, caller_verifier=caller_verifier)

        result = asyncio.run(verifier.verify_token("signed-token"))

        assert isinstance(result, AccessToken)
        assert result.client_id == "data-formulator-web"
        assert result.subject == "data-formulator-web"
        assert result.resource == "api://data-formulator-mcp-gateway"
        assert result.scopes == []
        caller_verifier.verify_authorization_header.assert_called_once_with(
            "Bearer signed-token"
        )

    def test_rejects_invalid_caller_token(self, auth_config):
        caller_verifier = MagicMock()
        caller_verifier.verify_authorization_header.side_effect = McpGatewayAuthenticationError(
            "Gateway caller token is invalid"
        )
        verifier = GatewayTokenVerifier(auth_config, caller_verifier=caller_verifier)

        assert asyncio.run(verifier.verify_token("signed-token")) is None
