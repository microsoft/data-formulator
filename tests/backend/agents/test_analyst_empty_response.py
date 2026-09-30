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


def test_progress_checkpoint_counts_rounds_not_parallel_calls_and_resets():
    messages = []
    for index in range(16):
        assert not AnalystAgent._progress_check_due(messages)
        messages.append({"role": "assistant", "tool_calls": [
            {"id": f"{index}-{offset}", "function": {"name": "inspect_source_data"}} for offset in range(3)]})
        messages.extend({"role": "tool", "content": "ok"} for _ in range(3))
    assert AnalystAgent._progress_check_due(messages)
    assessment = {"decision": "continue", "progress": "Validated eight accounts.",
                  "blocker": "", "next_step": "Validate the remaining two accounts."}
    message = SimpleNamespace(content=None, tool_calls=[SimpleNamespace(id="checkpoint", function=SimpleNamespace(
        name="progress_check", arguments=json.dumps(assessment)))])
    assert AnalystAgent._record_progress_check(messages, message) == assessment
    assert not AnalystAgent._progress_check_due(messages)
    messages.extend({"role": "assistant", "content": "Continue inspecting."} for _ in range(16))
    assert AnalystAgent._progress_check_due(messages)


@pytest.mark.parametrize("arguments", ["{}", "[]", "not-json", json.dumps({
    "decision": "continue", "progress": " ", "blocker": "", "next_step": "Inspect data."})])
def test_invalid_progress_checkpoint_does_not_reset_rounds(arguments):
    messages = [{"role": "assistant", "content": "Inspecting."} for _ in range(16)]
    message = SimpleNamespace(content=None, tool_calls=[SimpleNamespace(id="checkpoint", function=SimpleNamespace(
        name="progress_check", arguments=arguments))])
    with pytest.raises(ValueError, match="Invalid progress_check"):
        AnalystAgent._record_progress_check(messages, message)
    assert AnalystAgent._progress_check_due(messages)
    assert messages[-1]["tool_call_id"] == "checkpoint"


def _tool_stream(name, arguments, call_id="call"):
    chunk = _chunk()
    chunk.choices[0].delta.tool_calls = [SimpleNamespace(index=0, id=call_id, type="function",
        function=SimpleNamespace(name=name, arguments=json.dumps(arguments)))]
    return [chunk, _chunk(finish_reason="tool_calls")]


@pytest.mark.parametrize("decision", ["continue", "change_approach", "report_and_pause"])
def test_analyst_requires_progress_check_before_continuing_or_pausing(monkeypatch, decision):
    executions = []
    monkeypatch.setattr(AnalystAgent, "_run_explore_code", lambda *args: executions.append(args) or {"stdout": "ok"})
    assessment = {"decision": decision, "progress": "Validated eight accounts.", "blocker": "Two need access.",
                  "next_step": "Check credentials or provide access."}
    streams = [_tool_stream("execute_python_script", {"code": "print(1)"}, f"inspect-{index}") for index in range(16)]
    streams.append(_tool_stream("progress_check", assessment, "checkpoint"))
    if decision != "report_and_pause":
        streams.append([_chunk("Done."), _chunk(finish_reason="stop")])
    client, actions, messages = _run(streams)
    assert len(executions) == 16
    assert [tool["function"]["name"] for tool in client.tools[16]] == ["progress_check"]
    assert all("progress_check" not in [tool["function"]["name"] for tool in tools] for tools in client.tools[:16])
    assert actions[-1]["reason"] == ("progress_pause" if decision == "report_and_pause" else "done")
    assert not AnalystAgent._progress_check_due(messages)


