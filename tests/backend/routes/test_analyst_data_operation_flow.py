from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import flask
import pyarrow as pa
import pytest

from data_formulator.data_operations import (
    ConnectorQueryStep,
    DataOperation,
    DataOperationPlan,
    DataOperationRepository,
    FailedOperationStep,
    LoadQuery,
    OperationError,
    DataOperationStatus,
)
from data_formulator.data_operations.executor import DataOperationExecutionResult
from data_formulator.data_loader.query_runtime import QueryCancelled
from data_formulator.datalake.workspace import Workspace
from data_formulator.datalake.catalog_cache import save_catalog
from data_formulator.agent_config import ANALYST_EXECUTION_DEFAULTS


pytestmark = [pytest.mark.backend]


class _Loader:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def fetch_data_as_arrow(self, source_table: str, import_options: dict):
        self.calls.append((source_table, import_options))
        return pa.table({"id": [1, 2], "amount": [10.0, 20.0]})

    def get_safe_params(self):
        return {}

    def preview_data(self, source_table, import_options):
        from data_formulator.data_loader.external_data_loader import ExternalDataLoader
        return ExternalDataLoader.format_preview(self.fetch_data_as_arrow(source_table, import_options), import_options)

    def query_data_as_arrow(self, source_table, query, limit):
        self.calls.append((source_table, {"query": query, "limit": limit}))
        return pa.table({"total": [30.0]})

    def query_model(self, source_table):
        return "relational"

    def validate_native_query(self, language, text):
        pass

    def check_native_query(self, native):
        from data_formulator.data_loader.external_data_loader import ExternalDataLoader
        ExternalDataLoader.check_native_query(self, native)


@pytest.mark.parametrize("aggregate", [False, True, "native"])
def test_operation_preview_is_bounded_and_display_only(
    agents_client,
    tmp_path: Path,
    aggregate: bool,
) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    plan = DataOperationPlan(
        id="plan-1",
        label="Recent orders",
        summary="",
        steps=(ConnectorQueryStep(
            source_id="warehouse",
            table_key="public.orders",
            display_name="Recent orders",
            source_table="public.orders",
            query=LoadQuery.from_dict({"limit": 100, **({"native": {"language": "kql", "text": "orders | summarize total=sum(amount)"}} if aggregate == "native" else {"aggregates": [
                {"op": "sum", "column": "amount", "as": "total"},
            ]} if aggregate else {})}),
        ),),
    )
    operation = DataOperation(id="operation-1", reason="Choose orders", plans=(plan,))
    DataOperationRepository.for_workspace(workspace).create(
        operation,
        conversation_id="conversation-1",
    )
    save_catalog(workspace.user_home, "warehouse", [{
        "table_key": "public.orders",
        "name": "orders",
        "metadata": {"source_description": "Customer orders from the warehouse"},
    }])
    loader = _Loader()
    loader.query_capabilities = lambda: {"native_query_languages": ["kql"]}

    with (
        patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
        patch("data_formulator.routes.agents.get_workspace", return_value=workspace),
        patch("data_formulator.data_connector.resolve_live_loader", return_value=loader),
    ):
        response = agents_client.post(
            "/api/agent/data-operation-preview",
            json={"operation_id": operation.id, "plan_id": plan.id},
        )

    assert response.status_code == 200
    inspection = response.get_json()["data"]["previews"][0]["inspection"]
    assert inspection["row_limit"] == 50
    assert inspection["sample_method"] == ("native_query" if aggregate == "native" else "aggregate" if aggregate else "source_head")
    assert response.get_json()["data"] == {"previews": [{
        "display_name": "Recent orders",
        "source_id": "warehouse",
        "table_description": "Customer orders from the warehouse",
        "columns": ["total"] if aggregate else ["id", "amount"],
        "rows": [{"total": 30.0}] if aggregate else [{"id": 1, "amount": 10.0}, {"id": 2, "amount": 20.0}],
        "inspection": inspection,
    }]}
    assert loader.calls == [("public.orders", {"query": plan.steps[0].query.to_dict(), "limit": 50}
                            if aggregate else {"size": 50})]


