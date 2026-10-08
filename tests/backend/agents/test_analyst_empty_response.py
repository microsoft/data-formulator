"""Empty provider streams must not end an analyst run as a silent success."""
from __future__ import annotations

import json
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
        self.tools = []

    def get_completion_with_tools(self, *args, **kwargs):
        self.calls += 1
        self.tools.append(kwargs.get("tools"))
        return iter(self.streams.pop(0))


class _Log:
    def log(self, *args, **kwargs):
        pass


def _run(streams, *, max_tool_rounds=12, retries=2, backoff=0, include_progress=False, messages=None):
    client = _Client(streams)
    agent = AnalystAgent(client=client, workspace=SimpleNamespace(user_home=None),
                         skill_registry=build_registry(), identity_id=None,
                         execution_config=AnalystExecutionConfig(
                             max_tool_rounds_per_action=max_tool_rounds,
                             empty_response_retries=retries, empty_response_backoff_seconds=backoff))
    agent._loaded_skills = {"meta"}
    agent._run_payload = {}
    messages = messages if messages is not None else []
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


def _failing(error):
    raise error
    yield  # pragma: no cover


def test_stream_errors_on_the_first_chunk_are_retried(monkeypatch):
    monkeypatch.setattr(agent_module.time, "sleep", lambda seconds: None)
    client, actions, _ = _run([_failing(RuntimeError("Rate limit exceeded")), [_chunk("Done."), _chunk(finish_reason="stop")]])
    assert client.calls == 2
    assert actions[-1]["final_text"] == "Done."


def test_context_overflow_shortens_older_tool_output_and_retries():
    overflow = RuntimeError("AzureException BadRequestError - Your input exceeds the context window of this model.")
    history = [{"role": "tool", "tool_call_id": f"call-{index}", "content": f"result {index} " + "x" * 5000}
               for index in range(4)]
    client, actions, messages = _run([_failing(overflow), _failing(overflow),
                                      [_chunk("Done."), _chunk(finish_reason="stop")]], messages=list(history))
    assert client.calls == 3
    assert actions[-1]["final_text"] == "Done."
    tools = [message for message in messages if message["role"] == "tool"]
    assert [message["tool_call_id"] for message in tools] == ["call-0", "call-1", "call-2", "call-3"]
    assert all(len(message["content"]) < 500 and "context window" in message["content"] for message in tools)
    assert tools[0]["content"].startswith("result 0")


def test_context_overflow_with_nothing_left_to_shorten_is_reported():
    overflow = RuntimeError("Input tokens exceed the configured limit of 272000 tokens.")
    client, actions, _ = _run([_failing(overflow)])
    assert client.calls == 1
    assert actions[-1]["reason"] == "llm_error" and "Input too long" in actions[-1]["error_message"]


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


def _agent():
    return AnalystAgent(client=_Client([]), workspace=SimpleNamespace(user_home=None),
                        skill_registry=build_registry(), identity_id=None)


def test_progress_reminder_counts_rounds_not_parallel_calls_and_repeats_each_interval():
    agent = _agent()
    messages = []
    for index in range(16):
        assert not agent._remind_progress_if_due(messages, "this request", "ask the user")
        messages.append({"role": "assistant", "tool_calls": [
            {"id": f"{index}-{offset}", "function": {"name": "inspect_source_data"}} for offset in range(3)]})
        messages.extend({"role": "tool", "content": "ok"} for _ in range(3))
    assert agent._remind_progress_if_due(messages, "this request", "ask the user")
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"].startswith("[Automatic message] You have been working on this request for 16 turns.")
    assert not agent._remind_progress_if_due(messages, "this request", "ask the user")
    messages.extend({"role": "assistant", "content": "Continue inspecting."} for _ in range(16))
    assert agent._remind_progress_if_due(messages, "this request", "ask the user")
    assert "for 32 turns" in messages[-1]["content"]


def test_progress_reminder_resets_on_new_input():
    agent = _agent()
    messages = [{"role": "assistant", "content": "Earlier request."} for _ in range(20)]
    agent._reset_progress_reminder(messages)
    messages.extend({"role": "assistant", "content": "New request."} for _ in range(15))
    assert not agent._remind_progress_if_due(messages, "this request", "ask the user")
    messages.append({"role": "assistant", "content": "New request."})
    assert agent._remind_progress_if_due(messages, "this request", "ask the user")
    assert "for 16 turns" in messages[-1]["content"]


def _tool_stream(name, arguments, call_id="call"):
    chunk = _chunk()
    chunk.choices[0].delta.tool_calls = [SimpleNamespace(index=0, id=call_id, type="function",
        function=SimpleNamespace(name=name, arguments=json.dumps(arguments)))]
    return [chunk, _chunk(finish_reason="tool_calls")]


def test_analyst_sends_soft_progress_reminder_without_restricting_tools(monkeypatch):
    executions = []
    monkeypatch.setattr(AnalystAgent, "_run_explore_code", lambda *args: executions.append(args) or {"stdout": "ok"})
    streams = [_tool_stream("execute_python_script", {"code": "print(1)"}, f"inspect-{index}") for index in range(16)]
    streams.append([_chunk("Done."), _chunk(finish_reason="stop")])
    client, actions, messages = _run(streams)
    assert len(executions) == 16
    assert all("execute_python_script" in [tool["function"]["name"] for tool in tools] for tools in client.tools)
    reminders = [message for message in messages if str(message.get("content", "")).startswith("[Automatic message]")]
    assert len(reminders) == 1
    assert "ask the user" in reminders[0]["content"]
    assert actions[-1]["reason"] == "done"


def test_analyst_run_resets_progress_reminder_for_each_request(tmp_path, monkeypatch):
    from data_formulator.datalake.workspace import Workspace

    client = _Client([[_chunk("Done."), _chunk(finish_reason="stop")]])
    agent = AnalystAgent(client, Workspace("progress-reminder", root_dir=tmp_path))
    monkeypatch.setattr(agent, "_get_next_action", lambda trajectory, input_tables, outer_iteration:
                        agent._tool_loop(trajectory, 0, agent._reasoning_log, input_tables, outer_iteration))
    trajectory = [{"role": "system", "content": "Analyze data."},
                  *[{"role": "assistant", "content": "Earlier request."} for _ in range(20)]]
    events = list(agent.run([], "Analyze data", trajectory=trajectory))
    assert events[-1]["type"] == "completion"
    assert not any(str(message.get("content", "")).startswith("[Automatic message]") for message in trajectory)
