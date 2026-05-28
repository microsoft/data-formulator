"""Tests for /api/agent/chart-insight route.

Validates input validation (missing image, missing model, non-vision model),
success path, and agent error handling via AppError.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.errors import AppError, ErrorCode

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def app():
    """Minimal Flask app with agent_bp and error handlers registered."""
    test_app = flask.Flask(__name__)
    test_app.config["TESTING"] = True

    from data_formulator.error_handler import register_error_handlers
    from data_formulator.routes.agents import agent_bp
    test_app.register_blueprint(agent_bp)
    register_error_handlers(test_app)

    return test_app


@pytest.fixture()
def client(app):
    return app.test_client()


def _valid_body(**overrides):
    body = {
        "chart_image": "iVBORw0KGgoAAAA==",
        "chart_type": "Bar Chart",
        "field_names": ["x", "y"],
        "input_tables": [{"name": "t1", "rows": [{"x": 1}]}],
        "model": {"provider": "openai", "model": "gpt-4o", "name": "gpt-4o"},
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

class TestChartInsightValidation:

    def test_non_json_request_returns_error(self, client) -> None:
        resp = client.post(
            "/api/agent/chart-insight",
            data="not json",
            content_type="text/plain",
        )
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == ErrorCode.INVALID_REQUEST

    def test_missing_chart_image_returns_error(self, client) -> None:
        resp = client.post(
            "/api/agent/chart-insight",
            json=_valid_body(chart_image=""),
        )
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == ErrorCode.VALIDATION_ERROR

    def test_missing_model_returns_error(self, client) -> None:
        resp = client.post(
            "/api/agent/chart-insight",
            json=_valid_body(model=None),
        )
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == ErrorCode.INVALID_REQUEST


# ---------------------------------------------------------------------------
# Success path
# ---------------------------------------------------------------------------

class TestChartInsightSuccess:

    @patch("data_formulator.routes.agents._get_knowledge_store")
    @patch("data_formulator.routes.agents.get_workspace")
    @patch("data_formulator.routes.agents.get_identity_id", return_value="test-user")
    @patch("data_formulator.routes.agents.get_client")
    @patch("data_formulator.routes.agents.ChartInsightAgent")
    def test_success_returns_title_and_takeaways(
        self,
        MockAgent,
        mock_get_client,
        mock_get_identity,
        mock_get_workspace,
        mock_get_ks,
        client,
    ) -> None:
        agent_instance = MagicMock()
        agent_instance.run.return_value = [{
            "status": "ok",
            "title": "Key Insights",
            "takeaways": ["Point A", "Point B"],
        }]
        MockAgent.return_value = agent_instance

        resp = client.post("/api/agent/chart-insight", json=_valid_body())
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "success"
        assert data["data"]["title"] == "Key Insights"
        assert data["data"]["takeaways"] == ["Point A", "Point B"]


# ---------------------------------------------------------------------------
# Agent failure paths
# ---------------------------------------------------------------------------

class TestChartInsightAgentErrors:

    @patch("data_formulator.routes.agents._get_knowledge_store")
    @patch("data_formulator.routes.agents.get_workspace")
    @patch("data_formulator.routes.agents.get_identity_id", return_value="test-user")
    @patch("data_formulator.routes.agents.get_client")
    @patch("data_formulator.routes.agents.ChartInsightAgent")
    def test_empty_candidates_returns_agent_error(
        self, MockAgent, mock_client, mock_id, mock_ws, mock_ks, client,
    ) -> None:
        MockAgent.return_value.run.return_value = []

        resp = client.post("/api/agent/chart-insight", json=_valid_body())
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == ErrorCode.AGENT_ERROR

    @patch("data_formulator.routes.agents._get_knowledge_store")
    @patch("data_formulator.routes.agents.get_workspace")
    @patch("data_formulator.routes.agents.get_identity_id", return_value="test-user")
    @patch("data_formulator.routes.agents.get_client")
    @patch("data_formulator.routes.agents.ChartInsightAgent")
    def test_candidate_status_not_ok_returns_agent_error(
        self, MockAgent, mock_client, mock_id, mock_ws, mock_ks, client,
    ) -> None:
        MockAgent.return_value.run.return_value = [{"status": "error", "content": "parse fail"}]

        resp = client.post("/api/agent/chart-insight", json=_valid_body())
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == ErrorCode.AGENT_ERROR

    @patch("data_formulator.routes.agents._get_knowledge_store")
    @patch("data_formulator.routes.agents.get_workspace")
    @patch("data_formulator.routes.agents.get_identity_id", return_value="test-user")
    @patch("data_formulator.routes.agents.get_client")
    @patch("data_formulator.routes.agents.ChartInsightAgent")
    def test_llm_exception_returns_classified_error(
        self, MockAgent, mock_client, mock_id, mock_ws, mock_ks, client,
    ) -> None:
        exc = Exception("Error code: 401 - Unauthorized, invalid api key")
        MockAgent.return_value.run.side_effect = exc

        resp = client.post("/api/agent/chart-insight", json=_valid_body())
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] in (
            ErrorCode.LLM_AUTH_FAILED,
            ErrorCode.LLM_UNKNOWN_ERROR,
        )
