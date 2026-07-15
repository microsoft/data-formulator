"""Tests for startup-owned governed MCP operation execution."""

from __future__ import annotations

import asyncio

import pytest

from data_formulator.mcp.errors import (
    McpApprovalRequiredError,
    McpProfileNotFoundError,
    McpUpstreamUnavailableError,
)
from data_formulator.mcp.profile import (
    McpOperation,
    McpServerProfile,
    McpSourceReference,
)
from data_formulator.mcp_gateway.approval import McpApprovalGate
from data_formulator.mcp_gateway.contracts import McpOperationResult
from data_formulator.mcp_gateway.registry import McpProfileRegistry
from data_formulator.mcp_gateway.service import (
    McpGatewayApprovalCoordinator,
    McpGatewayOperationService,
)

pytestmark = [pytest.mark.backend]


def _profile(*, require_approval: bool) -> McpServerProfile:
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
        "require_approval": require_approval,
    })


class RecordingUpstreamClient:
    def __init__(self) -> None:
        self.request = None
        self.gateway_operation = None

    async def call_operation(self, request, gateway_operation) -> McpOperationResult:
        self.request = request
        self.gateway_operation = gateway_operation
        return McpOperationResult(
            profile_id=request.profile_id,
            operation=request.operation,
            source_reference=request.source_reference,
            items=({"name": "orders"},),
            next_page=None,
        )


class BlockingUpstreamClient(RecordingUpstreamClient):
    def __init__(self) -> None:
        super().__init__()
        self.call_count = 0
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def call_operation(self, request, gateway_operation) -> McpOperationResult:
        self.call_count += 1
        self.started.set()
        await self.release.wait()
        return await super().call_operation(request, gateway_operation)


class FailingUpstreamClient:
    def __init__(self) -> None:
        self.call_count = 0

    async def call_operation(self, request, gateway_operation) -> McpOperationResult:
        self.call_count += 1
        raise McpUpstreamUnavailableError("MCP upstream is unavailable")


class TestMcpGatewayOperationService:
    def test_executes_unapproved_profile_with_matching_client(self):
        profile = _profile(require_approval=False)
        upstream_client = RecordingUpstreamClient()
        constructed_profiles: list[McpServerProfile] = []
        service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: (
                constructed_profiles.append(resolved_profile) or upstream_client
            ),
        )
        source_reference = McpSourceReference(
            source_id="fabric:workspace-1:ontology-2",
            snapshot_id="snapshot-1",
        )

        result = asyncio.run(service.execute(
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=source_reference,
            arguments={"query": "orders"},
            operation_id="operation-1",
            page=1,
        ))

        assert result.items == ({"name": "orders"},)
        assert constructed_profiles == [profile]
        assert upstream_client.request.profile_id == profile.profile_id
        assert upstream_client.request.operation is McpOperation.CATALOG
        assert upstream_client.request.source_reference == source_reference
        assert upstream_client.request.arguments == {"query": "orders"}
        assert upstream_client.gateway_operation.operation_id == "operation-1"

    def test_rejects_unknown_profile_before_constructing_client(self):
        constructed_profiles: list[McpServerProfile] = []
        service = McpGatewayOperationService(
            registry=McpProfileRegistry([_profile(require_approval=False)]),
            upstream_client_factory=lambda profile: constructed_profiles.append(profile),
        )

        with pytest.raises(McpProfileNotFoundError, match="not configured"):
            asyncio.run(service.execute(
                profile_id="unknown-profile",
                operation=McpOperation.CATALOG,
                source_reference=McpSourceReference(
                    source_id="fabric:workspace-1:ontology-2",
                    snapshot_id="snapshot-1",
                ),
                arguments={},
                operation_id="operation-1",
                page=1,
            ))

        assert constructed_profiles == []

    def test_blocks_approval_required_profile_before_constructing_client(self):
        constructed_profiles: list[McpServerProfile] = []
        service = McpGatewayOperationService(
            registry=McpProfileRegistry([_profile(require_approval=True)]),
            upstream_client_factory=lambda profile: constructed_profiles.append(profile),
        )

        with pytest.raises(McpApprovalRequiredError, match="approval"):
            asyncio.run(service.execute(
                profile_id="fabric-pilot",
                operation=McpOperation.CATALOG,
                source_reference=McpSourceReference(
                    source_id="fabric:workspace-1:ontology-2",
                    snapshot_id="snapshot-1",
                ),
                arguments={},
                operation_id="operation-1",
                page=1,
            ))

        assert constructed_profiles == []


