"""A session's requests continue one agent conversation (design-docs/63)."""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock

import pytest

import data_formulator.analyst.history as history_module
from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.history import SessionHistory
from data_formulator.datalake.workspace import Workspace

pytestmark = pytest.mark.backend

STATE = {
    "derivedTables": [{"kind": "table", "id": "t-sales", "displayId": "Sales", "names": ["region", "sales"], "metadata": {},
                       "virtual": {"tableId": "d_sales", "rowCount": 3}, "parentNodeId": "ask", "createdAt": 2,
                       "derive": {"source": [], "code": "df = sales", "trigger": {"tableId": "conversation-root:c"}}}],
    "charts": [{"id": "chart-1", "chartType": "Bar Chart", "tableRef": "t-sales",
                "encodingMap": {"x": {"fieldID": "f-region"}, "y": {"fieldID": "f-sales"}}}],
    "conceptShelfItems": [{"id": "f-region", "name": "region"}, {"id": "f-sales", "name": "sales"}],
    "textTurns": [{"id": "ask", "prompt": "compare regions", "parentNodeId": "conversation-root:c", "createdAt": 1}],
    "focusedId": {"type": "chart", "chartId": "chart-1"},
}


@pytest.fixture()
def workspace(tmp_path):
    return Workspace("test-user", root_dir=tmp_path)


def _agent(workspace, replies, seen, *, model="model-a", skill=None):
    """An agent whose model answers with ``replies`` (final texts, or ``("ask", text)`` to pause on a question)."""
    client = MagicMock()
    client.model = model
    agent = AnalystAgent(client=client, workspace=workspace)
    replies = list(replies)

    def next_action(messages, *args, **kwargs):
        seen.append([dict(message) for message in messages])
        if skill:
            agent._load_skill_into_context(skill, messages)
        reply = replies.pop(0)
        if isinstance(reply, tuple):
            call = f"ask-{len(seen)}"
            messages.append({"role": "assistant", "content": None, "tool_calls": [{
                "id": call, "type": "function", "function": {"name": "ask_user", "arguments": "{}"}}]})
            messages.append({"role": "tool", "tool_call_id": call, "content": ""})
            yield {"type": "agent_action", "tool_call_id": call, "reason": "ok", "action_data": {
                "action": "ask_user", "questions": [{"text": reply[1], "responseType": "free_text"}]}}
            return
        messages.append({"role": "assistant", "content": reply})
        yield {"type": "agent_action", "action_data": None, "reason": "done", "final_text": reply}

    agent._get_next_action = next_action
    return agent


def _run(agent, question, state=STATE, conversation_id=None, **kwargs):
    return list(agent.run([], question, session_state=json.loads(json.dumps(state)),
                          conversation_id=conversation_id or question, **kwargs))


def test_a_later_request_continues_the_conversation_with_what_changed(workspace) -> None:
    seen: list = []
    _run(_agent(workspace, ["Sales lead in the North."], seen, skill="report"), "Which region leads?")
    moved = {**STATE, "focusedId": {"type": "table", "tableId": "t-sales"}}
    second = _agent(workspace, ["Because of Q4."], seen)
    _run(second, "Why?", moved)

    first_call, second_call = seen
    stored_first = SessionHistory(workspace).load()["messages"][:len(second_call) - 2]
    # The same system prompt, then the first request exactly as it was sent and answered, then only the new turn.
    assert second_call[0] == first_call[0]
    assert second_call[1:len(first_call)] == first_call[1:]
    assert second_call[1:-1] == stored_first
    assert stored_first[-1] == {"role": "assistant", "content": "Sales lead in the North."}
    turn = second_call[-1]["content"]
    assert turn.startswith("[SESSION CHANGES]") and turn.endswith("[USER QUESTION]\n\nWhy?")
    assert "[SESSION INDEX]" not in turn
    assert "Focus: `session/tables/d_sales.json` is now on the canvas, the user is working in `session/threads/1.md`" in turn
    # A skill loaded earlier stays loaded, so the tool list (and the cached prompt) stays the same.
    assert "report" in second._loaded_skills and "write_report" in second._legal_actions()
    assert [message["content"] for message in SessionHistory(workspace).load()["messages"]][-1] == "Because of Q4."


