# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for DataAgent structured clarification events."""

from __future__ import annotations

import pytest

from data_formulator.agents.data_agent import DataAgent

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
                            "text": "Which metric should I use?",
                            "responseType": "single_choice",
                            "options": ["Revenue", "Orders"],
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
                "text": "Which metric should I use?",
                "responseType": "single_choice",
                "required": True,
                "options": [{"label": "Revenue"}, {"label": "Orders"}],
            }
        ]
        assert "message" not in events[-1]
        assert "options" not in events[-1]

    def test_tool_rounds_exhausted_outputs_clarify_question(self, monkeypatch) -> None:
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
        assert clarify["questions"][0]["text_code"] == "agent.clarifyExhausted"
        assert clarify["questions"][0]["options"][0]["label_code"] == "agent.clarifyOptionContinue"
        assert "id" not in clarify["questions"][0]
        assert "id" not in clarify["questions"][0]["options"][0]
        # auto_select was removed; the user is expected to pick an option.
        assert "auto_select" not in clarify

    def test_clarify_action_preserves_multiple_question_option_groups(self, monkeypatch) -> None:
        agent = _agent()

        def fake_get_next_action(trajectory, input_tables, outer_iteration=0):
            yield {
                "type": "agent_action",
                "action_data": {
                    "action": "clarify",
                    "questions": [
                        {
                            "text": "Which metric?",
                            "options": ["Revenue"],
                        },
                        {
                            "text": "Which period?",
                            "options": [{"label": "Last 12 months"}],
                        },
                    ],
                },
                "reason": "ok",
                "llm_calls": 1,
            }

        monkeypatch.setattr(agent, "_get_next_action", fake_get_next_action)

        events = list(agent.run([], "", trajectory=[{"role": "system", "content": "test"}]))

        questions = events[-1]["questions"]
        assert [q["text"] for q in questions] == ["Which metric?", "Which period?"]
        assert questions[0]["options"] == [{"label": "Revenue"}]
        assert questions[1]["options"] == [{"label": "Last 12 months"}]
        # No id fields anywhere
        for q in questions:
            assert "id" not in q
            for opt in q.get("options", []):
                assert "id" not in opt


class TestDataAgentDelegate:
    """Tests for the delegate action."""

    def test_emits_delegate_event_for_data_loading(self, monkeypatch) -> None:
        agent = _agent()

        def fake_get_next_action(trajectory, input_tables, outer_iteration=0):
            yield {
                "type": "agent_action",
                "action_data": {
                    "action": "delegate",
                    "thought": "User asked about Q4 sales but no sales table is loaded.",
                    "target": "data_loading",
                    "message": "I don't see a sales table loaded — want to import one?",
                    "options": ["quarterly sales 2024"],
                },
                "reason": "ok",
                "llm_calls": 1,
            }

        monkeypatch.setattr(agent, "_get_next_action", fake_get_next_action)

        events = list(agent.run([], "", trajectory=[{"role": "system", "content": "test"}]))

        evt = events[-1]
        assert evt["type"] == "delegate"
        assert evt["target"] == "data_loading"
        assert evt["options"] == ["quarterly sales 2024"]
        assert evt["message"] == "I don't see a sales table loaded — want to import one?"
        assert evt["thought"] == "User asked about Q4 sales but no sales table is loaded."
        assert "trajectory" in evt
        assert evt["completed_step_count"] == 0

    def test_emits_delegate_event_for_report_gen(self, monkeypatch) -> None:
        agent = _agent()

        def fake_get_next_action(trajectory, input_tables, outer_iteration=0):
            yield {
                "type": "agent_action",
                "action_data": {
                    "action": "delegate",
                    "target": "report_gen",
                    "message": "Pick an angle for the write-up:",
                    "options": [
                        "Write a 200-word executive summary of regional trends.",
                        "Create a detailed analytical report on regional trends with category breakdowns.",
                    ],
                },
                "reason": "ok",
                "llm_calls": 1,
            }

        monkeypatch.setattr(agent, "_get_next_action", fake_get_next_action)

        events = list(agent.run([], "", trajectory=[{"role": "system", "content": "test"}]))

        evt = events[-1]
        assert evt["type"] == "delegate"
        assert evt["target"] == "report_gen"
        assert len(evt["options"]) == 2
        assert evt["options"][0] == "Write a 200-word executive summary of regional trends."
        assert evt["options"][1].startswith("Create a detailed")

    def test_missing_prompt_yields_parse_error(self, monkeypatch) -> None:
        agent = _agent()

        def fake_get_next_action(trajectory, input_tables, outer_iteration=0):
            yield {
                "type": "agent_action",
                "action_data": {
                    "action": "delegate",
                    "target": "data_loading",
                    "message": "missing",
                    "options": [""],
                },
                "reason": "ok",
                "llm_calls": 1,
            }

        monkeypatch.setattr(agent, "_get_next_action", fake_get_next_action)

        events = list(agent.run([], "", trajectory=[{"role": "system", "content": "test"}]))

        # Last event should be an error event (not a delegate).
        assert events[-1]["type"] != "delegate"

    def test_normalizer_validates_fields(self) -> None:
        with pytest.raises(ValueError):
            DataAgent._normalize_delegate_action(
                {"target": "", "options": ["x"]}
            )
        with pytest.raises(ValueError):
            DataAgent._normalize_delegate_action(
                {"target": "unknown", "options": ["x"]}
            )
        with pytest.raises(ValueError):
            DataAgent._normalize_delegate_action(
                {"target": "data_loading", "options": []}
            )
        with pytest.raises(ValueError):
            DataAgent._normalize_delegate_action(
                {"target": "data_loading", "options": ["   "]}
            )
        # Normal multi-option report_gen payload.
        out = DataAgent._normalize_delegate_action({
            "target": "  report_gen  ",
            "message": "  pick one  ",
            "options": ["  Brief recap.  ", "  Full report.  "],
        })
        assert out == {
            "target": "report_gen",
            "message": "pick one",
            "options": ["Brief recap.", "Full report."],
        }
        # Message is optional; >2 options are truncated to 2.
        out2 = DataAgent._normalize_delegate_action({
            "target": "report_gen",
            "options": ["A", "B", "C"],
        })
        assert out2 == {"target": "report_gen", "options": ["A", "B"]}
