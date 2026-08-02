"""Smoke tests verifying DataLoadAgent correctly wires AgentDiagnostics."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytestmark = [pytest.mark.backend]


JSON_ONLY_KEYS = {
    "agent", "timestamp", "model", "prompt_components",
    "llm_request", "llm_response", "performance",
}


# ---------------------------------------------------------------------------
# Helpers — build mock LLM responses
# ---------------------------------------------------------------------------

def _make_llm_response(content: str, finish_reason: str = "stop") -> SimpleNamespace:
    """Minimal mock that mirrors the shape agents expect from client.get_completion."""
    choice = SimpleNamespace(
        message=SimpleNamespace(role="assistant", content=content),
        finish_reason=finish_reason,
    )
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=20)
    return SimpleNamespace(choices=[choice], usage=usage)


# ---------------------------------------------------------------------------
# DataLoadAgent
# ---------------------------------------------------------------------------

class TestDataLoadAgentWiring:

    def _make_agent(self):
        from data_formulator.agents.agent_data_load import DataLoadAgent
        client = MagicMock()
        workspace = MagicMock()
        return DataLoadAgent(
            client=client, workspace=workspace,
            model_info={"provider": "test", "model": "mock"},
        )

    @patch("data_formulator.agents.agent_data_load.generate_data_summary", return_value="summary")
    def test_run_attaches_diagnostics(self, _mock_summary) -> None:
        agent = self._make_agent()
        llm_content = '```json\n{"suggested_table_name":"t","fields":{},"data_summary":"s"}\n```'
        agent.client.get_completion.return_value = _make_llm_response(llm_content)

        candidates = agent.run({"name": "test", "rows": []})

        assert len(candidates) >= 1
        diag = candidates[0]["diagnostics"]
        assert diag.keys() == JSON_ONLY_KEYS
        assert diag["agent"] == "DataLoadAgent"
        assert diag["llm_response"]["raw_content"] == llm_content

    @patch("data_formulator.agents.agent_data_load.generate_data_summary", return_value="summary")
    def test_run_parse_failure_still_has_diagnostics(self, _mock_summary) -> None:
        """Even when JSON parsing fails, diagnostics should be attached."""
        agent = self._make_agent()
        agent.client.get_completion.return_value = _make_llm_response("not valid json at all")

        candidates = agent.run({"name": "test", "rows": []})

        assert len(candidates) == 1
        assert candidates[0]["status"] == "other error"
        diag = candidates[0]["diagnostics"]
        assert diag.keys() == JSON_ONLY_KEYS
        assert diag["agent"] == "DataLoadAgent"

    def test_init_backward_compatible_without_model_info(self) -> None:
        """agent_routes.py calls DataLoadAgent without model_info — must not break."""
        from data_formulator.agents.agent_data_load import DataLoadAgent
        agent = DataLoadAgent(client=MagicMock(), workspace=MagicMock())
        assert agent._diag._model_info == {}
