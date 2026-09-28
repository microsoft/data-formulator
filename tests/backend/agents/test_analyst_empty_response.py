"""Empty provider streams must not end an analyst run as a silent success."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import data_formulator.analyst.agent as agent_module
from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.skills import build_registry


def _chunk(content=None, finish_reason=None):
    delta = SimpleNamespace(content=content, tool_calls=None, reasoning_content=None)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)])


class _Client:
    model = "fake/model"

    def __init__(self, streams):
        self.streams = list(streams)
        self.calls = 0

    def get_completion_with_tools(self, *args, **kwargs):
        self.calls += 1
        return iter(self.streams.pop(0))


class _Log:
    def log(self, *args, **kwargs):
        pass


def _run(streams, *, max_tool_rounds=6):
    client = _Client(streams)
    agent = AnalystAgent(client=client, workspace=SimpleNamespace(user_home=None),
                         skill_registry=build_registry(), identity_id=None)
    agent._loaded_skills = {"core"}
    agent._run_payload = {}
    messages: list[dict] = []
    events = list(agent._tool_loop(messages, max_tool_rounds=max_tool_rounds, max_json_retries=1, json_retries=0,
                                   llm_calls_in_cycle=0, rlog=_Log(), input_tables=[], outer_iteration=0))
    return client, [event for event in events if event.get("type") == "agent_action"], messages


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch):
    monkeypatch.setattr(agent_module, "_EMPTY_RESPONSE_BACKOFF_SECONDS", 0)


def test_empty_stream_is_retried_before_final_text():
    client, actions, messages = _run([[_chunk(finish_reason="stop")], [_chunk("Done."), _chunk(finish_reason="stop")]])
    assert client.calls == 2
    assert actions[-1]["reason"] == "done" and actions[-1]["final_text"] == "Done."
    assert [message["role"] for message in messages] == ["assistant"]


def test_repeated_empty_streams_surface_an_llm_error():
    empty = [_chunk(finish_reason="stop")]
    client, actions, messages = _run([empty, empty, empty])
    assert client.calls == 3
    assert actions[-1]["reason"] == "llm_error" and "empty response" in actions[-1]["error_message"]
    assert messages == []


@pytest.mark.parametrize("max_tool_rounds", [1, 2])
def test_empty_stream_at_round_limit_surfaces_error_without_unused_backoff(monkeypatch, max_tool_rounds):
    delays = []
    monkeypatch.setattr(agent_module.time, "sleep", delays.append)
    empty = [_chunk(finish_reason="stop")]
    client, actions, messages = _run([empty] * max_tool_rounds, max_tool_rounds=max_tool_rounds)
    assert client.calls == max_tool_rounds
    assert actions[-1]["reason"] == "llm_error"
    assert "empty response" in actions[-1]["error_message"]
    assert len(delays) == max_tool_rounds - 1
    assert messages == []
