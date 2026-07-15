"""Fail-closed validation for approved upstream MCP server capabilities."""

from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Callable, Mapping
from datetime import timedelta
import json
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import McpError
from mcp.types import Tool

from data_formulator.mcp.errors import (
    McpCapabilityDriftError,
    McpOperationCancelledError,
    McpOperationValidationError,
    McpResultValidationError,
    McpUpstreamUnavailableError,
)
from data_formulator.mcp.profile import McpServerProfile
from data_formulator.mcp_gateway.contracts import (
    McpOperationRequest,
    McpOperationResult,
)
from data_formulator.mcp_gateway.exception_utils import contains_exception
from data_formulator.mcp_gateway.operations import McpGatewayOperation


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

    async def call_operation(
        self,
        request: McpOperationRequest,
        gateway_operation: McpGatewayOperation,
    ) -> McpOperationResult:
        """Invoke only the request operation's profile-pinned upstream tool."""
        if request.profile_id != self._profile.profile_id:
            raise McpOperationValidationError(
                "operation request does not match the approved profile"
            )
        if gateway_operation.operation_id != request.operation_id:
            raise McpOperationValidationError(
                "gateway operation does not match the request"
            )
        if not gateway_operation.is_active:
            raise McpOperationCancelledError("MCP operation was cancelled")

        try:
            tool_name = self._profile.operation_tools[request.operation]
        except KeyError as exc:
            raise McpOperationValidationError(
                "operation is not approved by the MCP profile"
            ) from exc

        try:
            async with self._http_client_factory() as http_client:
                async with streamable_http_client(
                    self._profile.endpoint, http_client=http_client
                ) as (read_stream, write_stream, _get_session_id):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        tools = await session.list_tools()
                        self._capability_validator.validate_tools(tools.tools)
                        upstream_result = await session.call_tool(
                            tool_name,
                            arguments=_thaw_json_object(request.arguments),
                            read_timeout_seconds=timedelta(
                                seconds=self._profile.limits.total_timeout_seconds
                            ),
                        )
        except (
            McpCapabilityDriftError,
            McpOperationValidationError,
            McpResultValidationError,
            McpUpstreamUnavailableError,
        ):
            raise
        except BaseExceptionGroup as exc:
            if contains_exception(exc, McpCapabilityDriftError):
                raise McpCapabilityDriftError(
                    "upstream tool capability changed"
                ) from exc
            if contains_exception(exc, _TRANSPORT_EXCEPTION_TYPES):
                raise McpUpstreamUnavailableError(
                    "Approved MCP operation is unavailable"
                ) from exc
            raise
        except _TRANSPORT_EXCEPTION_TYPES as exc:
            raise McpUpstreamUnavailableError(
                "Approved MCP operation is unavailable"
            ) from exc

        if upstream_result.isError:
            raise McpUpstreamUnavailableError("Approved MCP operation was rejected")
        if upstream_result.structuredContent is None:
            raise McpResultValidationError(
                "approved MCP operation did not return a structured result"
            )

        try:
            payload = json.dumps(
                upstream_result.structuredContent,
                separators=(",", ":"),
            )
        except (TypeError, ValueError) as exc:
            raise McpResultValidationError(
                "approved MCP operation returned an invalid result"
            ) from exc

        result = McpOperationResult.from_upstream_json(
            profile=self._profile,
            request=request,
            payload=payload,
        )
        if not gateway_operation.complete():
            raise McpOperationCancelledError("MCP operation was cancelled")
        return result


def _thaw_json_object(arguments: Mapping[str, Any]) -> dict[str, Any]:
    """Convert immutable request arguments to the SDK's mutable JSON shape."""
    return {
        key: _thaw_json_value(value)
        for key, value in arguments.items()
    }


def _thaw_json_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _thaw_json_object(value)
    if isinstance(value, tuple):
        return [_thaw_json_value(item) for item in value]
    return value


_TRANSPORT_EXCEPTION_TYPES = (
    httpx.HTTPError,
    McpError,
    OSError,
    TimeoutError,
)
