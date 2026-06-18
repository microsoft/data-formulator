# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A single-decision, no-loop variant of :class:`AnalystAgent` for small models.

:class:`MiniAnalystAgent` is the most stripped-down member of the analyst family.
Where :class:`~data_formulator.analyst.agent.AnalystAgent` runs a
multi-step *inspect -> act -> observe* loop that can commit several actions, the
mini agent makes exactly **one analytic decision per run** and stops. Given the
data context it returns ONE of two things:

* **visualize** — a small data-transformation script plus a chart spec (this is
  the default; almost every question should produce a chart), or
* **explain** — a short free-text answer (only when the user is clearly *not*
  asking for a chart, e.g. a yes/no or factual question).

Before deciding, the agent may look at the data once: the model MAY run a single
``execute_python_script`` inspection (e.g. to check a join or a column's exact
values), then must produce its visualize/explain. The inspection budget is one
call, so it never becomes a loop (see ``loops/model-evaluation`` Section 9).

The chart-type set is deliberately **reduced** to a handful of common types, and
the prompt is tightly scoped, so small open-weight models reliably emit a
well-formed ``visualize`` action. To keep small models usable without drifting
into multi-chart territory, a *committed* visualize whose code/encodings fail is
**repaired in place** (the model is shown the error and asked to fix the SAME
chart) up to ``max_repair_attempts`` times — this completes the single
visualization, it does not start a new analysis turn.

Reuse: the visualize execution + ``result`` event are produced by the **same**
core-skill dispatch the base agent uses (:meth:`_dispatch_skill_action`), so a
mini result is byte-for-byte the shape every consumer already understands. The
plain-text transport (``_call_model`` / ``_parse_action`` /
``_run_inspection_tool``) carries actions as content JSON so models with weak or
absent function-calling still work; only the prompt and the single-decision
control flow are new.
"""

from __future__ import annotations

import json
import time
from typing import Any, Generator

from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.client_utils import (
    _extract_json_objects,
    _match_tool_from_obj,
)
from data_formulator.analyst.agent import (
    AnalystAgent,
    _AGENT_ID,
    _CORE_SKILL,
    _rescue_unpack_json_strings,
    handle_inspect_source_data,
    logger,
)
from data_formulator.analyst.skills import SkillContext

# Keys a model may use to carry the explanation text in an ``explain`` action.
_EXPLAIN_TEXT_KEYS = ("text", "explanation", "answer", "summary", "content", "message")

# Keys a model may use to carry its private reasoning alongside the action JSON;
# surfaced as a thinking_text event (mirrors how the native loop surfaces the
# assistant content that accompanies a tool call).
_THOUGHT_KEYS = ("thought", "thoughts", "reasoning", "thinking", "rationale")


# The reduced chart-type set. Every name here is a valid Data Formulator
# ``chart_type`` that the eval renderer and the visualize skill both understand;
# the list is kept short on purpose so a small model picks a sensible type
# instead of guessing among twenty.
_MINI_CHART_TYPES = (
    "Bar Chart",
    "Grouped Bar Chart",
    "Line Chart",
    "Scatter Plot",
    "Histogram",
    "Pie Chart",
    "Heatmap",
)

_MINI_CHART_REFERENCE = """\
- Bar Chart (x, y, color) - compare ONE number across categories. Category on x, number on y. Set color to colour/stack by a second category.
- Grouped Bar Chart (x, y, group) - side-by-side bars split by a second category; put that second category on `group`.
- Line Chart (x, y, color) - a trend over an ordered or time x-axis; color draws one line per series.
- Scatter Plot (x, y, color, size) - relationship between two numeric fields.
- Histogram (x) - distribution of ONE numeric field; put the raw field on x, do NOT pre-bin it.
- Pie Chart (color, size) - parts of a whole with <=7 slices; slice category on `color`, its value on `size`.
- Heatmap (x, y, color) - a 2D grid; x and y are the two categories, color is the numeric cell value."""


# A pseudo-tool advertised so the JSON matcher recognises an ``explain`` action.
# ``explain`` is not a registered skill action (it never reaches the skill
# dispatch); the mini loop intercepts it and ends the run with its text.
_EXPLAIN_TOOL = {
    "type": "function",
    "function": {
        "name": "explain",
        "description": "Answer the user in plain text when no chart is needed.",
        "parameters": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
}


# The complete, self-contained system prompt for the mini agent. Slots
# ({chart_types}, {inspect_note}) are filled by str.replace (NOT str.format) so
# the literal JSON braces below stay intact.
_MINI_PROMPT_TEMPLATE = """\
You are a data visualization agent. The user asks a question about their data and
you answer it by producing ONE chart in a single step.

