"""Fail-closed validation for approved upstream MCP server capabilities."""

from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Callable

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Tool

from data_formulator.mcp.errors import (
    McpCapabilityDriftError,
    McpUpstreamUnavailableError,
)
from data_formulator.mcp.profile import McpServerProfile


class McpUpstreamCapabilityValidator:
    """Verify an upstream tool list before the gateway can invoke it."""

    def __init__(self, profile: McpServerProfile) -> None:
        self._profile = profile

    def validate_tools(self, tools: Iterable[Tool]) -> None:
        """Require exact tool identity parity with the approved profile."""
        upstream_tools = {tool.name for tool in tools}
        if upstream_tools != self._profile.allowed_tools:
            raise McpCapabilityDriftError("upstream tool capability changed")


class McpUpstreamClient:
    """Perform profile-pinned MCP discovery before any upstream tool call."""

    def __init__(
        self,
        profile: McpServerProfile,
        http_client_factory: Callable[[], httpx.AsyncClient],
    ) -> None:
        self._profile = profile
        self._http_client_factory = http_client_factory
        self._capability_validator = McpUpstreamCapabilityValidator(profile)

    async def validate_capabilities(self) -> None:
        """Initialize the approved MCP server and reject incompatible tools."""
        try:
            async with self._http_client_factory() as http_client:
                async with streamable_http_client(
                    self._profile.endpoint, http_client=http_client
                ) as (read_stream, write_stream, _get_session_id):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        tools = await session.list_tools()
        except McpCapabilityDriftError:
            raise
        except Exception as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            raise McpUpstreamUnavailableError("Approved MCP server is unavailable") from exc

        self._capability_validator.validate_tools(tools.tools)
