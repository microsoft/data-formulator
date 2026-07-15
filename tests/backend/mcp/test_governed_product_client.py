"""Tests for the authenticated product-side governed MCP client."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from mcp.server.fastmcp import FastMCP

from data_formulator.mcp.errors import (
    McpApprovalRequiredError,
    McpGatewayAuthenticationError,
    McpProfileValidationError,
    McpResultValidationError,
    McpUpstreamUnavailableError,
)
from data_formulator.mcp.profile import (
    McpOperation,
    McpServerProfile,
    McpSourceReference,
)
from data_formulator.mcp_gateway.contracts import McpOperationRequest
from data_formulator.mcp_gateway.product_client import (
    McpGovernedProductClient,
    McpSdkGatewayTransport,
    McpTokenStoreGatewayAccessTokenProvider,
)
from data_formulator.mcp_gateway.source_registry import McpGovernedSource

pytestmark = [pytest.mark.backend]


def _source() -> McpGovernedSource:
    profile = McpServerProfile.from_dict({
        "profile_id": "fabric-pilot",
        "version": "v1",
        "endpoint": "https://upstream.example.com/mcp",
        "audience": "api://upstream",
        "server_label": "fabric-pilot",
        "source_class": "fabric_iq",
        "operations": ["catalog", "schema", "semantic_query", "health"],
        "capability_manifest": {
            "profile_version": "v1",
            "result_schema_version": "v1",
            "required_operations": ["catalog", "schema", "semantic_query", "health"],
        },
        "allowed_tools": [
            "fabric.list_entities",
            "fabric.get_schema",
            "fabric.search_ontology",
        ],
        "operation_tools": {
            "catalog": "fabric.list_entities",
            "schema": "fabric.get_schema",
            "semantic_query": "fabric.search_ontology",
        },
        "limits": {
            "max_rows": 10_000,
            "max_bytes": 32 * 1024 * 1024,
            "max_pages": 1,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    })
    return McpGovernedSource(
        connector_id="fabric-sales",
        profile=profile,
        source_reference=McpSourceReference(
            source_id="fabric:workspace-1:ontology-2",
            snapshot_id="snapshot-1",
        ),
    )


@dataclass
class _TokenProvider:
    token: str | None
    calls: list[dict[str, str]] = field(default_factory=list)

    def get_access_token(self, *, connector_id: str, audience: str) -> str | None:
        self.calls.append({
            "connector_id": connector_id,
            "audience": audience,
        })
        return self.token


@dataclass
class _Transport:
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def call(self, **kwargs: Any) -> dict[str, object]:
        self.calls.append(kwargs)
        raise AssertionError("transport must not be called without a token")


def test_missing_audience_token_fails_before_transport_invocation():
    source = _source()
    token_provider = _TokenProvider(token=None)
    transport = _Transport()
    client = McpGovernedProductClient(
        gateway_audience="api://data-formulator-mcp-gateway",
        token_provider=token_provider,
        transport=transport,
    )

    with pytest.raises(McpGatewayAuthenticationError):
        client.execute(
            source=source,
            operation=McpOperation.CATALOG,
            arguments={},
            page=1,
        )

    assert token_provider.calls == [{
        "connector_id": "fabric-sales",
        "audience": "api://data-formulator-mcp-gateway",
    }]
    assert transport.calls == []


@dataclass
class _SuccessfulTransport:
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def call(self, **kwargs: Any) -> dict[str, object]:
        self.calls.append(kwargs)
        request: McpOperationRequest = kwargs["request"]
        return {
            "result_schema_version": "v1",
            "source_reference": {
                "source_id": request.source_reference.source_id,
                "snapshot_id": request.source_reference.snapshot_id,
            },
            "items": [{"name": "sales.orders"}],
            "next_page": None,
        }


def test_sends_only_the_manifest_bound_operation_contract():
    source = _source()
    token_provider = _TokenProvider(token="gateway-token")
    transport = _SuccessfulTransport()
    client = McpGovernedProductClient(
        gateway_audience="api://data-formulator-mcp-gateway",
        token_provider=token_provider,
        transport=transport,
        operation_id_factory=lambda: "operation-1",
    )

    result = client.execute(
        source=source,
        operation=McpOperation.CATALOG,
        arguments={"table_filter": "sales"},
        page=1,
    )

    assert result.items == ({"name": "sales.orders"},)
    assert len(transport.calls) == 1
    call = transport.calls[0]
    assert call["access_token"] == "gateway-token"
    assert call["timeout_seconds"] == 30
    request = call["request"]
    assert request.profile_id == "fabric-pilot"
    assert request.operation is McpOperation.CATALOG
    assert request.source_reference == source.source_reference
    assert dict(request.arguments) == {"table_filter": "sales"}
    assert request.operation_id == "operation-1"
    assert request.page == 1
    assert set(call) == {"access_token", "request", "timeout_seconds"}


def test_token_store_provider_uses_connector_and_gateway_audience():
    calls: list[tuple[str, str]] = []

    class _TokenStore:
        def get_exact_service_token(
            self,
            connector_id: str,
            audience: str,
        ) -> str:
            calls.append((connector_id, audience))
            return "gateway-token"

    provider = McpTokenStoreGatewayAccessTokenProvider(
        token_store_factory=_TokenStore
    )

    token = provider.get_access_token(
        connector_id="fabric-sales",
        audience="api://data-formulator-mcp-gateway",
    )

    assert token == "gateway-token"
    assert calls == [
        ("fabric-sales", "api://data-formulator-mcp-gateway"),
    ]


def test_token_store_provider_does_not_use_legacy_token_fallback():
    class _TokenStore:
        def get_service_token(
            self,
            connector_id: str,
            audience: str,
        ) -> str:
            return "legacy-unqualified-token"

        def get_exact_service_token(
            self,
            connector_id: str,
            audience: str,
        ) -> None:
            return None

    provider = McpTokenStoreGatewayAccessTokenProvider(
        token_store_factory=_TokenStore
    )

    token = provider.get_access_token(
        connector_id="fabric-sales",
        audience="api://data-formulator-mcp-gateway",
    )

    assert token is None


def test_sdk_transport_attaches_bearer_token_and_calls_fixed_operation():
    server = FastMCP("product-client", stateless_http=True)
    received: list[dict[str, object]] = []

    @server.tool(name="catalog")
    def catalog(
        profile_id: str,
        source_reference: dict[str, object],
        arguments: dict[str, object],
        operation_id: str,
        page: int,
    ) -> dict[str, object]:
        received.append({
            "profile_id": profile_id,
            "source_reference": source_reference,
            "arguments": arguments,
            "operation_id": operation_id,
            "page": page,
        })
        return {
            "result_schema_version": "v1",
            "source_reference": source_reference,
            "items": [{"name": "sales.orders"}],
            "next_page": None,
        }

    app = server.streamable_http_app()
    authorization_headers: list[str | None] = []

    async def capture_authorization(scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope["headers"])
            raw_authorization = headers.get(b"authorization")
            authorization_headers.append(
                raw_authorization.decode() if raw_authorization else None
            )
        await app(scope, receive, send)

    def create_http_client(timeout_seconds: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=capture_authorization),
            base_url="https://localhost:8000",
            timeout=timeout_seconds,
        )

    source = _source()
    request = McpOperationRequest.create(
        profile=source.profile,
        operation=McpOperation.CATALOG,
        source_reference=source.source_reference,
        arguments={"table_filter": "sales"},
        operation_id="operation-1",
        page=1,
    )
    transport = McpSdkGatewayTransport(
        endpoint="https://localhost:8000/mcp",
        http_client_factory=create_http_client,
    )

    async def invoke() -> dict[str, object]:
        async with app.router.lifespan_context(app):
            result = await transport.call(
                access_token="gateway-token",
                request=request,
                timeout_seconds=30,
            )
            return dict(result)

    result = asyncio.run(invoke())

    assert result["items"] == [{"name": "sales.orders"}]
    assert set(authorization_headers) == {"Bearer gateway-token"}
    assert received == [{
        "profile_id": "fabric-pilot",
        "source_reference": {
            "source_id": "fabric:workspace-1:ontology-2",
            "snapshot_id": "snapshot-1",
        },
        "arguments": {"table_filter": "sales"},
        "operation_id": "operation-1",
        "page": 1,
    }]


def test_approval_required_response_is_not_auto_confirmed():
    class _ApprovalTransport:
        async def call(self, **_kwargs: Any) -> dict[str, object]:
            return {
                "status": "approval_required",
                "operation_id": "operation-1",
            }

    client = McpGovernedProductClient(
        gateway_audience="api://data-formulator-mcp-gateway",
        token_provider=_TokenProvider(token="gateway-token"),
        transport=_ApprovalTransport(),
        operation_id_factory=lambda: "operation-1",
    )

    with pytest.raises(McpApprovalRequiredError):
        client.execute(
            source=_source(),
            operation=McpOperation.CATALOG,
            arguments={},
            page=1,
        )


def test_sdk_transport_maps_tool_rejection_to_safe_error():
    server = FastMCP("product-client-rejection", stateless_http=True)

    @server.tool(name="catalog")
    def catalog(
        profile_id: str,
        source_reference: dict[str, object],
        arguments: dict[str, object],
        operation_id: str,
        page: int,
    ) -> dict[str, object]:
        raise RuntimeError("sensitive-upstream-detail")

    app = server.streamable_http_app()

    def create_http_client(timeout_seconds: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="https://localhost:8000",
            timeout=timeout_seconds,
        )

    source = _source()
    request = McpOperationRequest.create(
        profile=source.profile,
        operation=McpOperation.CATALOG,
        source_reference=source.source_reference,
        arguments={},
        operation_id="operation-1",
        page=1,
    )
    transport = McpSdkGatewayTransport(
        endpoint="https://localhost:8000/mcp",
        http_client_factory=create_http_client,
    )

    async def invoke() -> None:
        async with app.router.lifespan_context(app):
            with pytest.raises(McpUpstreamUnavailableError) as error:
                await transport.call(
                    access_token="gateway-token",
                    request=request,
                    timeout_seconds=30,
                )
            assert "sensitive-upstream-detail" not in str(error.value)

    asyncio.run(invoke())


def test_product_client_rejects_malformed_structured_result():
    class _MalformedTransport:
        async def call(self, **_kwargs: Any) -> dict[str, object]:
            return {"result": "not-a-governed-result"}

    client = McpGovernedProductClient(
        gateway_audience="api://data-formulator-mcp-gateway",
        token_provider=_TokenProvider(token="gateway-token"),
        transport=_MalformedTransport(),
        operation_id_factory=lambda: "operation-1",
    )

    with pytest.raises(McpResultValidationError):
        client.execute(
            source=_source(),
            operation=McpOperation.CATALOG,
            arguments={},
            page=1,
        )


def test_sdk_transport_maps_connection_failure_to_safe_error():
    def fail_request(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(
            "sensitive-internal-gateway-detail",
            request=request,
        )

    def create_http_client(timeout_seconds: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.MockTransport(fail_request),
            timeout=timeout_seconds,
        )

    source = _source()
    request = McpOperationRequest.create(
        profile=source.profile,
        operation=McpOperation.CATALOG,
        source_reference=source.source_reference,
        arguments={},
        operation_id="operation-1",
        page=1,
    )
    transport = McpSdkGatewayTransport(
        endpoint="https://gateway.example.com/mcp",
        http_client_factory=create_http_client,
    )

    with pytest.raises(McpUpstreamUnavailableError) as error:
        asyncio.run(
            transport.call(
                access_token="gateway-token",
                request=request,
                timeout_seconds=30,
            )
        )

    assert "sensitive-internal-gateway-detail" not in str(error.value)


def test_sdk_transport_rejects_an_untrusted_gateway_endpoint():
    with pytest.raises(McpProfileValidationError, match="HTTPS"):
        McpSdkGatewayTransport(endpoint="http://gateway.example.com/mcp")


def test_product_client_rejects_an_empty_gateway_audience():
    with pytest.raises(McpProfileValidationError, match="audience"):
        McpGovernedProductClient(
            gateway_audience=" ",
            token_provider=_TokenProvider(token="gateway-token"),
            transport=_SuccessfulTransport(),
        )
