# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for data_formulator.analyst.mini_agent.MiniAnalystAgent.

The mini agent makes a SINGLE analytic decision per run (one ``visualize`` or one
``explain``) with no multi-step loop. These tests cover the pure-logic seams (the
prompt, the reduced tool set, the JSON decision) plus end-to-end drives of
:meth:`run` with a scripted fake client and a stubbed core-skill dispatch,
asserting the key contracts: one decision, pure-text history, the two output
kinds, the two tool variations, and in-place repair of a failed chart.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from data_formulator.analyst import mini_agent as ma
from data_formulator.analyst.mini_agent import MiniAnalystAgent

pytestmark = [pytest.mark.backend]


_ACTION_NAMES = {"visualize", "ask_user", "delegate"}


def _mini_tools_list(allow_inspect: bool):
    tools = [
        {"type": "function", "function": {
            "name": "visualize",
            "description": "Commit a data transform + chart.",
            "parameters": {"type": "object",
                           "properties": {"code": {"type": "string"},
                                          "output_variable": {"type": "string"},
                                          "chart": {"type": "object"}},
                           "required": ["code", "output_variable", "chart"]}}},
    ]
    if allow_inspect:
        tools.append({"type": "function", "function": {
            "name": "execute_python_script",
            "description": "Run a script.",
            "parameters": {"type": "object",
                           "properties": {"code": {"type": "string"}},
                           "required": ["code"]}}})
    tools.append(ma._EXPLAIN_TOOL)
    return tools


def _resp(content):
    msg = SimpleNamespace(content=content, tool_calls=None)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason="stop")])


class _FakeRegistry:
    def action_names(self):
        return set(_ACTION_NAMES)


class _FakeRlog:
    def log(self, *a, **k):
        pass

    def close(self):
        pass


def _bare_mini(allow_inspection=True):
    """A MiniAnalystAgent with just the seams its decision logic touches stubbed
    — no real LLM / sandbox / registry tool building. ``allow_inspection`` only
    seeds the per-turn ``_decide(allow_inspect=...)`` input used by the ``_decide``
    helper below."""
    agent = MiniAnalystAgent.__new__(MiniAnalystAgent)
    agent.allow_inspection = allow_inspection
    agent.language_instruction = ""
    agent.max_repair_attempts = 2
    agent.registry = _FakeRegistry()
    agent._reasoning_log = _FakeRlog()
    agent._session_id = "test-session"
    agent.client = SimpleNamespace(model="test-model")
    agent._run_explore_code = lambda code, tables: {"status": "ok", "stdout": "ROWS=3"}
    agent._loaded_skill_tool_map = lambda: {}
    agent._mini_tools = lambda allow_inspect: _mini_tools_list(allow_inspect)
    return agent


def _decide(agent, scripted_contents, input_tables=None, allow_inspect=None):
    """Run _decide with the client scripted to return ``scripted_contents`` in
    order. Returns (events, decision_tuple, messages)."""
    script = iter(scripted_contents)
    agent._call_model = lambda messages: _resp(next(script))
    messages: list[dict] = [{"role": "system", "content": "sys"},
                            {"role": "user", "content": "q"}]
    gen = agent._decide(
        messages, input_tables or [], 1,
        allow_inspect=agent.allow_inspection if allow_inspect is None else allow_inspect)
    events = []
    decision = None
    try:
        while True:
            events.append(next(gen))
    except StopIteration as stop:
        decision = stop.value
    return events, decision, messages


# --------------------------------------------------------------------------
# Prompt seams
# --------------------------------------------------------------------------
class TestSystemPrompt:
    def test_template_describes_both_output_kinds(self):
        assert '"tool": "visualize"' in ma._MINI_PROMPT_TEMPLATE
        assert '"tool": "explain"' in ma._MINI_PROMPT_TEMPLATE
        assert "ONE JSON object" in ma._MINI_PROMPT_TEMPLATE

    def test_chart_reference_is_reduced_set(self):
        # Exactly the seven reduced types, nothing more exotic.
        for t in ma._MINI_CHART_TYPES:
            assert t in ma._MINI_CHART_REFERENCE
        assert "Boxplot" not in ma._MINI_CHART_REFERENCE
        assert "Waterfall" not in ma._MINI_CHART_REFERENCE
        assert len(ma._MINI_CHART_TYPES) == 7

    def test_inspection_note_present(self):
        agent = _bare_mini()
        out = agent._build_system_prompt()
        assert "execute_python_script" in out
        assert all(c in out for c in ma._MINI_CHART_TYPES)


