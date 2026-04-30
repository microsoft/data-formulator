# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for ExperienceDistillAgent and the /api/knowledge/distill-experience endpoint.

Covers:
- _extract_log_summary correctly extracts key info
- _extract_context_summary correctly extracts experience context
- Output Markdown includes valid YAML front matter
- front matter contains source: agent_summarized and source metadata
- Generated experience file written to correct directory
- category_hint controls sub-directory
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.agents.agent_experience_distill import ExperienceDistillAgent
from data_formulator.knowledge.store import parse_front_matter

pytestmark = [pytest.mark.backend]


SAMPLE_LOG_LINES = [
    {
        "step_type": "session_start",
        "ts": "2026-04-26T10:00:00+00:00",
        "user_question": "Show sales by region",
        "input_tables": ["sales", "regions"],
        "model": "gpt-4o",
    },
    {
        "step_type": "context_built",
        "ts": "2026-04-26T10:00:01+00:00",
        "total_tables": 2,
        "primary_tables": ["sales"],
    },
    {
        "step_type": "llm_response",
        "ts": "2026-04-26T10:00:03+00:00",
        "finish_reason": "tool_calls",
        "tool_calls": [{"name": "explore"}],
    },
    {
        "step_type": "tool_execution",
        "ts": "2026-04-26T10:00:04+00:00",
        "tool": "explore",
        "output_summary": "Regions: North, South, East, West",
    },
    {
        "step_type": "action_execution",
        "ts": "2026-04-26T10:00:05+00:00",
        "action": "visualize",
        "status": "ok",
        "output_rows": 25,
        "chart_type": "bar",
    },
    {
        "step_type": "session_end",
        "ts": "2026-04-26T10:00:10+00:00",
        "status": "success",
        "total_iterations": 2,
        "total_llm_calls": 3,
        "total_latency_ms": 10000,
    },
]

SAMPLE_EXPERIENCE_CONTEXT = {
    "context_id": "table-123",
    "source_table_id": "source-table",
    "user_question": "Show sales by region",
    "dialog": [
        {"role": "user", "content": "Show sales by region"},
        {"role": "assistant", "content": "[tool: explore]\nChecked region values"},
    ],
    "interaction": [
        {"from": "user", "role": "prompt", "content": "Show sales by region"},
        {"from": "data-agent", "role": "clarify", "content": "Which metric?"},
        {"from": "user", "role": "prompt", "content": "Use revenue"},
    ],
    "result_summary": {
        "display_instruction": "Revenue by region",
        "source_tables": ["sales", "regions"],
        "output_fields": ["region", "revenue"],
        "output_rows": 4,
        "chart_type": "bar",
        "code": "result_df = sales.groupby('region').revenue.sum().reset_index()",
    },
    "execution_attempts": [
        {
            "kind": "visualize",
            "attempt": 0,
            "status": "error",
            "summary": "Initial chart",
            "failed_code_summary": "1 non-empty lines; operations=count",
            "error": "missing column",
        },
        {
            "kind": "repair",
            "attempt": 1,
            "status": "ok",
            "summary": "Use revenue column",
            "repair_code_summary": "1 non-empty lines; operations=groupby, sum",
        },
    ],
}


# ── _extract_log_summary ──────────────────────────────────────────────────


class TestExtractLogSummary:
    def test_extracts_key_info(self):
        summary = ExperienceDistillAgent._extract_log_summary(SAMPLE_LOG_LINES)
        assert "sales by region" in summary
        assert "explore" in summary
        assert "bar" in summary
        assert "success" in summary

    def test_empty_log_returns_empty_marker(self):
        summary = ExperienceDistillAgent._extract_log_summary([])
        assert "empty" in summary.lower()

    def test_handles_unknown_step_types(self):
        lines = [{"step_type": "unknown_type", "data": "value"}]
        summary = ExperienceDistillAgent._extract_log_summary(lines)
        assert isinstance(summary, str)