def test_runs_from_the_same_conversation_each_add_their_turn(workspace) -> None:
    store = SessionHistory(workspace)
    store.commit("m", [{"role": "user", "content": "q0"}, {"role": "assistant", "content": "a0"}], continued=False)
    base, _ = store.continuable("m")
    store.commit("m", [{"role": "user", "content": "q1"}, {"role": "assistant", "content": "a1"}], continued=True)
    store.commit("m", [{"role": "user", "content": "q2"}, {"role": "assistant", "content": "a2"}], continued=True)
    data = store.load()
    assert base == data["messages"][:2]
    assert [message["content"] for message in data["messages"]] == ["q0", "a0", "q1", "a1", "q2", "a2"]
    assert data["turn_starts"] == [0, 2, 4] and data["revision"] == 3
    # A fresh start replaces the conversation.
    store.commit("m", [{"role": "user", "content": "fresh"}], continued=False)
    assert [message["content"] for message in store.load()["messages"]] == ["fresh"]


def test_a_paused_run_joins_the_conversation_when_its_resumed_run_finishes(workspace) -> None:
    seen: list = []
    _run(_agent(workspace, ["Done."], seen), "First")
    before = SessionHistory(workspace).load()["messages"]
    events = _run(_agent(workspace, [("ask", "Which year?")], seen), "Second")
    interact = next(event for event in events if event["type"] == "interact")
    assert SessionHistory(workspace).load()["messages"] == before

    # The reply resumes the paused run (same conversation id), with the trajectory the client kept.
    _run(_agent(workspace, ["2024 it is."], seen), "2024", conversation_id="Second",
         trajectory=interact["trajectory"] + [{"role": "user", "content": "2024"}])
    stored = SessionHistory(workspace).load()["messages"]
    assert stored[:len(before)] == before
    added = [message.get("content") for message in stored[len(before):]]
    assert added[0].startswith("[SESSION CHANGES]") and added[0].endswith("[USER QUESTION]\n\nSecond")
    assert added[-3].startswith("[SESSION CHANGES]") and added[-2:] == ["2024", "2024 it is."]