def test_operation_preview_failure_keeps_table_shape(
    agents_client,
    tmp_path: Path,
) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    plan = DataOperationPlan(
        id="plan-1",
        label="Recent orders",
        summary="",
        steps=(ConnectorQueryStep(
            source_id="warehouse",
            table_key="public.orders",
            display_name="Recent orders",
            source_table="public.orders",
            query=LoadQuery(limit=100),
        ),),
    )
    operation = DataOperation(id="operation-1", reason="Choose orders", plans=(plan,))
    DataOperationRepository.for_workspace(workspace).create(
        operation,
        conversation_id="conversation-1",
    )

    with (
        patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
        patch("data_formulator.routes.agents.get_workspace", return_value=workspace),
        patch(
            "data_formulator.data_connector.resolve_live_loader",
            side_effect=RuntimeError("Warehouse unavailable"),
        ),
    ):
        response = agents_client.post(
            "/api/agent/data-operation-preview",
            json={"operation_id": operation.id, "plan_id": plan.id},
        )

    assert response.status_code == 200
    preview = response.get_json()["data"]["previews"][0]
    assert preview["display_name"] == "Recent orders"
    assert preview["source_id"] == "warehouse"
    assert preview["error"] == "Warehouse unavailable"
    assert preview["columns"] == []
    assert preview["rows"] == []


@pytest.fixture()
def agents_client():
    from data_formulator.routes.agents import agent_bp

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.config["CLI_ARGS"] = {}
    app.register_blueprint(agent_bp)
    return app.test_client()


@pytest.mark.parametrize("max_iterations", [None, 5])
def test_analyst_request_resolves_execution_defaults(agents_client, tmp_path: Path, max_iterations) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    with (
        patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
        patch("data_formulator.routes.agents.get_client"),
        patch("data_formulator.routes.agents.get_workspace", return_value=workspace),
        patch("data_formulator.routes.agents.AnalystAgent") as analyst_agent,
    ):
        analyst_agent.return_value.run.return_value = iter([{"type": "completion"}])
        response = agents_client.post("/api/agent/analyst-streaming", json={
            "model": {}, "input_tables": [], "user_question": "Summarize orders",
            **({"max_iterations": max_iterations} if max_iterations is not None else {}),
        }, buffered=True)
    assert json.loads(response.data.decode("utf-8"))["type"] == "completion"
    config = analyst_agent.call_args.kwargs["execution_config"]
    assert config.max_actions == (max_iterations if max_iterations is not None else ANALYST_EXECUTION_DEFAULTS.max_actions)
    assert config.max_tool_rounds_per_action == ANALYST_EXECUTION_DEFAULTS.max_tool_rounds_per_action
    assert "max_repair_attempts" not in analyst_agent.call_args.kwargs


@pytest.mark.parametrize("max_iterations", [0, -1, True, "10", 1.5, None])
def test_invalid_action_budget_is_rejected_before_execution(agents_client, max_iterations) -> None:
    with (
        patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
        patch("data_formulator.routes.agents.get_workspace") as get_workspace,
        patch("data_formulator.routes.agents.AnalystAgent") as analyst_agent,
    ):
        response = agents_client.post("/api/agent/analyst-streaming", json={
            "model": {}, "input_tables": [], "user_question": "Find orders", "max_iterations": max_iterations,
        }, buffered=True)
    event = json.loads(response.data.decode("utf-8"))
    assert event["status"] == "error"
    assert response.mimetype == "application/json"
    assert "positive integer" in response.data.decode("utf-8")
    get_workspace.assert_not_called()
    analyst_agent.assert_not_called()


