# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for ExperienceDistillAgent and the /api/knowledge/distill-experience endpoint.

Covers:
- _extract_context_summary correctly extracts experience context
- Output Markdown includes valid YAML front matter
- front matter contains source: distill and source metadata
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


SAMPLE_EVENTS = [
    {
        "type": "message",
        "from": "user",
        "to": "data-agent",
        "role": "prompt",
        "content": "Show sales by region",
    },
    {
        "type": "message",
        "from": "data-agent",
        "to": "user",
        "role": "clarify",
        "content": "Which metric?",
    },
    {
        "type": "message",
        "from": "user",
        "to": "data-agent",
        "role": "instruction",
        "content": "Use revenue",
    },
    {
        "type": "message",
        "from": "data-agent",
        "to": "data-agent",
        "role": "tool_call",
        "content": "explore",
    },
    {
        "type": "create_table",
        "table_id": "t1",
        "source_tables": ["sales", "regions"],
        "columns": ["region", "revenue"],
        "row_count": 4,
        "sample_rows": [
            {"region": "North", "revenue": 100},
            {"region": "South", "revenue": 90},
        ],
        "code": "result_df = sales.groupby('region').revenue.sum().reset_index()",
    },
    {
        "type": "create_chart",
        "related_table_id": "t1",
        "mark_or_type": "bar",
        "encoding_summary": "x=region(nominal), y=revenue(quantitative)",
    },
]

SAMPLE_EXPERIENCE_CONTEXT = {
    "context_id": "ws-1",
    "workspace_id": "ws-1",
    "workspace_name": "Sales Region Analysis",
    "threads": [{"thread_id": "t1", "events": SAMPLE_EVENTS}],
}


# ── _extract_context_summary ──────────────────────────────────────────────


class TestExtractContextSummary:
    def test_renders_each_event_type(self):
        summary = ExperienceDistillAgent._extract_context_summary(SAMPLE_EXPERIENCE_CONTEXT)
        # message events
        assert "[user→data-agent/prompt]" in summary
        assert "Show sales by region" in summary
        assert "[data-agent→user/clarify]" in summary
        assert "Which metric" in summary
        assert "[user→data-agent/instruction]" in summary
        assert "Use revenue" in summary
        # tool_call self-loop
        assert "[data-agent→data-agent/tool_call]" in summary
        assert "explore" in summary
        # create_table
        assert "[create_table] t1" in summary
        assert "sources: sales, regions" in summary
        assert "columns: ['region', 'revenue']" in summary
        assert "rows: 4" in summary
        assert "sample (first 2 rows):" in summary
        assert "groupby" in summary  # from code
        # repair_reason and code_shape are intentionally NOT emitted
        # (the surrounding messages already capture failure context).
        assert "code shape" not in summary
        assert "repair reason" not in summary
        # create_chart
        assert "[create_chart] bar on t1" in summary
        assert "encoding: x=region(nominal)" in summary

    def test_empty_events_returns_marker(self):
        summary = ExperienceDistillAgent._extract_context_summary({})
        assert summary == "(empty context)"

    def test_user_content_is_not_displaycontent(self):
        # Frontend now sends raw .content, not displayContent. The renderer
        # just prints whatever 'content' is on the event.
        ctx = {
            "threads": [{
                "thread_id": "t1",
                "events": [{
                    "type": "message",
                    "from": "user",
                    "to": "data-agent",
                    "role": "instruction",
                    "content": "raw text",
                }],
            }],
        }
        summary = ExperienceDistillAgent._extract_context_summary(ctx)
        assert "raw text" in summary

    def test_skips_non_dict_events(self):
        ctx = {"threads": [{"thread_id": "t1", "events": [
            "not-a-dict", None, 42,
            {"type": "message", "from": "user", "to": "data-agent",
             "role": "prompt", "content": "ok"},
        ]}]}
        summary = ExperienceDistillAgent._extract_context_summary(ctx)
        assert "[user→data-agent/prompt]" in summary
        # No crashes; the bogus entries are silently dropped.

    def test_create_table_basic(self):
        ctx = {"threads": [{"thread_id": "t1", "events": [{
            "type": "create_table",
            "table_id": "t1",
            "source_tables": ["src"],
            "columns": ["a"],
            "row_count": 1,
            "sample_rows": [{"a": 1}],
            "code": "x = 1",
        }]}]}
        summary = ExperienceDistillAgent._extract_context_summary(ctx)
        assert "[create_table] t1" in summary

    def test_create_chart_without_encoding(self):
        ctx = {"threads": [{"thread_id": "t1", "events": [{
            "type": "create_chart",
            "related_table_id": "t1",
            "mark_or_type": "line",
        }]}]}
        summary = ExperienceDistillAgent._extract_context_summary(ctx)
        assert "[create_chart] line on t1" in summary
        assert "encoding:" not in summary

    def test_renders_multi_thread_with_headers(self):
        """Session-scoped payloads (design-docs/24) are rendered per thread."""
        ctx = {
            "threads": [
                {
                    "thread_id": "leaf-a",
                    "events": [{
                        "type": "message", "from": "user", "to": "data-agent",
                        "role": "prompt", "content": "load gas prices",
                    }],
                },
                {
                    "thread_id": "leaf-b",
                    "events": [{
                        "type": "message", "from": "user", "to": "data-agent",
                        "role": "prompt", "content": "filter to 2024",
                    }],
                },
            ],
        }
        summary = ExperienceDistillAgent._extract_context_summary(ctx)
        assert "### Thread 1 (id=leaf-a)" in summary
        assert "### Thread 2 (id=leaf-b)" in summary
        assert "load gas prices" in summary
        assert "filter to 2024" in summary