def test_a_request_starts_fresh_when_continuing_would_not_pay(workspace, monkeypatch) -> None:
    store = SessionHistory(workspace)
    turn = [{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]
    store.commit("m", turn, continued=False)
    assert store.continuable("m") == (turn, "continuing")
    assert store.continuable("other-model") == (None, "model changed")

    big = [{"role": "user", "content": "x" * 50_000}, {"role": "tool", "tool_call_id": "t", "content": "y" * 700_000},
           {"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]
    store.commit("m", big, continued=False)
    assert store.continuable("m") == (None, "history too large")
    monkeypatch.setattr(history_module, "MAX_TOKENS", 10**9)
    data = store.load()
    data["updated_at"] = time.time() - history_module.IDLE_SECONDS - 1
    store._save(data)
    assert store.continuable("m") == (None, "idle with a large history")

    monkeypatch.setenv("DF_AGENT_CONTINUATION", "off")
    assert store.continuable("m") == (None, "continuation off")


def test_older_tool_output_is_shortened_once_the_conversation_is_large(workspace, monkeypatch) -> None:
    monkeypatch.setattr(history_module, "COMPACT_TOKENS", 1_000)
    store = SessionHistory(workspace)
    for index in range(3):
        store.commit("m", [{"role": "user", "content": f"q{index}"},
                           {"role": "tool", "tool_call_id": f"t{index}", "content": f"{index}" * 2_000},
                           {"role": "assistant", "content": f"a{index}"}], continued=True)
    tools = [message["content"] for message in store.load()["messages"] if message["role"] == "tool"]
    # The last two turns keep their output; older output is shortened.
    assert tools[0].endswith(history_module._COMPACTED) and len(tools[0]) < 600
    assert tools[1:] == ["1" * 2_000, "2" * 2_000]


def test_the_conversation_is_hidden_from_the_agent_and_left_out_of_exports(workspace) -> None:
    import zipfile
    from data_formulator.analyst.session_files import SessionFiles
    from types import SimpleNamespace

    SessionHistory(workspace).commit("m", [{"role": "user", "content": "q"}], continued=False)
    assert not any("_agent" in item["path"] for item in SessionFiles(SimpleNamespace(workspace=workspace, payload={})).list()["files"])
    names = zipfile.ZipFile(workspace.export_session_zip({})).namelist()
    assert names and not any("_agent" in name for name in names)


@pytest.mark.slow
def test_a_model_stream_that_sends_nothing_is_retried(workspace, monkeypatch) -> None:
    import threading
    from data_formulator.analyst import agent as agent_module

    monkeypatch.setenv("DF_MODEL_FIRST_CHUNK_SECONDS", "0.2")
    release = threading.Event()

    def stalled():
        release.wait(5)
        yield "late"

    client = MagicMock()
    client.model = "m"
    client.get_completion_with_tools.side_effect = [stalled(), iter(["chunk"])]
    agent = AnalystAgent(client=client, workspace=workspace)
    stream = agent._open_stream([{"role": "user", "content": "hi"}], [])
    release.set()
    assert list(stream) == ["chunk"] and client.get_completion_with_tools.call_count == 2
    assert issubclass(agent_module.ModelStreamStalled, TimeoutError)


def test_a_rate_limited_model_call_waits_longer_and_retries_more(workspace, monkeypatch) -> None:
    from data_formulator.agent_config import AnalystExecutionConfig
    from data_formulator.analyst import agent as agent_module

    class RateLimitError(Exception):
        pass

    waits: list[float] = []
    monkeypatch.setattr(agent_module.time, "sleep", waits.append)
    client = MagicMock()
    client.model = "m"
    limited = RateLimitError("exceeded token rate limit")
    client.get_completion_with_tools.side_effect = [limited, limited, limited, iter(["chunk"])]
    agent = AnalystAgent(client=client, workspace=workspace, execution_config=AnalystExecutionConfig(rate_limit_backoff_seconds=2.0))
    agent.cancel = None
    assert list(agent._open_stream([{"role": "user", "content": "hi"}], [])) == ["chunk"]
    assert waits == [2.0, 4.0, 8.0]


def test_a_rate_limited_model_call_waits_as_long_as_the_provider_asks(workspace, monkeypatch) -> None:
    from types import SimpleNamespace
    from data_formulator.analyst import agent as agent_module

    class RateLimitError(Exception):
        pass

    class MidStreamFallbackError(Exception):
        pass

    in_headers = RateLimitError("exceeded token rate limit")
    in_headers.response = SimpleNamespace(headers={"retry-after-ms": "2500"})
    wrapped = MidStreamFallbackError("rate limit")
    wrapped.original_exception = in_headers
    in_message = RateLimitError("Rate limit is exceeded. Please retry after 7 seconds.")
    too_long = RateLimitError("429 rate limit")
    too_long.litellm_response_headers = {"retry-after": "600"}
    unsaid = RateLimitError("exceeded token rate limit")
    assert agent_module._retry_after_seconds(wrapped) == 2.5
    assert agent_module._retry_after_seconds(in_message) == 7.0
    assert agent_module._retry_after_seconds(unsaid) is None

    waits: list[float] = []
    monkeypatch.setattr(agent_module.time, "sleep", waits.append)
    client = MagicMock()
    client.model = "m"
    client.get_completion_with_tools.side_effect = [wrapped, in_message, too_long, iter(["chunk"])]
    agent = AnalystAgent(client=client, workspace=workspace)
    agent.cancel = None
    assert list(agent._open_stream([{"role": "user", "content": "hi"}], [])) == ["chunk"]
    assert waits == [2.5, 7.0, 60.0]


def test_a_rate_limit_wait_is_shown_to_the_user(workspace, monkeypatch) -> None:
    import flask
    from data_formulator.analyst import agent as agent_module
    from data_formulator.error_handler import flush_stream_warnings

    class RateLimitError(Exception):
        pass

    monkeypatch.setattr(agent_module.time, "sleep", lambda seconds: None)
    client = MagicMock()
    client.model = "m"
    client.get_completion_with_tools.side_effect = [RateLimitError("exceeded token rate limit"), iter(["chunk"])]
    agent = AnalystAgent(client=client, workspace=workspace)
    agent.cancel = None
    with flask.Flask(__name__).test_request_context():
        list(agent._open_stream([{"role": "user", "content": "hi"}], []))
        warnings = [json.loads(line)["warning"] for line in flush_stream_warnings()]
    assert [w["message_code"] for w in warnings] == ["LLM_RATE_LIMIT_RETRY"]
    assert "Retrying in 10 seconds" in warnings[0]["message"]


def test_a_continued_turn_shows_what_is_new_to_the_conversation(workspace) -> None:
    from types import SimpleNamespace
    from data_formulator.analyst.session_files import render_turn_context
    from data_formulator.analyst.session_layer import SessionLayer

    def context(state, history):
        layer = SessionLayer(json.loads(json.dumps(state)), workspace)
        return render_turn_context(SimpleNamespace(workspace=workspace, payload={"session_layer": layer}), history)

    seen = [{"role": "user", "content": "[SESSION INDEX]\n" + SessionLayer(json.loads(json.dumps(STATE)), workspace).index()},
            {"role": "assistant", "content": "Read session/tables/d_sales.json"}]
    # Same canvas, same thread: only the changes and where the user is.
    same = context(STATE, seen)
    assert same.startswith("[SESSION CHANGES]") and "Focus: `session/charts/chart-1.json`" in same
    assert "[ON THE CANVAS]" not in same and "[THE THREAD YOU ARE CONTINUING]" not in same
    # The user edited the chart: it is shown again; its table, already in the conversation, is not.
    edited = json.loads(json.dumps(STATE))
    edited["charts"][0]["chartType"] = "Line Chart"
    changed = context(edited, seen)
    assert "[ON THE CANVAS] `session/charts/chart-1.json`" in changed and "[ITS DATA]" not in changed
    # The user moved to another thread since: its latest steps come along.
    elsewhere = [{**seen[0], "content": seen[0]["content"].replace("session/threads/1.md", "session/threads/2.md")}, seen[1]]
    assert "[THE THREAD YOU ARE CONTINUING] `session/threads/1.md`" in context(STATE, elsewhere)


def test_the_model_stream_reports_what_the_agent_is_doing(workspace, monkeypatch) -> None:
    from types import SimpleNamespace
    from data_formulator.analyst import agent as agent_module

    def chunk(content=None, name=None, arguments=None):
        calls = None
        if name or arguments:
            calls = [SimpleNamespace(index=0, id="call_1" if name else None,
                                     function=SimpleNamespace(name=name, arguments=arguments))]
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason=None,
                                                        delta=SimpleNamespace(content=content, tool_calls=calls))])

    chunks = [chunk("Plan: compare\n- [ ] load\n- [ ] chart\n"), chunk("Let me chart "), chunk("the **monthly** rates "),
              chunk("for `Construction`."), chunk(name="visualize"), chunk(arguments='{"code": "x = 1"}')]
    monkeypatch.setattr(agent_module, "_STATUS_INTERVAL", 0.0)
    agent = AnalystAgent(client=MagicMock(), workspace=workspace)
    monkeypatch.setattr(agent, "_open_stream", lambda messages, tools: iter(chunks))
    tools = [{"type": "function", "function": {"name": "visualize", "parameters": {"type": "object"}}}]
    stream, events = agent._stream_llm([], tools), []
    with pytest.raises(StopIteration) as finished:
        while True:
            events.append(next(stream))
    statuses = [event for event in events if event["type"] == "status"]
    assert statuses[0] == {"type": "status", "phase": "thinking"}
    # The plan's checklist is not narration; the sentence after it is, as it grows.
    # Short fragments wait for a few words; markdown is dropped.
    assert [event["text"] for event in statuses if event["phase"] == "narrating"] == [
        "Let me chart the monthly rates", "Let me chart the monthly rates for Construction."]
    assert statuses[-1] == {"type": "status", "phase": "writing", "tool": "visualize"}
    assert finished.value.value.choices[0].message.tool_calls[0].function.name == "visualize"


