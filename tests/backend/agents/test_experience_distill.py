# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for ExperienceDistillAgent and the /api/knowledge/distill-experience endpoint.

Covers:
- _extract_log_summary correctly extracts key info
- Output Markdown includes valid YAML front matter
- front matter contains source: agent_summarized and source_session
- Session log not found returns appropriate error
- Generated experience file written to correct directory
- category_hint controls sub-directory
"""

from __future__ import annotations

import json
from pathlib import Path
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


# ── _read_session_log (in knowledge route) ────────────────────────────────


class TestReadSessionLog:
    def test_reads_existing_log(self, tmp_path):
        from data_formulator.routes.knowledge import _read_session_log

        log_dir = tmp_path / "agent-logs" / "2026-04-26"
        log_dir.mkdir(parents=True)
        log_file = log_dir / "sess-abc-DataAgent.jsonl"
        lines = [json.dumps(line) for line in SAMPLE_LOG_LINES]
        log_file.write_text("\n".join(lines), encoding="utf-8")

        result = _read_session_log(tmp_path, "sess-abc")
        assert len(result) == len(SAMPLE_LOG_LINES)
        assert result[0]["step_type"] == "session_start"

    def test_nonexistent_session_returns_empty(self, tmp_path):
        from data_formulator.routes.knowledge import _read_session_log
        result = _read_session_log(tmp_path, "nonexistent")
        assert result == []

    def test_no_logs_dir_returns_empty(self, tmp_path):
        from data_formulator.routes.knowledge import _read_session_log
        result = _read_session_log(tmp_path, "anything")
        assert result == []


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

        # Create a reasoning log for the test
        log_dir = tmp_path / "agent-logs" / "2026-04-26"
        log_dir.mkdir(parents=True)
        log_file = log_dir / "sess-test-DataAgent.jsonl"
        lines = [json.dumps(line) for line in SAMPLE_LOG_LINES]
        log_file.write_text("\n".join(lines), encoding="utf-8")

        (tmp_path / "knowledge" / "experiences").mkdir(parents=True)

        with patch("data_formulator.routes.knowledge.get_identity_id", return_value="test-user"), \
             patch("data_formulator.routes.knowledge.get_user_home", return_value=tmp_path):
            yield _app

    @pytest.fixture()
    def client(self, app):
        return app.test_client()

    def test_missing_session_id_returns_error(self, client):
        resp = client.post("/api/knowledge/distill-experience",
                           json={"user_question": "test", "model": {"endpoint": "openai", "model": "gpt-4o"}})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_missing_model_returns_error(self, client):
        resp = client.post("/api/knowledge/distill-experience",
                           json={"session_id": "sess-test", "user_question": "test"})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_nonexistent_session_returns_error(self, client):
        resp = client.post("/api/knowledge/distill-experience",
                           json={
                               "session_id": "no-such-session",
                               "user_question": "test",
                               "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "test"},
                           })
        data = resp.get_json()
        assert data["status"] == "error"
        assert "No reasoning log" in data.get("error", {}).get("message", "")

    def test_successful_distill(self, client, tmp_path):
        with patch("data_formulator.routes.agents.get_client") as mock_gc, \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch("data_formulator.agents.agent_experience_distill.ExperienceDistillAgent.run",
                   return_value=MOCK_LLM_RESPONSE):

            mock_gc.return_value = MagicMock()
            resp = client.post("/api/knowledge/distill-experience",
                               json={
                                   "session_id": "sess-test",
                                   "user_question": "Show sales by region",
                                   "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "test"},
                               })
            data = resp.get_json()
            assert data["status"] == "ok"
            assert data["category"] == "experiences"
            assert data["path"].endswith(".md")

            # Verify file was written
            exp_dir = tmp_path / "knowledge" / "experiences"
            md_files = list(exp_dir.rglob("*.md"))
            assert len(md_files) >= 1

    def test_category_hint_creates_subdir(self, client, tmp_path):
        with patch("data_formulator.routes.agents.get_client") as mock_gc, \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch("data_formulator.agents.agent_experience_distill.ExperienceDistillAgent.run",
                   return_value=MOCK_LLM_RESPONSE):

            mock_gc.return_value = MagicMock()
            resp = client.post("/api/knowledge/distill-experience",
                               json={
                                   "session_id": "sess-test",
                                   "user_question": "test",
                                   "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "test"},
                                   "category_hint": "sales",
                               })
            data = resp.get_json()
            assert data["status"] == "ok"
            assert "sales/" in data["path"]
