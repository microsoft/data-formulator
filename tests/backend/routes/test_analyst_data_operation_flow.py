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
    LoadQuery,
    DataOperationStatus,
)
from data_formulator.datalake.workspace import Workspace


pytestmark = [pytest.mark.backend]


class _Loader:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def fetch_data_as_arrow(self, source_table: str, import_options: dict):
        self.calls.append((source_table, import_options))
        return pa.table({"id": [1, 2], "amount": [10.0, 20.0]})

    def get_safe_params(self):
        return {}


def test_operation_preview_is_bounded_and_display_only(
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
    loader = _Loader()

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
    assert response.get_json()["data"] == {"previews": [{
        "display_name": "Recent orders",
        "source_id": "warehouse",
        "columns": ["id", "amount"],
        "rows": [{"id": 1, "amount": 10.0}, {"id": 2, "amount": 20.0}],
    }]}
    assert loader.calls == [("public.orders", {"size": 50})]


@pytest.fixture()
def agents_client():
    from data_formulator.routes.agents import agent_bp

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.config["CLI_ARGS"] = {}
    app.register_blueprint(agent_bp)
    return app.test_client()


def test_selected_operation_executes_without_model_turn(
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
        response = agents_client.post(
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

    events = [
        json.loads(line)
        for line in response.data.decode("utf-8").splitlines()
    ]
    assert [event["type"] for event in events] == ["data_operation_result"]
    assert events[0]["operation"]["status"] == "loaded"
    assert events[0]["operation"]["result_table_ids"] == ["recent_orders"]
    get_client.assert_not_called()
    analyst_agent.assert_not_called()

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

    retry_event = json.loads(retry_response.data.decode("utf-8").strip())
    assert retry_event["operation"]["result_table_ids"] == ["recent_orders"]
    retry_get_client.assert_not_called()
    loader_resolver.assert_not_called()
    retry_agent.assert_not_called()


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