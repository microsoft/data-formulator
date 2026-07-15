"""Startup-owned execution for fixed governed MCP operations."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from typing import Protocol

from data_formulator.mcp.errors import (
    McpApprovalRequiredError,
    McpOperationValidationError,
)
from data_formulator.mcp.profile import (
    McpOperation,
    McpServerProfile,
    McpSourceReference,
)
from data_formulator.mcp_gateway.approval import McpApprovalGate, McpApprovalRequest
from data_formulator.mcp_gateway.contracts import (
    McpOperationRequest,
    McpOperationResult,
)
from data_formulator.mcp_gateway.operations import McpGatewayOperation
from data_formulator.mcp_gateway.registry import McpProfileRegistry


class McpUpstreamOperationClient(Protocol):
    """Call a validated fixed operation against one approved upstream profile."""

    async def call_operation(
        self,
        request: McpOperationRequest,
        gateway_operation: McpGatewayOperation,
    ) -> McpOperationResult:
        """Execute one validated operation."""


class McpGatewayOperationService:
    """Resolve startup-owned profiles before delegating fixed operations upstream."""

    def __init__(
        self,
        *,
        registry: McpProfileRegistry,
        upstream_client_factory: Callable[
            [McpServerProfile],
            McpUpstreamOperationClient,
        ],
    ) -> None:
        self._registry = registry
        self._upstream_client_factory = upstream_client_factory

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
        """Execute an unapproved read operation through its resolved profile."""
        profile, request = self.prepare_request(
            profile_id=profile_id,
            operation=operation,
            source_reference=source_reference,
            arguments=arguments,
            operation_id=operation_id,
            page=page,
        )
        if profile.require_approval:
            raise McpApprovalRequiredError("MCP operation requires user approval")
        return await self.execute_request(profile=profile, request=request)

    def prepare_request(
        self,
        *,
        profile_id: str,
        operation: McpOperation,
        source_reference: McpSourceReference,
        arguments: dict[str, object],
        operation_id: str,
        page: int,
    ) -> tuple[McpServerProfile, McpOperationRequest]:
        """Validate an immutable request against its startup-owned profile."""
        profile = self._registry.get(profile_id)
        request = McpOperationRequest.create(
            profile=profile,
            operation=operation,
            source_reference=source_reference,
            arguments=arguments,
            operation_id=operation_id,
            page=page,
        )
        return profile, request

    async def execute_request(
        self,
        *,
        profile: McpServerProfile,
        request: McpOperationRequest,
    ) -> McpOperationResult:
        """Execute one previously validated immutable request."""
        gateway_operation = McpGatewayOperation(request.operation_id)
        upstream_client = self._upstream_client_factory(profile)
        return await upstream_client.call_operation(request, gateway_operation)


@dataclass(frozen=True)
class _PendingApprovalOperation:
    approval_id: str
    profile: McpServerProfile
    request: McpOperationRequest


class McpGatewayApprovalCoordinator:
    """Retain and execute one approval-required request for its authenticated caller."""

    def __init__(
        self,
        *,
        operation_service: McpGatewayOperationService,
        approval_gate: McpApprovalGate,
    ) -> None:
        self._operation_service = operation_service
        self._approval_gate = approval_gate
        self._pending: dict[tuple[str, str], _PendingApprovalOperation] = {}
        self._lock = Lock()

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
    ) -> McpApprovalRequest:
        """Store one validated approval-required operation without calling upstream."""
        profile, request = self._operation_service.prepare_request(
            profile_id=profile_id,
            operation=operation,
            source_reference=source_reference,
            arguments=arguments,
            operation_id=operation_id,
            page=page,
        )
        if not profile.require_approval:
            raise McpOperationValidationError("MCP operation does not require approval")

        key = (caller_subject, request.operation_id)
        with self._lock:
            if key in self._pending:
                raise McpOperationValidationError("MCP operation identifier is already pending")
            approval = self._approval_gate.request(
                caller_subject=caller_subject,
                profile_id=request.profile_id,
                operation=request.operation.value,
                source_reference=request.source_reference,
            )
            pending = _PendingApprovalOperation(
                approval_id=approval.approval_id,
                profile=profile,
                request=request,
            )
            self._pending[key] = pending
        return approval

    async def confirm_and_execute(
        self,
        *,
        caller_subject: str,
        operation_id: str,
    ) -> McpOperationResult:
        """Consume an owner-confirmed request before executing its exact stored scope."""
        key = (caller_subject, operation_id)
        with self._lock:
            pending = self._pending.get(key)
            if pending is None or not self._approval_gate.confirm_and_consume(
                pending.approval_id,
                caller_subject=caller_subject,
                profile_id=pending.request.profile_id,
                operation=pending.request.operation.value,
                source_reference=pending.request.source_reference,
            ):
                raise McpApprovalRequiredError("MCP operation approval is unavailable")
            del self._pending[key]

        return await self._operation_service.execute_request(
            profile=pending.profile,
            request=pending.request,
        )

    def deny(
        self,
        *,
        caller_subject: str,
        operation_id: str,
    ) -> None:
        """Deny and remove one caller-owned pending operation."""
        key = (caller_subject, operation_id)
        with self._lock:
            pending = self._pending.get(key)
            if pending is None or not self._approval_gate.deny(
                pending.approval_id,
                caller_subject=caller_subject,
            ):
                raise McpApprovalRequiredError("MCP operation approval is unavailable")
            del self._pending[key]
