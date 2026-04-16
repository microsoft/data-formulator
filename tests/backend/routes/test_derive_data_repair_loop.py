"""Integration tests for the derive-data and refine-data repair loop improvements.

Covers:
- Repair loop triggers on both 'error' and 'other error' statuses
- Empty results list does not crash (IndexError guard)
- Followup exceptions are caught gracefully with safe generic messages
- get-recommendation-questions never leaks exception details to the client
"""
from __future__ import annotations

import json
import shutil
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from data_formulator.routes.agents import agent_bp

pytestmark = [pytest.mark.backend]

MODULE = "data_formulator.routes.agents"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ok_result(code: str = "x = 1") -> dict:
    return {
        "status": "ok",
        "code": code,
        "content": {"rows": [], "virtual": {"table_name": "t", "row_count": 0}},
        "dialog": [{"role": "system", "content": "..."}],
        "agent": "DataRecAgent",
        "refined_goal": {},
    }


def _make_error_result(status: str = "error", content: str = "some error") -> dict:
    return {
        "status": status,
        "code": "bad_code()",
        "content": content,
        "dialog": [{"role": "system", "content": "..."}],
        "agent": "DataRecAgent",
        "refined_goal": {},
    }


@contextmanager
def _mock_workspace():
    """Yield a (mock_workspace, tmp_workspace_cm) that stubs out workspace deps."""
    ws = MagicMock()
    ws.list_tables.return_value = set()

    @contextmanager
    def fake_temp_data(ws_inner, temp_data):
        yield ws_inner

    yield ws, fake_temp_data


def _build_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["CLI_ARGS"] = {"max_display_rows": 100}
    app.register_blueprint(agent_bp)
    return app


def _derive_data_payload(**overrides) -> dict:
    base = {
        "token": "test-token",
        "model": {"endpoint": "openai", "model": "gpt-4", "api_key": "k", "api_base": "http://x"},
        "input_tables": [{"name": "t1", "rows": [{"a": 1}]}],
        "extra_prompt": "do something",
        "max_repair_attempts": 1,
    }
    base.update(overrides)
    return base


def _refine_data_payload(**overrides) -> dict:
    base = {
        "token": "test-token",
        "model": {"endpoint": "openai", "model": "gpt-4", "api_key": "k", "api_base": "http://x"},
        "input_tables": [{"name": "t1", "rows": [{"a": 1}]}],
        "dialog": [{"role": "system", "content": "..."}],
        "new_instruction": "fix it",
        "latest_data_sample": [{"a": 1}],
        "max_repair_attempts": 1,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# derive-data: repair loop status matching
# ---------------------------------------------------------------------------

class TestDeriveDataRepairLoop:

    def _post_derive(self, client, payload):
        return client.post(
            "/api/agent/derive-data",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_repair_loop_triggers_on_other_error(self) -> None:
        """'other error' status should enter the repair loop (not just 'error')."""
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.run.return_value = [_make_error_result(status="other error")]
        mock_agent.followup.return_value = [_make_ok_result()]

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.DataRecAgent", return_value=mock_agent),
                patch(f"{MODULE}.sign_result"),
            ):
                with app.test_client() as client:
                    resp = self._post_derive(client, _derive_data_payload())

        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["results"][0]["status"] == "ok"
        mock_agent.followup.assert_called_once()

    def test_repair_loop_skips_when_status_is_ok(self) -> None:
        """When initial result is 'ok', repair loop should not execute."""
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.run.return_value = [_make_ok_result()]

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.DataRecAgent", return_value=mock_agent),
                patch(f"{MODULE}.sign_result"),
            ):
                with app.test_client() as client:
                    resp = self._post_derive(client, _derive_data_payload())

        data = resp.get_json()
        assert data["results"][0]["status"] == "ok"
        mock_agent.followup.assert_not_called()

    def test_empty_results_does_not_crash(self) -> None:
        """If agent.run() returns an empty list, no IndexError should occur."""
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.run.return_value = []

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.DataRecAgent", return_value=mock_agent),
                patch(f"{MODULE}.sign_result"),
            ):
                with app.test_client() as client:
                    resp = self._post_derive(client, _derive_data_payload())

        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["results"] == []

    def test_followup_exception_is_caught(self) -> None:
        """If agent.followup() raises, the error should be caught and a safe
        classified message returned (no raw exception text)."""
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.run.return_value = [_make_error_result(status="error")]
        mock_agent.followup.side_effect = RuntimeError("LLM connection timeout")

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.DataRecAgent", return_value=mock_agent),
                patch(f"{MODULE}.sign_result"),
            ):
                with app.test_client() as client:
                    resp = self._post_derive(client, _derive_data_payload())

        data = resp.get_json()
        assert data["status"] == "ok"
        result = data["results"][0]
        assert result["status"] == "error"
        # classify_llm_error maps "timeout" → safe timeout message
        assert "timed out" in result["content"].lower() or "timeout" in result["content"].lower()
        # Raw exception text must not leak
        assert "LLM connection timeout" not in result["content"]