def test_selected_operation_executes_then_resumes_analysis(
    agents_client,
    tmp_path: Path,
) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    repository = DataOperationRepository.for_workspace(workspace)
    plan = DataOperationPlan(
        id="plan-1",
        label="Recent orders",
        summary="",
        steps=(ConnectorQueryStep(
            source_id="warehouse",
            table_key="public.orders",
            display_name="Recent orders",
            source_table="public.orders",
            query=LoadQuery(limit=100),
        ),),
    )
    operation = DataOperation(
        id="operation-1",
        reason="Choose orders",
        plans=(plan,),
    )
    repository.create(operation, conversation_id="conversation-1")

    with (
        patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
        patch("data_formulator.routes.agents.get_client") as get_client,
        patch("data_formulator.routes.agents.get_workspace", return_value=workspace),
        patch("data_formulator.data_connector.resolve_live_loader", return_value=_Loader()),
        patch("data_formulator.routes.agents.AnalystAgent") as analyst_agent,
    ):
        analyst_agent.return_value.run.return_value = iter([{
            "type": "completion", "summary": "Orders total 30.",
        }])
        response = agents_client.post(
            "/api/agent/analyst-streaming",
            json={
                "model": {},
                "input_tables": [],
                "user_question": "Recent orders",
                "trajectory": [
                    {"role": "user", "content": "Find orders and calculate their total."},
                    {"role": "assistant", "content": "Choose"},
                ],
                "conversation_id": "conversation-1",
                "interaction_response": {
                    "operation_id": operation.id,
                    "plan_id": plan.id,
                },
            },
            buffered=True,
        )

    events = [
        json.loads(line)
        for line in response.data.decode("utf-8").splitlines()
    ]
    assert [event["type"] for event in events] == ["tool_start", "tool_result", "data_operation_result", "completion"]
    assert events[-2]["operation"]["status"] == "loaded"
    assert events[-2]["operation"]["result_table_ids"] == ["recent_orders"]
    get_client.assert_called_once()
    run_kwargs = analyst_agent.return_value.run.call_args.kwargs
    assert run_kwargs["input_tables"] == [{"name": "recent_orders", "rows": [], "virtual": True}]
    assert run_kwargs["trajectory"][0]["content"] == "Find orders and calculate their total."
    assert "Workspace loading finished" in run_kwargs["trajectory"][-1]["content"]
    assert '"compute_ready": true' in run_kwargs["trajectory"][-1]["content"]

    persisted = repository.get(operation.id)
    assert persisted is not None
    assert persisted.status == DataOperationStatus.LOADED
    assert persisted.result_table_ids == ("recent_orders",)
    assert workspace.read_data_as_df("recent_orders")["id"].tolist() == [1, 2]

    with (
        patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
        patch("data_formulator.routes.agents.get_client") as retry_get_client,
        patch("data_formulator.routes.agents.get_workspace", return_value=workspace),
        patch("data_formulator.data_connector.resolve_live_loader") as loader_resolver,
        patch("data_formulator.routes.agents.AnalystAgent") as retry_agent,
    ):
        retry_agent.return_value.run.return_value = iter([{"type": "completion"}])
        retry_response = agents_client.post(
            "/api/agent/analyst-streaming",
            json={
                "model": {},
                "input_tables": [],
                "user_question": "Recent orders",
                "trajectory": [{"role": "assistant", "content": "Choose"}],
                "conversation_id": "conversation-1",
                "interaction_response": {
                    "operation_id": operation.id,
                    "plan_id": plan.id,
                },
            },
        )

    retry_events = [json.loads(line) for line in retry_response.data.decode("utf-8").splitlines()]
    assert [event["type"] for event in retry_events] == ["data_operation_result", "completion"]
    assert retry_events[0]["operation"]["result_table_ids"] == ["recent_orders"]
    retry_get_client.assert_called_once()
    loader_resolver.assert_not_called()
    retry_agent.return_value.run.assert_called_once()


