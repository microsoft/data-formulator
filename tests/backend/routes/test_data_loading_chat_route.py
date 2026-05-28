"""Tests for /api/agent/data-loading-chat route.

Validates input validation, message forwarding (including image attachments),
and agent error handling via NDJSON streaming.
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
        "model": {"provider": "openai", "model": "gpt-4o", "name": "gpt-4o"},
        "messages": [{"role": "user", "content": "load some data"}],
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

class TestDataLoadingChatValidation:

    def test_non_json_request_returns_error(self, client) -> None:
        resp = client.post(
            "/api/agent/data-loading-chat",
            data="not json",
            content_type="text/plain",
        )
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == ErrorCode.INVALID_REQUEST


# ---------------------------------------------------------------------------
# Success path — messages (with and without images) reach the agent
# ---------------------------------------------------------------------------

class TestDataLoadingChatSuccess:

    @patch("data_formulator.routes.agents._get_knowledge_store")
    @patch("data_formulator.routes.agents.get_language_instruction", return_value="")
    @patch("data_formulator.routes.agents.get_workspace")
    @patch("data_formulator.routes.agents.get_identity_id", return_value="test-user")
    @patch("data_formulator.routes.agents.get_client")
    @patch("data_formulator.routes.agents.DataLoadingAgent")
    def test_messages_forwarded_to_agent(
        self, MockAgent, mock_client, mock_id, mock_ws, mock_lang, mock_ks, client,
    ) -> None:
        """Ensures the `messages` variable is properly parsed and passed to
        agent.stream(). This is the regression test for the NameError bug where
        `messages` was accidentally deleted."""
        agent_instance = MagicMock()
        agent_instance.stream.return_value = iter([
            {"type": "status", "content": "done"},
        ])
        MockAgent.return_value = agent_instance

        body = _valid_body()
        resp = client.post("/api/agent/data-loading-chat", json=body)
        assert resp.status_code == 200

        agent_instance.stream.assert_called_once()
        forwarded_messages = agent_instance.stream.call_args[0][0]
        assert forwarded_messages == body["messages"]

    @patch("data_formulator.routes.agents._get_knowledge_store")
    @patch("data_formulator.routes.agents.get_language_instruction", return_value="")
    @patch("data_formulator.routes.agents.get_workspace")
    @patch("data_formulator.routes.agents.get_identity_id", return_value="test-user")
    @patch("data_formulator.routes.agents.get_client")
    @patch("data_formulator.routes.agents.DataLoadingAgent")
    def test_image_messages_are_forwarded(
        self, MockAgent, mock_client, mock_id, mock_ws, mock_lang, mock_ks, client,
    ) -> None:
        """Image attachments in messages must reach the agent without being
        blocked by any pre-flight vision check."""
        agent_instance = MagicMock()
        agent_instance.stream.return_value = iter([
            {"type": "status", "content": "done"},
        ])
        MockAgent.return_value = agent_instance

        messages_with_image = [{
            "role": "user",
            "content": "extract data from this",
            "attachments": [{"type": "image", "name": "img.png", "url": "data:image/png;base64,abc"}],
        }]
        resp = client.post(
            "/api/agent/data-loading-chat",
            json=_valid_body(messages=messages_with_image),
        )
        assert resp.status_code == 200

        forwarded = agent_instance.stream.call_args[0][0]
        assert forwarded[0]["attachments"][0]["type"] == "image"


# ---------------------------------------------------------------------------
# Agent errors stream correctly
# ---------------------------------------------------------------------------

class TestDataLoadingChatErrors:

    @patch("data_formulator.routes.agents._get_knowledge_store")
    @patch("data_formulator.routes.agents.get_language_instruction", return_value="")
    @patch("data_formulator.routes.agents.get_workspace")
    @patch("data_formulator.routes.agents.get_identity_id", return_value="test-user")
    @patch("data_formulator.routes.agents.get_client")
    @patch("data_formulator.routes.agents.DataLoadingAgent")
    def test_agent_exception_streams_error_event(
        self, MockAgent, mock_client, mock_id, mock_ws, mock_lang, mock_ks, client,
    ) -> None:
        agent_instance = MagicMock()
        agent_instance.stream.side_effect = Exception(
            "Error code: 401 - Unauthorized"
        )
        MockAgent.return_value = agent_instance

        resp = client.post("/api/agent/data-loading-chat", json=_valid_body())
        assert resp.status_code == 200

        lines = [l for l in resp.data.decode().strip().split("\n") if l]
        assert len(lines) >= 1
        event = json.loads(lines[-1])
        assert event.get("type") == "error"