# ── run (mocked LLM) ─────────────────────────────────────────────────────


MOCK_LLM_RESPONSE = """\
---
title: Regional Sales Analysis Pattern
tags: [sales, regional, bar-chart]
created: 2026-04-26
updated: 2026-04-26
source: distill
source_context: ws-1
---

## When to Use

When analyzing sales data broken down by geographical regions.

## Method

1. Load the sales and regions tables
2. Join on region key
3. Aggregate by region
4. Create a bar chart showing totals

## Key Findings

- Bar charts are effective for comparing discrete regional categories.
"""

MOCK_CONTEXT_RESPONSE = MOCK_LLM_RESPONSE


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

        with patch.object(agent, "_call_llm", return_value=MOCK_CONTEXT_RESPONSE):
            result = agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        assert result.startswith("---")
        meta, body = parse_front_matter(result)
        assert meta["source"] == "distill"
        assert meta["source_context"] == "ws-1"
        assert "tags" in meta

    def test_fallback_front_matter_added(self):
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        no_fm_response = "# Sales Analysis\n\nJust some content."
        with patch.object(agent, "_call_llm", return_value=no_fm_response):
            result = agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        assert result.startswith("---")
        meta, _ = parse_front_matter(result)
        assert meta["source"] == "distill"
        assert meta["source_context"] == "ws-1"

    def test_retries_once_when_body_too_long(self):
        """If first LLM call produces body > limit, agent retries with condensation prompt."""
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        long_body = "x" * 3000
        long_response = (
            "---\ntitle: Long\ntags: []\ncreated: 2026-01-01\n"
            "updated: 2026-01-01\nsource: distill\nsource_context: t1\n---\n\n"
            + long_body
        )
        short_response = MOCK_CONTEXT_RESPONSE

        call_count = 0

        def fake_call_llm(messages):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return long_response
            return short_response

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            result = agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        assert call_count == 2
        _, body = parse_front_matter(result)
        assert len(body.strip()) <= 2000

    def test_retry_asks_for_slack_under_limit(self):
        """The retry prompt asks the model for less than the hard limit."""
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        long_body = "x" * 3000
        long_response = (
            "---\ntitle: L\ntags: []\ncreated: 2026-01-01\n"
            "updated: 2026-01-01\nsource: distill\nsource_context: t1\n---\n\n"
            + long_body
        )

        captured: list[list[dict]] = []

        def fake_call_llm(messages):
            captured.append(messages)
            # First call returns the long body; second call returns short.
            return long_response if len(captured) == 1 else MOCK_CONTEXT_RESPONSE

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        assert len(captured) == 2
        retry_prompt = captured[1][-1]["content"]
        # Must mention the slacked target (limit minus margin), not the raw limit.
        expected_target = 2000 - agent.RETRY_MARGIN
        assert f"within {expected_target} characters" in retry_prompt

    def test_hard_trims_when_retry_still_over_limit(self):
        """If the retry still overshoots, body is hard-trimmed to fit the limit."""
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        first_body = "x" * 3000
        retry_body = "y" * 2014  # mimics the real-world failure: 14 over
        front_matter = (
            "---\ntitle: T\ntags: []\ncreated: 2026-01-01\n"
            "updated: 2026-01-01\nsource: distill\nsource_context: t1\n---\n\n"
        )

        responses = [front_matter + first_body, front_matter + retry_body]
        call_count = 0

        def fake_call_llm(messages):
            nonlocal call_count
            resp = responses[call_count]
            call_count += 1
            return resp

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            result = agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        # Both LLM calls happened.
        assert call_count == 2
        # Final body fits the hard limit (no save failure).
        _, body = parse_front_matter(result)
        assert len(body.strip()) <= 2000
        # Truncation marker is present so the user can see it was trimmed.
        assert "truncated" in body
        # Front matter preserved.
        meta, _ = parse_front_matter(result)
        assert meta["source_context"] == "t1"

    def test_no_retry_when_body_within_limit(self):
        """If first LLM call is within limit, no retry happens."""
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client)

        call_count = 0

        def fake_call_llm(messages):
            nonlocal call_count
            call_count += 1
            return MOCK_CONTEXT_RESPONSE

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        assert call_count == 1

    def test_language_instruction_injected_into_system_prompt(self):
        client = self._mock_client()
        zh_instruction = "[LANGUAGE INSTRUCTION]\nWrite in Simplified Chinese."
        agent = ExperienceDistillAgent(client=client, language_instruction=zh_instruction)

        captured_messages = []

        def fake_call_llm(messages):
            captured_messages.extend(messages)
            return MOCK_CONTEXT_RESPONSE

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        system_content = captured_messages[0]["content"]
        assert "[LANGUAGE INSTRUCTION]" in system_content
        assert "Simplified Chinese" in system_content

    def test_language_code_zh_injects_chinese_instruction(self):
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client, language_code="zh")

        captured_messages = []

        def fake_call_llm(messages):
            captured_messages.extend(messages)
            return MOCK_CONTEXT_RESPONSE

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        system_content = captured_messages[0]["content"]
        assert "Simplified Chinese" in system_content
        assert "[LANGUAGE INSTRUCTION]" in system_content

    def test_language_code_en_no_extra_instruction(self):
        client = self._mock_client()
        agent = ExperienceDistillAgent(client=client, language_code="en")

        captured_messages = []

        def fake_call_llm(messages):
            captured_messages.extend(messages)
            return MOCK_CONTEXT_RESPONSE

        with patch.object(agent, "_call_llm", side_effect=fake_call_llm):
            agent.run(SAMPLE_EXPERIENCE_CONTEXT)

        system_content = captured_messages[0]["content"]
        assert "in English" in system_content
        assert "[LANGUAGE INSTRUCTION]" not in system_content


