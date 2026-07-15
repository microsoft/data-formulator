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
    caller_subject: str
    profile_id: str
    operation: str
    source_reference: McpSourceReference
    state: McpApprovalState


@dataclass
class _ApprovalRecord:
    caller_subject: str
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
        caller_subject: str,
        profile_id: str,
        operation: str,
        source_reference: McpSourceReference,
    ) -> McpApprovalRequest:
        _validate_request_fields(
            caller_subject=caller_subject,
            profile_id=profile_id,
            operation=operation,
        )

        approval_id = token_urlsafe(32)
        record = _ApprovalRecord(
            caller_subject=caller_subject,
            profile_id=profile_id,
            operation=operation,
            source_reference=source_reference,
            state=McpApprovalState.PENDING,
        )
        with self._lock:
            self._records[approval_id] = record
        return self._snapshot(approval_id, record)

    def approve(self, approval_id: str, *, caller_subject: str) -> bool:
        return self._transition(
            approval_id,
            caller_subject=caller_subject,
            target=McpApprovalState.APPROVED,
        )

    def deny(self, approval_id: str, *, caller_subject: str) -> bool:
        return self._transition(
            approval_id,
            caller_subject=caller_subject,
            target=McpApprovalState.DENIED,
        )

    def consume(
        self,
        approval_id: str,
        *,
        caller_subject: str,
        profile_id: str,
        operation: str,
        source_reference: McpSourceReference,
    ) -> bool:
        with self._lock:
            record = self._records.get(approval_id)
            if (
                record is None
                or record.state is not McpApprovalState.APPROVED
                or not _matches_scope(
                    record,
                    caller_subject=caller_subject,
                    profile_id=profile_id,
                    operation=operation,
                    source_reference=source_reference,
                )
            ):
                return False
            record.state = McpApprovalState.CONSUMED
            return True

    def confirm_and_consume(
        self,
        approval_id: str,
        *,
        caller_subject: str,
        profile_id: str,
        operation: str,
        source_reference: McpSourceReference,
    ) -> bool:
        """Atomically confirm and consume one caller-owned approval scope."""
        with self._lock:
            record = self._records.get(approval_id)
            if (
                record is None
                or record.state is not McpApprovalState.PENDING
                or not _matches_scope(
                    record,
                    caller_subject=caller_subject,
                    profile_id=profile_id,
                    operation=operation,
                    source_reference=source_reference,
                )
            ):
                return False
            record.state = McpApprovalState.CONSUMED
            return True

    def _transition(
        self,
        approval_id: str,
        *,
        caller_subject: str,
        target: McpApprovalState,
    ) -> bool:
        with self._lock:
            record = self._records.get(approval_id)
            if (
                record is None
                or record.state is not McpApprovalState.PENDING
                or record.caller_subject != caller_subject
            ):
                return False
            record.state = target
            return True

    @staticmethod
    def _snapshot(approval_id: str, record: _ApprovalRecord) -> McpApprovalRequest:
        return McpApprovalRequest(
            approval_id=approval_id,
            caller_subject=record.caller_subject,
            profile_id=record.profile_id,
            operation=record.operation,
            source_reference=record.source_reference,
            state=record.state,
        )


def _validate_request_fields(
    *,
    caller_subject: str,
    profile_id: str,
    operation: str,
) -> None:
    if not caller_subject.strip() or not profile_id.strip() or not operation.strip():
        raise ValueError("caller_subject, profile_id, and operation must be nonempty")


def _matches_scope(
    record: _ApprovalRecord,
    *,
    caller_subject: str,
    profile_id: str,
    operation: str,
    source_reference: McpSourceReference,
) -> bool:
    return (
        record.caller_subject == caller_subject
        and record.profile_id == profile_id
        and record.operation == operation
        and record.source_reference == source_reference
    )