class TestMiniTools:
    def test_mini_tools_offer_visualize_explain_and_inspection(self):
        from data_formulator.analyst.skills import build_registry
        agent = MiniAnalystAgent.__new__(MiniAnalystAgent)
        agent.registry = build_registry()
        agent._loaded_skills = {"core"}
        names = {(t.get("function") or {}).get("name")
                 for t in agent._mini_tools(allow_inspect=True)}
        assert "visualize" in names
        assert "explain" in names
        assert "execute_python_script" in names

    def test_mini_tools_drop_inspection_when_unavailable(self):
        from data_formulator.analyst.skills import build_registry
        agent = MiniAnalystAgent.__new__(MiniAnalystAgent)
        agent.registry = build_registry()
        agent._loaded_skills = {"core"}
        names = {(t.get("function") or {}).get("name")
                 for t in agent._mini_tools(allow_inspect=False)}
        assert names == {"visualize", "explain"}


# --------------------------------------------------------------------------
# The single decision
# --------------------------------------------------------------------------
class TestDecide:
    def test_visualize_in_one_shot(self):
        agent = _bare_mini(allow_inspection=False)
        viz = json.dumps({"thought": "bar it", "tool": "visualize", "arguments": {
            "code": "out=df", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        events, decision, messages = _decide(agent, [viz])
        assert decision[0] == "visualize"
        assert decision[1]["output_variable"] == "out"
        # thought surfaced
        assert any(e["type"] == "thinking_text" and e["content"] == "bar it"
                   for e in events)
        # pure-text history: the assistant turn is the verbatim JSON
        assert messages[-1]["role"] == "assistant"
        assert all("tool_calls" not in m for m in messages)
        assert all(m["role"] != "tool" for m in messages)

    def test_explain_action_ends_with_text(self):
        agent = _bare_mini(allow_inspection=False)
        exp = json.dumps({"tool": "explain",
                          "arguments": {"text": "There are 42 rows."}})
        _, decision, _ = _decide(agent, [exp])
        assert decision == ("explain", "There are 42 rows.")

    def test_plain_text_is_explain(self):
        agent = _bare_mini(allow_inspection=False)
        _, decision, messages = _decide(agent, ["The data covers 2019-2023."])
        assert decision[0] == "explain"
        assert "2019" in decision[1]
        assert messages[-1]["role"] == "assistant"

    def test_inspection_then_visualize_keeps_history_pure_text(self):
        agent = _bare_mini(allow_inspection=True)
        inspect = json.dumps({"tool": "execute_python_script",
                              "arguments": {"code": "print(1)"}})
        viz = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df", "output_variable": "out",
            "chart": {"chart_type": "Line Chart"}}})
        events, decision, messages = _decide(agent, [inspect, viz])
        etypes = [e["type"] for e in events]
        assert "tool_start" in etypes and "tool_result" in etypes
        assert decision[0] == "visualize"
        # the inspection observation came back as a [OBSERVATION] user turn
        assert any(m["role"] == "user" and "[OBSERVATION]" in (m["content"] or "")
                   and "ROWS=3" in (m["content"] or "") for m in messages)
        assert all("tool_calls" not in m for m in messages)

    def test_inspection_budget_is_one(self):
        # Two inspection attempts: the second must be refused (no tool offered),
        # nudging the model; the final visualize still commits.
        agent = _bare_mini(allow_inspection=True)
        inspect = json.dumps({"tool": "execute_python_script",
                              "arguments": {"code": "print(1)"}})
        viz = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        # script: inspect, inspect(again -> refused as unknown), visualize
        _, decision, messages = _decide(agent, [inspect, inspect, viz])
        assert decision[0] == "visualize"
        # a correction nudge was issued for the second (now unavailable) inspect
        assert any("not available" in (m["content"] or "")
                   for m in messages if m["role"] == "user")

    def test_missing_required_field_triggers_one_correction(self):
        agent = _bare_mini(allow_inspection=False)
        bad = json.dumps({"tool": "visualize",
                          "arguments": {"code": "out=df", "output_variable": "out"}})
        good = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        _, decision, messages = _decide(agent, [bad, good])
        assert decision[0] == "visualize"
        assert decision[1].get("chart")
        assert any("[OBSERVATION] ERROR" in (m["content"] or "")
                   for m in messages if m["role"] == "user")


# --------------------------------------------------------------------------
# End-to-end run(): result/completion events + repair
# --------------------------------------------------------------------------
class _DummySandbox:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _prep_run(agent, scripted_contents, monkeypatch):
    """Wire run()'s collaborators: scripted client, stub initial messages, no-op
    sandbox + reasoning-log + explore ns."""
    script = iter(scripted_contents)
    agent._call_model = lambda messages: _resp(next(script))
    agent._build_initial_messages = lambda *a, **k: [
        {"role": "system", "content": "sys"}, {"role": "user", "content": "q"}]
    agent._explore_ns_dir = lambda: Path("/nonexistent/mini-test-ns")
    monkeypatch.setattr(
        "data_formulator.sandbox.local_sandbox.SandboxSession",
        lambda *a, **k: _DummySandbox())