class TestExtractContextSummary:
    def test_extracts_context_signals(self):
        summary = ExperienceDistillAgent._extract_context_summary(SAMPLE_EXPERIENCE_CONTEXT)
        assert "sales by region" in summary
        assert "Which metric" in summary
        assert "missing column" in summary
        assert "revenue" in summary
        assert "Dialog structure" in summary
        assert "explore" in summary
        assert "Checked region values" not in summary
        assert "result_df =" not in summary
        assert "groupby" in summary
        assert "Failed code summary" in summary
        assert "Repair code summary" in summary
        assert "Source tables" in summary
        assert "sales" in summary and "regions" in summary

    def test_empty_context_returns_marker(self):
        summary = ExperienceDistillAgent._extract_context_summary({})
        assert "empty" not in summary.lower()
        assert "User question" in summary


# ── run (mocked LLM) ─────────────────────────────────────────────────────


MOCK_LLM_RESPONSE = """\
---
title: Regional Sales Analysis Pattern
tags: [sales, regional, bar-chart]
created: 2026-04-26
updated: 2026-04-26
source: agent_summarized
source_session: sess-test
---

## Scenario

When analyzing sales data broken down by geographical regions.

## Method

1. Load the sales and regions tables
2. Join on region key
3. Aggregate by region
4. Create a bar chart showing totals

## Key Findings

- Bar charts are effective for comparing discrete regional categories.
"""

MOCK_CONTEXT_RESPONSE = MOCK_LLM_RESPONSE.replace(
    "source_session: sess-test",
    "source_context: table-123",
)


class TestRunWithMockedLLM:
    def _mock_client(self):
        c = MagicMock()
        c.model = "test-model"
        c.endpoint = "openai"
        c.params = {"api_key": "test-key"}
        return c

    def test_produces_valid_markdown(self):
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        mock_resp = MagicMock()
        mock_resp.choices = [MagicMock()]
        mock_resp.choices[0].message.content = MOCK_LLM_RESPONSE

        with patch.object(agent, "_call_llm", return_value=MOCK_LLM_RESPONSE):
            result = agent.run(SAMPLE_LOG_LINES, "Show sales by region", session_id="sess-test")

        assert result.startswith("---")
        meta, body = parse_front_matter(result)
        assert meta["source"] == "agent_summarized"
        assert meta["source_session"] == "sess-test"
        assert "tags" in meta

    def test_fallback_front_matter_added(self):
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        no_fm_response = "# Sales Analysis\n\nJust some content."
        with patch.object(agent, "_call_llm", return_value=no_fm_response):
            result = agent.run(SAMPLE_LOG_LINES, "test", session_id="sess-x")

        assert result.startswith("---")
        meta, _ = parse_front_matter(result)
        assert meta["source"] == "agent_summarized"
        assert meta["source_session"] == "sess-x"

    def test_run_from_context_produces_valid_markdown(self):
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        with patch.object(agent, "_call_llm", return_value=MOCK_CONTEXT_RESPONSE):
            result = agent.run_from_context(SAMPLE_EXPERIENCE_CONTEXT)

        assert result.startswith("---")
        meta, _ = parse_front_matter(result)
        assert meta["source"] == "agent_summarized"
        assert meta["source_context"] == "table-123"

    def test_run_from_context_fallback_front_matter_added(self):
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        with patch.object(agent, "_call_llm", return_value="# Experience\n\nContent"):
            result = agent.run_from_context(SAMPLE_EXPERIENCE_CONTEXT)

        meta, _ = parse_front_matter(result)
        assert meta["source"] == "agent_summarized"
        assert meta["source_context"] == "table-123"

    def test_language_instruction_injected_into_system_prompt(self):
        client = self._mock_client()
        zh_instruction = "[LANGUAGE INSTRUCTION]\nWrite in Simplified Chinese."
        agent = ExperienceDistillAgent(client=client, language_instruction=zh_instruction)

        captured_messages = []

        def fake_call_llm(messages):
            captured_messages.extend(messages)
            return MOCK_CONTEXT_RESPONSE

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            agent.run_from_context(SAMPLE_EXPERIENCE_CONTEXT)

        system_content = captured_messages[0]["content"]
        assert "[LANGUAGE INSTRUCTION]" in system_content
        assert "Simplified Chinese" in system_content
        assert "title" in system_content and "user's language" in system_content

    def test_language_instruction_injected_into_log_prompt(self):
        client = self._mock_client()
        zh_instruction = "[LANGUAGE INSTRUCTION]\nWrite in Simplified Chinese."
        agent = ExperienceDistillAgent(client=client, language_instruction=zh_instruction)

        captured_messages = []

        def fake_call_llm(messages):
            captured_messages.extend(messages)
            return MOCK_LLM_RESPONSE

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            agent.run(SAMPLE_LOG_LINES, "Show sales by region", session_id="sess-test")

        system_content = captured_messages[0]["content"]
        assert "[LANGUAGE INSTRUCTION]" in system_content
        assert "Simplified Chinese" in system_content
        assert "title" in system_content and "user's language" in system_content


