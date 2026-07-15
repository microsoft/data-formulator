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

from data_formulator.mcp.errors import (
    McpApprovalRequiredError,
    McpGatewayAuthenticationError,
    McpProfileValidationError,
)
from data_formulator.mcp.profile import McpOperation, McpSourceReference
from data_formulator.mcp_gateway.auth import GatewayAuthConfig
from data_formulator.mcp_gateway.app import (
    create_asgi_app,
    create_gateway,
    create_production_gateway,
)
from data_formulator.mcp_gateway.contracts import McpOperationResult

pytestmark = [pytest.mark.backend]


class RecordingOperationService:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def execute(
        self,
        *,
        profile_id: str,
        operation: McpOperation,
        source_reference: McpSourceReference,
        arguments: dict[str, object],
        operation_id: str,
        page: int,
    ) -> McpOperationResult:
        self.calls.append({
            "profile_id": profile_id,
            "operation": operation,
            "source_reference": source_reference,
            "arguments": arguments,
            "operation_id": operation_id,
            "page": page,
        })
        return McpOperationResult(
            profile_id=profile_id,
            operation=operation,
            source_reference=source_reference,
            items=({"name": "orders"},),
            next_page=None,
        )


class RecordingApprovalCoordinator:
    def __init__(self) -> None:
        self.confirmations: list[dict[str, str]] = []
        self.denials: list[dict[str, str]] = []
        self.requests: list[dict[str, object]] = []

    def request_approval(
        self,
        *,
        caller_subject: str,
        profile_id: str,
        operation: McpOperation,
        source_reference: McpSourceReference,
        arguments: dict[str, object],
        operation_id: str,
        page: int,
    ) -> None:
        self.requests.append({
            "caller_subject": caller_subject,
            "profile_id": profile_id,
            "operation": operation,
            "source_reference": source_reference,
            "arguments": arguments,
            "operation_id": operation_id,
            "page": page,
        })

    async def confirm_and_execute(
        self,
        *,
        caller_subject: str,
        operation_id: str,
    ) -> McpOperationResult:
        self.confirmations.append({
            "caller_subject": caller_subject,
            "operation_id": operation_id,
        })
        return McpOperationResult(
            profile_id="fabric-pilot",
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            items=({"name": "orders"},),
            next_page=None,
        )

    def deny(
        self,
        *,
        caller_subject: str,
        operation_id: str,
    ) -> None:
        self.denials.append({
            "caller_subject": caller_subject,
            "operation_id": operation_id,
        })


class ApprovalRequiredOperationService:
    async def execute(
        self,
        *,
        profile_id: str,
        operation: McpOperation,
        source_reference: McpSourceReference,
        arguments: dict[str, object],
        operation_id: str,
        page: int,
    ) -> McpOperationResult:
        raise McpApprovalRequiredError("MCP operation requires user approval")


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


def test_gateway_exposes_only_fixed_operations_when_service_is_injected():
    service = RecordingOperationService()
    gateway = create_gateway(operation_service=service)
    app = gateway.streamable_http_app()

    async def probe() -> tuple[set[str], dict[str, object], dict[str, object]]:
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
                        result = await session.call_tool("catalog", {
                            "profile_id": "fabric-pilot",
                            "source_reference": {
                                "source_id": "fabric:workspace-1:ontology-2",
                                "snapshot_id": "snapshot-1",
                            },
                            "arguments": {"query": "orders"},
                            "operation_id": "operation-1",
                            "page": 1,
                        })
                        catalog_tool = next(
                            tool for tool in tools.tools if tool.name == "catalog"
                        )
                        return (
                            {tool.name for tool in tools.tools},
                            catalog_tool.inputSchema,
                            result.structuredContent or {},
                        )

    tool_names, catalog_schema, result = asyncio.run(probe())

    assert tool_names == {
        "health",
        "catalog",
        "schema",
        "semantic_query",
        "bounded_read",
    }
    assert {"endpoint", "tool", "tool_name", "url"}.isdisjoint(
        catalog_schema["properties"]
    )
    assert result == {
        "result_schema_version": "v1",
        "source_reference": {
            "source_id": "fabric:workspace-1:ontology-2",
            "snapshot_id": "snapshot-1",
        },
        "items": [{"name": "orders"}],
        "next_page": None,
    }
    assert service.calls == [{
        "profile_id": "fabric-pilot",
        "operation": McpOperation.CATALOG,
        "source_reference": McpSourceReference(
            source_id="fabric:workspace-1:ontology-2",
            snapshot_id="snapshot-1",
        ),
        "arguments": {"query": "orders"},
        "operation_id": "operation-1",
        "page": 1,
    }]