# ── _experience_filename ──────────────────────────────────────────────────


class TestExperienceFilename:
    def test_derives_from_workspace_name(self):
        from data_formulator.routes.knowledge import _experience_filename
        name = _experience_filename("Sales Analysis Pattern")
        assert name.endswith(".md")
        assert "sales-analysis-pattern" in name.lower()

    def test_fallback_when_workspace_name_blank(self):
        from data_formulator.routes.knowledge import _experience_filename
        name = _experience_filename("   ")
        assert name == "session-experience.md"


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

    def test_missing_events_returns_error(self, client):
        # Empty threads list should be rejected by the route validator.
        bad_context = {
            "context_id": "x",
            "workspace_id": "ws-1",
            "workspace_name": "Demo",
            "threads": [],
        }
        resp = client.post("/api/knowledge/distill-experience",
                           json={
                               "experience_context": bad_context,
                               "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "test"},
                           })
        data = resp.get_json()
        assert data["status"] == "error"

    def test_missing_events_field_returns_error(self, client):
        bad_context = {
            "context_id": "x",
            "workspace_id": "ws-1",
            "workspace_name": "Demo",
        }  # no 'threads' key
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
             patch("data_formulator.agents.agent_experience_distill.ExperienceDistillAgent.run",
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
             patch("data_formulator.agents.agent_experience_distill.ExperienceDistillAgent.run",
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
