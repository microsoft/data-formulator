"""Tests for scope-bound user approvals of governed MCP operations."""

from __future__ import annotations

import pytest

from data_formulator.mcp.profile import McpSourceReference
from data_formulator.mcp_gateway.approval import McpApprovalGate, McpApprovalState

pytestmark = [pytest.mark.backend]

CALLER_SUBJECT = "data-formulator-user"


@pytest.fixture
def source_reference():
    return McpSourceReference(
        source_id="fabric:workspace-1:ontology-2",
        snapshot_id="2026-07-14T16:00:00Z",
    )


class TestMcpApprovalGate:
    def test_approved_request_can_be_consumed_once_for_exact_scope(self, source_reference):
        gate = McpApprovalGate()
        request = gate.request(
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        )

        assert request.state is McpApprovalState.PENDING
        assert gate.approve(request.approval_id, caller_subject=CALLER_SUBJECT) is True
        assert gate.consume(
            request.approval_id,
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is True
        assert gate.consume(
            request.approval_id,
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is False

    def test_approval_cannot_be_reused_for_different_source(self, source_reference):
        gate = McpApprovalGate()
        request = gate.request(
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        )
        gate.approve(request.approval_id, caller_subject=CALLER_SUBJECT)

        assert gate.consume(
            request.approval_id,
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-3",
                snapshot_id="2026-07-14T16:00:00Z",
            ),
        ) is False

    def test_denied_approval_cannot_be_consumed(self, source_reference):
        gate = McpApprovalGate()
        request = gate.request(
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        )

        assert gate.deny(request.approval_id, caller_subject=CALLER_SUBJECT) is True
        assert gate.consume(
            request.approval_id,
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is False

    def test_unknown_approval_cannot_be_approved(self):
        assert McpApprovalGate().approve(
            "unknown", caller_subject=CALLER_SUBJECT
        ) is False

    def test_confirmation_requires_the_requesting_caller_subject(self, source_reference):
        gate = McpApprovalGate()
        request = gate.request(
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        )

        assert gate.confirm_and_consume(
            request.approval_id,
            caller_subject="different-user",
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is False
        assert gate.confirm_and_consume(
            request.approval_id,
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is True
        assert gate.confirm_and_consume(
            request.approval_id,
            caller_subject=CALLER_SUBJECT,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is False