@pytest.mark.parametrize(
    ("top_level_overrides", "operation_arguments"),
    [
        ({"endpoint": "https://untrusted.example.com/mcp"}, {}),
        ({}, {"tool": "untrusted.delete_all"}),
    ],
)
def test_gateway_rejects_raw_proxy_overrides_before_service_execution(
    top_level_overrides,
    operation_arguments,
):
    service = RecordingOperationService()
    gateway = create_gateway(operation_service=service)
    app = gateway.streamable_http_app()

    async def invoke() -> bool:
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
                        request = {
                            "profile_id": "fabric-pilot",
                            "source_reference": {
                                "source_id": "fabric:workspace-1:ontology-2",
                                "snapshot_id": "snapshot-1",
                            },
                            "arguments": operation_arguments,
                            "operation_id": "operation-1",
                        }
                        request.update(top_level_overrides)
                        result = await session.call_tool("catalog", request)
                        return result.isError

    assert asyncio.run(invoke()) is True
    assert service.calls == []


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


def test_confirmation_route_executes_only_the_authenticated_callers_operation():
    coordinator = RecordingApprovalCoordinator()
    caller_subject_provider = lambda: "data-formulator-user"
    gateway = create_gateway()
    app = create_asgi_app(
        gateway,
        approval_coordinator=coordinator,
        caller_subject_provider=caller_subject_provider,
    )

    async def request() -> tuple[int, dict[str, object]]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.post("/approvals/operation-1/confirm")
                return response.status_code, response.json()

    status_code, body = asyncio.run(request())

    assert status_code == 200
    assert body == {
        "status": "success",
        "data": {
            "result_schema_version": "v1",
            "source_reference": {
                "source_id": "fabric:workspace-1:ontology-2",
                "snapshot_id": "snapshot-1",
            },
            "items": [{"name": "orders"}],
            "next_page": None,
        },
    }
    assert coordinator.confirmations == [{
        "caller_subject": "data-formulator-user",
        "operation_id": "operation-1",
    }]


def test_confirmation_route_rejects_an_unauthenticated_caller():
    coordinator = RecordingApprovalCoordinator()
    gateway = create_gateway()

    def raise_authentication_error() -> str:
        raise McpGatewayAuthenticationError("Gateway caller token is invalid")

    app = create_asgi_app(
        gateway,
        approval_coordinator=coordinator,
        caller_subject_provider=raise_authentication_error,
    )

    async def request() -> tuple[int, dict[str, object]]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.post("/approvals/operation-1/confirm")
                return response.status_code, response.json()

    status_code, body = asyncio.run(request())

    assert status_code == 401
    assert body == {
        "status": "error",
        "error": {
            "code": "AUTH_REQUIRED",
            "message": "Authentication is required",
            "retry": False,
        },
    }
    assert coordinator.confirmations == []


def test_confirmation_route_rejects_a_caller_supplied_approval_identifier():
    coordinator = RecordingApprovalCoordinator()
    gateway = create_gateway()
    app = create_asgi_app(
        gateway,
        approval_coordinator=coordinator,
        caller_subject_provider=lambda: "data-formulator-user",
    )

    async def request() -> tuple[int, dict[str, object]]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.post(
                    "/approvals/operation-1/confirm",
                    json={"approval_id": "attacker-controlled"},
                )
                return response.status_code, response.json()

    status_code, body = asyncio.run(request())

    assert status_code == 403
    assert body == {
        "status": "error",
        "error": {
            "code": "ACCESS_DENIED",
            "message": "Approval is unavailable",
            "retry": False,
        },
    }
    assert coordinator.confirmations == []


