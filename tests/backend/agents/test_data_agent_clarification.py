# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for DataAgent structured clarification events."""

from __future__ import annotations

import pytest

from data_formulator.agents.data_agent import DataAgent
from data_formulator.routes.agents import _format_clarification_responses

pytestmark = [pytest.mark.backend]


class _FakeClient:
    model = "test-model"


def _agent() -> DataAgent:
    return DataAgent(client=_FakeClient(), workspace=None)


class TestDataAgentClarification:
    def test_clarify_action_outputs_structured_questions(self, monkeypatch) -> None:
        agent = _agent()

        def fake_get_next_action(trajectory, input_tables, outer_iteration=0):
            yield {
                "type": "agent_action",
                "action_data": {
                    "action": "clarify",
                    "questions": [
                        {
                            "id": "metric",
                            "text": "Which metric should I use?",
                            "responseType": "single_choice",
                            "options": [
                                {"id": "revenue", "label": "Revenue"},
                                {"id": "orders", "label": "Orders"},
                            ],
                        }
                    ],
                },
                "reason": "ok",
                "llm_calls": 1,
            }

        monkeypatch.setattr(agent, "_get_next_action", fake_get_next_action)

        events = list(agent.run([], "", trajectory=[{"role": "system", "content": "test"}]))

        assert events[-1]["type"] == "clarify"
        assert events[-1]["questions"] == [
            {
                "id": "metric",
                "text": "Which metric should I use?",
                "responseType": "single_choice",
                "required": True,
                "options": [
                    {"id": "revenue", "label": "Revenue"},
                    {"id": "orders", "label": "Orders"},
                ],
            }
        ]
        assert "message" not in events[-1]
        assert "options" not in events[-1]

    def test_tool_rounds_exhausted_outputs_auto_select_question(self, monkeypatch) -> None:
        agent = _agent()

        def fake_get_next_action(trajectory, input_tables, outer_iteration=0):
            yield {
                "type": "agent_action",
                "action_data": None,
                "reason": "tool_rounds_exhausted",
                "llm_calls": 12,
            }

        monkeypatch.setattr(agent, "_get_next_action", fake_get_next_action)

        events = list(agent.run([], "", trajectory=[{"role": "system", "content": "test"}]))

        clarify = events[-1]
        assert clarify["type"] == "clarify"
        assert clarify["questions"][0]["id"] == "continue_after_tool_rounds"
        assert clarify["questions"][0]["text_code"] == "agent.clarifyExhausted"
        assert clarify["questions"][0]["options"][0]["id"] == "continue"
        assert clarify["auto_select"] == {
            "question_id": "continue_after_tool_rounds",
            "option_id": "continue",
            "timeout_ms": 60000,
        }

    def test_clarify_action_preserves_multiple_question_option_groups(self, monkeypatch) -> None:
        agent = _agent()

        def fake_get_next_action(trajectory, input_tables, outer_iteration=0):
            yield {
                "type": "agent_action",
                "action_data": {
                    "action": "clarify",
                    "questions": [
                        {
                            "id": "metric",
                            "text": "Which metric?",
                            "options": [{"id": "revenue", "label": "Revenue"}],
                        },
                        {
                            "id": "period",
                            "text": "Which period?",
                            "options": [{"id": "last_12_months", "label": "Last 12 months"}],
                        },
                    ],
                },
                "reason": "ok",
                "llm_calls": 1,
            }

        monkeypatch.setattr(agent, "_get_next_action", fake_get_next_action)

        events = list(agent.run([], "", trajectory=[{"role": "system", "content": "test"}]))

        questions = events[-1]["questions"]
        assert [q["id"] for q in questions] == ["metric", "period"]
        assert questions[0]["options"] == [{"id": "revenue", "label": "Revenue"}]
        assert questions[1]["options"] == [{"id": "last_12_months", "label": "Last 12 months"}]

    def test_format_clarification_responses_for_resume_prompt(self) -> None:
        formatted = _format_clarification_responses([
            {
                "question_id": "metric",
                "answer": "Revenue",
                "option_id": "revenue",
                "source": "option",
            },
            {
                "question_id": "__freeform__",
                "answer": "Focus on the last 12 months.",
                "source": "freeform",
            },
        ])

        assert "- metric: Revenue (option: revenue)" in formatted
        assert "- Freeform clarification: Focus on the last 12 months." in formatted