# ── _experience_filename ──────────────────────────────────────────────────


class TestExperienceFilename:
    def test_derives_from_title(self):
        from data_formulator.routes.knowledge import _experience_filename
        md = "---\ntitle: Sales Analysis Pattern\n---\nContent"
        name = _experience_filename("sess-1", md)
        assert name.endswith(".md")
        assert "sales" in name.lower()

    def test_fallback_to_session_id(self):
        from data_formulator.routes.knowledge import _experience_filename
        name = _experience_filename("sess-1", "No front matter at all")
        assert name == "sess-1.md"


# ── API endpoint ──────────────────────────────────────────────────────────


class TestDistillEndpoint:
    @pytest.fixture()
    def app(self, tmp_path):
        from data_formulator.error_handler import register_error_handlers
        from data_formulator.routes.knowledge import knowledge_bp

        _app = flask.Flask(__name__)
        _app.config["TESTING"] = True
        _app.secret_key = "test"
        _app.register_blueprint(knowledge_bp)
        register_error_handlers(_app)

        (tmp_path / "knowledge" / "experiences").mkdir(parents=True)

        with patch("data_formulator.routes.knowledge.get_identity_id", return_value="test-user"), \
             patch("data_formulator.routes.knowledge.get_user_home", return_value=tmp_path):
            yield _app

    @pytest.fixture()
    def client(self, app):
        return app.test_client()

    def test_missing_context_returns_error(self, client):
        resp = client.post("/api/knowledge/distill-experience",
                           json={"model": {"endpoint": "openai", "model": "gpt-4o"}})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_missing_model_returns_error(self, client):
        resp = client.post("/api/knowledge/distill-experience",
                           json={"experience_context": SAMPLE_EXPERIENCE_CONTEXT})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_missing_context_field_returns_error(self, client):
        bad_context = {**SAMPLE_EXPERIENCE_CONTEXT}
        bad_context.pop("result_summary")
        resp = client.post("/api/knowledge/distill-experience",
                           json={
                               "experience_context": bad_context,
                               "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "test"},
                           })
        data = resp.get_json()
        assert data["status"] == "error"

    def test_successful_distill(self, client, tmp_path):
        with patch("data_formulator.routes.agents.get_client") as mock_gc, \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch("data_formulator.agents.agent_experience_distill.ExperienceDistillAgent.run_from_context",
                   return_value=MOCK_CONTEXT_RESPONSE):

            mock_gc.return_value = MagicMock()
            resp = client.post("/api/knowledge/distill-experience",
                               json={
                                   "experience_context": SAMPLE_EXPERIENCE_CONTEXT,
                                   "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "test"},
                               })
            data = resp.get_json()
            assert data["status"] == "success"
            assert data["data"]["category"] == "experiences"
            assert data["data"]["path"].endswith(".md")

            # Verify file was written
            exp_dir = tmp_path / "knowledge" / "experiences"
            md_files = list(exp_dir.rglob("*.md"))
            assert len(md_files) >= 1
            assert not (tmp_path / "agent-logs").exists()

    def test_category_hint_creates_subdir(self, client, tmp_path):
        with patch("data_formulator.routes.agents.get_client") as mock_gc, \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch("data_formulator.agents.agent_experience_distill.ExperienceDistillAgent.run_from_context",
                   return_value=MOCK_CONTEXT_RESPONSE):

            mock_gc.return_value = MagicMock()
            resp = client.post("/api/knowledge/distill-experience",
                               json={
                                   "experience_context": SAMPLE_EXPERIENCE_CONTEXT,
                                   "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "test"},
                                   "category_hint": "sales",
                               })
            data = resp.get_json()
            assert data["status"] == "success"
            assert "sales/" in data["data"]["path"]
