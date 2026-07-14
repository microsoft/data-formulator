"""Contract tests for the stateless governed MCP gateway application."""

from __future__ import annotations

import asyncio
from datetime import timedelta
import json

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server.auth.provider import TokenVerifier

from data_formulator.mcp.errors import McpProfileValidationError
from data_formulator.mcp_gateway.auth import GatewayAuthConfig
from data_formulator.mcp_gateway.app import (
    create_asgi_app,
    create_gateway,
    create_production_gateway,
)

pytestmark = [pytest.mark.backend]


def test_gateway_exposes_only_health_before_profiles_are_configured():
    gateway = create_gateway()
    app = gateway.streamable_http_app()

    async def probe() -> tuple[set[str], str]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
                timeout=timedelta(seconds=5),
            ) as http_client:
                async with streamable_http_client(
                    "http://localhost:8000/mcp", http_client=http_client
                ) as (read_stream, write_stream, _get_session_id):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        tools = await session.list_tools()
                        result = await session.call_tool("health", {})
                        return {tool.name for tool in tools.tools}, result.content[0].text

    tool_names, result_text = asyncio.run(probe())
    result = json.loads(result_text)

    assert tool_names == {"health"}
    assert result == {"status": "ok", "profile_version": "v1"}


def test_gateway_denies_unauthenticated_request_when_verifier_is_configured():
    class RejectingTokenVerifier(TokenVerifier):
        async def verify_token(self, token: str):
            return None

    gateway = create_gateway(
        token_verifier=RejectingTokenVerifier(),
        auth_config=GatewayAuthConfig(
            issuer="https://login.example.com/tenant/v2.0",
            audience="api://data-formulator-mcp-gateway",
            jwks_url="https://login.example.com/tenant/keys",
            resource_server_url="https://gateway.example.com/mcp",
        ),
    )
    app = gateway.streamable_http_app()

    async def request() -> int:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.post("/mcp", json={})
                return response.status_code

    assert asyncio.run(request()) == 401


def test_production_gateway_requires_dedicated_auth_configuration(monkeypatch):
    monkeypatch.delenv("MCP_GATEWAY_ISSUER_URL", raising=False)
    monkeypatch.delenv("MCP_GATEWAY_AUDIENCE", raising=False)
    monkeypatch.delenv("MCP_GATEWAY_JWKS_URL", raising=False)
    monkeypatch.delenv("MCP_GATEWAY_RESOURCE_URL", raising=False)

    with pytest.raises(McpProfileValidationError, match="gateway authentication"):
        create_production_gateway()


def test_production_gateway_uses_dedicated_auth_configuration(monkeypatch):
    monkeypatch.setenv("MCP_GATEWAY_ISSUER_URL", "https://login.example.com/tenant/v2.0")
    monkeypatch.setenv("MCP_GATEWAY_AUDIENCE", "api://data-formulator-mcp-gateway")
    monkeypatch.setenv("MCP_GATEWAY_JWKS_URL", "https://login.example.com/tenant/keys")
    monkeypatch.setenv("MCP_GATEWAY_RESOURCE_URL", "https://gateway.example.com/mcp")

    gateway = create_production_gateway()

    assert gateway is not None


def test_asgi_app_exposes_health_check_separately_from_mcp_endpoint():
    gateway = create_gateway()
    app = create_asgi_app(gateway)

    async def request() -> tuple[int, dict[str, str]]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.get("/health")
                return response.status_code, response.json()

    status_code, body = asyncio.run(request())

    assert status_code == 200
    assert body == {"status": "ok", "profile_version": "v1"}
