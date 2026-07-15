"""Tests for upstream MCP capability validation before gateway tool calls."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import timedelta

import httpx
import pytest
from mcp.server.fastmcp import FastMCP
from mcp.types import Tool

from data_formulator.mcp.errors import (
    McpCapabilityDriftError,
    McpOperationCancelledError,
    McpOperationValidationError,
    McpResultValidationError,
    McpUpstreamUnavailableError,
)
from data_formulator.mcp.profile import McpOperation, McpServerProfile, McpSourceReference
from data_formulator.mcp_gateway.client import (
    McpUpstreamCapabilityValidator,
    McpUpstreamClient,
)
from data_formulator.mcp_gateway.contracts import McpOperationRequest
from data_formulator.mcp_gateway.operations import McpGatewayOperation

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
            _tool("fabric.get_schema"),
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
                _tool("fabric.get_schema"),
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

        @server.tool(name="fabric.get_schema")
        def get_schema() -> dict[str, list[str]]:
            return {"columns": []}

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

    def test_calls_only_profile_mapped_tool_and_validates_result(self):
        server = FastMCP("upstream", stateless_http=True)
        calls: list[tuple[str, str]] = []

        @server.tool(name="fabric.list_entities")
        def list_entities(query: str) -> dict[str, object]:
            calls.append(("fabric.list_entities", query))
            return {
                "result_schema_version": "v1",
                "source_reference": {
                    "source_id": "fabric:workspace-1:ontology-2",
                    "snapshot_id": "snapshot-1",
                },
                "items": [{"name": "orders"}],
            }

        @server.tool(name="fabric.get_schema")
        def get_schema() -> dict[str, list[str]]:
            return {"columns": []}

        @server.tool(name="fabric.search_ontology")
        def search_ontology() -> dict[str, list[str]]:
            return {"results": []}

        app = server.streamable_http_app()
        profile = replace(_profile(), endpoint="https://localhost:8000/mcp")
        request = McpOperationRequest.create(
            profile=profile,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={"query": "orders"},
            operation_id="operation-1",
        )

        def client_factory() -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://localhost:8000",
                timeout=timedelta(seconds=5),
            )

        async def invoke() -> object:
            async with app.router.lifespan_context(app):
                return await McpUpstreamClient(
                    profile, client_factory
                ).call_operation(request, McpGatewayOperation(request.operation_id))

        result = asyncio.run(invoke())

        assert result.items == ({"name": "orders"},)
        assert calls == [("fabric.list_entities", "orders")]

    def test_rejects_request_for_different_profile(self):
        profile = _profile()
        other_profile = replace(profile, profile_id="other-profile")
        request = McpOperationRequest.create(
            profile=other_profile,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
        )

        with pytest.raises(McpOperationValidationError, match="profile"):
            asyncio.run(McpUpstreamClient(
                profile,
                lambda: httpx.AsyncClient(),
            ).call_operation(request, McpGatewayOperation(request.operation_id)))

    def test_rejects_capability_drift_before_invoking_mapped_tool(self):
        server = FastMCP("upstream", stateless_http=True)
        calls: list[str] = []

        @server.tool(name="fabric.list_entities")
        def list_entities() -> dict[str, object]:
            calls.append("fabric.list_entities")
            return {}

        @server.tool(name="fabric.get_schema")
        def get_schema() -> dict[str, object]:
            return {}

        app = server.streamable_http_app()
        profile = replace(_profile(), endpoint="https://localhost:8000/mcp")
        request = McpOperationRequest.create(
            profile=profile,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
        )

        def client_factory() -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://localhost:8000",
                timeout=timedelta(seconds=5),
            )

        async def invoke() -> None:
            async with app.router.lifespan_context(app):
                with pytest.raises(McpCapabilityDriftError, match="capability changed"):
                    await McpUpstreamClient(profile, client_factory).call_operation(
                        request,
                        McpGatewayOperation(request.operation_id),
                    )

        asyncio.run(invoke())

        assert calls == []

    def test_rejects_malformed_upstream_structured_result(self):
        server = FastMCP("upstream", stateless_http=True)

        @server.tool(name="fabric.list_entities")
        def list_entities() -> dict[str, list[str]]:
            return {"unexpected": []}

        @server.tool(name="fabric.get_schema")
        def get_schema() -> dict[str, list[str]]:
            return {"columns": []}

        @server.tool(name="fabric.search_ontology")
        def search_ontology() -> dict[str, list[str]]:
            return {"results": []}

        app = server.streamable_http_app()
        profile = replace(_profile(), endpoint="https://localhost:8000/mcp")
        request = McpOperationRequest.create(
            profile=profile,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
        )

        def client_factory() -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://localhost:8000",
                timeout=timedelta(seconds=5),
            )

        async def invoke() -> None:
            async with app.router.lifespan_context(app):
                with pytest.raises(McpResultValidationError, match="unsupported schema"):
                    await McpUpstreamClient(profile, client_factory).call_operation(
                        request,
                        McpGatewayOperation(request.operation_id),
                    )

        asyncio.run(invoke())

    def test_maps_upstream_policy_denial_to_safe_error(self):
        server = FastMCP("upstream", stateless_http=True)

        @server.tool(name="fabric.list_entities")
        def list_entities() -> dict[str, object]:
            raise PermissionError("upstream-policy-detail")

        @server.tool(name="fabric.get_schema")
        def get_schema() -> dict[str, list[str]]:
            return {"columns": []}

        @server.tool(name="fabric.search_ontology")
        def search_ontology() -> dict[str, list[str]]:
            return {"results": []}

        app = server.streamable_http_app()
        profile = replace(_profile(), endpoint="https://localhost:8000/mcp")
        request = McpOperationRequest.create(
            profile=profile,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
        )

        def client_factory() -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://localhost:8000",
                timeout=timedelta(seconds=5),
            )

        async def invoke() -> None:
            async with app.router.lifespan_context(app):
                with pytest.raises(
                    McpUpstreamUnavailableError,
                    match="rejected",
                ) as error:
                    await McpUpstreamClient(profile, client_factory).call_operation(
                        request,
                        McpGatewayOperation(request.operation_id),
                    )
                assert "upstream-policy-detail" not in str(error.value)

        asyncio.run(invoke())

    def test_maps_operation_timeout_to_safe_error(self):
        server = FastMCP("upstream", stateless_http=True)

        @server.tool(name="fabric.list_entities")
        async def list_entities() -> dict[str, object]:
            await asyncio.sleep(0.1)
            return {
                "result_schema_version": "v1",
                "source_reference": {
                    "source_id": "fabric:workspace-1:ontology-2",
                    "snapshot_id": "snapshot-1",
                },
                "items": [],
            }

        @server.tool(name="fabric.get_schema")
        def get_schema() -> dict[str, list[str]]:
            return {"columns": []}

        @server.tool(name="fabric.search_ontology")
        def search_ontology() -> dict[str, list[str]]:
            return {"results": []}

        app = server.streamable_http_app()
        profile = replace(
            _profile(),
            endpoint="https://localhost:8000/mcp",
            limits=replace(_profile().limits, total_timeout_seconds=0.01),
        )
        request = McpOperationRequest.create(
            profile=profile,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
        )

        def client_factory() -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://localhost:8000",
                timeout=timedelta(seconds=5),
            )

        async def invoke() -> None:
            async with app.router.lifespan_context(app):
                with pytest.raises(McpUpstreamUnavailableError, match="unavailable"):
                    await McpUpstreamClient(profile, client_factory).call_operation(
                        request,
                        McpGatewayOperation(request.operation_id),
                    )

        asyncio.run(invoke())

    def test_discards_result_when_operation_is_cancelled_before_completion(self):
        server = FastMCP("upstream", stateless_http=True)

        @server.tool(name="fabric.list_entities")
        async def list_entities() -> dict[str, object]:
            await asyncio.sleep(0.05)
            return {
                "result_schema_version": "v1",
                "source_reference": {
                    "source_id": "fabric:workspace-1:ontology-2",
                    "snapshot_id": "snapshot-1",
                },
                "items": [],
            }

        @server.tool(name="fabric.get_schema")
        def get_schema() -> dict[str, list[str]]:
            return {"columns": []}

        @server.tool(name="fabric.search_ontology")
        def search_ontology() -> dict[str, list[str]]:
            return {"results": []}

        app = server.streamable_http_app()
        profile = replace(_profile(), endpoint="https://localhost:8000/mcp")
        request = McpOperationRequest.create(
            profile=profile,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
        )
        operation = McpGatewayOperation(request.operation_id)

        def client_factory() -> httpx.AsyncClient:
            return httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="https://localhost:8000",
                timeout=timedelta(seconds=5),
            )

        async def invoke() -> None:
            async with app.router.lifespan_context(app):
                task = asyncio.create_task(
                    McpUpstreamClient(profile, client_factory).call_operation(
                        request, operation
                    )
                )
                await asyncio.sleep(0.01)
                assert operation.cancel() is True
                with pytest.raises(McpOperationCancelledError, match="cancelled"):
                    await task

        asyncio.run(invoke())
