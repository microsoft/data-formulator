"""Empty provider streams must not end an analyst run as a silent success."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import data_formulator.analyst.agent as agent_module
from data_formulator.agent_config import AnalystExecutionConfig
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


def _run(streams, *, max_tool_rounds=12, retries=2, backoff=0, include_progress=False):
    client = _Client(streams)
    agent = AnalystAgent(client=client, workspace=SimpleNamespace(user_home=None),
                         skill_registry=build_registry(), identity_id=None,
                         execution_config=AnalystExecutionConfig(
                             max_tool_rounds_per_action=max_tool_rounds,
                             empty_response_retries=retries, empty_response_backoff_seconds=backoff))
    agent._loaded_skills = {"meta"}
    agent._run_payload = {}
    messages: list[dict] = []
    events = list(agent._tool_loop(messages,
                                   llm_calls_in_cycle=0, rlog=_Log(), input_tables=[], outer_iteration=0))
    return client, events if include_progress else [event for event in events if event.get("type") == "agent_action"], messages


def test_repeated_tool_progress_events_preserve_call_identity(monkeypatch):
    monkeypatch.setattr(AnalystAgent, "_run_explore_code", lambda *args: {"status": "ok", "stdout": "done"})
    chunk = _chunk()
    chunk.choices[0].delta.tool_calls = [
        SimpleNamespace(index=index, id=call_id, type="function", function=SimpleNamespace(
            name="execute_python_script", arguments='{"code": "print(1)"}'))
        for index, call_id in enumerate(["python-first", "python-second"])
    ]
    _, events, _ = _run([
        [chunk, _chunk(finish_reason="tool_calls")],
        [_chunk("Done."), _chunk(finish_reason="stop")],
    ], include_progress=True)
    assert [(event["type"], event["tool_call_id"]) for event in events
            if event["type"] in {"tool_start", "tool_result"}] == [
        ("tool_start", "python-first"), ("tool_result", "python-first"),
        ("tool_start", "python-second"), ("tool_result", "python-second"),
    ]


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


@pytest.mark.parametrize("retries", [0, 1])
def test_empty_stream_at_retry_limit_surfaces_error_without_unused_backoff(monkeypatch, retries):
    delays = []
    monkeypatch.setattr(agent_module.time, "sleep", delays.append)
    empty = [_chunk(finish_reason="stop")]
    client, actions, messages = _run([empty] * (retries + 1), retries=retries)
    assert client.calls == retries + 1
    assert actions[-1]["reason"] == "llm_error"
    assert "empty response" in actions[-1]["error_message"]
    assert len(delays) == retries
    assert messages == []


def test_configured_retry_count_and_backoff(monkeypatch):
    delays = []
    monkeypatch.setattr(agent_module.time, "sleep", delays.append)
    empty = [_chunk(finish_reason="stop")]
    client, actions, messages = _run([empty, empty], retries=1, backoff=0.5)
    assert client.calls == 2
    assert actions[-1]["reason"] == "llm_error"
    assert delays == [0.5]
    assert messages == []


def test_empty_response_retries_can_be_disabled(monkeypatch):
    delays = []
    monkeypatch.setattr(agent_module.time, "sleep", delays.append)
    client, actions, _ = _run([[_chunk(finish_reason="stop")]], retries=0)
    assert client.calls == 1
    assert actions[-1]["reason"] == "llm_error"
    assert delays == []