def _viz_result_event():
    return {"type": "result", "status": "success", "content": {
        "question": "",
        "result": {"code": "out=df",
                   "refined_goal": {"chart": {"chart_type": "Bar Chart"},
                                    "title": "T"},
                   "content": {"rows": [{"x": 1, "y": 2}]}}}}


class TestRun:
    def test_explain_run_emits_completion_summary(self, monkeypatch):
        agent = _bare_mini(allow_inspection=False)
        _prep_run(agent, [json.dumps(
            {"tool": "explain", "arguments": {"text": "Sales are flat."}})], monkeypatch)
        events = list(agent.run([{"name": "t"}], "is it growing?"))
        comp = [e for e in events if e["type"] == "completion"]
        assert comp and comp[0]["status"] == "success"
        assert comp[0]["content"]["summary"] == "Sales are flat."
        # an explain produces no result/chart
        assert not any(e["type"] == "result" for e in events)

    def test_visualize_run_emits_result_then_completion(self, monkeypatch):
        agent = _bare_mini(allow_inspection=False)
        viz = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        _prep_run(agent, [viz], monkeypatch)

        def _viz_ok(*a, **k):
            yield {"type": "action", "action": "visualize"}
            yield _viz_result_event()
            return "[OBSERVATION] Chart created."
        agent._dispatch_skill_action = _viz_ok

        events = list(agent.run([{"name": "t"}], "show sales"))
        etypes = [e["type"] for e in events]
        assert "result" in etypes
        comp = [e for e in events if e["type"] == "completion"]
        assert comp and comp[0]["status"] == "success"
        assert comp[0]["content"]["total_steps"] >= 0

    def test_failed_visualize_is_repaired_in_place(self, monkeypatch):
        agent = _bare_mini(allow_inspection=False)
        viz1 = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df.bad", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        viz2 = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        _prep_run(agent, [viz1, viz2], monkeypatch)

        calls = {"n": 0}

        def _viz_dispatch(*a, **k):
            calls["n"] += 1
            if calls["n"] == 1:
                yield {"type": "error", "message": "boom"}
                return "[OBSERVATION – Step 1 FAILED]\n\nError: boom"
            yield _viz_result_event()
            return "[OBSERVATION] Chart created."
        agent._dispatch_skill_action = _viz_dispatch

        events = list(agent.run([{"name": "t"}], "show sales"))
        assert calls["n"] == 2  # one failure, one repair
        assert any(e["type"] == "result" for e in events)
        comp = [e for e in events if e["type"] == "completion"]
        assert comp and comp[0]["status"] == "success"

    def test_repair_can_inspect_before_refixing(self, monkeypatch):
        # The auto-revision loop may inspect the data to diagnose a failure
        # (e.g. discover the real columns) before emitting a corrected chart.
        agent = _bare_mini(allow_inspection=True)
        agent.max_repair_attempts = 1
        viz_bad = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df['rate']", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        inspect = json.dumps({"tool": "execute_python_script",
                              "arguments": {"code": "print(df.columns)"}})
        viz_good = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        # initial viz (fails) -> repair decides to inspect, then corrected viz
        _prep_run(agent, [viz_bad, inspect, viz_good], monkeypatch)

        calls = {"n": 0}

        def _viz_dispatch(*a, **k):
            calls["n"] += 1
            if calls["n"] == 1:
                yield {"type": "error", "message": "KeyError rate"}
                return "[OBSERVATION – Step 1 FAILED]\n\nError: KeyError - 'rate'"
            yield _viz_result_event()
            return "[OBSERVATION] Chart created."
        agent._dispatch_skill_action = _viz_dispatch

        events = list(agent.run([{"name": "t"}], "show rate"))
        # the repair turn ran an inspection before the corrected visualize
        assert any(e["type"] == "tool_start"
                   and e.get("tool") == "execute_python_script" for e in events)
        assert any(e["type"] == "result" for e in events)
        comp = [e for e in events if e["type"] == "completion"]
        assert comp and comp[0]["status"] == "success"

    def test_unrepairable_visualize_completes_without_chart(self, monkeypatch):
        agent = _bare_mini(allow_inspection=False)
        agent.max_repair_attempts = 0  # no repair budget
        viz = json.dumps({"tool": "visualize", "arguments": {
            "code": "out=df.bad", "output_variable": "out",
            "chart": {"chart_type": "Bar Chart"}}})
        _prep_run(agent, [viz], monkeypatch)

        def _viz_fail(*a, **k):
            yield {"type": "error", "message": "boom"}
            return "[OBSERVATION – Step 1 FAILED]\n\nError: boom"
        agent._dispatch_skill_action = _viz_fail

        events = list(agent.run([{"name": "t"}], "show sales"))
        assert not any(e["type"] == "result" for e in events)
        comp = [e for e in events if e["type"] == "completion"]
        assert comp and comp[0]["status"] == "completed_no_viz"
        # The run must not end silently: a failed chart surfaces an error event
        # carrying the reason. In production the skill's own error event is
        # dropped by the shell router, so run() re-surfaces it from the
        # observation; here the message must reach the user with the cause.
        errs = [e for e in events if e["type"] == "error"
                and e.get("message_code") == "agent.miniNoChart"]
        assert errs and "boom" in errs[0]["message"]

    def test_empty_reply_is_not_a_silent_explain(self, monkeypatch):
        # A small model that returns nothing must not end the run with an empty
        # completion; the summary falls back to a user-visible message.
        agent = _bare_mini(allow_inspection=False)
        _prep_run(agent, ["", ""], monkeypatch)  # empty reply, then empty again
        events = list(agent.run([{"name": "t"}], "is it growing?"))
        comp = [e for e in events if e["type"] == "completion"]
        assert comp and comp[0]["content"]["summary"].strip()



