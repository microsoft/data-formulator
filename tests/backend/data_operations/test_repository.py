import json
from pathlib import Path

import pytest

from data_formulator.data_operations import (
    ConnectorQueryStep,
    DataOperation,
    DataOperationConflictError,
    DataOperationPlan,
    DataOperationRepository,
    DataOperationStatus,
    FailedOperationStep,
    OperationError,
    resolve_interaction_response,
)


def _operation(operation_id: str, plan_id: str) -> DataOperation:
    return DataOperation(
        id=operation_id,
        reason="Load orders",
        plans=(DataOperationPlan(
            id=plan_id,
            label="Recent orders",
            summary="Orders since January",
            steps=(ConnectorQueryStep(
                source_id="warehouse",
                table_key="public.orders",
                display_name="Recent orders",
                source_table="public.orders",
            ),),
        ),),
    )


def test_repository_round_trips_full_executable_operation(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    operation = _operation("operation-1", "plan-1")

    repository.create(operation, conversation_id="conversation-1")

    assert repository.get(operation.id) == operation
    payload = json.loads((tmp_path / "data_operations.json").read_text())
    step = payload["operations"][0]["operation"]["plans"][0]["steps"][0]
    assert step["source_id"] == "warehouse"
    assert step["table_key"] == "public.orders"


def test_create_supersedes_only_same_conversation(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    first = _operation("operation-1", "plan-1")
    other = _operation("operation-2", "plan-2")
    replacement = _operation("operation-3", "plan-3")
    repository.create(first, conversation_id="conversation-1")
    repository.create(other, conversation_id="conversation-2")

    repository.create(replacement, conversation_id="conversation-1")

    superseded = repository.get(first.id)
    assert superseded is not None
    assert superseded.status == DataOperationStatus.SUPERSEDED
    assert superseded.superseded_by_operation_id == replacement.id
    assert repository.get(other.id) == other


def test_select_is_idempotent_and_rejects_conflicts(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    operation = _operation("operation-1", "plan-1")
    repository.create(operation, conversation_id="conversation-1")

    selected = repository.select(operation.id, "plan-1")
    assert selected.status == DataOperationStatus.RUNNING
    assert selected.selected_plan_id == "plan-1"
    assert repository.select(operation.id, "plan-1") == selected

    with pytest.raises(KeyError, match="Unknown plan"):
        repository.select(operation.id, "tampered-plan")


def test_interaction_response_returns_trusted_plan_label(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    operation = _operation("operation-1", "plan-1")
    repository.create(operation, conversation_id="conversation-1")

    prompt = resolve_interaction_response(repository, {
        "operation_id": operation.id,
        "plan_id": "plan-1",
    })

    assert prompt == "Selected loading option: Recent orders"


def test_elaborate_requires_an_awaiting_operation(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    operation = _operation("operation-1", "plan-1")
    repository.create(operation, conversation_id="conversation-1")
    assert resolve_interaction_response(repository, {
        "operation_id": operation.id,
        "action": "elaborate",
    }) == "Elaborate on the proposed loading options."

    repository.select(operation.id, "plan-1")
    with pytest.raises(DataOperationConflictError, match="not awaiting selection"):
        resolve_interaction_response(repository, {
            "operation_id": operation.id,
            "action": "elaborate",
        })


def test_execution_transitions_are_atomic_and_idempotent(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    operation = _operation("operation-1", "plan-1")
    repository.create(operation, conversation_id="conversation-1")
    repository.select(operation.id, "plan-1")

    loaded = repository.complete(operation.id, ("recent_orders",))
    assert loaded.status == DataOperationStatus.LOADED
    assert loaded.result_table_ids == ("recent_orders",)
    assert repository.complete(operation.id, ("recent_orders",)) == loaded

    with pytest.raises(DataOperationConflictError, match="not running"):
        repository.fail(operation.id, OperationError("late_failure", "Too late"))


def test_failed_execution_records_typed_error(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    operation = _operation("operation-1", "plan-1")
    repository.create(operation, conversation_id="conversation-1")
    repository.select(operation.id, "plan-1")

    error = OperationError("connector_error", "Source unavailable")
    failed = repository.fail(operation.id, error)

    assert failed.status == DataOperationStatus.FAILED
    assert failed.error == error
    assert repository.fail(operation.id, error) == failed


def test_repository_lives_under_ephemeral_workspace_scratch(tmp_path: Path) -> None:
    from data_formulator.datalake.workspace import Workspace

    workspace = Workspace("test-user", root_dir=tmp_path)
    repository = DataOperationRepository.for_workspace(workspace)
    operation = _operation("operation-1", "plan-1")

    repository.create(operation, conversation_id="conversation-1")

    store = workspace.confined_scratch.root / "data_operations" / "data_operations.json"
    assert store.exists()
    assert not (workspace.confined_root.root / "data_operations.json").exists()


def test_finish_records_partial_result(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    operation = _operation("operation-1", "plan-1")
    repository.create(operation, conversation_id="conversation-1")
    repository.select(operation.id, "plan-1")
    failed_step = FailedOperationStep(
        step_index=1,
        display_name="Customers",
        error=OperationError("connector_error", "Customers could not be loaded."),
    )

    result = repository.finish(
        operation.id,
        ("orders",),
        (failed_step,),
    )

    assert result.status == DataOperationStatus.PARTIALLY_LOADED
    assert result.result_table_ids == ("orders",)
    assert result.failed_steps == (failed_step,)


def test_select_rejects_superseded_operation(tmp_path: Path) -> None:
    repository = DataOperationRepository(tmp_path)
    first = _operation("operation-1", "plan-1")
    repository.create(first, conversation_id="conversation-1")
    repository.create(
        _operation("operation-2", "plan-2"),
        conversation_id="conversation-1",
    )

    with pytest.raises(DataOperationConflictError, match="not awaiting selection"):
        repository.select(first.id, "plan-1")