class TestMcpGatewayApprovalCoordinator:
    def test_executes_the_stored_request_after_owner_confirms(self):
        profile = _profile(require_approval=True)
        upstream_client = RecordingUpstreamClient()
        constructed_profiles: list[McpServerProfile] = []
        operation_service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: (
                constructed_profiles.append(resolved_profile) or upstream_client
            ),
        )
        coordinator = McpGatewayApprovalCoordinator(
            operation_service=operation_service,
            approval_gate=McpApprovalGate(),
        )
        source_reference = McpSourceReference(
            source_id="fabric:workspace-1:ontology-2",
            snapshot_id="snapshot-1",
        )

        coordinator.request_approval(
            caller_subject="data-formulator-user",
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=source_reference,
            arguments={"query": "orders"},
            operation_id="operation-1",
            page=1,
        )

        assert constructed_profiles == []

        result = asyncio.run(coordinator.confirm_and_execute(
            caller_subject="data-formulator-user",
            operation_id="operation-1",
        ))

        assert result.items == ({"name": "orders"},)
        assert constructed_profiles == [profile]
        assert upstream_client.request.profile_id == profile.profile_id
        assert upstream_client.request.operation is McpOperation.CATALOG
        assert upstream_client.request.source_reference == source_reference
        assert upstream_client.request.arguments == {"query": "orders"}
        assert upstream_client.request.operation_id == "operation-1"
        assert upstream_client.request.page == 1

    def test_rejects_confirmation_by_a_different_caller(self):
        profile = _profile(require_approval=True)
        constructed_profiles: list[McpServerProfile] = []
        operation_service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: (
                constructed_profiles.append(resolved_profile)
            ),
        )
        coordinator = McpGatewayApprovalCoordinator(
            operation_service=operation_service,
            approval_gate=McpApprovalGate(),
        )
        coordinator.request_approval(
            caller_subject="data-formulator-user",
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
            page=1,
        )

        with pytest.raises(McpApprovalRequiredError, match="approval"):
            asyncio.run(coordinator.confirm_and_execute(
                caller_subject="different-user",
                operation_id="operation-1",
            ))

            assert constructed_profiles == []

    def test_owner_can_deny_pending_operation_without_constructing_client(self):
        profile = _profile(require_approval=True)
        constructed_profiles: list[McpServerProfile] = []
        operation_service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: (
                constructed_profiles.append(resolved_profile)
            ),
        )
        coordinator = McpGatewayApprovalCoordinator(
            operation_service=operation_service,
            approval_gate=McpApprovalGate(),
        )
        coordinator.request_approval(
            caller_subject="data-formulator-user",
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
            page=1,
        )

        coordinator.deny(
            caller_subject="data-formulator-user",
            operation_id="operation-1",
        )

        with pytest.raises(McpApprovalRequiredError, match="approval"):
            asyncio.run(coordinator.confirm_and_execute(
                caller_subject="data-formulator-user",
                operation_id="operation-1",
            ))
        with pytest.raises(McpApprovalRequiredError, match="approval"):
            coordinator.deny(
                caller_subject="data-formulator-user",
                operation_id="operation-1",
            )
        assert constructed_profiles == []

    def test_different_caller_cannot_deny_owner_pending_operation(self):
        profile = _profile(require_approval=True)
        upstream_client = RecordingUpstreamClient()
        operation_service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: upstream_client,
        )
        coordinator = McpGatewayApprovalCoordinator(
            operation_service=operation_service,
            approval_gate=McpApprovalGate(),
        )
        coordinator.request_approval(
            caller_subject="data-formulator-user",
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
            page=1,
        )

        with pytest.raises(McpApprovalRequiredError, match="approval"):
            coordinator.deny(
                caller_subject="different-user",
                operation_id="operation-1",
            )

        result = asyncio.run(coordinator.confirm_and_execute(
            caller_subject="data-formulator-user",
            operation_id="operation-1",
        ))
        assert result.items == ({"name": "orders"},)

    def test_concurrent_confirmations_execute_upstream_once(self):
        profile = _profile(require_approval=True)
        upstream_client = BlockingUpstreamClient()
        operation_service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: upstream_client,
        )
        coordinator = McpGatewayApprovalCoordinator(
            operation_service=operation_service,
            approval_gate=McpApprovalGate(),
        )
        coordinator.request_approval(
            caller_subject="data-formulator-user",
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
            page=1,
        )

        async def confirm_twice() -> McpOperationResult:
            first_confirmation = asyncio.create_task(
                coordinator.confirm_and_execute(
                    caller_subject="data-formulator-user",
                    operation_id="operation-1",
                )
            )
            await upstream_client.started.wait()
            with pytest.raises(McpApprovalRequiredError, match="approval"):
                await coordinator.confirm_and_execute(
                    caller_subject="data-formulator-user",
                    operation_id="operation-1",
                )
            upstream_client.release.set()
            return await first_confirmation

        result = asyncio.run(confirm_twice())

        assert result.items == ({"name": "orders"},)
        assert upstream_client.call_count == 1

    def test_confirmation_wins_over_denial_after_upstream_execution_starts(self):
        profile = _profile(require_approval=True)
        upstream_client = BlockingUpstreamClient()
        operation_service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: upstream_client,
        )
        coordinator = McpGatewayApprovalCoordinator(
            operation_service=operation_service,
            approval_gate=McpApprovalGate(),
        )
        coordinator.request_approval(
            caller_subject="data-formulator-user",
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
            page=1,
        )

        async def confirm_then_deny() -> McpOperationResult:
            confirmation = asyncio.create_task(coordinator.confirm_and_execute(
                caller_subject="data-formulator-user",
                operation_id="operation-1",
            ))
            await upstream_client.started.wait()
            with pytest.raises(McpApprovalRequiredError, match="approval"):
                coordinator.deny(
                    caller_subject="data-formulator-user",
                    operation_id="operation-1",
                )
            upstream_client.release.set()
            return await confirmation

        result = asyncio.run(confirm_then_deny())

        assert result.items == ({"name": "orders"},)
        assert upstream_client.call_count == 1

    def test_upstream_failure_after_consumption_cannot_be_replayed(self):
        profile = _profile(require_approval=True)
        upstream_client = FailingUpstreamClient()
        operation_service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: upstream_client,
        )
        coordinator = McpGatewayApprovalCoordinator(
            operation_service=operation_service,
            approval_gate=McpApprovalGate(),
        )
        coordinator.request_approval(
            caller_subject="data-formulator-user",
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
            page=1,
        )

        with pytest.raises(McpUpstreamUnavailableError, match="unavailable"):
            asyncio.run(coordinator.confirm_and_execute(
                caller_subject="data-formulator-user",
                operation_id="operation-1",
            ))
        with pytest.raises(McpApprovalRequiredError, match="approval"):
            asyncio.run(coordinator.confirm_and_execute(
                caller_subject="data-formulator-user",
                operation_id="operation-1",
            ))

        assert upstream_client.call_count == 1

    def test_unknown_and_replayed_operation_ids_have_same_error(self):
        profile = _profile(require_approval=True)
        operation_service = McpGatewayOperationService(
            registry=McpProfileRegistry([profile]),
            upstream_client_factory=lambda resolved_profile: RecordingUpstreamClient(),
        )
        coordinator = McpGatewayApprovalCoordinator(
            operation_service=operation_service,
            approval_gate=McpApprovalGate(),
        )
        coordinator.request_approval(
            caller_subject="data-formulator-user",
            profile_id=profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-2",
                snapshot_id="snapshot-1",
            ),
            arguments={},
            operation_id="operation-1",
            page=1,
        )
        coordinator.deny(
            caller_subject="data-formulator-user",
            operation_id="operation-1",
        )

        with pytest.raises(McpApprovalRequiredError) as replayed:
            coordinator.deny(
                caller_subject="data-formulator-user",
                operation_id="operation-1",
            )
        with pytest.raises(McpApprovalRequiredError) as unknown:
            coordinator.deny(
                caller_subject="data-formulator-user",
                operation_id="unknown-operation",
            )

        assert str(replayed.value) == str(unknown.value)
