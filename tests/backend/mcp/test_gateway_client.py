"""Tests for upstream MCP capability validation before gateway tool calls."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import timedelta

import httpx
import pytest
from mcp.server.fastmcp import FastMCP
from mcp.types import Tool

from data_formulator.mcp.errors import McpCapabilityDriftError, McpUpstreamUnavailableError
from data_formulator.mcp.profile import McpServerProfile
from data_formulator.mcp_gateway.client import (
    McpUpstreamCapabilityValidator,
    McpUpstreamClient,
)

pytestmark = [pytest.mark.backend]


def _profile() -> McpServerProfile:
    return McpServerProfile.from_dict({
        "profile_id": "fabric-pilot",
        "version": "v1",
        "endpoint": "https://gateway.example.com/mcp",
        "audience": "api://data-formulator-mcp-gateway",
        "server_label": "fabric-pilot",
        "source_class": "fabric_iq",
        "operations": ["catalog", "schema", "semantic_query", "health"],
        "capability_manifest": {
            "profile_version": "v1",
            "result_schema_version": "v1",
            "required_operations": ["catalog", "schema", "semantic_query", "health"],
        },
        "allowed_tools": ["fabric.list_entities", "fabric.search_ontology"],
        "limits": {
            "max_rows": 10_000,
            "max_bytes": 32 * 1024 * 1024,
            "max_pages": 200,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    })


def _tool(name: str) -> Tool:
    return Tool(name=name, description="test tool", inputSchema={"type": "object"})


class TestMcpUpstreamCapabilityValidator:
    def test_accepts_exact_profile_pinned_tool_set(self):
        validator = McpUpstreamCapabilityValidator(_profile())

        validator.validate_tools([
            _tool("fabric.list_entities"),
            _tool("fabric.search_ontology"),
        ])

    def test_rejects_missing_profile_pinned_tool(self):
        validator = McpUpstreamCapabilityValidator(_profile())

        with pytest.raises(McpCapabilityDriftError, match="tool capability changed"):
            validator.validate_tools([_tool("fabric.list_entities")])

    def test_rejects_unexpected_upstream_tool(self):
        validator = McpUpstreamCapabilityValidator(_profile())

        with pytest.raises(McpCapabilityDriftError, match="tool capability changed"):
            validator.validate_tools([
                _tool("fabric.list_entities"),
                _tool("fabric.search_ontology"),
                _tool("fabric.delete_ontology"),
            ])


class TestMcpUpstreamClient:
    def test_validates_profile_pinned_tools_over_streamable_http(self):
        server = FastMCP("upstream", stateless_http=True)

        @server.tool(name="fabric.list_entities")
        def list_entities() -> dict[str, list[str]]:
            return {"entities": []}

        @server.tool(name="fabric.search_ontology")
        def search_ontology() -> dict[str, list[str]]:
            return {"results": []}

        app = server.streamable_http_app()
        profile = replace(_profile(), endpoint="https://localhost:8000/mcp")

        def client_factory() -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://localhost:8000",
                timeout=timedelta(seconds=5),
            )

        async def probe() -> None:
            async with app.router.lifespan_context(app):
                await McpUpstreamClient(profile, client_factory).validate_capabilities()

        asyncio.run(probe())

    def test_maps_transport_failure_to_safe_error(self):
        profile = replace(_profile(), endpoint="https://localhost:8000/mcp")

        def client_factory() -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.MockTransport(lambda _request: httpx.Response(503)),
                base_url="https://localhost:8000",
                timeout=timedelta(seconds=5),
            )

        with pytest.raises(McpUpstreamUnavailableError, match="unavailable") as error:
            asyncio.run(McpUpstreamClient(profile, client_factory).validate_capabilities())

        assert "localhost" not in str(error.value)