def test_checkpoint_rejects_ordinary_tools_without_execution_or_streaming(monkeypatch):
    executions = []
    monkeypatch.setattr(AnalystAgent, "_run_explore_code", lambda *args: executions.append(args))
    messages = [{"role": "assistant", "content": "Inspecting."} for _ in range(16)]
    client, events, _ = _run([
        _tool_stream("execute_python_script", {"code": "print(1)"}),
        _tool_stream("write_report", {"report": "Must not be streamed."}),
        [_chunk("I will continue."), _chunk(finish_reason="stop")],
    ], messages=messages, include_progress=True)
    assert client.calls == 3
    assert executions == []
    assert [event["type"] for event in events] == ["agent_action"]
    assert events[-1]["reason"] == "llm_error"
    assert AnalystAgent._progress_check_due(messages)


def test_checkpoint_cadence_spans_action_boundaries_and_empty_retries(monkeypatch):
    monkeypatch.setattr(AnalystAgent, "_run_explore_code", lambda *args: {"stdout": "ok"})
    _, actions, messages = _run([
        *[_tool_stream("execute_python_script", {"code": "print(1)"}, f"inspect-{index}") for index in range(15)],
        [_chunk(finish_reason="stop")],
        _tool_stream("ask_user", {"questions": [{"text": "Which account?"}]}, "question"),
    ])
    assert actions[-1]["action_data"]["action"] == "ask_user"
    assert len([message for message in messages if message["role"] == "assistant"]) == 16
    assessment = {"decision": "continue", "progress": "Identified the account.", "blocker": "",
                  "next_step": "Report the result."}
    client, actions, _ = _run([
        _tool_stream("progress_check", assessment),
        [_chunk("Done."), _chunk(finish_reason="stop")],
    ], messages=messages)
    assert [tool["function"]["name"] for tool in client.tools[0]] == ["progress_check"]
    assert actions[-1]["reason"] == "done"


def test_progress_checkpoint_rejects_mixed_calls_and_pairs_every_result():
    assessment = {"decision": "report_and_pause", "progress": "No new evidence.", "blocker": "Access denied.",
                  "next_step": "Provide access."}
    message = SimpleNamespace(content=None, tool_calls=[
        SimpleNamespace(id="checkpoint", function=SimpleNamespace(name="progress_check", arguments=json.dumps(assessment))),
        SimpleNamespace(id="ordinary", function=SimpleNamespace(name="execute_python_script", arguments='{"code":"print(1)"}')),
    ])
    messages = [{"role": "assistant", "content": "Inspecting."} for _ in range(16)]
    with pytest.raises(ValueError, match="alone"):
        AnalystAgent._record_progress_check(messages, message)
    assert [message["tool_call_id"] for message in messages[-2:]] == ["checkpoint", "ordinary"]
    assert AnalystAgent._progress_check_due(messages)


def test_progress_pause_uses_resumable_analyst_interaction(tmp_path, monkeypatch):
    from data_formulator.datalake.workspace import Workspace

    assessment = {"decision": "report_and_pause", "progress": "Validated eight accounts.", "blocker": "Access denied.",
                  "next_step": "Provide access or revise the scope."}
    client = _Client([_tool_stream("progress_check", assessment)])
    agent = AnalystAgent(client, Workspace("progress-pause", root_dir=tmp_path))
    monkeypatch.setattr(agent, "_get_next_action", lambda trajectory, input_tables, outer_iteration:
                        agent._tool_loop(trajectory, 0, agent._reasoning_log, input_tables, outer_iteration))
    trajectory = [{"role": "system", "content": "Analyze data."},
                  *[{"role": "assistant", "content": "Inspecting."} for _ in range(16)]]
    events = list(agent.run([], "Analyze data", trajectory=trajectory))
    pause = events[-1]
    assert pause["type"] == "interact"
    assert pause["questions"][0]["text"] == AnalystAgent._progress_check_report(assessment)
    assert not any(event["type"] == "completion" for event in events)
    assert not AnalystAgent._progress_check_due(pause["trajectory"])
    client.streams.append([_chunk("Done."), _chunk(finish_reason="stop")])
    resumed = list(agent.run([], "Exclude the unavailable accounts", trajectory=pause["trajectory"]))
    assert resumed[-1]["type"] == "completion"
    assert "progress_check" not in {tool["function"]["name"] for tool in client.tools[-1]}