def test_the_answer_streams_as_it_is_written_and_a_note_does_not(workspace, monkeypatch) -> None:
    from types import SimpleNamespace

    def chunk(content, phase=None):
        delta = SimpleNamespace(content=content, tool_calls=None,
                                provider_specific_fields={"phase": phase} if phase else None)
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason=None, delta=delta)])

    agent = AnalystAgent(client=MagicMock(), workspace=workspace)

    def run(chunks):
        monkeypatch.setattr(agent, "_open_stream", lambda messages, tools: iter(chunks))
        stream, events = agent._stream_llm([], []), []
        with pytest.raises(StopIteration):
            while True:
                events.append(next(stream))
        return events

    answer = run([chunk("**India** has ", "final_answer"), chunk("the most.", "final_answer")])
    assert [event for event in answer if event["type"] == "text_delta"] == [
        {"type": "text_delta", "channel": "answer", "content": "**India** has "},
        {"type": "text_delta", "channel": "answer", "content": "the most."}]
    assert agent._answer_streamed and not any(event.get("phase") == "narrating" for event in answer)
    # A note before a tool call, or a provider that does not mark phases, stays a status line.
    for phase in ("commentary", None):
        events = run([chunk("Let me check the coverage first.", phase)])
        assert not any(event["type"] == "text_delta" for event in events) and not agent._answer_streamed


