# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for SortDataAgent.

Focuses on things we can test without a real LLM:
- The input dict key must be 'values' (not 'value') to match the system prompt.
- The user query is serialised as valid JSON.
- The agent correctly handles choices that return valid JSON blocks.
- The agent handles choices whose content cannot be parsed as JSON.
- The 'agent' field on each candidate is set to 'SortDataAgent'.
- The 'dialog' field includes both the initial messages and the LLM reply.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from data_formulator.agents.agent_sort_data import SortDataAgent

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_choice(content: str) -> SimpleNamespace:
    """Build a fake response choice with the given message content."""
    msg = SimpleNamespace(role="assistant", content=content)
    return SimpleNamespace(message=msg)


def _make_response(*contents: str) -> SimpleNamespace:
    """Build a fake completion response with one choice per content string."""
    return SimpleNamespace(choices=[_make_choice(c) for c in contents])


def _make_agent(response) -> SortDataAgent:
    """Build a SortDataAgent whose client returns *response* on get_completion."""
    client = MagicMock()
    client.get_completion.return_value = response
    return SortDataAgent(client)


# ---------------------------------------------------------------------------
# Input construction
# ---------------------------------------------------------------------------

class TestInputConstruction:
    def test_input_key_is_values_not_value(self):
        """Regression for the 'value' → 'values' key name bug.

        The system prompt examples use 'values'; sending 'value' would confuse
        the LLM. This test captures the call to get_completion and inspects
        the serialised user message.
        """
        client = MagicMock()
        client.get_completion.return_value = _make_response('{"name": "x", "sorted_values": ["a"], "reason": "ok"}')
        agent = SortDataAgent(client)

        agent.run("month", ["March", "January", "February"])

        # Extract the user message that was sent to the LLM
        call_args = client.get_completion.call_args
        messages = call_args.kwargs.get("messages") or call_args.args[0]
        user_content = next(m["content"] for m in messages if m["role"] == "user")

        # The serialised JSON block must contain the key "values", not "value"
        assert '"values"' in user_content, (
            f"Expected key 'values' in user content but got:\n{user_content}"
        )
        # Parse out the JSON block from [INPUT]\n\n{...}\n\n[OUTPUT]
        json_part = user_content.split("[INPUT]")[1].split("[OUTPUT]")[0].strip()
        parsed = json.loads(json_part)
        assert "values" in parsed
        assert "value" not in parsed

    def test_input_name_is_preserved(self):
        """The 'name' field in the serialised input must match what was passed."""
        client = MagicMock()
        client.get_completion.return_value = _make_response(
            '{"name": "grades", "sorted_values": ["A", "B"], "reason": "ok"}'
        )
        agent = SortDataAgent(client)
        agent.run("grades", ["B", "A"])

        messages = client.get_completion.call_args.kwargs.get("messages") or \
                   client.get_completion.call_args.args[0]
        user_content = next(m["content"] for m in messages if m["role"] == "user")
        json_part = user_content.split("[INPUT]")[1].split("[OUTPUT]")[0].strip()
        parsed = json.loads(json_part)
        assert parsed["name"] == "grades"

    def test_input_values_are_preserved(self):
        """Every value passed in must appear in the serialised JSON."""
        client = MagicMock()
        client.get_completion.return_value = _make_response(
            '{"name": "x", "sorted_values": [], "reason": "ok"}'
        )
        agent = SortDataAgent(client)
        values = [">=60", "10", "20", "50"]
        agent.run("grades", values)

        messages = client.get_completion.call_args.kwargs.get("messages") or \
                   client.get_completion.call_args.args[0]
        user_content = next(m["content"] for m in messages if m["role"] == "user")
        json_part = user_content.split("[INPUT]")[1].split("[OUTPUT]")[0].strip()
        parsed = json.loads(json_part)
        assert parsed["values"] == values

    def test_unicode_values_serialised_correctly(self):
        """Non-ASCII values must not be escaped as \\uXXXX in the user query
        (ensure_ascii=False is set so the LLM sees readable text)."""
        client = MagicMock()
        client.get_completion.return_value = _make_response(
            '{"name": "month", "sorted_values": ["一月", "二月"], "reason": "ok"}'
        )
        agent = SortDataAgent(client)
        agent.run("month", ["二月", "一月"])

        messages = client.get_completion.call_args.kwargs.get("messages") or \
                   client.get_completion.call_args.args[0]
        user_content = next(m["content"] for m in messages if m["role"] == "user")
        # Must appear as literal Chinese characters, not escaped sequences
        assert "一月" in user_content or "二月" in user_content


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

class TestResponseParsing:
    def test_valid_json_block_in_content_returns_ok(self):
        payload = '{"name": "month", "sorted_values": ["January", "February"], "reason": "natural order"}'
        response = _make_response(payload)
        agent = _make_agent(response)

        candidates = agent.run("month", ["February", "January"])

        assert len(candidates) == 1
        assert candidates[0]["status"] == "ok"
        assert candidates[0]["content"]["sorted_values"] == ["January", "February"]

    def test_json_wrapped_in_text_is_extracted(self):
        """The agent uses extract_json_objects, so JSON embedded in prose should work."""
        payload = 'Here is the result:\n{"name": "x", "sorted_values": ["a", "b"], "reason": "r"}\nDone.'
        response = _make_response(payload)
        agent = _make_agent(response)

        candidates = agent.run("x", ["b", "a"])

        assert candidates[0]["status"] == "ok"

    def test_unparseable_content_returns_error_status(self):
        response = _make_response("Sorry, I cannot sort this data.")
        agent = _make_agent(response)

        candidates = agent.run("x", ["b", "a"])

        assert len(candidates) == 1
        assert candidates[0]["status"] != "ok"

    def test_multiple_choices_produce_multiple_candidates(self):
        good = '{"name": "x", "sorted_values": ["a"], "reason": "ok"}'
        bad = "unparseable"
        response = _make_response(good, bad)
        agent = _make_agent(response)

        candidates = agent.run("x", ["a"])

        assert len(candidates) == 2

    def test_agent_field_is_set(self):
        response = _make_response('{"name": "x", "sorted_values": [], "reason": "r"}')
        agent = _make_agent(response)

        candidates = agent.run("x", [])
        assert candidates[0]["agent"] == "SortDataAgent"

    def test_dialog_includes_system_and_user_and_assistant(self):
        content = '{"name": "x", "sorted_values": [], "reason": "r"}'
        response = _make_response(content)
        agent = _make_agent(response)

        candidates = agent.run("x", [])
        dialog = candidates[0]["dialog"]

        roles = [m["role"] for m in dialog]
        assert "system" in roles
        assert "user" in roles
        assert "assistant" in roles
        # Assistant reply must be the last message
        assert dialog[-1]["role"] == "assistant"
        assert dialog[-1]["content"] == content
