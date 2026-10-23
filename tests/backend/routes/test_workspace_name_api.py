"""Tests for workspace naming and lightweight helper model routing.

The endpoint is used by the frontend auto-naming hook and must preserve the
selected model payload so both server-managed and user-managed models work.
"""
from __future__ import annotations

import pytest
from unittest.mock import patch

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def flask_client():
    from data_formulator.app import app

    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


class TestWorkspaceNameEndpoint:
    @pytest.mark.parametrize(
        "model_config",
        [
            {
                "id": "global-openai-gpt-4o",
                "endpoint": "openai",
                "model": "gpt-4o",
                "is_global": True,
            },
            {
                "id": "user-openai-gpt-4o",
                "endpoint": "openai",
                "model": "gpt-4o",
                "api_key": "sk-user-key",
                "api_base": "https://api.openai.com/v1",
            },
        ],
    )
    def test_workspace_name_uses_selected_model_payload(self, flask_client, model_config):
        client_obj = object()

        with (
            patch("data_formulator.routes.agents.get_client", return_value=client_obj) as get_client,
            patch("data_formulator.routes.agents.get_language_instruction", return_value="LANG") as get_lang,
            patch("data_formulator.routes.agents.SimpleAgents") as simple_agents,
        ):
            simple_agents.return_value.workspace_name.return_value = "销售分析"

            resp = flask_client.post(
                "/api/agent/workspace-name",
                json={
                    "model": model_config,
                    "context": {
                        "tables": ["Orders"],
                        "userQuery": "分析销售趋势",
                    },
                },
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert body["data"] == {"display_name": "销售分析"}

        get_client.assert_called_once_with(model_config, use_small_model=True)
        get_lang.assert_called_once_with(mode="full")
        simple_agents.assert_called_once_with(client=client_obj, language_instruction="LANG")
        simple_agents.return_value.workspace_name.assert_called_once_with(
            table_names=["Orders"],
            user_query="分析销售趋势",
        )

    def test_workspace_name_requires_model(self, flask_client):
        resp = flask_client.post(
            "/api/agent/workspace-name",
            json={"context": {"tables": ["Orders"]}},
        )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "INVALID_REQUEST"


@pytest.mark.parametrize("route,agent_name,payload,result", [
    (
        "sort-data", "SortDataAgent",
        {"field": "month", "items": ["March", "January"]},
        [{"status": "ok", "content": {"sorted_values": ["January", "March"]}}],
    ),
    (
        "derive-starter-questions", "StarterQuestionsAgent",
        {"input_tables": [{"name": "Orders", "columns": ["revenue"]}]},
        ["Compare revenue across orders"],
    ),
    (
        "code-expl", "CodeExplanationAgent",
        {"input_tables": [], "code": "result_df = source_df.copy()"},
        [{"status": "ok", "concepts": []}],
    ),
])
def test_helper_routes_use_small_model(flask_client, route, agent_name, payload, result):
    model_config = {
        "endpoint": "openai", "model": "gpt-4o", "small_model": "gpt-4o-mini",
    }
    client_obj = object()
    with (
        patch("data_formulator.routes.agents.get_client", return_value=client_obj) as get_client,
        patch("data_formulator.routes.agents.get_workspace"),
        patch(f"data_formulator.routes.agents.{agent_name}") as agent,
    ):
        agent.return_value.run.return_value = result
        response = flask_client.post(
            f"/api/agent/{route}", json={"model": model_config, **payload},
        )

    assert response.status_code == 200
    assert response.get_json()["status"] == "success"
    get_client.assert_called_once_with(model_config, use_small_model=True)
    assert agent.call_args.kwargs["client"] is client_obj
    agent.return_value.run.assert_called_once()
