# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for attach_reasoning_content / accumulate_reasoning_content helpers."""

import pytest

from data_formulator.agents.agent_utils import (
    attach_reasoning_content,
    accumulate_reasoning_content,
)


# ---------------------------------------------------------------------------
# Helpers to fake LLM response objects
# ---------------------------------------------------------------------------

class _FakeMessage:
    """Minimal stand-in for ``choice.message``."""
    def __init__(self, content="hello", reasoning_content=None):
        self.content = content
        if reasoning_content is not None:
            self.reasoning_content = reasoning_content


class _FakeDelta:
    """Minimal stand-in for a streaming ``choice.delta``."""
    def __init__(self, content=None, reasoning_content=None):
        self.content = content
        if reasoning_content is not None:
            self.reasoning_content = reasoning_content


# ---------------------------------------------------------------------------
# attach_reasoning_content
# ---------------------------------------------------------------------------

class TestAttachReasoningContent:
    def test_present(self):
        msg = {"role": "assistant", "content": "hi"}
        result = attach_reasoning_content(msg, _FakeMessage(reasoning_content="think"))
        assert result is msg
        assert msg["reasoning_content"] == "think"

    def test_absent(self):
        msg = {"role": "assistant", "content": "hi"}
        attach_reasoning_content(msg, _FakeMessage())
        assert "reasoning_content" not in msg

    def test_none_value_not_attached(self):
        """If the attribute exists but is explicitly None, don't add it."""
        fake = _FakeMessage()
        fake.reasoning_content = None
        msg = {"role": "assistant", "content": "hi"}
        attach_reasoning_content(msg, fake)
        assert "reasoning_content" not in msg

    def test_empty_string_attached(self):
        """An empty string is a valid value — it should still be attached."""
        msg = {"role": "assistant", "content": "hi"}
        attach_reasoning_content(msg, _FakeMessage(reasoning_content=""))
        assert msg["reasoning_content"] == ""


# ---------------------------------------------------------------------------
# accumulate_reasoning_content
# ---------------------------------------------------------------------------

class TestAccumulateReasoningContent:
    def test_first_chunk(self):
        result = accumulate_reasoning_content(None, _FakeDelta(reasoning_content="a"))
        assert result == "a"

    def test_subsequent_chunks(self):
        acc = "ab"
        result = accumulate_reasoning_content(acc, _FakeDelta(reasoning_content="c"))
        assert result == "abc"

    def test_no_attr(self):
        result = accumulate_reasoning_content(None, _FakeDelta())
        assert result is None

    def test_no_attr_preserves_accumulator(self):
        result = accumulate_reasoning_content("existing", _FakeDelta())
        assert result == "existing"

    def test_none_value_no_change(self):
        delta = _FakeDelta()
        delta.reasoning_content = None
        result = accumulate_reasoning_content("existing", delta)
        assert result == "existing"

    def test_empty_string_delta_no_change(self):
        """Empty-string delta is falsy — accumulator should not change."""
        result = accumulate_reasoning_content(None, _FakeDelta(reasoning_content=""))
        assert result is None

    def test_multiple_chunks_sequence(self):
        acc = None
        for chunk_text in ["Think", "ing ", "step"]:
            acc = accumulate_reasoning_content(acc, _FakeDelta(reasoning_content=chunk_text))
        assert acc == "Thinking step"