def test_denial_route_denies_only_the_authenticated_callers_operation():
    coordinator = RecordingApprovalCoordinator()
    gateway = create_gateway()
    app = create_asgi_app(
        gateway,
        approval_coordinator=coordinator,
        caller_subject_provider=lambda: "data-formulator-user",
    )

    async def request() -> tuple[int, dict[str, object]]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.post("/approvals/operation-1/deny")
                return response.status_code, response.json()

    status_code, body = asyncio.run(request())

    assert status_code == 200
    assert body == {
        "status": "success",
        "data": {
            "operation_id": "operation-1",
            "state": "denied",
        },
    }
    assert coordinator.denials == [{
        "caller_subject": "data-formulator-user",
        "operation_id": "operation-1",
    }]


def test_denial_route_rejects_an_unauthenticated_caller():
    coordinator = RecordingApprovalCoordinator()
    gateway = create_gateway()

    def raise_authentication_error() -> str:
        raise McpGatewayAuthenticationError("Gateway caller token is invalid")

    app = create_asgi_app(
        gateway,
        approval_coordinator=coordinator,
        caller_subject_provider=raise_authentication_error,
    )

    async def request() -> tuple[int, dict[str, object]]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.post("/approvals/operation-1/deny")
                return response.status_code, response.json()

    status_code, body = asyncio.run(request())

    assert status_code == 401
    assert body == {
        "status": "error",
        "error": {
            "code": "AUTH_REQUIRED",
            "message": "Authentication is required",
            "retry": False,
        },
    }
    assert coordinator.denials == []


def test_denial_route_rejects_a_request_body():
    coordinator = RecordingApprovalCoordinator()
    gateway = create_gateway()
    app = create_asgi_app(
        gateway,
        approval_coordinator=coordinator,
        caller_subject_provider=lambda: "data-formulator-user",
    )

    async def request() -> tuple[int, dict[str, object]]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.post(
                    "/approvals/operation-1/deny",
                    json={"approval_id": "attacker-controlled"},
                )
                return response.status_code, response.json()

    status_code, body = asyncio.run(request())

    assert status_code == 403
    assert body == {
        "status": "error",
        "error": {
            "code": "ACCESS_DENIED",
            "message": "Approval is unavailable",
            "retry": False,
        },
    }
    assert coordinator.denials == []


def test_denial_route_hides_unavailable_operation_state():
    class UnavailableApprovalCoordinator(RecordingApprovalCoordinator):
        def deny(
            self,
            *,
            caller_subject: str,
            operation_id: str,
        ) -> None:
            raise McpApprovalRequiredError("MCP operation approval is unavailable")

    coordinator = UnavailableApprovalCoordinator()
    gateway = create_gateway()
    app = create_asgi_app(
        gateway,
        approval_coordinator=coordinator,
        caller_subject_provider=lambda: "data-formulator-user",
    )

    async def request() -> tuple[int, dict[str, object]]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
            ) as http_client:
                response = await http_client.post("/approvals/operation-1/deny")
                return response.status_code, response.json()

    status_code, body = asyncio.run(request())

    assert status_code == 403
    assert body == {
        "status": "error",
        "error": {
            "code": "ACCESS_DENIED",
            "message": "Approval is unavailable",
            "retry": False,
        },
    }


def test_gateway_creates_an_owner_bound_pending_approval_without_exposing_its_id():
    coordinator = RecordingApprovalCoordinator()
    gateway = create_gateway(
        operation_service=ApprovalRequiredOperationService(),
        approval_coordinator=coordinator,
        caller_subject_provider=lambda: "data-formulator-user",
    )
    app = gateway.streamable_http_app()

    async def invoke() -> dict[str, object]:
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
                        result = await session.call_tool("catalog", {
                            "profile_id": "fabric-pilot",
                            "source_reference": {
                                "source_id": "fabric:workspace-1:ontology-2",
                                "snapshot_id": "snapshot-1",
                            },
                            "arguments": {"query": "orders"},
                            "operation_id": "operation-1",
                        })
                        return result.structuredContent or {}

    result = asyncio.run(invoke())

    assert result == {
        "status": "approval_required",
        "operation_id": "operation-1",
    }
    assert coordinator.requests == [{
        "caller_subject": "data-formulator-user",
        "profile_id": "fabric-pilot",
        "operation": McpOperation.CATALOG,
        "source_reference": McpSourceReference(
            source_id="fabric:workspace-1:ontology-2",
            snapshot_id="snapshot-1",
        ),
        "arguments": {"query": "orders"},
        "operation_id": "operation-1",
        "page": 1,
    }]