def test_a_streamed_answer_is_retracted_when_a_tool_call_follows(workspace, monkeypatch) -> None:
    from types import SimpleNamespace

    agent = AnalystAgent(client=MagicMock(), workspace=workspace)
    agent._loaded_skills = {"meta"}
    agent._run_payload = {}
    call = SimpleNamespace(id="call_1", function=SimpleNamespace(name="read_file", arguments='{"files": []}'))
    replies = [SimpleNamespace(choices=[SimpleNamespace(finish_reason="tool_calls", message=SimpleNamespace(
                   content="Here is what I found.", tool_calls=[call], reasoning_content=None, reasoning_items=[]))]),
               SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
                   content="Done.", tool_calls=None, reasoning_content=None, reasoning_items=[]))])]

    def stream_llm(messages, tools):
        agent._answer_streamed = True
        yield {"type": "text_delta", "channel": "answer", "content": "Here is"}
        return replies.pop(0)

    monkeypatch.setattr(agent, "_stream_llm", stream_llm)
    monkeypatch.setattr(agent, "_loaded_skill_tool_map", lambda: {})
    events = list(agent._tool_loop([], llm_calls_in_cycle=0, rlog=MagicMock(), input_tables=[], outer_iteration=0))
    kinds = [event["type"] for event in events]
    # The first answer was followed by a tool call: retracted, then shown as a note; the last one ends the run.
    assert kinds.index("answer_retracted") < kinds.index("thinking_text") < kinds.index("tool_start")
    assert kinds.count("answer_retracted") == 1 and events[-1]["final_text"] == "Done."


def test_opening_the_model_stream_has_a_request_timeout(workspace) -> None:
    client = MagicMock()
    client.model = "m"
    client.get_completion_with_tools.return_value = iter(["chunk"])
    agent = AnalystAgent(client=client, workspace=workspace)
    list(agent._open_stream([{"role": "user", "content": "hi"}], []))
    assert client.get_completion_with_tools.call_args.kwargs["timeout"] == 90.0


def test_a_failed_action_is_shown_to_the_user_and_its_reason_returned_to_the_agent(workspace) -> None:
    agent = AnalystAgent(client=MagicMock(), workspace=workspace)

    def failing_visualize():
        yield {"type": "error", "message": "Unknown or mismatched input source: d_result_5. Use an exact data input "
                                           "id: data:62e2:sdg4_indicators", "message_code": "agent.parseActionFailed"}
        return "[OBSERVATION – Step 1 FAILED]\n\nError: Unknown or mismatched input source: d_result_5."

    router = agent._route_skill_events(failing_visualize(), 1, [], [], "visualize")
    events = []
    with pytest.raises(StopIteration) as finished:
        while True:
            events.append(next(router))
    # Not an `error` (that ends the run in the application); a failed step with its first sentence.
    assert events == [{"type": "action_failed", "action": "visualize", "iteration": 1,
                       "message": "Unknown or mismatched input source: d_result_5.",
                       "message_code": "agent.parseActionFailed"}]
    assert "FAILED" in finished.value.value
