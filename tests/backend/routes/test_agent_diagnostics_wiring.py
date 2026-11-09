"""Smoke tests verifying DataLoadAgent correctly wires AgentDiagnostics."""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

pytestmark = [pytest.mark.backend]


@pytest.mark.parametrize("with_reference", [False, True])
def test_starter_questions_uses_bounded_reference_context(with_reference):
    from data_formulator.app import app

    reference = {
        "kind": "external-table-reference", "id": "external:trips", "connectorId": "taxi",
        "tableKey": "trips", "displayName": "Trips", "sourceTable": {"id": "trips", "name": "trips"},
        "summary": {"columns": [{"name": "vendor", "type": "string"}], "rowCount": 20_000_000,
                    "description": "Taxi trips", "sampleRows": [{"vendor": "x" * 1000}] * 20,
                    "inspection": {"sample_method": "source_head", "row_count_status": "exact"}},
        "queryIntent": {"filters": [{"column": "year", "op": "eq", "value": 2011}]},
        "credentials": "must-not-reach-the-model",
    }
    model = {"id": "test", "model": "gpt-4o", "endpoint": "openai"}
    client = MagicMock(model="gpt-4o")
    client.get_completion.return_value = _make_llm_response('{"questions": ["Compare trips by vendor"]}')
    tables = [] if with_reference else [{"name": "trips", "columns": ["vendor"], "sample_rows": [{"vendor": "A"}]}]
    payload = {"model": model, "input_tables": tables, "primary_table": reference["id"] if with_reference else "trips"}
    if with_reference:
        payload["external_references"] = [reference, None, {"kind": "other"}]
    with app.test_client() as flask_client, \
         patch("data_formulator.routes.agents.get_client", return_value=client), \
         patch("data_formulator.routes.agents.get_language_instruction", return_value="LANG"):
        response = flask_client.post("/api/agent/derive-starter-questions", json=payload)
    assert response.status_code == 200
    assert response.get_json()["data"]["result"] == ["Compare trips by vendor"]
    messages = client.get_completion.call_args.kwargs["messages"]
    context = json.loads(messages[1]["content"].split("[INPUT]\n\n", 1)[1].split("\n\n[OUTPUT]", 1)[0])
    assert context["tables"] == tables
    assert context["primary_table"] == payload["primary_table"]
    assert "LANG" in messages[0]["content"]
    assert "Do not assume date coverage" in messages[0]["content"]
    assert "untrusted data" in messages[0]["content"]
    if with_reference:
        assert len(context["external_references"]) == 1
        item = context["external_references"][0]
        assert item["queryIntent"] == reference["queryIntent"]
        assert item["summary"]["inspection"] == reference["summary"]["inspection"]
        assert len(item["summary"]["sampleRows"]) == 5
        assert len(item["summary"]["sampleRows"][0]["vendor"]) == 203
        assert item["summary"]["sampleTruncated"] is True
        assert "credentials" not in item
        assert len(reference["summary"]["sampleRows"]) == 20
    else:
        assert context["external_references"] == []


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
