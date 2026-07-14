"""Tests for scope-bound user approvals of governed MCP operations."""

from __future__ import annotations

import pytest

from data_formulator.mcp.profile import McpSourceReference
from data_formulator.mcp_gateway.approval import McpApprovalGate, McpApprovalState

pytestmark = [pytest.mark.backend]


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
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        )

        assert request.state is McpApprovalState.PENDING
        assert gate.approve(request.approval_id) is True
        assert gate.consume(
            request.approval_id,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is True
        assert gate.consume(
            request.approval_id,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is False

    def test_approval_cannot_be_reused_for_different_source(self, source_reference):
        gate = McpApprovalGate()
        request = gate.request(
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        )
        gate.approve(request.approval_id)

        assert gate.consume(
            request.approval_id,
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
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        )

        assert gate.deny(request.approval_id) is True
        assert gate.consume(
            request.approval_id,
            profile_id="fabric-pilot",
            operation="semantic_query",
            source_reference=source_reference,
        ) is False

    def test_unknown_approval_cannot_be_approved(self):
        assert McpApprovalGate().approve("unknown") is False
