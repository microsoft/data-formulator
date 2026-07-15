"""Terminal operation state used to discard late MCP results."""

from __future__ import annotations

from enum import Enum
from threading import Lock


class McpGatewayOperationState(str, Enum):
    """Lifecycle states for one gateway operation."""

    ACTIVE = "active"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class McpGatewayOperation:
    """Allow exactly one terminal outcome for a caller-owned operation."""

    def __init__(self, operation_id: str) -> None:
        if not operation_id.strip():
            raise ValueError("operation_id must be nonempty")
        self.operation_id = operation_id
        self._state = McpGatewayOperationState.ACTIVE
        self._lock = Lock()

    @property
    def state(self) -> McpGatewayOperationState:
        with self._lock:
            return self._state

    @property
    def is_active(self) -> bool:
        """Report whether an upstream result may still be delivered."""
        with self._lock:
            return self._state is McpGatewayOperationState.ACTIVE

    def cancel(self) -> bool:
        """Mark the operation cancelled and reject every late completion."""
        return self._transition(McpGatewayOperationState.CANCELLED)

    def complete(self) -> bool:
        """Mark the operation complete only while it remains active."""
        return self._transition(McpGatewayOperationState.COMPLETED)

    def _transition(self, target: McpGatewayOperationState) -> bool:
        with self._lock:
            if self._state is not McpGatewayOperationState.ACTIVE:
                return False
            self._state = target
            return True
