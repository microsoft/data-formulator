"""Single-use approval records for governed MCP operations."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from secrets import token_urlsafe
from threading import Lock

from data_formulator.mcp.profile import McpSourceReference


class McpApprovalState(str, Enum):
    """Lifecycle states for a user approval request."""

    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CONSUMED = "consumed"


@dataclass(frozen=True)
class McpApprovalRequest:
    """A user-visible approval request bound to one exact operation scope."""

    approval_id: str
    profile_id: str
    operation: str
    source_reference: McpSourceReference
    state: McpApprovalState


@dataclass
class _ApprovalRecord:
    profile_id: str
    operation: str
    source_reference: McpSourceReference
    state: McpApprovalState


class McpApprovalGate:
    """Create, approve, deny, and consume scope-bound operation approvals."""

    def __init__(self) -> None:
        self._records: dict[str, _ApprovalRecord] = {}
        self._lock = Lock()

    def request(
        self,
        *,
        profile_id: str,
        operation: str,
        source_reference: McpSourceReference,
    ) -> McpApprovalRequest:
        if not profile_id.strip() or not operation.strip():
            raise ValueError("profile_id and operation must be nonempty")

        approval_id = token_urlsafe(32)
        record = _ApprovalRecord(
            profile_id=profile_id,
            operation=operation,
            source_reference=source_reference,
            state=McpApprovalState.PENDING,
        )
        with self._lock:
            self._records[approval_id] = record
        return self._snapshot(approval_id, record)

    def approve(self, approval_id: str) -> bool:
        return self._transition(approval_id, McpApprovalState.APPROVED)

    def deny(self, approval_id: str) -> bool:
        return self._transition(approval_id, McpApprovalState.DENIED)

    def consume(
        self,
        approval_id: str,
        *,
        profile_id: str,
        operation: str,
        source_reference: McpSourceReference,
    ) -> bool:
        with self._lock:
            record = self._records.get(approval_id)
            if (
                record is None
                or record.state is not McpApprovalState.APPROVED
                or record.profile_id != profile_id
                or record.operation != operation
                or record.source_reference != source_reference
            ):
                return False
            record.state = McpApprovalState.CONSUMED
            return True

    def _transition(self, approval_id: str, target: McpApprovalState) -> bool:
        with self._lock:
            record = self._records.get(approval_id)
            if record is None or record.state is not McpApprovalState.PENDING:
                return False
            record.state = target
            return True

    @staticmethod
    def _snapshot(approval_id: str, record: _ApprovalRecord) -> McpApprovalRequest:
        return McpApprovalRequest(
            approval_id=approval_id,
            profile_id=record.profile_id,
            operation=record.operation,
            source_reference=record.source_reference,
            state=record.state,
        )