@pytest.mark.parametrize("outcome", ["virtual", "partial", "failed", "exception", "cancelled"])
def test_approval_continuation_observes_load_outcome(agents_client, tmp_path: Path, outcome: str) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    repository = DataOperationRepository.for_workspace(workspace)
    plan = DataOperationPlan(label="Orders", summary="", steps=(ConnectorQueryStep(
        source_id="warehouse", table_key="orders", source_table="orders", display_name="Orders",
    ),))
    operation = DataOperation(reason="Choose orders", plans=(plan,))
    repository.create(operation, conversation_id="conversation-1")
    reference = {
        "kind": "external-table-reference", "id": "external:warehouse:orders",
        "connectorId": "warehouse", "tableKey": "orders", "displayName": "Orders",
        "sourceTable": {"id": "orders", "name": "Orders"},
        "capturedAt": "2026-09-28T00:00:00Z", "summary": {"columns": []},
    }
    existing_reference = {**reference, "id": "external:warehouse:customers", "tableKey": "customers"}
    failures = (FailedOperationStep(0, "Orders", OperationError("LOAD_FAILED", "Query failed")),)
    result = DataOperationExecutionResult(
        result_table_ids=(),
        failed_steps=failures if outcome in {"partial", "failed"} else (),
        result_references=(reference,) if outcome in {"virtual", "partial"} else (),
    )
    with (
        patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
        patch("data_formulator.routes.agents.get_client"),
        patch("data_formulator.routes.agents.get_workspace", return_value=workspace),
        patch("data_formulator.data_operations.DataOperationExecutor.execute", return_value=result) as execute,
        patch("data_formulator.routes.agents.AnalystAgent") as analyst_agent,
    ):
        if outcome == "exception":
            execute.side_effect = RuntimeError("Warehouse unavailable")
        elif outcome == "cancelled":
            execute.side_effect = QueryCancelled()
        analyst_agent.return_value.run.return_value = iter([{"type": "completion"}])
        response = agents_client.post("/api/agent/analyst-streaming", json={
            "model": {}, "input_tables": [], "external_references": [existing_reference],
            "user_question": "Orders", "completed_step_count": 2,
            "trajectory": [{"role": "user", "content": "Show yearly revenue"}],
            "conversation_id": "conversation-1",
            "interaction_response": {"operation_id": operation.id, "plan_id": plan.id},
        }, buffered=True)

    execute.assert_called_once()
    events = [json.loads(line) for line in response.data.decode("utf-8").splitlines()]
    if outcome == "cancelled":
        analyst_agent.assert_not_called()
        assert not any(event["type"] == "data_operation_result" for event in events)
        assert repository.get(operation.id).error.code == "CANCELLED"
        return
    assert [event["type"] for event in events] == ["tool_start", "tool_result", "data_operation_result", "completion"]
    expected_status = "loaded" if outcome == "virtual" else "partially_loaded" if outcome == "partial" else "failed"
    assert events[-2]["operation"]["status"] == expected_status
    run_kwargs = analyst_agent.return_value.run.call_args.kwargs
    assert run_kwargs["completed_step_count"] == 2
    assert run_kwargs["input_tables"] == []
    assert run_kwargs["trajectory"][0]["content"] == "Show yearly revenue"
    observation = json.loads(run_kwargs["trajectory"][-1]["content"].split("\n", 2)[2])
    assert observation["status"] == expected_status
    assert observation["workspace_inputs"] == []
    assert observation.get("failed_steps", []) == [item.to_dict() for item in result.failed_steps]
    assert run_kwargs["external_references"] == [existing_reference, *result.result_references]
    if result.result_references:
        assert observation["load_outcomes"][0]["compute_ready"] is False
    if outcome == "exception":
        assert observation["error"]["message"]


def test_expired_operation_resumes_analyst_for_rediscovery(
    agents_client,
    tmp_path: Path,
) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)

    with (
        patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
        patch("data_formulator.routes.agents.get_client", return_value=object()),
        patch("data_formulator.routes.agents.get_workspace", return_value=workspace),
        patch("data_formulator.routes.agents.AnalystAgent") as analyst_agent,
    ):
        analyst_agent.return_value.run.return_value = iter([{
            "type": "completion",
            "message": "I will rediscover the source.",
        }])
        response = agents_client.post(
            "/api/agent/analyst-streaming",
            json={
                "model": {},
                "input_tables": [],
                "user_question": "Recent orders",
                "trajectory": [{"role": "assistant", "content": "Choose"}],
                "conversation_id": "conversation-1",
                "interaction_response": {
                    "operation_id": "expired-operation",
                    "plan_id": "expired-plan",
                },
            },
        )

    event = json.loads(response.data.decode("utf-8").strip())
    assert event["type"] == "completion"
    run_kwargs = analyst_agent.return_value.run.call_args.kwargs
    assert "proposal expired" in run_kwargs["user_question"]
    assert "rediscover" in run_kwargs["user_question"]
    assert run_kwargs["trajectory"][-1]["content"] == run_kwargs["user_question"]