# --------------------------------------------------------------------------
# Plain-text transport seams (migrated from the removed simple_agent tests;
# MiniAnalystAgent now owns _catalog_reminder / _parse_action).
# --------------------------------------------------------------------------

def _proto_tools():
    """A representative tool list — an inspection tool with a unique required key
    plus visualize — for exercising the generic protocol seams."""
    return [
        {"type": "function", "function": {
            "name": "execute_python_script",
            "description": "Run a script.",
            "parameters": {"type": "object",
                           "properties": {"purpose": {"type": "string"},
                                          "code": {"type": "string"}},
                           "required": ["purpose", "code"]}}},
        {"type": "function", "function": {
            "name": "inspect_source_data",
            "description": "Summarise source tables.",
            "parameters": {"type": "object",
                           "properties": {"table_names": {"type": "array",
                                                          "items": {"type": "string"}}},
                           "required": ["table_names"]}}},
        {"type": "function", "function": {
            "name": "visualize",
            "description": "Commit a data transform + chart.",
            "parameters": {"type": "object",
                           "properties": {"code": {"type": "string"},
                                          "output_variable": {"type": "string"},
                                          "chart": {"type": "object"}},
                           "required": ["code", "output_variable", "chart"]}}},
    ]


class TestCatalogReminder:
    def test_splits_inspection_and_action_names(self):
        agent = _bare_mini()
        text = agent._catalog_reminder(_proto_tools())
        assert "execute_python_script" in text and "inspect_source_data" in text
        assert "visualize" in text
        # visualize is listed under Actions, not Inspection tools
        inspect_part, action_part = text.split("Actions:")
        assert "visualize" not in inspect_part
        assert "visualize" in action_part


class TestParseAction:
    def test_wrapped_tool_envelope(self):
        content = json.dumps({"thought": "let's chart it", "tool": "visualize",
                              "arguments": {"code": "df=1", "output_variable": "df",
                                            "chart": {}}})
        thought, name, args = MiniAnalystAgent._parse_action(content, _proto_tools())
        assert name == "visualize"
        assert thought == "let's chart it"
        assert args["output_variable"] == "df"

    def test_bare_args_matched_by_required_keys(self):
        content = json.dumps({"table_names": ["t1", "t2"]})
        thought, name, args = MiniAnalystAgent._parse_action(content, _proto_tools())
        assert name == "inspect_source_data"
        assert args["table_names"] == ["t1", "t2"]

    def test_nested_action_wrapper(self):
        content = json.dumps({"thought": "go", "action": {
            "name": "visualize",
            "arguments": {"code": "df=1", "output_variable": "df", "chart": {}}}})
        thought, name, args = MiniAnalystAgent._parse_action(content, _proto_tools())
        assert name == "visualize"
        assert thought == "go"

    def test_json_embedded_in_prose(self):
        content = ('I will inspect first.\n'
                   '{"tool": "inspect_source_data", "arguments": {"table_names": ["t"]}}')
        parsed = MiniAnalystAgent._parse_action(content, _proto_tools())
        assert parsed is not None
        assert parsed[1] == "inspect_source_data"

    def test_plain_text_is_final_answer(self):
        assert MiniAnalystAgent._parse_action(
            "Here is the final summary.", _proto_tools()) is None

    def test_none_content(self):
        assert MiniAnalystAgent._parse_action(None, _proto_tools()) is None
