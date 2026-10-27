"""The analyst's checklist plan, read from its own narration (design-docs/64)."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from data_formulator.agent_config import AnalystExecutionConfig
from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.plan import RunPlan, read_plan, split_plan
from data_formulator.analyst.skills import build_registry

pytestmark = [pytest.mark.backend]

PLAN = """Here's the plan:
- [ ] Completion by region since 2000
- [x] Find the indicator
* [ ] ~~Urban vs rural~~ (no location breakdown)

Starting with the overview."""


def test_split_plan_reads_items_and_keeps_the_prose():
    items, prose = split_plan(PLAN)
    assert [(item.text, item.status, item.note) for item in items] == [
        ("Completion by region since 2000", "open", ""),
        ("Find the indicator", "done", ""),
        ("Urban vs rural", "dropped", "no location breakdown"),
    ]
    assert prose == "Here's the plan:\n\nStarting with the overview."


def test_a_single_checkbox_is_not_a_plan():
    assert split_plan("- [ ] just one thing")[0] is None
    assert split_plan("No plan here.") == (None, "No plan here.")


def test_ticks_open_steps_in_order_and_reminds_once():
    plan = RunPlan()
    plan.revise(split_plan(PLAN)[0])
    assert plan.tick() and [item.status for item in plan.items] == ["done", "done", "dropped"]
    assert not plan.tick()
    assert plan.reminder() is None

    plan.revise(split_plan("- [x] a\n- [ ] b\n- [ ] c")[0])
    reminder = plan.reminder()
    assert "1) b; 2) c" in reminder
    assert plan.reminder() is None


def _chunk(content=None, finish_reason=None, tool_calls=None):
    delta = SimpleNamespace(content=content, tool_calls=tool_calls, reasoning_content=None)
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


def _agent(streams) -> tuple[AnalystAgent, _Client]:
    client = _Client(streams)
    agent = AnalystAgent(client=client, workspace=SimpleNamespace(user_home=None),
                         skill_registry=build_registry(), identity_id=None,
                         execution_config=AnalystExecutionConfig(empty_response_backoff_seconds=0))
    agent._loaded_skills = {"meta"}
    agent._run_payload = {}
    agent._delivered = False
    return agent, client


def _loop(agent, messages):
    return list(agent._tool_loop(messages, llm_calls_in_cycle=0, rlog=_Log(), input_tables=[], outer_iteration=0))


def test_the_plan_is_taken_from_narration_and_hidden_from_the_thought(monkeypatch):
    monkeypatch.setattr(AnalystAgent, "_run_explore_code", lambda *args: {"status": "ok", "stdout": "ok"})
    call = SimpleNamespace(index=0, id="call-1", type="function", function=SimpleNamespace(
        name="execute_python_script", arguments='{"code": "print(1)"}'))
    agent, _ = _agent([
        [_chunk(PLAN), _chunk(tool_calls=[call]), _chunk(finish_reason="tool_calls")],
        [_chunk("All done."), _chunk(finish_reason="stop")],
    ])
    agent._plan.reminded = True  # this test is about reading the plan, not the reminder
    messages: list[dict] = []
    events = _loop(agent, messages)

    plan_events = [event for event in events if event["type"] == "plan"]
    assert plan_events[0]["revised"] is True
    assert [item["status"] for item in plan_events[0]["items"]] == ["open", "done", "dropped"]
    thoughts = [event["content"] for event in events if event["type"] == "thinking_text"]
    assert thoughts == ["Here's the plan:\n\nStarting with the overview."]
    # The model's own history keeps what it wrote.
    assert messages[0]["content"] == PLAN


def test_ending_with_open_steps_asks_once_to_continue():
    agent, client = _agent([
        [_chunk("- [ ] overview\n- [ ] gender gap\n\nHere is the overview."), _chunk(finish_reason="stop")],
        [_chunk("Done with the overview; the gender gap needs another indicator."), _chunk(finish_reason="stop")],
    ])
    messages: list[dict] = []
    events = _loop(agent, messages)
    final = [event for event in events if event["type"] == "agent_action"][-1]

    assert client.calls == 2
    assert final["reason"] == "done"
    assert final["final_text"] == "Done with the overview; the gender gap needs another indicator."
    reminders = [message["content"] for message in messages if message["role"] == "user"]
    assert len(reminders) == 1 and "1) overview; 2) gender gap" in reminders[0]


def test_an_empty_reply_after_delivery_with_open_steps_is_reminded():
    agent, client = _agent([[_chunk(finish_reason="stop")], [_chunk("Wrapped up."), _chunk(finish_reason="stop")]])
    agent._delivered = True
    agent._plan.revise(split_plan("- [x] overview\n- [ ] gender gap")[0])
    messages: list[dict] = []
    final = [event for event in _loop(agent, messages) if event["type"] == "agent_action"][-1]
    assert client.calls == 2 and final["final_text"] == "Wrapped up."
    assert [message["role"] for message in messages] == ["user", "assistant"]


def test_no_plan_means_no_reminder():
    agent, client = _agent([[_chunk("The answer is 42."), _chunk(finish_reason="stop")]])
    final = [event for event in _loop(agent, []) if event["type"] == "agent_action"][-1]
    assert client.calls == 1 and final["final_text"] == "The answer is 42."


def test_results_attach_to_the_step_they_serve_and_finish_completes_answered_steps():
    plan = RunPlan()
    plan.revise(split_plan("- [ ] Overview\n- [ ] Gender gap\n- [ ] Summary")[0])
    assert plan.record(1, "chart-a") and plan.record(1, "chart-b")
    assert [item.status for item in plan.items] == ["open", "open", "open"]  # step 1 may take more charts
    assert plan.record(2, "chart-c")
    assert [(item.status, item.results) for item in plan.items] == [
        ("done", ["chart-a", "chart-b"]), ("open", ["chart-c"]), ("open", [])]
    # Restating the checklist keeps delivered results.
    plan.revise(split_plan("- [x] Overview\n- [ ] Gender gap\n- [ ] Summary")[0])
    assert plan.items[1].results == ["chart-c"]
    assert plan.finish() and [item.status for item in plan.items] == ["done", "done", "open"]
    assert "1) Summary" in plan.reminder()


def test_results_without_a_valid_step_tick_the_next_open_step():
    plan = RunPlan()
    plan.revise(split_plan("- [ ] a\n- [ ] b")[0])
    for step in (None, 0, 9, True):
        plan.record(step, "x")
    assert [item.status for item in plan.items] == ["done", "done"]
    assert not plan.record(None, "y")
    assert plan.event(revised=False)["items"][0]["results"] == ["x"]


def test_a_reworded_restatement_keeps_results_by_position():
    plan = RunPlan()
    plan.revise(split_plan("- [ ] Compare spending trends since 2010\n- [ ] Compare female share\n- [ ] Summarize")[0])
    plan.record(1, "chart-a")
    plan.record(1, "chart-b")
    plan.record(2, "chart-c")
    plan.revise(split_plan("- [x] Spending trends\n- [x] Female share\n- [x] Summary")[0])
    assert [item.results for item in plan.items] == [["chart-a", "chart-b"], ["chart-c"], []]


def test_step_text_drops_emphasis_and_step_labels():
    items, _ = split_plan("- [ ] **Step 1:** Compare trends\n- [ ] Step 2 - Chart the **female** share")
    assert [item.text for item in items] == ["Compare trends", "Chart the female share"]


def test_a_plan_title_line_names_the_plan_and_leaves_the_narration():
    items, title, rest = read_plan("Starting with the overview.\n\n**Plan:** Who is left behind\n- [ ] Overview\n- [ ] Gaps")
    assert title == "Who is left behind" and [item.text for item in items] == ["Overview", "Gaps"]
    assert rest == "Starting with the overview."
    plan = RunPlan()
    plan.revise(items, title)
    plan.revise(split_plan("- [x] Overview\n- [ ] Gaps")[0])
    assert plan.event(revised=True)["title"] == "Who is left behind"


def test_a_plan_line_without_a_checklist_is_prose():
    assert read_plan("Plan: look at gaps first.") == (None, None, "Plan: look at gaps first.")


def test_a_referenced_request_may_open_a_new_thread_with_its_first_message_only():
    agent, _ = _agent([
        [_chunk("New thread: Diesel prices\nLooking at diesel instead."), _chunk(finish_reason="stop")],
    ])
    agent._references = [{"id": "chart-1", "label": "Weekly prices"}]
    agent._placement_open = True
    agent._plan.reminded = True
    events = _loop(agent, [])
    assert [event for event in events if event["type"] == "placement"] == [
        {"type": "placement", "new_thread": True, "title": "Diesel prices"}]
    final = [event for event in events if event["type"] == "agent_action"][-1]
    assert final["final_text"] == "Looking at diesel instead."
    # Only the first message decides; without a reference there is no choice to make.
    assert list(agent._read_placement("New thread: later")) == []
    plain, _ = _agent([[_chunk("New thread: x"), _chunk(finish_reason="stop")]])
    assert not [event for event in _loop(plain, []) if event["type"] == "placement"]


def test_the_reference_note_names_the_result_by_its_session_path():
    agent, _ = _agent([])
    agent._references = [{"id": "chart-1", "label": "Weekly prices"}]
    agent._run_payload = {"session_layer": SimpleNamespace(output_path=lambda id: f"session/charts/{id}.json")}
    note = agent._reference_note()
    assert '- `session/charts/chart-1.json` "Weekly prices"' in note and "New thread:" in note
