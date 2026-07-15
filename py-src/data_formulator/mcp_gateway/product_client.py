"""Authenticated product-side client for fixed governed MCP operations."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from datetime import timedelta
import json
from typing import Any, Callable, Protocol
from uuid import uuid4

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import McpError

from data_formulator.auth.token_store import TokenStore
from data_formulator.mcp.errors import (
    McpApprovalRequiredError,
    McpGatewayAuthenticationError,
    McpProfileValidationError,
    McpResultValidationError,
    McpUpstreamUnavailableError,
)
from data_formulator.mcp.profile import McpOperation, validate_mcp_endpoint
from data_formulator.mcp_gateway.contracts import (
    McpOperationRequest,
    McpOperationResult,
)
from data_formulator.mcp_gateway.exception_utils import contains_exception
from data_formulator.mcp_gateway.source_registry import McpGovernedSource


class McpGatewayAccessTokenProvider(Protocol):
    """Resolve a current caller token for one connector and gateway audience."""

    def get_access_token(
        self,
        *,
        connector_id: str,
        audience: str,
    ) -> str | None:
        """Return an audience-qualified token without persisting it."""


class McpGatewayTransport(Protocol):
    """Invoke one fixed gateway request with a caller bearer token."""

    async def call(
        self,
        *,
        access_token: str,
        request: McpOperationRequest,
        timeout_seconds: float,
    ) -> Mapping[str, object]:
        """Return structured gateway content."""


class McpTokenStoreGatewayAccessTokenProvider:
    """Read only audience-qualified gateway tokens from the current session."""

    def __init__(
        self,
        *,
        token_store_factory: Callable[[], TokenStore] = TokenStore,
    ) -> None:
        self._token_store_factory = token_store_factory

    def get_access_token(
        self,
        *,
        connector_id: str,
        audience: str,
    ) -> str | None:
        """Return the current connector token for exactly one audience."""
        return self._token_store_factory().get_exact_service_token(
            connector_id,
            audience,
        )


class McpSdkGatewayTransport:
    """Call the fixed gateway endpoint through the approved MCP SDK."""

    def __init__(
        self,
        *,
        endpoint: str,
        http_client_factory: Callable[[float], httpx.AsyncClient] | None = None,
    ) -> None:
        self._endpoint = validate_mcp_endpoint(endpoint)
        self._http_client_factory = (
            http_client_factory or _create_http_client
        )

    async def call(
        self,
        *,
        access_token: str,
        request: McpOperationRequest,
        timeout_seconds: float,
    ) -> Mapping[str, object]:
        """Invoke only the operation encoded in the validated request."""
        try:
            async with self._http_client_factory(timeout_seconds) as http_client:
                http_client.headers["Authorization"] = f"Bearer {access_token}"
                async with streamable_http_client(
                    self._endpoint,
                    http_client=http_client,
                ) as (read_stream, write_stream, _get_session_id):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        result = await session.call_tool(
                            request.operation.value,
                            arguments={
                                "profile_id": request.profile_id,
                                "source_reference": {
                                    "source_id": request.source_reference.source_id,
                                    "snapshot_id": request.source_reference.snapshot_id,
                                },
                                "arguments": _thaw_json_object(request.arguments),
                                "operation_id": request.operation_id,
                                "page": request.page,
                            },
                            read_timeout_seconds=timedelta(
                                seconds=timeout_seconds
                            ),
                        )
        except BaseExceptionGroup as exc:
            if contains_exception(exc, _TRANSPORT_EXCEPTION_TYPES):
                raise McpUpstreamUnavailableError(
                    "Governed MCP gateway is unavailable"
                ) from exc
            raise
        except _TRANSPORT_EXCEPTION_TYPES as exc:
            raise McpUpstreamUnavailableError(
                "Governed MCP gateway is unavailable"
            ) from exc

        if result.isError:
            raise McpUpstreamUnavailableError(
                "Governed MCP gateway rejected the operation"
            )
        if not isinstance(result.structuredContent, Mapping):
            raise McpResultValidationError(
                "governed MCP gateway returned an invalid result"
            )
        return result.structuredContent


class McpGovernedProductClient:
    """Resolve caller auth at execution time before invoking the gateway."""

    def __init__(
        self,
        *,
        gateway_audience: str,
        token_provider: McpGatewayAccessTokenProvider,
        transport: McpGatewayTransport,
        operation_id_factory: Callable[[], str] = lambda: str(uuid4()),
    ) -> None:
        if not isinstance(gateway_audience, str) or not gateway_audience.strip():
            raise McpProfileValidationError(
                "governed MCP gateway audience must be nonempty"
            )
        self._gateway_audience = gateway_audience.strip()
        self._token_provider = token_provider
        self._transport = transport
        self._operation_id_factory = operation_id_factory

    def execute(
        self,
        *,
        source: McpGovernedSource,
        operation: McpOperation,
        arguments: Mapping[str, object],
        page: int,
    ) -> McpOperationResult:
        """Execute one manifest-bound operation for the current caller."""
        access_token = self._token_provider.get_access_token(
            connector_id=source.connector_id,
            audience=self._gateway_audience,
        )
        if not isinstance(access_token, str) or not access_token.strip():
            raise McpGatewayAuthenticationError(
                "Authentication is required for the governed MCP gateway"
            )

        request = McpOperationRequest.create(
            profile=source.profile,
            operation=operation,
            source_reference=source.source_reference,
            arguments=arguments,
            operation_id=self._operation_id_factory(),
            page=page,
        )
        payload = asyncio.run(
            self._transport.call(
                access_token=access_token,
                request=request,
                timeout_seconds=source.profile.limits.total_timeout_seconds,
            )
        )
        if (
            set(payload) == {"status", "operation_id"}
            and payload.get("status") == "approval_required"
            and payload.get("operation_id") == request.operation_id
        ):
            raise McpApprovalRequiredError(
                "Governed MCP operation requires confirmation"
            )
        return McpOperationResult.from_upstream_json(
            profile=source.profile,
            request=request,
            payload=json.dumps(payload, separators=(",", ":")),
        )


def _create_http_client(timeout_seconds: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout_seconds)


def _thaw_json_object(arguments: Mapping[str, Any]) -> dict[str, Any]:
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
