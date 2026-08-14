from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from data_formulator.datalake.workspace_metadata import WorkspaceLock

from .models import (
    DataOperation,
    DataOperationStatus,
    FailedOperationStep,
    OperationError,
)


STORE_FILENAME = "data_operations.json"
STORE_VERSION = 1


class DataOperationConflictError(ValueError):
    pass


@dataclass(frozen=True)
class StoredDataOperation:
    conversation_id: str
    operation: DataOperation

    def to_dict(self) -> dict[str, Any]:
        return {
            "conversation_id": self.conversation_id,
            "operation": self.operation.to_dict(),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> StoredDataOperation:
        return cls(
            conversation_id=str(value["conversation_id"]),
            operation=DataOperation.from_dict(value["operation"]),
        )


class DataOperationRepository:
    def __init__(self, workspace_path: Path):
        self._workspace_path = workspace_path
        self._store_path = workspace_path / STORE_FILENAME

    @classmethod
    def for_workspace(cls, workspace) -> DataOperationRepository:
        return cls(workspace.confined_scratch.root / "data_operations")

    def create(
        self,
        operation: DataOperation,
        *,
        conversation_id: str,
    ) -> DataOperation:
        if not conversation_id.strip():
            raise ValueError("conversation_id is required")

        with WorkspaceLock(self._workspace_path):
            records = self._read_unlocked()
            if any(record.operation.id == operation.id for record in records):
                raise DataOperationConflictError(
                    f"Data operation already exists: {operation.id}"
                )

            updated: list[StoredDataOperation] = []
            for record in records:
                current = record.operation
                if (
                    record.conversation_id == conversation_id
                    and current.status == DataOperationStatus.AWAITING_SELECTION
                ):
                    current = replace(
                        current,
                        status=DataOperationStatus.SUPERSEDED,
                        superseded_by_operation_id=operation.id,
                    )
                updated.append(replace(record, operation=current))
            updated.append(StoredDataOperation(conversation_id, operation))
            self._write_unlocked(updated)
        return operation

    def get(self, operation_id: str) -> DataOperation | None:
        with WorkspaceLock(self._workspace_path):
            for record in self._read_unlocked():
                if record.operation.id == operation_id:
                    return record.operation
        return None

    def get_awaiting_selection(self, operation_id: str) -> DataOperation:
        operation = self.get(operation_id)
        if operation is None:
            raise KeyError(f"Unknown data operation: {operation_id}")
        if operation.status != DataOperationStatus.AWAITING_SELECTION:
            raise DataOperationConflictError(
                f"Data operation is not awaiting selection: {operation.id}"
            )
        return operation

    def select(self, operation_id: str, plan_id: str) -> DataOperation:
        with WorkspaceLock(self._workspace_path):
            records = self._read_unlocked()
            selected: DataOperation | None = None
            updated: list[StoredDataOperation] = []
            for record in records:
                operation = record.operation
                if operation.id == operation_id:
                    operation = self._select_operation(operation, plan_id)
                    selected = operation
                updated.append(replace(record, operation=operation))

            if selected is None:
                raise KeyError(f"Unknown data operation: {operation_id}")
            self._write_unlocked(updated)
            return selected

    def complete(
        self,
        operation_id: str,
        result_table_ids: tuple[str, ...],
    ) -> DataOperation:
        return self._record_execution(
            operation_id,
            status=DataOperationStatus.LOADED,
            result_table_ids=result_table_ids,
        )

    def fail(
        self,
        operation_id: str,
        error: OperationError,
    ) -> DataOperation:
        return self._record_execution(
            operation_id,
            status=DataOperationStatus.FAILED,
            error=error,
        )

    def finish(
        self,
        operation_id: str,
        result_table_ids: tuple[str, ...],
        failed_steps: tuple[FailedOperationStep, ...],
    ) -> DataOperation:
        if failed_steps and result_table_ids:
            status = DataOperationStatus.PARTIALLY_LOADED
            error = None
        elif failed_steps:
            status = DataOperationStatus.FAILED
            error = OperationError(
                code="data_operation_failed",
                message="No tables could be loaded.",
            )
        else:
            status = DataOperationStatus.LOADED
            error = None
        return self._record_execution(
            operation_id,
            status=status,
            result_table_ids=result_table_ids,
            error=error,
            failed_steps=failed_steps,
        )

    def _record_execution(
        self,
        operation_id: str,
        *,
        status: DataOperationStatus,
        result_table_ids: tuple[str, ...] = (),
        error: OperationError | None = None,
        failed_steps: tuple[FailedOperationStep, ...] = (),
    ) -> DataOperation:
        with WorkspaceLock(self._workspace_path):
            records = self._read_unlocked()
            recorded: DataOperation | None = None
            updated: list[StoredDataOperation] = []
            for record in records:
                operation = record.operation
                if operation.id == operation_id:
                    if (
                        operation.status == status
                        and operation.result_table_ids == result_table_ids
                        and operation.error == error
                        and operation.failed_steps == failed_steps
                    ):
                        recorded = operation
                    elif operation.status != DataOperationStatus.RUNNING:
                        raise DataOperationConflictError(
                            f"Data operation is not running: {operation.id}"
                        )
                    else:
                        operation = replace(
                            operation,
                            status=status,
                            result_table_ids=result_table_ids,
                            error=error,
                            failed_steps=failed_steps,
                        )
                        recorded = operation
                updated.append(replace(record, operation=operation))

            if recorded is None:
                raise KeyError(f"Unknown data operation: {operation_id}")
            self._write_unlocked(updated)
            return recorded

    @staticmethod
    def _select_operation(operation: DataOperation, plan_id: str) -> DataOperation:
        if not any(plan.id == plan_id for plan in operation.plans):
            raise KeyError(f"Unknown plan {plan_id} for operation {operation.id}")
        if operation.selected_plan_id == plan_id:
            return operation
        if operation.status != DataOperationStatus.AWAITING_SELECTION:
            raise DataOperationConflictError(
                f"Data operation is not awaiting selection: {operation.id}"
            )
        return replace(
            operation,
            status=DataOperationStatus.RUNNING,
            selected_plan_id=plan_id,
        )

    def _read_unlocked(self) -> list[StoredDataOperation]:
        if not self._store_path.exists():
            return []
        with self._store_path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        if payload.get("version") != STORE_VERSION:
            raise ValueError(
                f"Unsupported data operation store version: {payload.get('version')!r}"
            )
        records = payload.get("operations")
        if not isinstance(records, list):
            raise ValueError("Data operation store requires operations[]")
        return [StoredDataOperation.from_dict(item) for item in records]

    def _write_unlocked(self, records: list[StoredDataOperation]) -> None:
        self._workspace_path.mkdir(parents=True, exist_ok=True)
        file_descriptor, temp_path = tempfile.mkstemp(
            dir=self._workspace_path,
            prefix=".data_operations_",
            suffix=".json.tmp",
            text=True,
        )
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as file:
                json.dump(
                    {
                        "version": STORE_VERSION,
                        "operations": [record.to_dict() for record in records],
                    },
                    file,
                    ensure_ascii=False,
                    indent=2,
                )
                file.write("\n")
            os.replace(temp_path, self._store_path)
        except Exception:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise


def resolve_interaction_response(
    repository: DataOperationRepository,
    response: dict[str, Any],
) -> str:
    operation_id = str(response.get("operation_id", "")).strip()
    if not operation_id:
        raise ValueError("interaction_response.operation_id is required")

    action = response.get("action")
    plan_id = str(response.get("plan_id", "")).strip()
    if action == "elaborate":
        if plan_id:
            raise ValueError("Elaborate response must not include plan_id")
        repository.get_awaiting_selection(operation_id)
        return "Elaborate on the proposed loading options."
    if action is not None:
        raise ValueError(f"Unsupported interaction response action: {action!r}")
    if not plan_id:
        raise ValueError("interaction_response.plan_id is required")

    operation = repository.select(operation_id, plan_id)
    selected_plan = next(plan for plan in operation.plans if plan.id == plan_id)
    return f"Selected loading option: {selected_plan.label}"