# ---------------------------------------------------------------------------
# refine-data: same repair loop tests
# ---------------------------------------------------------------------------

class TestRefineDataRepairLoop:

    def _post_refine(self, client, payload):
        return client.post(
            "/api/agent/refine-data",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_repair_loop_triggers_on_other_error(self) -> None:
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.followup.side_effect = [
            [_make_error_result(status="other error")],
            [_make_ok_result()],
        ]

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.DataTransformationAgent", return_value=mock_agent),
                patch(f"{MODULE}.sign_result"),
            ):
                with app.test_client() as client:
                    resp = self._post_refine(client, _refine_data_payload())

        data = resp.get_json()
        assert data["results"][0]["status"] == "ok"
        assert mock_agent.followup.call_count == 2

    def test_empty_results_does_not_crash(self) -> None:
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.followup.return_value = []

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.DataTransformationAgent", return_value=mock_agent),
                patch(f"{MODULE}.sign_result"),
            ):
                with app.test_client() as client:
                    resp = self._post_refine(client, _refine_data_payload())

        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["results"] == []

    def test_followup_exception_in_repair_is_caught(self) -> None:
        """Followup exception returns a safe classified message, not raw exception text."""
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.followup.side_effect = [
            [_make_error_result(status="error")],
            RuntimeError("API key expired"),
        ]

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.DataTransformationAgent", return_value=mock_agent),
                patch(f"{MODULE}.sign_result"),
            ):
                with app.test_client() as client:
                    resp = self._post_refine(client, _refine_data_payload())

        data = resp.get_json()
        result = data["results"][0]
        assert result["status"] == "error"
        # Raw exception text must not appear
        assert "API key expired" not in result["content"]
        # Should be classified as a model request failure (generic fallback)
        assert result["content"] in (
            "Model request failed",
            "Authentication failed — please check your API key",
        )


# ---------------------------------------------------------------------------
# get-recommendation-questions: error message uses classify_llm_error
# ---------------------------------------------------------------------------

class TestGetRecommendationQuestionsError:

    def test_error_message_is_classified_not_raw(self) -> None:
        """Error response uses classify_llm_error — safe pre-defined message,
        not the raw exception text."""
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.run.side_effect = ValueError("column 'x' not found in table")

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.InteractiveExploreAgent", return_value=mock_agent),
            ):
                with app.test_client() as client:
                    resp = client.post(
                        "/api/agent/get-recommendation-questions",
                        data=json.dumps({
                            "model": {"endpoint": "openai", "model": "gpt-4",
                                       "api_key": "k", "api_base": "http://x"},
                            "input_tables": [{"name": "t", "rows": []}],
                        }),
                        content_type="application/json",
                    )

        lines = resp.data.decode("utf-8").strip().split("\n")
        assert len(lines) >= 1
        error_line = [l for l in lines if l.startswith("error:")]
        assert len(error_line) == 1

        error_payload = json.loads(error_line[0].removeprefix("error: "))
        # Raw exception must not leak
        assert "column 'x' not found" not in error_payload["content"]
        # classify_llm_error returns a pre-defined safe message
        assert error_payload["content"] == "Model request failed"

    def test_error_message_never_leaks_api_keys(self) -> None:
        """Even when exception contains API keys, classify_llm_error returns
        a safe pre-defined message without any raw exception text."""
        app = _build_app()

        mock_agent = MagicMock()
        mock_agent.run.side_effect = RuntimeError("auth failed api_key=sk-secret123 for model")

        with _mock_workspace() as (ws, fake_ctx):
            with (
                patch(f"{MODULE}.get_client", return_value=MagicMock()),
                patch(f"{MODULE}.get_identity_id", return_value="test-user"),
                patch(f"{MODULE}.get_workspace", return_value=ws),
                patch(f"{MODULE}.get_language_instruction", return_value=""),
                patch(f"{MODULE}.InteractiveExploreAgent", return_value=mock_agent),
            ):
                with app.test_client() as client:
                    resp = client.post(
                        "/api/agent/get-recommendation-questions",
                        data=json.dumps({
                            "model": {"endpoint": "openai", "model": "gpt-4",
                                       "api_key": "k", "api_base": "http://x"},
                            "input_tables": [{"name": "t", "rows": []}],
                        }),
                        content_type="application/json",
                    )

        lines = resp.data.decode("utf-8").strip().split("\n")
        error_line = [l for l in lines if l.startswith("error:")]
        error_payload = json.loads(error_line[0].removeprefix("error: "))
        assert "sk-secret123" not in error_payload["content"]
        # "auth failed" matches the authentication pattern
        assert "Authentication failed" in error_payload["content"]