## Your data
The tables are already loaded. The user message lists them under [AVAILABLE TABLES]
(or [PRIMARY TABLE(S)]) with their columns and a few sample rows, and ends with
[USER QUESTION]. In your Python, read a table by its EXACT file name shown there,
e.g. pd.read_csv('orders.csv') or pd.read_parquet('sales.parquet'). Never invent
files or columns that are not listed.

## What you output: exactly ONE JSON object
Your ENTIRE reply is ONE JSON object and nothing else - no prose, no markdown
fences. It is one of two kinds:

1. VISUALIZE - use this for almost every question:
{"thought": "<one short sentence>", "tool": "visualize", "arguments": {"code": "<python that builds the result table>", "output_variable": "<the variable your code assigns the final DataFrame to>", "chart": {"chart_type": "<one name from the list below>", "encodings": {"x": "<col>", "y": "<col>"}, "config": {}}, "title": "<short Title Case title>", "input_tables": ["<source table name>"]}}

2. EXPLAIN - only when the user is NOT asking for a chart (a yes/no or factual question):
{"thought": "<one short sentence>", "tool": "explain", "arguments": {"text": "<your answer in 1-3 sentences>"}}

When in doubt, VISUALIZE.

## Writing the visualize code
- A standalone Python script: imports at the top, NO function wrapper.
- Read the source tables by their exact file names, then aggregate / filter / sort /
  reshape so the DataFrame is exactly what the chart needs, and assign it to your
  output_variable.
- output_variable MUST be a pandas DataFrame (a table with named columns), NEVER a
  Series or a single number. Two common mistakes and their fixes:
    * groupby -> pass as_index=False, e.g.
      df.groupby('city', as_index=False)['sales'].sum()
    * value_counts() returns a Series -> call .reset_index(), e.g.
      df['city'].value_counts().reset_index(name='count')   # columns: city, count
- Every column named in `encodings` MUST be an actual column of your output
  DataFrame (check the names match exactly, including the ones you create).
- Allowed libraries: pandas, numpy, duckdb, math, datetime, statistics, collections,
  re, sklearn, scipy. NOT allowed: matplotlib, plotly, seaborn, os, sys, requests.
- Strings must be valid JSON: write newlines in the code as \\n and quotes as \\".

### Chart types (chart_type must be one of these EXACT names)
{chart_types}
{inspect_note}
## Worked example
[USER QUESTION] Top 5 products by revenue.
Your entire reply (one object, nothing else):
{"thought": "sum revenue per product, take the top 5, bar chart", "tool": "visualize", "arguments": {"code": "import pandas as pd\\norders = pd.read_csv('orders.csv')\\nagg = orders.groupby('product', as_index=False)['revenue'].sum()\\ntop_products = agg.sort_values('revenue', ascending=False).head(5)", "output_variable": "top_products", "chart": {"chart_type": "Bar Chart", "encodings": {"x": "product", "y": "revenue"}, "config": {}}, "title": "Top 5 Products By Revenue", "input_tables": ["orders"]}}

## Worked example (counting rows -> a DataFrame, not a Series)
[USER QUESTION] How many orders are in each status?
Your entire reply (one object, nothing else):
{"thought": "count rows per status with value_counts, reset_index to a real table", "tool": "visualize", "arguments": {"code": "import pandas as pd\\norders = pd.read_csv('orders.csv')\\ncounts = orders['status'].value_counts().reset_index(name='count')", "output_variable": "counts", "chart": {"chart_type": "Bar Chart", "encodings": {"x": "status", "y": "count"}, "config": {}}, "title": "Orders By Status", "input_tables": ["orders"]}}

## Rules
- Reply with EXACTLY ONE JSON object. Do not wrap it in markdown, do not add text
  before or after it.
