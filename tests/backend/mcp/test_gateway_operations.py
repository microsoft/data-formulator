"""Tests for terminal operation handling in the governed MCP gateway."""

from __future__ import annotations

import pytest

from data_formulator.mcp_gateway.operations import (
    McpGatewayOperation,
    McpGatewayOperationState,
)

pytestmark = [pytest.mark.backend]


class TestMcpGatewayOperation:
    def test_cancellation_prevents_late_completion(self):
        operation = McpGatewayOperation("operation-1")

        assert operation.cancel() is True
        assert operation.state is McpGatewayOperationState.CANCELLED
        assert operation.complete() is False
        assert operation.state is McpGatewayOperationState.CANCELLED

    def test_completion_prevents_later_cancellation(self):
        operation = McpGatewayOperation("operation-1")

        assert operation.complete() is True
        assert operation.state is McpGatewayOperationState.COMPLETED
        assert operation.cancel() is False
        assert operation.state is McpGatewayOperationState.COMPLETED

    def test_operation_identifier_must_be_nonempty(self):
        with pytest.raises(ValueError, match="operation_id"):
            McpGatewayOperation("")
