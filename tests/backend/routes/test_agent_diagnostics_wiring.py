"""Smoke tests verifying each Agent correctly wires AgentDiagnostics.

Background
----------
The AgentDiagnostics class is tested in isolation in test_agent_diagnostics.py.
These tests verify that DataRecAgent, DataTransformationAgent and DataLoadAgent
actually attach diagnostics with the expected schema to their output, covering
both the normal path and the LLM-error path.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Schema key-sets (mirrors test_agent_diagnostics.py TestSchemaCompatibility)
# ---------------------------------------------------------------------------

FULL_RESPONSE_KEYS = {
    "agent", "timestamp", "model", "prompt_components",
    "llm_request", "llm_response", "parsing", "execution", "performance",
}
ERROR_KEYS = {
    "agent", "timestamp", "model", "prompt_components",
    "llm_request", "error",
}
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


def _make_llm_exception(body: str = "connection timeout") -> Exception:
    """Exception with a .body attribute, as produced by the real client wrapper."""
    exc = Exception(body)
    exc.body = body
    return exc


LLM_CONTENT_WITH_JSON_AND_CODE = (
    '```json\n{"chart_type":"Bar Chart","output_variable":"result_df"}\n```\n'
    '```python\nimport pandas as pd\nresult_df = pd.DataFrame({"x":[1]})\n```'
)


# ---------------------------------------------------------------------------
# DataRecAgent
# ---------------------------------------------------------------------------

class TestDataRecAgentWiring:

    def _make_agent(self):
        from data_formulator.agents.agent_data_rec import DataRecAgent
        client = MagicMock()
        workspace = MagicMock()
        workspace.get_fresh_name.return_value = "d-result_df"
        return DataRecAgent(
            client=client, workspace=workspace,
            model_info={"provider": "test", "model": "mock"},
        )

    @patch("data_formulator.agents.agent_data_rec.supplement_missing_block")
    @patch("data_formulator.sandbox.create_sandbox")
    def test_normal_response_has_diagnostics(self, mock_sandbox_factory, mock_supplement) -> None:
        mock_supplement.return_value = (
            {"chart_type": "Bar Chart", "output_variable": "result_df"},
            ["result_df = pd.DataFrame({'x':[1]})"],
            None,
            0.0,
        )
        import pandas as pd
        mock_sandbox = MagicMock()
        mock_sandbox.run_python_code.return_value = {
            "status": "ok",
            "content": pd.DataFrame({"x": [1]}),
            "df_names": ["result_df"],
        }
        mock_sandbox_factory.return_value = mock_sandbox

        agent = self._make_agent()
        response = _make_llm_response(LLM_CONTENT_WITH_JSON_AND_CODE)
        messages = [{"role": "system", "content": "sys"}, {"role": "user", "content": "q"}]

        candidates = agent.process_gpt_response([], messages, response, t_llm=0.5)

        assert len(candidates) >= 1
        diag = candidates[0]["diagnostics"]
        assert diag.keys() == FULL_RESPONSE_KEYS
        assert diag["agent"] == "DataRecAgent"
        assert diag["parsing"]["code_found"] is True
        assert diag["performance"]["llm_seconds"] == 0.5

    def test_exception_response_has_error_diagnostics(self) -> None:
        agent = self._make_agent()
        exc = _make_llm_exception("rate limit")
        messages = [{"role": "system", "content": "sys"}]

        candidates = agent.process_gpt_response([], messages, exc)

        assert len(candidates) == 1
        diag = candidates[0]["diagnostics"]
        assert diag.keys() == ERROR_KEYS
        assert diag["agent"] == "DataRecAgent"
        assert diag["error"] == "rate limit"

    @patch("data_formulator.agents.agent_data_rec.supplement_missing_block")
    @patch("data_formulator.sandbox.create_sandbox")
    def test_execution_exception_diagnostics_are_sanitized(self, mock_sandbox_factory, mock_supplement) -> None:
        mock_supplement.return_value = (
            {"chart_type": "Bar Chart", "output_variable": "result_df"},
            ["result_df = pd.DataFrame({'x':[1]})"],
            None,
            0.0,
        )
        import pandas as pd
        mock_sandbox = MagicMock()
        mock_sandbox.run_python_code.return_value = {
            "status": "ok",
            "content": pd.DataFrame({"x": [1]}),
        }
        mock_sandbox_factory.return_value = mock_sandbox

        agent = self._make_agent()
        agent.workspace.write_parquet.side_effect = RuntimeError(
            r"boom C:\Users\dev\secret.txt token=secret-token"
        )
        response = _make_llm_response(LLM_CONTENT_WITH_JSON_AND_CODE)
        messages = [{"role": "system", "content": "sys"}, {"role": "user", "content": "q"}]

        candidate = agent.process_gpt_response([], messages, response)[0]

        assert candidate["content"] == "Unexpected error during code execution."
        exec_error = candidate["diagnostics"]["execution"]["error_message"]
        assert "RuntimeError" in exec_error
        assert "Traceback" not in exec_error
        assert r"C:\Users\dev" not in exec_error
        assert "secret-token" not in exec_error


# ---------------------------------------------------------------------------
# DataTransformationAgent
# ---------------------------------------------------------------------------

class TestDataTransformAgentWiring:

    def _make_agent(self):
        from data_formulator.agents.agent_data_transform import DataTransformationAgent
        client = MagicMock()
        workspace = MagicMock()
        workspace.get_fresh_name.return_value = "d-result_df"
        return DataTransformationAgent(
            client=client, workspace=workspace,
            model_info={"provider": "test", "model": "mock"},
        )

    @patch("data_formulator.agents.agent_data_transform.supplement_missing_block")
    @patch("data_formulator.sandbox.create_sandbox")
    def test_normal_response_has_diagnostics(self, mock_sandbox_factory, mock_supplement) -> None:
        mock_supplement.return_value = (
            {"chart_type": "Bar Chart", "output_variable": "result_df"},
            ["result_df = pd.DataFrame({'x':[1]})"],
            None,
            0.0,
        )
        import pandas as pd
        mock_sandbox = MagicMock()
        mock_sandbox.run_python_code.return_value = {
            "status": "ok",
            "content": pd.DataFrame({"x": [1]}),
            "df_names": ["result_df"],
        }
        mock_sandbox_factory.return_value = mock_sandbox

        agent = self._make_agent()
        response = _make_llm_response(LLM_CONTENT_WITH_JSON_AND_CODE)
        messages = [{"role": "system", "content": "sys"}, {"role": "user", "content": "q"}]

        candidates = agent.process_gpt_response(response, messages, t_llm=0.3)

        assert len(candidates) >= 1
        diag = candidates[0]["diagnostics"]
        assert diag.keys() == FULL_RESPONSE_KEYS
        assert diag["agent"] == "DataTransformationAgent"
        assert diag["performance"]["llm_seconds"] == 0.3

    def test_exception_response_has_error_diagnostics(self) -> None:
        agent = self._make_agent()
        exc = _make_llm_exception("server error")
        messages = [{"role": "system", "content": "sys"}]

        candidates = agent.process_gpt_response(exc, messages)

        assert len(candidates) == 1
        diag = candidates[0]["diagnostics"]
        assert diag.keys() == ERROR_KEYS
        assert diag["agent"] == "DataTransformationAgent"
        assert diag["error"] == "server error"

    @patch("data_formulator.agents.agent_data_transform.supplement_missing_block")
    @patch("data_formulator.sandbox.create_sandbox")
    def test_execution_exception_diagnostics_are_sanitized(self, mock_sandbox_factory, mock_supplement) -> None:
        mock_supplement.return_value = (
            {"chart_type": "Bar Chart", "output_variable": "result_df"},
            ["result_df = pd.DataFrame({'x':[1]})"],
            None,
            0.0,
        )
        import pandas as pd
        mock_sandbox = MagicMock()
        mock_sandbox.run_python_code.return_value = {
            "status": "ok",
            "content": pd.DataFrame({"x": [1]}),
        }
        mock_sandbox_factory.return_value = mock_sandbox

        agent = self._make_agent()
        agent.workspace.write_parquet.side_effect = RuntimeError(
            r"boom /tmp/workspace/secret.txt token=secret-token"
        )
        response = _make_llm_response(LLM_CONTENT_WITH_JSON_AND_CODE)
        messages = [{"role": "system", "content": "sys"}, {"role": "user", "content": "q"}]

        candidate = agent.process_gpt_response(response, messages)[0]

        assert candidate["content"] == "An error occurred during code execution."
        exec_error = candidate["diagnostics"]["execution"]["error_message"]
        assert "RuntimeError" in exec_error
        assert "Traceback" not in exec_error
        assert "/tmp/workspace" not in exec_error
        assert "secret-token" not in exec_error


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