- Always assign the final DataFrame to the exact output_variable name you chose.
- Use only file names and columns that appear in the user message.
"""

_INSPECT_NOTE = """\

## (Optional) look at the data first
If the sample rows do not tell you enough (e.g. you need the exact category values,
a column's range, or how two tables join), you MAY first run ONE inspection:
{"thought": "<why you need to look>", "tool": "execute_python_script", "arguments": {"code": "<python that prints what you need>"}}
It returns its stdout to you only. After it runs you MUST reply with your visualize
(or explain) object. Use this at most once; if the samples already tell you enough,
skip it and go straight to visualize.
"""


class MiniAnalystAgent(AnalystAgent):
    """A single-decision analyst: one ``visualize`` (or ``explain``) per run.

    Unlike :class:`AnalystAgent` it does **not** loop: :meth:`run` makes one
    analytic decision and stops. It carries its own plain-text transport seams
    (``_call_model`` / ``_parse_action`` / ``_run_inspection_tool``) so models
    with weak or absent function-calling still work, and dispatches the committed
    ``visualize`` through the base core skill, so the emitted ``result`` /
    ``completion`` events are identical to the loop-based agent. Before committing,
    the model may run a single ``execute_python_script`` inspection (a budget of
    one, so it never loops).
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        # One committing action per run; the base machinery is never asked to
        # take a second analytic step.
        kwargs.setdefault("max_iterations", 1)
        super().__init__(*args, **kwargs)

    # ------------------------------------------------------------------
    # Prompt: a tightly scoped, single-decision system prompt
    # ------------------------------------------------------------------

    def _build_system_prompt(
        self,
        has_primary_tables: bool = False,
        has_focused_thread: bool = False,
        has_other_threads: bool = False,
        has_attached_images: bool = False,
        has_charts: bool = False,
        **kwargs: Any,
    ) -> str:
        """Assemble the mini prompt: one visualize/explain decision, a reduced
        chart-type reference, and a short note describing the single optional
        ``execute_python_script`` inspection call."""
        prompt = _MINI_PROMPT_TEMPLATE
        prompt = prompt.replace("{chart_types}", _MINI_CHART_REFERENCE)
        prompt = prompt.replace("{inspect_note}", _INSPECT_NOTE)
        if self.language_instruction:
            prompt = prompt + "\n\n" + self.language_instruction
        return prompt

    # ------------------------------------------------------------------
    # Tool set: only visualize + explain (+ the one inspection, until spent)
    # ------------------------------------------------------------------

    def _mini_tools(self, allow_inspect: bool) -> list[dict[str, Any]]:
        """The minimal tool set the mini agent recognises this turn: the
        ``visualize`` action, the ``explain`` pseudo-tool, and — only when
        ``allow_inspect`` — the ``execute_python_script`` inspection tool."""
        base = AnalystAgent._current_tools(self)
        keep = {"visualize"}
        if allow_inspect:
            keep.add("execute_python_script")
        tools = [t for t in base
                 if ((t.get("function") or {}).get("name") in keep)]
        tools.append(_EXPLAIN_TOOL)
        return tools

    # ------------------------------------------------------------------
    # Plain-text transport: a no-native-tools model call, a JSON-action parser,
    # and the single inspection executor. Actions travel as content JSON so
    # models with weak or absent function-calling still work; every tool is run
    # by the SAME base handlers as the looping agent.
    # ------------------------------------------------------------------

    def _catalog_reminder(self, tools: list[dict[str, Any]]) -> str:
        """A short per-turn reminder of the protocol + the names currently
        available (reflects skills loaded so far, e.g. ``write_report`` after the
        report skill loads). Keeps weak models on-protocol without re-deriving
        the full schemas, which already live in the prompt/skill bodies."""
        action_names = self.registry.action_names()
        names = [(t.get("function") or {}).get("name") for t in tools]
        inspect = [n for n in names if n and n not in action_names]
        act = [n for n in names if n and n in action_names]
        return (
            "[ACTION PROTOCOL] Reply with ONE JSON object "
            '{"thought":..,"tool":<name>,"arguments":{..}} to call a tool/action, '
            "or plain text (no JSON) to finish. "
            f"Inspection tools: {', '.join(inspect) or '(none)'}. "
            f"Actions: {', '.join(act) or '(none)'}."
        )

    def _call_model(self, messages: list[dict]):
        """Buffered completion with NO tools, retrying transient errors before
        any output is consumed (mirrors the base :meth:`_open_stream` contract)."""
        last_exc: Exception | None = None
        for attempt in range(self._MAX_LLM_RETRIES):
            try:
                return self.client.get_completion(
                    messages, stream=False,
                    reasoning_effort=reasoning_effort_for(
                        _AGENT_ID, self.client.model),
                )
            except Exception as e:  # noqa: BLE001 - retried or re-raised below
                last_exc = e
                if self._is_transient_error(e) and attempt < self._MAX_LLM_RETRIES - 1:
                    wait = 2 ** attempt
                    logger.warning(
                        "[MiniAnalystAgent] Transient LLM error (attempt "
                        "%d/%d), retrying in %ds: %s",
                        attempt + 1, self._MAX_LLM_RETRIES, wait, e,
                    )
                    time.sleep(wait)
                    continue
                raise
        raise last_exc  # pragma: no cover - loop always returns or raises

    @staticmethod
    def _parse_action(
        content: str | None, tools: list[dict[str, Any]],
    ) -> tuple[str, str, dict[str, Any]] | None:
        """Parse the first JSON object in ``content`` that names a known tool.

        Returns ``(thought, tool_name, arguments)`` or ``None`` when no JSON
        object matches a tool - in which case ``content`` is the run's final
        plain-text answer. The same matcher used by the Ollama salvage resolves
        the documented ``{"tool","arguments"}`` shape as well as the nested /
        bare-argument shapes weaker models fall into.
        """
        if not isinstance(content, str) or "{" not in content:
            return None
        for blob in _extract_json_objects(content):
            try:
                obj = json.loads(blob)
            except (ValueError, TypeError):
                continue
            if not isinstance(obj, dict):
                continue
            matched = _match_tool_from_obj(obj, tools)
            if matched is None:
                continue
            name, args = matched
            thought = ""
            for k in _THOUGHT_KEYS:
                v = obj.get(k)
                if isinstance(v, str) and v.strip():
                    thought = v.strip()
                    break
            return thought, name, (args if isinstance(args, dict) else {})
        return None

    def _run_inspection_tool(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
        input_tables: list[dict[str, Any]] | None,
        outer_iteration: int,
        rlog,
    ) -> Generator[dict, None, tuple[str, dict | None]]:
        """Execute one inspection tool with the SAME handlers as the base loop,
        yielding the same ``tool_start`` / ``tool_result`` / ``skill_loaded``
        events. Returns ``(observation_text, skill_body_msg_or_None)``."""
        yield {
            "type": "tool_start",
            "tool": tool_name,
            "purpose": tool_args.get("purpose") if tool_name == "execute_python_script" else None,
            "code": tool_args.get("code") if tool_name == "execute_python_script" else None,
            "table_names": tool_args.get("table_names") if tool_name == "inspect_source_data" else None,
            "skill": tool_args.get("name") if tool_name == "load_skill" else None,
        }

        tool_t0 = time.time()
        tool_status = "ok"
        body_msg: dict | None = None

        if tool_name == "execute_python_script":
            result = self._run_explore_code(
                tool_args.get("code", ""), input_tables or [])
            tool_content = result.get("stdout", "")
            tool_status = result.get("status", "ok")
            if result.get("error"):
                tool_content += f"\n\nError: {result['error']}"
            yield {"type": "tool_result", "tool": tool_name, "status": tool_status,
                   "stdout": result.get("stdout", ""), "error": result.get("error")}
        elif tool_name == "inspect_source_data":
            tool_content = handle_inspect_source_data(
                tool_args.get("table_names", []), input_tables or [], self.workspace)
            yield {"type": "tool_result", "tool": tool_name, "status": "ok",
                   "stdout": tool_content}
        elif tool_name == "load_skill":
            skill_name = tool_args.get("name", "")
            ok, message, body_msg = self._build_skill_body_message(skill_name)
            tool_status = "ok" if ok else "error"
            tool_content = message
            if ok:
                yield {"type": "skill_loaded", "skill": skill_name,
                       "unlocks": list(self.registry.metas[skill_name].action_names)
                       if self.registry.has(skill_name) else []}
            yield {"type": "tool_result", "tool": tool_name, "status": tool_status,
                   "stdout": message, "error": None if ok else message}
        elif tool_name in self._loaded_skill_tool_map():
            skill = self._loaded_skill_tool_map()[tool_name]
            skill_ctx = SkillContext(
                client=self.client, workspace=self.workspace,
                language_instruction=self.language_instruction,
                trajectory=[], payload=dict(self._run_payload))
            try:
                result = skill.handle_tool(tool_name, tool_args, skill_ctx)
                tool_content = result.text
            except Exception as exc:  # noqa: BLE001
                logger.warning("[MiniAnalystAgent] Skill tool %r failed", tool_name, exc_info=exc)
                tool_content = f"Tool '{tool_name}' failed: {exc}"
                tool_status = "error"
            yield {"type": "tool_result", "tool": tool_name, "status": tool_status,
                   "stdout": tool_content}
        else:
            tool_content = (
                f"Unknown tool: {tool_name}. Use only the tools/actions listed in "
                "the protocol, or reply in plain text to finish."
            )
            tool_status = "error"
            yield {"type": "tool_result", "tool": tool_name, "status": tool_status,
                   "stdout": tool_content}

        rlog.log("tool_execution", iteration=outer_iteration, tool=tool_name,
                 input_summary=(tool_args.get("purpose", "") or "")[:200],
                 output_summary=(tool_content[:200] + "...") if len(tool_content) > 200 else tool_content,
                 latency_ms=int((time.time() - tool_t0) * 1000), status=tool_status)
        return tool_content, body_msg

    # ------------------------------------------------------------------
    # The run: one decision, no loop
    # ------------------------------------------------------------------

    def run(
        self,
        input_tables: list[dict[str, Any]],
        user_question: str,
        focused_thread: list[dict[str, Any]] | None = None,
        other_threads: list[dict[str, Any]] | None = None,
        trajectory: list[dict] | None = None,
        completed_step_count: int = 0,
        primary_tables: list[str] | None = None,
        attached_images: list[str] | None = None,
        charts: list[dict[str, Any]] | None = None,
    ) -> Generator[dict[str, Any], None, None]:
        """Make a single analytic decision and stop.

        Yields the same event types as :meth:`AnalystAgent.run` (``thinking_text``,
        ``tool_start`` / ``tool_result`` for the optional inspection, ``action`` /
        ``result`` for the chart, ``error``, and a terminal ``completion``), but
        commits at most one ``visualize`` (repaired in place on failure) or ends
        with one ``explain``.
        """
        rlog = self._reasoning_log
        session_start = time.time()

        self._loaded_skills = {_CORE_SKILL}
        self._run_payload = {
            "input_tables": input_tables,
            "charts": charts or [],
            "focused_thread": focused_thread,
            "other_threads": other_threads,
            "primary_tables": primary_tables,
        }
        completed_steps: list[dict[str, Any]] = []
        iteration = completed_step_count + 1

        try:
            rlog.log(
                "session_start",
                agent="MiniAnalystAgent",
                session_id=self._session_id,
                user_question=user_question,
                input_tables=[t.get("name", "") for t in input_tables],
                model=self.client.model,
                rules_injected=[],
                knowledge_injected=[],
            )

            if trajectory is None:
                ns_dir = self._explore_ns_dir()
                if ns_dir.exists():
                    import shutil
                    shutil.rmtree(ns_dir, ignore_errors=True)
                messages = self._build_initial_messages(
                    input_tables, user_question, focused_thread, other_threads,
                    primary_tables=primary_tables,
                    attached_images=attached_images, charts=charts,
                )
            else:
                messages = trajectory

            # A live sandbox session backs the optional inspection so its
            # namespace persists across the (at most one) inspection call.
            from data_formulator.sandbox.local_sandbox import SandboxSession
            with SandboxSession() as explore_session:
                self._explore_session = explore_session
                kind, payload = yield from self._decide(
                    messages, input_tables, iteration,
                    allow_inspect=True,
                )
                self._explore_session = None

            if kind == "explain":
                yield {
                    "type": "completion",
                    "iteration": iteration,
                    "status": "success",
                    "content": {"summary": payload, "total_steps": 0},
                }
                self._log_session_end(rlog, "success", iteration, 0, session_start)
                return

            if kind == "visualize":
                produced = yield from self._visualize_with_repair(
                    payload, messages, input_tables, iteration, completed_steps)
                status = "success" if produced else "completed_no_viz"
                yield {
                    "type": "completion",
                    "iteration": iteration,
                    "status": status,
                    "content": {"summary": "", "total_steps": len(completed_steps)},
                }
                self._log_session_end(rlog, status, iteration, 0, session_start)
                return

            # kind == "none": an LLM error or an exhausted protocol; payload is
            # the status string.
            if payload == "llm_error":
                yield self._error_event(
                    iteration, "LLM API error", message_code="agent.llmApiError")
            yield {
                "type": "completion",
                "iteration": iteration,
                "status": payload,
                "content": {"summary": "", "total_steps": 0},
            }
            self._log_session_end(rlog, payload, iteration, 0, session_start)
            return
        finally:
            rlog.close()

    # ------------------------------------------------------------------
    # Decision: (optional inspection ->) one visualize/explain
    # ------------------------------------------------------------------

    def _decide(
        self,
        messages: list[dict],
        input_tables: list[dict[str, Any]] | None,
        iteration: int,
        *,
        allow_inspect: bool,
    ) -> Generator[dict, None, tuple[str, Any]]:
        """Run the single decision. Returns ``("visualize", args)``,
        ``("explain", text)`` or ``("none", reason)``.

        At most one inspection (``execute_python_script``) and one corrective
        re-prompt are allowed, so the decision is bounded and never loops.
        """
        rlog = self._reasoning_log
        inspections_left = 1 if allow_inspect else 0
        corrections_left = 1

        for _round in range(4):  # hard safety ceiling on model calls
            can_inspect = inspections_left > 0
            # Advertise inspection only when it's actually allowed this round, but
            # always RECOGNISE an inspection call so a model that asks for one when
            # it can't have it is nudged back on track (not misread as a final
            # plain-text answer).
            advertised = self._mini_tools(can_inspect)
            recognize = self._mini_tools(allow_inspect=True)
            rlog.log("llm_request", iteration=iteration,
                     messages_count=len(messages),
                     tools_available=[t["function"]["name"] for t in advertised],
                     transport="json_protocol_mini")
            call_messages = list(messages) + [
                {"role": "system", "content": self._catalog_reminder(advertised)},
            ]
            t0 = time.time()
            try:
                response = self._call_model(call_messages)
            except Exception as exc:  # noqa: BLE001
                rlog.log("llm_response", iteration=iteration,
                         latency_ms=int((time.time() - t0) * 1000),
                         finish_reason="error", error=type(exc).__name__)
                logger.error("[MiniAnalystAgent] LLM call failed", exc_info=exc)
                return ("none", "llm_error")

            latency = int((time.time() - t0) * 1000)
            if not getattr(response, "choices", None):
                rlog.log("llm_response", iteration=iteration,
                         latency_ms=latency, finish_reason="empty")
                return ("none", "llm_error")

            content = (response.choices[0].message.content or "")
            parsed = self._parse_action(content, recognize)

            # --- plain text -> the explain answer ---------------------------
            if parsed is None:
                rlog.log("llm_response", iteration=iteration,
                         latency_ms=latency, finish_reason="final_text")
                messages.append({"role": "assistant", "content": content or None})
                return ("explain", content.strip())

            thought, name, args = parsed
            messages.append({"role": "assistant", "content": content})
            if thought:
                yield {"type": "thinking_text", "content": thought}

            # --- explain action ---------------------------------------------
            if name == "explain":
                rlog.log("llm_response", iteration=iteration,
                         latency_ms=latency, finish_reason="explain")
                text = ""
                for k in _EXPLAIN_TEXT_KEYS:
                    v = args.get(k)
                    if isinstance(v, str) and v.strip():
                        text = v.strip()
                        break
                return ("explain", text or thought or content.strip())

            # --- visualize action -------------------------------------------
            if name == "visualize":
                _rescue_unpack_json_strings(args)
                missing = [f for f in ("code", "output_variable", "chart")
                           if not args.get(f)]
                if missing and corrections_left > 0:
                    corrections_left -= 1
                    messages.append({"role": "user", "content": (
                        "[OBSERVATION] ERROR: your visualize is missing required "
                        f"field(s): {', '.join(missing)}. Emit the visualize JSON "
                        "again with those filled in.")})
                    rlog.log("llm_response", iteration=iteration,
                             latency_ms=latency, finish_reason="missing_fields")
                    continue
                rlog.log("llm_response", iteration=iteration,
                         latency_ms=latency, finish_reason="visualize")
                return ("visualize", args)

            # --- the one optional inspection --------------------------------
            if name in ("execute_python_script", "inspect_source_data"):
                if can_inspect:
                    inspections_left -= 1
                    rlog.log("llm_response", iteration=iteration,
                             latency_ms=latency, finish_reason="inspect", tool=name)
                    tool_content, body_msg = yield from self._run_inspection_tool(
                        name, args, input_tables, iteration, rlog)
                    messages.append({"role": "user", "content": (
                        f"[OBSERVATION] {tool_content}\n\nNow emit your visualize "
                        "JSON object (or an explain object).")})
                    if body_msg is not None:
                        messages.append(body_msg)
                    continue
                # Inspection asked for but not available (budget spent, or the
                # no-tool variation): nudge straight to the answer.
                if corrections_left > 0:
                    corrections_left -= 1
                    messages.append({"role": "user", "content": (
                        "[OBSERVATION] Inspection is not available now; emit your "
                        "visualize JSON object directly (or an explain object).")})
                    rlog.log("llm_response", iteration=iteration,
                             latency_ms=latency, finish_reason="inspect_denied")
                    continue
                return ("none", "tool_rounds_exhausted")

            # --- anything else -> one corrective nudge ----------------------
            if corrections_left > 0:
                corrections_left -= 1
                messages.append({"role": "user", "content": (
                    f"[OBSERVATION] ERROR: '{name}' is not available. Reply with a "
                    "single visualize JSON object (or an explain object).")})
                rlog.log("llm_response", iteration=iteration,
                         latency_ms=latency, finish_reason="unknown_tool")
                continue

            return ("none", "tool_rounds_exhausted")

        return ("none", "tool_rounds_exhausted")

    # ------------------------------------------------------------------
    # Visualize: dispatch through the core skill, repair the SAME chart on failure
    # ------------------------------------------------------------------

    def _visualize_with_repair(
        self,
        args: dict[str, Any],
        messages: list[dict],
        input_tables: list[dict[str, Any]] | None,
        iteration: int,
        completed_steps: list[dict[str, Any]],
    ) -> Generator[dict, None, bool]:
        """Execute the committed ``visualize`` via the base core-skill dispatch,
        re-yielding its ``action`` / ``result`` / ``error`` events. If the code or
        encodings fail, show the model the error and let it fix the SAME chart, up
        to ``max_repair_attempts`` times. Returns ``True`` once a chart is
        produced, ``False`` if every attempt failed."""
        repairs_left = max(0, int(self.max_repair_attempts))

        while True:
            action = dict(args)
            action["action"] = "visualize"

            gen = self._dispatch_skill_action(
                _CORE_SKILL, "visualize", action, messages, iteration, completed_steps)
            produced = False
            observation: str | None = None
            try:
                while True:
                    event = next(gen)
                    if event.get("type") == "result":
                        produced = True
                    yield event
            except StopIteration as stop:
                observation = stop.value

            # Keep history coherent (pure-text transport) so a repair turn reads
            # the failure exactly like an inspection result.
            self._set_action_observation(messages, None, observation)

            if produced:
                return True
            if repairs_left <= 0:
                return False

            repairs_left -= 1
            messages.append({"role": "user", "content": (
                "[SYSTEM] The visualize above FAILED. Fix the SAME chart: read the "
                "error in the observation, correct your code and/or encodings, and "
                "emit ONE corrected visualize JSON object (no other text).")})
            kind, new_args = yield from self._decide(
                messages, input_tables, iteration, allow_inspect=False)
            if kind != "visualize":
                return False
            args = new_args
