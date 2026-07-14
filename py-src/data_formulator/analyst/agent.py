# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""AnalystAgent — the unified data analyst agent shell.

This is the single user-facing data agent that replaces the separate
``DataAgent`` (structured-action visualization loop) and ``ReportGenAgent``
(streaming report writer). It hosts a set of **core actions** plus a registry
of **skills** that unlock additional **gated actions** on demand. See
``design-docs/35-unified-agent-skills-architecture.md`` and the action turn
model in ``design-docs/36-artifact-turn-model.md``.

Architecture (a vanilla tool-calling loop, plus the skills layer):
  - **Inspection tools** (``execute_python_script``, ``inspect_source_data``, ``load_skill``,
    plus skill-private tools) are called via the tool-calling API to gather
    information. Parallel-safe, internal, no side effects.
  - **Committing actions** (``visualize``, ``delegate``) render a user-visible
    surface. Each returns an *observation* string that the shell feeds back as
    the action's tool-call result — the same lane an inspection tool result
    rides — so the agent reads it and decides its own next move. Always available.
  - **Gated actions** (e.g. ``write_report``) are unlocked only after their
    skill is loaded via ``load_skill``; their tool is not offered until then.

The run ends when the model commits **no action** in a turn: its final plain-text
answer *is* the completion (the frontend renders it as the run's summary). There
is no control verdict and no separate "stop" action — the agent simply stops
acting. The shell stays skill-agnostic: it partitions a response into inspection
tools vs committing actions, enforces the one-action-per-turn cardinality guard,
routes the chosen action to the owning skill's ``handle_action(...)``, feeds the
returned observation back, and forwards the channel-tagged events.
"""

import json
import logging
import re
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Generator

from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.agent_utils import (
    accumulate_reasoning_content,
    attach_reasoning_content,
    ensure_output_variable_in_code,
)
from data_formulator.agents.context import (
    build_focused_thread_context,
    build_lightweight_table_context,
    build_peripheral_thread_context,
    handle_inspect_source_data,
)
from data_formulator.agents.client_utils import Client
from data_formulator.datalake.parquet_utils import df_to_safe_records

from data_formulator.analyst.skills import (
    Event,
    SkillContext,
    SkillRegistry,
    ToolResult,
    build_registry,
)
from data_formulator.analyst.tools import build_tools

logger = logging.getLogger(__name__)

_AGENT_ID = "analyst"

# The always-on baseline skill, auto-loaded at the start of every run. It owns
# the built-in tools (execute_python_script / inspect_source_data) and the always-available
# actions (visualize / delegate) plus the base prompt body (its SKILL.md). The
# shell hardcodes nothing about those actions — legality is derived from
# whichever skills are loaded.
_CORE_SKILL = "core"

# Banner stamped at the START of a loaded skill's body message. It is the single
# contract between the emitter (_load_skill_into_context) and the resume parser
# (_rehydrate_loaded_skills): they share this template + regex so they cannot
# drift, and the regex is anchored to the message start so only banners *we*
# emitted match — never the same text pasted by a user or echoed by the model.
_SKILL_LOADED_BANNER = "[SKILL LOADED: {name}]"
_SKILL_LOADED_RE = re.compile(r"^\[SKILL LOADED: ([^\]]+)\]")

# ── Action-argument coercion ──────────────────────────────────────────────
# Weaker models sometimes JSON-encode a nested action argument as a string
# (e.g. ``"chart": "{...}"``). Parse those back to objects before dispatch so
# the skill handler sees structured data. Required-field validation lives in the
# registry (``action_required_fields``) and the skill handler — not here.


def _rescue_unpack_json_strings(data: dict) -> None:
    """In-place: parse values that are JSON-encoded strings back to objects."""
    for key in (
        "chart", "input_tables", "questions", "options", "followups",
        "field_metadata", "field_display_names",
    ):
        val = data.get(key)
        if isinstance(val, str) and val.strip()[:1] in ("{", "["):
            try:
                data[key] = json.loads(val)
            except (json.JSONDecodeError, ValueError):
                pass


# ── Live tool-argument streaming (design-docs/36 §5) ───────────────────────
# A streaming action (only ``write_report`` today) writes its payload as a
# tool-call argument. Providers stream that argument as a growing JSON fragment
# (``delta.tool_calls[].function.arguments`` — Anthropic's ``input_json_delta``).
# This extractor pulls the *decoded* value of one top-level string key out of
# that fragment as it grows, surfacing only the newly-completed suffix each feed
# so the agent can forward it as channel ``text_delta``s. It is forgiving of a
# partial trailing escape (``\\`` or an incomplete ``\\uXXXX``): it holds those
# bytes back until the next chunk completes them, never emitting half an escape.


class _StreamingArgExtractor:
    """Incrementally extract the decoded string value of a top-level JSON key
    from a growing tool-call ``arguments`` fragment.

    ``feed`` is given the full accumulated arguments so far and returns only the
    newly-decoded suffix of the target field's value (``""`` while nothing new
    can be safely decoded yet).
    """

    def __init__(self, field: str):
        # Matches ``"field"`` then ``:`` then the opening quote of the value.
        self._open_re = re.compile(r'"' + re.escape(field) + r'"\s*:\s*"')
        self._emitted = 0

    def feed(self, args_so_far: str) -> str:
        decoded = self._decode(args_so_far)
        if decoded is None or len(decoded) <= self._emitted:
            return ""
        new = decoded[self._emitted:]
        self._emitted = len(decoded)
        return new

    def _decode(self, args: str) -> str | None:
        """Return the decoded value-so-far of the field, or ``None`` if the
        value has not started or a trailing escape is incomplete."""
        m = self._open_re.search(args)
        if not m:
            return None
        rest = args[m.end():]
        out: list[str] = []
        i, n = 0, len(rest)
        while i < n:
            ch = rest[i]
            if ch == "\\":
                if i + 1 >= n:
                    break  # dangling escape — wait for the next chunk
                out.append(rest[i:i + 2])
                i += 2
                continue
            if ch == '"':
                break  # closing quote — value complete
            out.append(ch)
            i += 1
        try:
            # Re-wrap as a JSON string literal so escapes decode correctly.
            return json.loads('"' + "".join(out) + '"')
        except (json.JSONDecodeError, ValueError):
            return None  # e.g. partial ``\\uXXXX`` — wait for more



# The agent's system frame — shell-owned, invariant across skills: identity, the
# tools-vs-actions contract, the skills mechanism, and the action budget /
# stop criteria. This is the agent's own contract, so it lives here as code (not
# as a skill body). ``_build_system_prompt`` fills the ``{...}`` slots via plain
# string substitution (NOT str.format — braces elsewhere stay literal). The
# always-loaded ``core`` skill's SKILL.md (the concrete tools + action schemas)
# is appended after this frame, unformatted, exactly like any other skill body.
SYSTEM_PROMPT = """\
You are an autonomous data analyst agent.

Your goal is to help the user by exploring their data, producing visualizations,
and — when asked — packaging the findings (e.g. into a written report). You
operate in a loop: gather what you need with inspection tools, take an **action**
when you want to act on the data, read its result, and repeat — then stop by
giving your final answer in plain text.

## Tools vs. actions

Everything you do is a function/tool call, but calls come in two kinds and
keeping them straight is essential:

- **Inspection tools** (internal — for gathering information). Functions like
  `execute_python_script`, `inspect_source_data`, `inspect_chart`, and `load_skill` that
  inspect data or load instructions *before* you act. Their results return to
  you and are **not** shown to the user. They commit nothing and are
  **independent** — none depends on another's result — so call as many as you
  need, across as many rounds as you need, until you have enough to act.
- **Actions** (committing — shown to the user). A discrete operation like
  `visualize`, `ask_user`, `delegate`, and (once the report skill is loaded)
  `write_report`. Each renders a user-visible surface, and its result is
  returned to you just like a tool result so you can react to it.

**Actions are sequential — take exactly one, then wait for its result.** This is
the key difference from inspection tools: those are independent, but each
action's result shapes your next decision — the chart you'd draw next depends on
what this one reveals — so choosing two at once would make the second a blind
guess, decided before you've seen the first's outcome. Do all your inspection
first, then commit the single action that fits.

Treat each action like one turn in a back-and-forth: **you act → its result
answers → you act again.** Even when you're planning a sequence of charts,
surface them one at a time so each reacts to the last. (If you do emit several
actions at once, only the first runs and the rest are discarded — batching only
loses work.)

**To finish, reply with plain text and no action.** Plain text is your
**closing answer** — the run is over and you expect nothing further (the user's
next message starts a fresh turn). Use it whenever you've done what was asked,
including answering a question you fully resolved.

**Whenever you expect the user to reply — a question, a clarification, an
explanation you want them to react to, or a set of choices — use the `ask_user`
action instead.** It renders a question widget and pauses the run for their
reply, so the conversation resumes in the same turn. `ask_user` accepts
free-text questions (no clickable options required), so reach for it for *any*
followup-seeking turn, not only structured choices. Plain text never asks for
input; `ask_user` always does. There is no separate "stop" or "summary" action:
you stop by simply not acting.

The concrete actions available to you — and how to use each well — are
described in the capability sections below.

## Understanding your context

{context_guide}

## Skills (load on demand)

Your baseline capabilities come from the **core** skill, which is **always loaded
automatically** (you'll see it below as `[SKILL: core]`). Beyond that baseline,
extra capabilities are packaged as **extension skills** — each one unlocks an
additional action (and sometimes extra tools), but only after you load it:
1. Call the `load_skill("<name>")` tool — this reads the skill's instructions into
   your context and unlocks its action(s) and any tools it provides.
2. Follow those instructions and call the action it unlocks (its tool only
   appears once the skill is loaded).

Calling an extension skill's action **before** loading the skill will not
execute — you'll be asked to load it first. Extension skills available this run
(load the one whose `when to use` fits):

{skills_block}

## Working within your budget

- You have a budget of **{max_iterations} actions** for this run — a **hard
  ceiling, not a target**. Use as few as the goal requires.
- **Stop as soon as the user's goal is met.** End the run by giving your final
  answer in plain text rather than taking more actions just because you can.
- For concrete/progressive questions, take a follow-up action only when it
  addresses a gap the previous step actually raised. For open-ended
  exploration, the opposite applies: deliberately spend your budget covering
  distinct analytical angles (see the core skill's "Choosing what to do").
- If the request is genuinely ambiguous, ask the user in plain text (no action)
  rather than guessing.

{agent_exploration_rules}"""


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class AnalystAgent:
    """Unified data analyst agent — core actions + on-demand skills."""

    def __init__(
        self,
        client: Client,
        workspace,
        skill_registry: SkillRegistry | None = None,
        agent_exploration_rules: str = "",
        agent_coding_rules: str = "",
        language_instruction: str = "",
        max_iterations: int = 5,
        max_repair_attempts: int = 2,
        identity_id: str | None = None,
    ):
        self.client = client
        self.workspace = workspace
        self.registry = skill_registry or build_registry()
        self.agent_exploration_rules = agent_exploration_rules
        self.agent_coding_rules = agent_coding_rules
        self.language_instruction = language_instruction
        self.max_iterations = max_iterations
        self.max_repair_attempts = max_repair_attempts

        from data_formulator.agents.reasoning_log import (
            ReasoningLogger, _NullReasoningLogger,
        )
        self._session_id = uuid.uuid4().hex[:12]
        if identity_id:
            try:
                self._reasoning_log = ReasoningLogger(
                    identity_id, "AnalystAgent", self._session_id,
                )
            except Exception:
                logger.warning("Failed to initialise ReasoningLogger", exc_info=True)
                self._reasoning_log = _NullReasoningLogger()
        else:
            self._reasoning_log = _NullReasoningLogger()

        self._knowledge_store = None
        self._injected_knowledge: list[dict[str, Any]] = []
        self._injected_rules: list[str] = []
        _user_home = getattr(workspace, "user_home", None)
        if _user_home:
            try:
                from data_formulator.knowledge.store import KnowledgeStore
                self._knowledge_store = KnowledgeStore(_user_home)
            except Exception:
                logger.warning("Failed to initialise KnowledgeStore", exc_info=True)

        # Per-run skill state (reset at the start of each run()). Skill code
        # modules themselves live in ``self.registry.skills`` and are always
        # available; ``_loaded_skills`` only tracks which skills the model has
        # been *exposed* to (tools + actions + guidance) this run.
        self._loaded_skills: set[str] = set()
        # Free-form payload for skill dispatch (charts, etc.), set per run.
        self._run_payload: dict[str, Any] = {}
        # Live-streaming bookkeeping (design-docs/36 §5). ``_streamed_channels``
        # maps a committing action's tool_call_id -> the channel its argument was
        # already forwarded on during the streaming LLM call; ``_suppress_stream_channel``
        # is set just before dispatching such an action so the router drops the
        # skill's duplicate (buffered) emission of the same content.
        self._streamed_channels: dict[str, str] = {}
        self._suppress_stream_channel: str | None = None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _explore_ns_dir(self) -> Path:
        """Directory for cross-turn namespace serialisation."""
        return self.workspace.confined_scratch.root / "_explore_ns"

    def _legal_actions(self) -> frozenset[str]:
        """The set of committing actions currently legal to emit.

        Every legal action is owned by a *loaded* skill. ``core`` is always
        loaded, so its baseline actions are always legal; a gated skill's
        actions become legal once that skill is loaded.
        """
        legal: set[str] = set()
        for name in self._loaded_skills:
            meta = self.registry.metas.get(name)
            if meta:
                legal.update(meta.action_names)
        return frozenset(legal)

    # ------------------------------------------------------------------
    # Public API
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
        """Run the unified analyst loop.

        Yields event dicts with ``type`` in:
            ``"action"``        – the agent's committed action (for UI)
            ``"result"``        – a visualization result (data + chart)
            ``"tool_start"`` / ``"tool_result"`` – inspection tool activity
            ``"skill_loaded"``  – a skill's gate opened
            ``"delegate"``      – hand-off to a peer agent
            ``"completion"``    – the run's final answer (ends the run)
            ``"error"``         – error information

        The run ends when the model commits no action in a turn: its final
        plain-text answer is emitted as the ``completion`` event.
        """
        rlog = self._reasoning_log
        session_start_time = time.time()
        total_llm_calls = 0
        completed_steps: list[dict[str, Any]] = []
        iteration = completed_step_count
        final_status = "max_iterations"

        # Reset per-run skill + payload state. ``core`` is auto-loaded: its
        # baseline tools + actions are always available and its SKILL.md body is
        # appended to the system frame (see _build_system_prompt). Gated skills
        # are added to this set as the model loads them. The payload carries
        # everything a dispatched skill handler needs to build its own context
        # (e.g. the report skill rebuilds [AVAILABLE CHARTS] + thread
        # context).
        self._loaded_skills = {_CORE_SKILL}
        self._run_payload = {
            "input_tables": input_tables,
            "charts": charts or [],
            "focused_thread": focused_thread,
            "other_threads": other_threads,
            "primary_tables": primary_tables,
        }

        try:
            rlog.log(
                "session_start",
                agent="AnalystAgent",
                session_id=self._session_id,
                user_question=user_question,
                input_tables=[t.get("name", "") for t in input_tables],
                model=self.client.model,
                rules_injected=[
                    r for r in [self.agent_exploration_rules, self.agent_coding_rules] if r
                ],
                knowledge_injected=[],
            )

            if trajectory is None:
                ns_dir = self._explore_ns_dir()
                if ns_dir.exists():
                    import shutil
                    shutil.rmtree(ns_dir, ignore_errors=True)

                trajectory = self._build_initial_messages(
                    input_tables, user_question, focused_thread, other_threads,
                    primary_tables=primary_tables,
                    attached_images=attached_images,
                    charts=charts,
                )
                rlog.log(
                    "context_built",
                    system_prompt_tokens=len(trajectory[0].get("content", "")) // 4 if trajectory else 0,
                    user_msg_tokens=len(str(trajectory[1].get("content", ""))) // 4 if len(trajectory) > 1 else 0,
                    total_tables=len(input_tables),
                    primary_tables=primary_tables or [],
                    knowledge_rules_injected=self._injected_rules,
                    knowledge_injected=self._injected_knowledge,
                )

                if self._injected_rules or self._injected_knowledge:
                    yield {
                        "type": "context_info",
                        "rules_injected": self._injected_rules,
                        "knowledge_injected": [
                            {"category": k["category"], "title": k["title"]}
                            for k in self._injected_knowledge
                        ],
                    }
            else:
                # Resume: the trajectory is the single source of truth. A loaded
                # skill is just its ``[SKILL LOADED: <name>]`` body sitting in
                # history (kept for free via prefix caching), so re-open the gate
                # for every skill whose body is still present. This keeps
                # ``_loaded_skills`` in sync with what the model actually sees,
                # avoiding a "body present but gate closed" contradiction.
                self._rehydrate_loaded_skills(trajectory)

            action_budget = self.max_iterations  # hard ceiling on committing actions
            actions_committed = completed_step_count  # resume-aware count
            hard_ceiling = iteration + max(self.max_iterations * 3, 12)

            while iteration < hard_ceiling:
                iteration += 1

                # --- THINK: call LLM with tools, get the next action ------
                t_start = time.time()
                action = None
                action_reason = "ok"
                action_error = ""
                final_text = ""
                action_tool_call_id = None
                for event in self._get_next_action(trajectory, input_tables, outer_iteration=iteration):
                    if event.get("type") == "agent_action":
                        action = event.get("action_data")
                        action_reason = event.get("reason", "ok")
                        action_error = event.get("error_message", "")
                        final_text = event.get("final_text", "")
                        action_tool_call_id = event.get("tool_call_id")
                        total_llm_calls += event.get("llm_calls", 0)
                    else:
                        yield event
                logger.info("[AnalystAgent] iteration %d total=%.2fs reason=%s",
                            iteration, time.time() - t_start, action_reason)

                if action is None:
                    # ── No committing action → the run is over ────────────────
                    # The normal close: the model answered in plain text and
                    # committed nothing. That final text IS the completion (the
                    # frontend renders it as the run's summary). An LLM API error
                    # is fatal; the tool-round backstop also lands here.
                    if action_reason == "llm_error":
                        final_status = "llm_error"
                        yield self._error_event(
                            iteration,
                            action_error or "LLM API error",
                            message_code="agent.llmApiError",
                        )
                        self._log_session_end(rlog, final_status, iteration, total_llm_calls, session_start_time)
                        return

                    final_status = (
                        "tool_rounds_exhausted"
                        if action_reason == "tool_rounds_exhausted"
                        else "success"
                    )
                    yield {
                        "type": "completion",
                        "iteration": iteration,
                        "status": final_status,
                        "content": {
                            "summary": final_text,
                            "total_steps": len(completed_steps),
                        },
                    }
                    self._log_session_end(rlog, final_status, iteration, total_llm_calls, session_start_time)
                    return

                action_type = action.get("action")
                logger.info(f"[AnalystAgent] Iteration {iteration}: action={action_type}")

                # --- GATE: every action is owned by a skill; its owner must be
                #     loaded. ``core`` is always loaded, so its actions pass
                #     straight through.
                owner = self.registry.action_owner(action_type)
                if owner is None:
                    legal = ", ".join(sorted(self._legal_actions()))
                    self._set_action_observation(
                        trajectory, action_tool_call_id,
                        f"[ERROR] Unknown action '{action_type}'. Choose one of: "
                        f"{legal}, or load a skill that unlocks the action you need.",
                    )
                    yield self._error_event(
                        iteration, f"Unknown action: {action_type}",
                        message_code="agent.unknownAction",
                    )
                    continue
                if owner not in self._loaded_skills:
                    # Gate closed — tell the model to load the skill, no execution.
                    self._set_action_observation(
                        trajectory, action_tool_call_id,
                        f"[GATED] The '{action_type}' action requires the "
                        f"'{owner}' skill. Call load_skill(\"{owner}\") first, "
                        "follow its instructions, then emit the action again.",
                    )
                    rlog.log("action_gated", action=action_type, skill=owner,
                             iteration=iteration)
                    continue

                # --- DISPATCH: the owning skill renders the action and RETURNS
                #     an observation string; the shell feeds it back as the
                #     action's tool-call result (the same lane an inspection tool
                #     result rides), then loops so the agent reads it and decides
                #     its own next move. There is no control verdict.
                # If this action's argument was streamed live during the LLM call
                # (e.g. write_report), tell the router to drop the skill's
                # duplicate buffered emission of the same content.
                self._suppress_stream_channel = self._streamed_channels.get(
                    action_tool_call_id
                )
                try:
                    observation = yield from self._dispatch_skill_action(
                        owner, action_type, action, trajectory, iteration, completed_steps,
                    )
                finally:
                    self._suppress_stream_channel = None
                self._set_action_observation(
                    trajectory, action_tool_call_id, observation,
                )

                if observation is None:
                    # ── Terminal action → the run pauses ──────────────────────
                    # A handler that returns no observation (``interact``) has
                    # nothing for the agent to react to: it already yielded its
                    # own terminal surface (a question widget) and the run waits
                    # for the user. Stop here; their next message starts a fresh
                    # turn. No completion event — the interact event is the close.
                    self._log_session_end(
                        rlog, "success", iteration, total_llm_calls, session_start_time,
                    )
                    return

                actions_committed += 1
                remaining = action_budget - actions_committed
                if remaining <= 0:
                    # Hard action ceiling reached — stop and let the user steer.
                    final_status = "max_iterations"
                    yield {
                        "type": "completion",
                        "iteration": iteration,
                        "status": "max_iterations",
                        "content": {
                            "summary": "Reached the maximum number of actions for this run.",
                            "summary_code": "agent.maxIterationsSummary",
                            "total_steps": len(completed_steps),
                        },
                    }
                    self._log_session_end(rlog, final_status, iteration, total_llm_calls, session_start_time)
                    return
                if remaining == 1:
                    trajectory.append({
                        "role": "user",
                        "content": (
                            "[SYSTEM] You have 1 action left in your budget. Make it "
                            "count, or wrap up by giving your final answer in plain "
                            "text (which ends the run)."
                        ),
                    })
                continue

            # Runaway backstop — too many non-committing rounds without finishing.
            final_status = "max_iterations"
            self._log_session_end(rlog, final_status, iteration, total_llm_calls, session_start_time)
            yield {
                "type": "completion",
                "iteration": iteration,
                "status": "max_iterations",
                "content": {
                    "summary": "Reached the maximum number of exploration steps.",
                    "summary_code": "agent.maxIterationsSummary",
                    "total_steps": len(completed_steps),
                },
            }
        finally:
            rlog.close()

    # ------------------------------------------------------------------
    # Skill loading + dispatch
    # ------------------------------------------------------------------

    def _rehydrate_loaded_skills(self, trajectory: list[dict]) -> None:
        """Re-open skill gates for bodies still present in a resumed trajectory.

        A skill is "loaded" iff its ``[SKILL LOADED: <name>]`` body is in
        context. On resume ``_loaded_skills`` has just been reset to ``{core}``,
        so scan the (persisted) trajectory for those banners and re-add every
        known skill whose body survived. Unknown names are ignored — only the
        registry decides what is real.

        The match is anchored to the start of the message (see
        ``_SKILL_LOADED_RE``): our emitter always stamps the banner at position
        0, so a user-pasted or model-echoed ``[SKILL LOADED: ...]`` sitting
        mid-message will not spuriously open a gate.
        """
        for message in trajectory:
            content = message.get("content")
            if not isinstance(content, str):
                continue
            m = _SKILL_LOADED_RE.match(content)
            if m:
                name = m.group(1).strip()
                if self.registry.has(name):
                    self._loaded_skills.add(name)

    def _load_skill_into_context(
        self, name: str, trajectory: list[dict],
    ) -> tuple[bool, str]:
        """Load a skill's ``SKILL.md`` body into the trajectory.

        Returns ``(ok, message)``. On success the body is appended as a user
        message and ``name`` is recorded in ``_loaded_skills``; the gated
        actions it declares become legal. Idempotent — loading twice is a no-op.

        Convenience wrapper around :meth:`_build_skill_body_message` that appends
        the body immediately. Prefer the builder directly when loading inside a
        tool-call round, where the body must be appended *after* the tool-result
        messages (an assistant ``tool_calls`` turn must be immediately followed
        by its tool responses — see the readonly loop in ``_tool_loop``).
        """
        ok, message, body_msg = self._build_skill_body_message(name)
        if ok and body_msg is not None:
            trajectory.append(body_msg)
        return ok, message

    def _build_skill_body_message(
        self, name: str,
    ) -> tuple[bool, str, dict | None]:
        """Resolve a skill's body into a ``user`` message *without* appending it.

        Returns ``(ok, message, body_msg)``. On success ``name`` is recorded in
        ``_loaded_skills`` (so the gated actions become legal immediately) and
        ``body_msg`` is the user turn the caller must append to the trajectory;
        the caller controls *when* it lands so message ordering stays
        provider-valid. Idempotent — loading twice yields ``body_msg=None``.
        """
        if not self.registry.has(name):
            return False, f"Unknown skill: {name!r}", None
        if name in self._loaded_skills:
            return True, f"Skill '{name}' already loaded.", None
        try:
            body = self.registry.load_body(name)
        except Exception as e:
            logger.warning("[AnalystAgent] Failed to load skill body %s", name, exc_info=True)
            return False, f"Failed to load skill {name!r}: {e}", None

        meta = self.registry.metas[name]
        unlocks = ", ".join(meta.action_names) if meta.action_names else "(none)"
        tool_names = [
            spec.get("function", {}).get("name")
            for spec in self.registry.tools_for([name])
        ]
        tool_names = [t for t in tool_names if t]
        tools_line = (
            f" New tools available: {', '.join(tool_names)}.\n" if tool_names else ""
        )
        # Mirror the ``[SKILL: <name>]`` header the core body gets in
        # _build_system_prompt, so every capability bundle reads as one family —
        # here ``[SKILL LOADED: <name>]`` marks one that just became active. The
        # banner is built from the shared template so resume-time rehydration
        # (_rehydrate_loaded_skills) parses exactly what we emit here.
        body_msg = {
            "role": "user",
            "content": (
                f"{_SKILL_LOADED_BANNER.format(name=name)} You can now use the action(s): {unlocks}.\n"
                f"{tools_line}\n"
                f"{body}"
            ),
        }
        self._loaded_skills.add(name)
        return True, f"Skill '{name}' loaded; unlocked: {unlocks}.", body_msg

    def _dispatch_skill_action(
        self,
        skill_name: str,
        action_type: str,
        action: dict[str, Any],
        trajectory: list[dict],
        iteration: int,
        completed_steps: list[dict[str, Any]],
    ) -> Generator[Event, None, str | None]:
        """Render a skill's action via ``handle_action`` and return its
        observation string (or ``None``).

        The skill does the *processing* (validate, run, emit events) and yields
        events back; this method *routes* those events to the caller — stamping
        ``iteration``, tracking completed visualization steps, and enriching the
        delegate event with the resumability fields the frontend needs — then
        returns the skill's observation. The shell feeds that observation back as
        the action's tool-call result (see ``_set_action_observation``).

        The skill is always instantiated (eager registry build), so this only
        fails if a skill declares an action in its ``SKILL.md`` but ships no
        executable handler — a config error: the shell yields its own ``error``
        event and returns an observation describing the failure.
        """
        rlog = self._reasoning_log
        skill = self.registry.get_skill(skill_name)
        if skill is None or not hasattr(skill, "handle_action"):
            logger.warning(
                "[AnalystAgent] Skill %r unlocks action %r but has no handle_action.",
                skill_name, action_type,
            )
            rlog.log("action_execution", action=action_type, status="no_handler",
                     iteration=iteration, skill=skill_name)
            yield self._error_event(
                iteration,
                f"Skill '{skill_name}' has no handler for '{action_type}'.",
                message_code="agent.skillNoHandler",
            )
            return (
                f"[SKILL ERROR] The '{skill_name}' skill cannot render "
                f"'{action_type}'. Choose a core action instead."
            )

        ctx = SkillContext(
            client=self.client,
            workspace=self.workspace,
            language_instruction=self.language_instruction,
            trajectory=trajectory,
            payload={**self._run_payload, "completed_step_count": len(completed_steps)},
            runtime=self,
        )
        rlog.log("action_execution", action=action_type, status="ok",
                 iteration=iteration, skill=skill_name)
        gen = skill.handle_action(action_type, action, ctx)
        observation = yield from self._route_skill_events(
            gen, iteration, trajectory, completed_steps,
        )
        return observation

    def _route_skill_events(
        self,
        gen: Generator[Event, None, str | None],
        iteration: int,
        trajectory: list[dict],
        completed_steps: list[dict[str, Any]],
    ) -> Generator[Event, None, str | None]:
        """The shell's router: a skill yields events to *here* (never straight
        to the frontend), and this is the single place that decides what to
        forward upstream — re-yielding each event after enriching it with
        shell-owned bookkeeping — then returns the skill's observation string.

        Concretely it:
        - stamps ``iteration`` on every event;
        - records each ``result`` event as a completed visualization step;
        - enriches ``delegate`` / ``interact`` events (both pause the run) with
          the stripped trajectory + completed-step count needed to resume.

        It is free to transform or drop events; skills stay decoupled from the
        wire protocol and the routing policy.

        Suppression: when the committing action's argument was already streamed
        live (``_suppress_stream_channel`` set by ``run``), the skill's later
        *buffered* re-emission of the same content — its ``action`` event and the
        ``text_delta`` on that channel — is dropped here so the frontend sees the
        content exactly once (design-docs/36 §5).

        Recoverable errors: every ``error`` event a skill yields is paired with a
        returned observation string (e.g. visualize's "chart fields not found",
        a malformed ``ask_user`` payload). That observation is fed back to the
        agent as the action's tool-call result, so the agent sees the failure and
        self-corrects on the next iteration. These are *internal* retry signals,
        not user-facing failures, so they are dropped here and never streamed to
        the frontend. Only fatal, run-ending errors (LLM API failures) are
        emitted directly by ``run`` outside this router and do reach the client.
        """
        suppress_channel = self._suppress_stream_channel
        try:
            ev = next(gen)
            while True:
                ev.setdefault("iteration", iteration)
                etype = ev.get("type")
                drop = (
                    etype == "error"
                    or (bool(suppress_channel) and (
                        etype == "action"
                        or (etype == "text_delta" and ev.get("channel") == suppress_channel)
                    ))
                )
                if not drop:
                    if etype == "result":
                        content = ev.get("content", {}) or {}
                        result = content.get("result") or {}
                        completed_steps.append({
                            "display_instruction": content.get("question", ""),
                            "code": result.get("code", ""),
                        })
                    elif etype in ("delegate", "interact"):
                        # Both pause the run; the frontend needs the trajectory +
                        # step count to resume after the user answers / hands off.
                        ev.setdefault("trajectory", self._strip_images(trajectory))
                        ev.setdefault("completed_step_count", len(completed_steps))
                    yield ev
                ev = gen.send(None)
        except StopIteration as stop:
            return stop.value  # the skill's observation string (or None)

    def _set_action_observation(
        self, messages: list[dict], tool_call_id: str | None, observation: str | None,
    ) -> None:
        """Feed an action's observation back as its tool-call result.

        The committing action was recorded as an assistant tool call answered by
        an empty placeholder ``tool`` message (see ``_commit_action``); fill that
        placeholder with the skill's observation so the agent reads it exactly
        like an inspection tool result. Falls back to appending a user message if
        the id is missing (safety).
        """
        text = observation if observation else "ok"
        if tool_call_id:
            for msg in reversed(messages):
                if msg.get("role") == "tool" and msg.get("tool_call_id") == tool_call_id:
                    msg["content"] = text
                    return
        messages.append({"role": "user", "content": text})

    # ------------------------------------------------------------------
    # Runtime facade — execution substrate exposed to skills via ctx.runtime
    # ------------------------------------------------------------------

    def run_visualize_code(self, **kwargs) -> dict[str, Any]:
        """Public alias so skills can run visualize code via ``ctx.runtime``."""
        return self._run_visualize_code(**kwargs)

    def register_run_chart(
        self,
        transform_result: dict[str, Any],
        chart_spec: dict[str, Any],
    ) -> None:
        """Register a chart created mid-run so gated skills (e.g. report) can
        reference and inspect it within the same run.

        The entry mirrors the shape the frontend forwards for pre-existing charts
        (``chart_id`` / ``chart_type`` / ``encodings`` / ``table_ref`` / ``code`` /
        ``chart_data``). Charts are read by the agent from their encodings + sample
        data (and code), not a rendered image. The mutation lands on
        ``self._run_payload['charts']`` so the next dispatched skill ctx sees it.
        """
        chart_id = transform_result.get("chart_id")
        if not chart_id:
            return
        content = transform_result.get("content", {}) or {}
        table_name = (content.get("virtual", {}) or {}).get("table_name", "")
        rows = content.get("rows", []) or []
        charts = self._run_payload.setdefault("charts", [])
        if any(c.get("chart_id") == chart_id for c in charts):
            return
        charts.append({
            "chart_id": chart_id,
            "chart_type": chart_spec.get("type") or chart_spec.get("chart_type") or "Unknown",
            "encodings": dict(chart_spec.get("encodings", {}) or {}),
            "table_ref": table_name,
            "code": transform_result.get("code", ""),
            "chart_data": {"name": table_name, "rows": rows[:50]},
        })

    def run_explore_code(
        self, code: str, input_tables: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Public alias so skills can run explore code via ``ctx.runtime``."""
        return self._run_explore_code(code, input_tables)

    # ------------------------------------------------------------------
    # Sandbox execution substrate
    # ------------------------------------------------------------------

    def _run_explore_code(
        self,
        code: str,
        input_tables: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Run explore code in sandbox, capturing stdout."""
        capture_code = (
            "import io as _io, sys as _sys, pandas as _pd\n"
            "_old_stdout = _sys.stdout\n"
            "_sys.stdout = _captured = _io.StringIO()\n"
            "\n"
            f"{code}\n"
            "\n"
            "_sys.stdout = _old_stdout\n"
            "_pack = {\n"
            "    'stdout': _captured.getvalue(),\n"
            "}\n"
        )

        try:
            with self.workspace.local_dir() as local_path:
                import os as _os
                workspace_path = _os.path.abspath(str(local_path))
                allowed_objects = {"_pack": None}

                session = getattr(self, "_explore_session", None)
                if session is not None:
                    raw = session.execute(capture_code, allowed_objects, workspace_path)
                else:
                    from data_formulator.sandbox import create_sandbox
                    try:
                        from flask import current_app
                        sandbox_mode = current_app.config.get('CLI_ARGS', {}).get('sandbox', 'local')
                    except (ImportError, RuntimeError):
                        sandbox_mode = 'local'
                    sandbox = create_sandbox(sandbox_mode)
                    raw = sandbox._run_in_warm_subprocess(
                        capture_code, allowed_objects, workspace_path
                    )

            if raw.get("status") == "ok":
                allowed = raw.get("allowed_objects") or {}
                if not isinstance(allowed, dict):
                    allowed = {}
                pack = allowed.get("_pack", {})
                stdout = pack.get("stdout", "") if isinstance(pack, dict) else ""
                if not isinstance(stdout, str):
                    stdout = str(stdout)
                if len(stdout) > 8000:
                    stdout = stdout[:8000] + "\n... (truncated)"
                return {"status": "ok", "stdout": stdout}
            else:
                err = raw.get("error_message", raw.get("content", "Unknown error"))
                logger.warning(
                    "[AnalystAgent] explore code failed: %s\n--- code ---\n%s",
                    err, code[:2000],
                )
                return {
                    "status": "error",
                    "error": err,
                    "stdout": "",
                }
        except Exception as e:
            logger.error("[AnalystAgent] Sandbox execution error", exc_info=e)
            return {"status": "error", "error": "Code execution failed", "stdout": ""}

    def _run_visualize_code(
        self,
        code: str,
        output_variable: str,
        chart_spec: dict,
        field_metadata: dict,
        field_display_names: dict,
        display_instruction: str,
        title: str = "",
        messages: list[dict] | None = None,
    ) -> dict[str, Any]:
        """Run visualize code in sandbox and assemble chart."""
        from data_formulator.sandbox import create_sandbox

        try:
            from flask import current_app
            sandbox_mode = current_app.config.get('CLI_ARGS', {}).get('sandbox', 'local')
            max_display_rows = current_app.config['CLI_ARGS'].get('max_display_rows', 5000)
        except (ImportError, RuntimeError):
            sandbox_mode = 'local'
            max_display_rows = 5000

        code, was_patched, detected_var = ensure_output_variable_in_code(code, output_variable)
        if was_patched:
            logger.info(f"[AnalystAgent] patched output_variable: {output_variable} = {detected_var}")

        sandbox = create_sandbox(sandbox_mode)

        try:
            execution_result = sandbox.run_python_code(
                code=code,
                workspace=self.workspace,
                output_variable=output_variable,
            )

            if execution_result['status'] != 'ok':
                error_message = execution_result.get('content', 'Unknown error')
                logger.warning(
                    "[AnalystAgent] visualize code failed: %s\n--- code ---\n%s",
                    error_message, code[:2000],
                )
                return {"status": "error", "error_message": str(error_message)}

            full_df = execution_result['content']
            row_count = len(full_df)

            chart_encodings = chart_spec.get("encodings", {})

            def _missing_encoding(field: Any) -> bool:
                # field is normally a column-name string. Weak models sometimes
                # emit a dict ({"field": "col"}), a list, or other non-string;
                # turn those into a clean, repairable "not found" instead of an
                # unhashable-type crash on the membership test below.
                if not field:
                    return False  # empty / None -> optional channel, skip
                if isinstance(field, dict):
                    field = field.get("field")
                    if not field:
                        return False
                if not isinstance(field, str):
                    return True  # list / number / etc. -> invalid single column
                return field not in full_df.columns

            missing_fields = [
                f"{channel}: '{field}'"
                for channel, field in chart_encodings.items()
                if _missing_encoding(field)
            ]
            if missing_fields:
                available = list(full_df.columns)
                return {
                    "status": "error",
                    "error_message": (
                        f"Chart encoding fields not found in output DataFrame: "
                        f"{', '.join(missing_fields)}. "
                        f"Available columns: {available}"
                    ),
                    "error_code": "agent.fieldsNotFound",
                    "error_params": {
                        "missing": ", ".join(missing_fields),
                        "available": str(available),
                    },
                }

            if row_count == 0:
                return {
                    "status": "error",
                    "error_message": "Output DataFrame is empty (0 rows). Check filters or data loading.",
                    "error_code": "agent.emptyDataframe",
                }

            output_table_name = self.workspace.get_fresh_name(f"d-{output_variable}")
            self.workspace.write_parquet(full_df, output_table_name)

            if row_count > max_display_rows:
                query_output = full_df.head(max_display_rows)
            else:
                query_output = full_df
            query_output = query_output.loc[:, ~query_output.columns.duplicated()]

            refined_goal = {
                "display_instruction": display_instruction,
                "title": title,
                "output_variable": output_variable,
                "output_fields": list(query_output.columns),
                "chart": chart_spec,
                "field_metadata": field_metadata,
                "field_display_names": field_display_names or {},
            }

            transform_result = {
                "status": "ok",
                # Backend-minted, run-stable chart id. Forwarded to the frontend
                # in the ``result`` event so it adopts this id verbatim — the same
                # id the agent can embed in a same-run report (``chart://<id>``)
                # and pass to ``inspect_chart``. NOT derived from the table name
                # (one table may back many charts).
                "chart_id": f"chart-{uuid.uuid4().hex[:12]}",
                "code": code,
                "content": {
                    "rows": df_to_safe_records(query_output),
                    "virtual": {
                        "table_name": output_table_name,
                        "row_count": row_count,
                    },
                },
                "refined_goal": refined_goal,
                "dialog": self._snapshot_dialog(messages),
                "agent": "AnalystAgent",
            }

            return {
                "status": "ok",
                "transform_result": transform_result,
            }

        except Exception as e:
            logger.error("[AnalystAgent] Visualize execution error", exc_info=e)
            return {"status": "error", "error_message": "Visualization execution failed"}

    # ------------------------------------------------------------------
    # Message construction
    # ------------------------------------------------------------------

    def _build_system_prompt(
        self,
        has_primary_tables: bool = False,
        has_focused_thread: bool = False,
        has_other_threads: bool = False,
        has_attached_images: bool = False,
        has_charts: bool = False,
    ) -> str:
        rules_block = ""
        if self.agent_exploration_rules and self.agent_exploration_rules.strip():
            rules_block = (
                "\n## Additional exploration rules\n\n"
                + self.agent_exploration_rules.strip()
                + "\n\nPlease follow the above rules when exploring data."
            )

        context_lines = []
        if has_primary_tables:
            context_lines.append(
                "- **[PRIMARY TABLE(S)]**: The table(s) the user is focused on. "
                "Prioritize these, but freely use other available tables if needed."
            )
            context_lines.append(
                "- **[OTHER AVAILABLE TABLES]**: Additional tables in the workspace."
            )
        else:
            context_lines.append(
                "- **[AVAILABLE TABLES]**: All tables in the workspace."
            )
        context_lines.append(
            "  Use `inspect_source_data` to get detailed stats and sample rows. "
            "Use `execute_python_script` for custom computations."
        )
        if has_focused_thread:
            context_lines.append(
                "- **[FOCUSED THREAD]**: The thread the user is continuing. "
                "Build on this — do not repeat visualizations already created here."
            )
        if has_other_threads:
            context_lines.append(
                "- **[OTHER THREADS]**: Brief summaries of other exploration threads in this workspace. "
            )
        if has_charts:
            context_lines.append(
                "- **[AVAILABLE CHARTS]**: Charts the user already created (with their "
                "ids, types, and encodings). These already exist — build on them or "
                "reference them; do not re-create an equivalent chart. When asked to "
                "write up / summarize / report on the exploration, load the `report` "
                "skill and embed these by id rather than producing new visualizations."
            )
        if has_attached_images:
            context_lines.append(
                "- **[USER ATTACHMENT(S)]**: Image(s) provided by the user. "
                "Refer to these when relevant to the user's question."
            )
        context_guide = "\n".join(context_lines)

        # The skill catalog is static capability config (fixed at agent build,
        # independent of the user's question), so it belongs in the frame next to
        # the skills mechanism — not in the per-run user message. The only truly
        # dynamic skill data is a loaded skill body, which arrives as a
        # ``load_skill`` tool result.
        skills_block = self.registry.render_registry_block() or "_(no loadable skills)_"

        # Fill the system frame's slots via plain substitution (brace-safe: any
        # other braces in the text stay literal). The frame is the agent's own
        # contract — identity, tools-vs-actions, skills mechanism, budget.
        substitutions = {
            "{context_guide}": context_guide,
            "{skills_block}": skills_block,
            "{max_iterations}": str(self.max_iterations),
            "{agent_exploration_rules}": rules_block,
        }
        prompt = SYSTEM_PROMPT
        for slot, value in substitutions.items():
            prompt = prompt.replace(slot, value)

        # Append the always-loaded ``core`` skill's capability body (the concrete
        # tools + action schemas). It is plain content — no placeholders — and is
        # framed with the same ``[SKILL: <name>]`` header as on-demand skills (see
        # _load_skill_into_context) so every capability bundle reads as one family:
        # core is the always-active baseline, gated skills announce themselves when
        # loaded.
        core_body = self.registry.load_body(_CORE_SKILL)
        prompt += (
            f"\n\n[SKILL: {_CORE_SKILL}] Always-on baseline — these tools and "
            f"actions are active for the whole run.\n\n{core_body}"
        )

        if self._knowledge_store:
            knowledge_rules = self._knowledge_store.load_always_apply_rules()
            self._injected_rules = [r["title"] for r in knowledge_rules]
            prompt += self._knowledge_store.format_rules_block(knowledge_rules)
        else:
            self._injected_rules = []

        if self.agent_coding_rules and self.agent_coding_rules.strip():
            prompt += (
                "\n\n## Agent Coding Rules\n\n"
                + self.agent_coding_rules.strip()
            )

        if self.language_instruction:
            prompt = prompt + "\n\n" + self.language_instruction
        return prompt

    def _build_initial_messages(
        self,
        input_tables: list[dict[str, Any]],
        user_question: str,
        focused_thread: list[dict[str, Any]] | None = None,
        other_threads: list[dict[str, Any]] | None = None,
        primary_tables: list[str] | None = None,
        attached_images: list[str] | None = None,
        charts: list[dict[str, Any]] | None = None,
    ) -> list[dict]:
        """Build the initial messages with 3-tier context."""
        table_summaries = self._build_lightweight_table_context(input_tables, primary_tables=primary_tables)

        focused_block = ""
        if focused_thread:
            focused_block = self._build_focused_thread_context(focused_thread)

        peripheral_block = ""
        if other_threads:
            peripheral_block = self._build_peripheral_thread_context(other_threads)

        if primary_tables:
            user_content = f"{table_summaries}\n\n"
        else:
            user_content = f"[AVAILABLE TABLES]\n\n{table_summaries}\n\n"
        if focused_block:
            user_content += f"{focused_block}\n\n"
        if peripheral_block:
            user_content += f"{peripheral_block}\n\n"

        # Surface the charts the user already created so the agent treats them as
        # existing material — to build on, reference, or report from — rather than
        # re-creating them. The chart_ids here are exactly what the report skill's
        # ``inspect_chart`` / ``![caption](chart://chart_id)`` embeds expect.
        charts_block = self._build_available_charts_context(charts)
        if charts_block:
            user_content += f"{charts_block}\n\n"

        self._injected_knowledge = []
        if self._knowledge_store:
            always_apply_rules = self._knowledge_store.load_always_apply_rules()
            if always_apply_rules:
                rules_text = "\n\n".join([f"### {r['title']}\n{r['body']}" for r in always_apply_rules])
                user_content += f"[USER RULES - MUST FOLLOW]\n\n{rules_text}\n\n"

        user_content += f"[USER QUESTION]\n\n{user_question}"

        system_prompt = self._build_system_prompt(
            has_primary_tables=bool(primary_tables),
            has_focused_thread=bool(focused_thread),
            has_other_threads=bool(other_threads),
            has_attached_images=bool(attached_images),
            has_charts=bool(charts_block),
        )

        has_images = bool(attached_images) and len(attached_images) > 0

        if has_images:
            content_parts: list[dict] = [{"type": "text", "text": user_content}]
            label = "[USER ATTACHMENT]" if len(attached_images) == 1 else "[USER ATTACHMENTS]"
            content_parts.append({"type": "text", "text": f"\n{label} (image(s) provided by the user):"})
            for img in attached_images:
                if img.startswith("data:"):
                    content_parts.append({"type": "image_url", "image_url": {"url": img, "detail": "low"}})
            return [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content_parts},
            ]
        else:
            return [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ]

    def _build_focused_thread_context(
        self, focused_thread: list[dict[str, Any]]
    ) -> str:
        return build_focused_thread_context(focused_thread)

    def _build_peripheral_thread_context(
        self, other_threads: list[dict[str, Any]]
    ) -> str:
        return build_peripheral_thread_context(other_threads)

    @staticmethod
    def _build_available_charts_context(
        charts: list[dict[str, Any]] | None,
    ) -> str:
        """Render the ``[AVAILABLE CHARTS]`` block from the chart descriptors.

        Mirrors the legacy report agent's listing (id, type, encodings, table
        ref) so chart_ids stay stable across the run — the report skill's
        ``inspect_chart`` and ``chart://chart_id`` embeds reference these ids.
        Returns ``""`` when there are no charts.
        """
        if not charts:
            return ""
        lines = ["[AVAILABLE CHARTS]"]
        for c in charts:
            chart_id = c.get("chart_id")
            if not chart_id:
                continue
            enc_str = ", ".join(
                f"{k}: {v}" for k, v in (c.get("encodings") or {}).items() if v
            )
            lines.append(
                f"  - {chart_id}: {c.get('chart_type', 'Unknown')}"
                + (f" ({enc_str})" if enc_str else "")
                + f" → table: {c.get('table_ref', '?')}"
            )
        return "\n".join(lines) if len(lines) > 1 else ""

    def _build_lightweight_table_context(
        self, input_tables: list[dict[str, Any]], primary_tables: list[str] | None = None
    ) -> str:
        return build_lightweight_table_context(
            input_tables,
            self.workspace,
            primary_tables,
        )

    # ------------------------------------------------------------------
    # LLM interaction (with internal tool-calling loop)
    # ------------------------------------------------------------------

    def _get_next_action(
        self,
        trajectory: list[dict],
        input_tables: list[dict[str, Any]] | None = None,
        outer_iteration: int = 0,
    ) -> Generator[dict[str, Any], None, None]:
        """Call the LLM with tools, run the inspection tool rounds internally,
        and surface the single committing action the turn ends with (as an
        ``agent_action`` event)."""
        max_tool_rounds = 12
        max_json_retries = 1
        json_retries = 0
        messages = trajectory
        llm_calls_in_cycle = 0

        rlog = self._reasoning_log

        from data_formulator.sandbox.local_sandbox import SandboxSession
        ns_dir = self._explore_ns_dir()
        ws_path = str(self.workspace.confined_scratch.root.parent)

        with SandboxSession() as explore_session:
            self._explore_session = explore_session

            if ns_dir.exists():
                ok = SandboxSession.restore_namespace(explore_session, ns_dir, ws_path)
                if ok:
                    logger.info("[AnalystAgent] Restored explore namespace from %s", ns_dir)
                import shutil
                shutil.rmtree(ns_dir, ignore_errors=True)

            self._tool_loop_exit_reason = None
            yield from self._tool_loop(
                messages, max_tool_rounds, max_json_retries, json_retries,
                llm_calls_in_cycle, rlog, input_tables, outer_iteration,
            )

            if self._tool_loop_exit_reason == "tool_rounds_exhausted":
                saved = explore_session.save_namespace(ns_dir, ws_path)
                if saved:
                    logger.info("[AnalystAgent] Saved explore namespace to %s", ns_dir)

            self._explore_session = None

    def _current_tools(self) -> list[dict[str, Any]]:
        """The tool set offered this turn: inspection tools (core tools +
        load_skill + loaded skills' tools) plus the committing **action**
        tools of loaded skills (core's visualize/delegate always; write_report
        once the report skill is loaded). The model gathers with inspection tools
        and acts with at most one action per turn."""
        extra_tools = self.registry.tools_for(self._loaded_skills)
        action_tools = self.registry.action_tools_for(self._loaded_skills)
        return build_tools(
            self.registry.gated_skill_names(),
            extra_tools,
            action_tools=action_tools,
        )

    def _loaded_skill_tool_map(self) -> dict[str, Any]:
        """Map ``tool_name -> skill instance`` for inspection tools unlocked by
        loaded skills. Tool names come from the registry's ``tools.json`` specs;
        the value is the skill processor that handles them."""
        mapping: dict[str, Any] = {}
        for name in self._loaded_skills:
            skill = self.registry.get_skill(name)
            if skill is None:
                continue
            for spec in self.registry.tools_for([name]):
                fn_name = spec.get("function", {}).get("name")
                if fn_name:
                    mapping[fn_name] = skill
        return mapping

    def _tool_loop(
        self,
        messages, max_tool_rounds, max_json_retries, json_retries,
        llm_calls_in_cycle, rlog, input_tables, outer_iteration,
    ):
        """Inner tool-calling loop, wrapped by _get_next_action in a
        SandboxSession context manager."""
        for round_idx in range(max_tool_rounds):
            llm_calls_in_cycle += 1
            tools = self._current_tools()
            rlog.log("llm_request", iteration=outer_iteration,
                     round=round_idx + 1,
                     messages_count=len(messages),
                     tools_available=[t["function"]["name"] for t in tools])
            llm_t0 = time.time()
            try:
                response = yield from self._stream_llm(messages, tools)
            except Exception as exc:
                llm_latency = int((time.time() - llm_t0) * 1000)
                rlog.log("llm_response", iteration=outer_iteration,
                         round=round_idx + 1,
                         latency_ms=llm_latency, finish_reason="error",
                         error=type(exc).__name__)
                logger.error("[AnalystAgent] LLM call failed", exc_info=exc)
                from data_formulator.security.sanitize import classify_llm_error
                yield {
                    "type": "agent_action",
                    "action_data": None,
                    "reason": "llm_error",
                    "error_message": classify_llm_error(exc),
                    "llm_calls": llm_calls_in_cycle,
                }
                return

            llm_latency = int((time.time() - llm_t0) * 1000)

            if not response.choices:
                rlog.log("llm_response", iteration=outer_iteration,
                         round=round_idx + 1,
                         latency_ms=llm_latency, finish_reason="empty")
                yield {"type": "agent_action", "action_data": None, "reason": "llm_error",
                       "error_message": "LLM returned empty response",
                       "llm_calls": llm_calls_in_cycle}
                return

            choice = response.choices[0]
            content = choice.message.content or ""
            tool_calls = getattr(choice.message, 'tool_calls', None)
            finish_reason = getattr(choice, "finish_reason", "stop")

            if tool_calls:
                rlog.log("llm_response", iteration=outer_iteration,
                         round=round_idx + 1,
                         latency_ms=llm_latency, finish_reason="tool_calls",
                         tool_calls=[{"name": tc.function.name} for tc in tool_calls])
            else:
                rlog.log("llm_response", iteration=outer_iteration,
                         round=round_idx + 1,
                         latency_ms=llm_latency, finish_reason=finish_reason)

            # --- tool calls: partition into committing actions vs inspection ---
            if tool_calls:
                if content.strip():
                    yield {"type": "thinking_text", "content": content.strip()}

                # A committing action is a tool call (visualize / delegate /
                # write_report). Inspection tools (explore /
                # inspect_source_data / inspect_chart / load_skill) gather. A turn
                # ends with exactly ONE action; the harness enforces that here.
                action_names = self.registry.action_names()
                action_calls = [tc for tc in tool_calls
                                if tc.function.name in action_names]
                readonly_calls = [tc for tc in tool_calls
                                  if tc.function.name not in action_names]

                # ── Action present → cardinality guard (first-wins) ───────────
                if action_calls:
                    committed = yield from self._commit_action(
                        action_calls, readonly_calls, messages, content, choice,
                        rlog, outer_iteration, llm_calls_in_cycle,
                    )
                    if committed:
                        return
                    # Not committed (e.g. missing required fields) → a correction
                    # tool-result was appended; loop and let the model retry.
                    continue

                # ── Only inspection tools → execute all and loop ───────────────
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": content or None,
                }
                attach_reasoning_content(assistant_msg, choice.message)
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in readonly_calls
                ]
                messages.append(assistant_msg)

                # Tools unlocked by currently-loaded skills (name -> instance).
                skill_tool_owners = self._loaded_skill_tool_map()
                # Images returned by skill tools are attached as a single
                # follow-up vision message after all tool results this round.
                pending_images: list[str] = []
                # Skill bodies unlocked via load_skill this round. They are
                # `user` turns and MUST land AFTER every tool result — an
                # assistant `tool_calls` turn must be immediately followed by its
                # tool responses (Azure/OpenAI reject any other message in
                # between). So we defer them past the per-tc loop.
                pending_skill_bodies: list[dict] = []

                for tc in readonly_calls:
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        tool_args = {}

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

                    if tool_name == "execute_python_script":
                        result = self._run_explore_code(
                            tool_args.get("code", ""),
                            input_tables or [],
                        )
                        tool_content = result.get("stdout", "")
                        tool_status = result.get("status", "ok")
                        if result.get("error"):
                            tool_content += f"\n\nError: {result['error']}"
                        yield {
                            "type": "tool_result",
                            "tool": tool_name,
                            "status": tool_status,
                            "stdout": result.get("stdout", ""),
                            "error": result.get("error"),
                        }
                    elif tool_name == "inspect_source_data":
                        table_names = tool_args.get("table_names", [])
                        tool_content = handle_inspect_source_data(
                            table_names, input_tables or [], self.workspace,
                        )
                        yield {
                            "type": "tool_result",
                            "tool": tool_name,
                            "status": "ok",
                            "stdout": tool_content,
                        }
                    elif tool_name == "load_skill":
                        skill_name = tool_args.get("name", "")
                        ok, message, body_msg = self._build_skill_body_message(skill_name)
                        tool_status = "ok" if ok else "error"
                        tool_content = message
                        # The skill body is a `user` turn that must be appended
                        # AFTER this round's tool results (see pending_skill_bodies);
                        # the tool result here just confirms the load.
                        if ok and body_msg is not None:
                            pending_skill_bodies.append(body_msg)
                        if ok:
                            yield {
                                "type": "skill_loaded",
                                "skill": skill_name,
                                "unlocks": list(
                                    self.registry.metas[skill_name].action_names
                                ) if self.registry.has(skill_name) else [],
                            }
                        yield {
                            "type": "tool_result",
                            "tool": tool_name,
                            "status": tool_status,
                            "stdout": message,
                            "error": None if ok else message,
                        }
                    elif tool_name in skill_tool_owners:
                        skill = skill_tool_owners[tool_name]
                        skill_ctx = SkillContext(
                            client=self.client,
                            workspace=self.workspace,
                            language_instruction=self.language_instruction,
                            trajectory=messages,
                            payload=dict(self._run_payload),
                        )
                        try:
                            result = skill.handle_tool(tool_name, tool_args, skill_ctx)
                        except Exception as exc:
                            logger.warning("[AnalystAgent] Skill tool %r failed", tool_name, exc_info=exc)
                            result = ToolResult(text=f"Tool '{tool_name}' failed: {exc}")
                            tool_status = "error"
                        tool_content = result.text
                        if result.images:
                            pending_images.extend(result.images)
                        yield {
                            "type": "tool_result",
                            "tool": tool_name,
                            "status": tool_status,
                            "stdout": tool_content,
                        }
                    else:
                        tool_content = f"Unknown tool: {tool_name}"

                    tool_latency = int((time.time() - tool_t0) * 1000)
                    output_summary = (tool_content[:200] + "...") if len(tool_content) > 200 else tool_content
                    rlog.log("tool_execution", iteration=outer_iteration,
                             tool=tool_name,
                             input_summary=tool_args.get("purpose", "")[:200],
                             output_summary=output_summary,
                             latency_ms=tool_latency, status=tool_status)

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_content,
                    })

                # Attach any skill-tool images as a single follow-up vision turn
                # (tool-result messages can't carry image content on most providers).
                if pending_images:
                    image_blocks: list[dict[str, Any]] = [{
                        "type": "text",
                        "text": (
                            "[INSPECTED IMAGE(S)] Rendered images for the tool "
                            "call(s) you just made, in request order:"
                        ),
                    }]
                    for url in pending_images:
                        image_blocks.append({
                            "type": "image_url",
                            "image_url": {"url": url, "detail": "high"},
                        })
                    messages.append({"role": "user", "content": image_blocks})

                # Now that every tool result is in place, land any skill bodies
                # unlocked this round (deferred so the assistant tool_calls turn
                # stays immediately followed by its tool responses).
                for body_msg in pending_skill_bodies:
                    messages.append(body_msg)

                logger.info("[AnalystAgent] Executed %d inspection tool call(s), looping back to LLM", len(readonly_calls))
                continue

            # --- no tool calls — the model gave a plain-text answer ----------
            # In this turn model, committing no action is the NORMAL way to end
            # the run: the agent has nothing more to do and answers in prose.
            # That final text is the run's completion (the frontend renders it
            # as the summary). Record it as a plain assistant turn and signal
            # "done" to the outer loop.
            logger.info("[AnalystAgent] No action committed; final text ends the run")
            final_msg: dict[str, Any] = {"role": "assistant", "content": content or None}
            attach_reasoning_content(final_msg, choice.message)
            messages.append(final_msg)
            yield {"type": "agent_action", "action_data": None, "reason": "done",
                   "final_text": content.strip(), "llm_calls": llm_calls_in_cycle}
            return

        # --- tool rounds exhausted ---
        logger.warning("[AnalystAgent] Exceeded %d tool rounds without committing an action", max_tool_rounds)
        self._tool_loop_exit_reason = "tool_rounds_exhausted"
        yield {"type": "agent_action", "action_data": None, "reason": "tool_rounds_exhausted",
               "llm_calls": llm_calls_in_cycle}
        return

    def _commit_action(
        self,
        action_calls: list,
        readonly_calls: list,
        messages: list[dict],
        content: str,
        choice,
        rlog,
        outer_iteration: int,
        llm_calls_in_cycle: int,
    ) -> Generator[Event, None, bool]:
        """Apply the one-action-per-turn cardinality guard and commit.

        A turn ends with exactly one committing action. When the model emits
        more than one action (or mixes an action with inspection calls in the
        same response), we take the **first** action and discard the rest —
        first-wins, never reject-the-whole-turn (mirrors Claude's
        serialize-don't-refuse). The trajectory is kept provider-valid by
        recording an assistant message carrying *only* the chosen action's
        tool call (so there are no orphaned ``tool_calls`` to answer), plus its
        single ``ok`` tool result; any drop is noted so the model learns the
        rule.

        Yields the ``agent_action`` event with the chosen action's arguments
        (the ``run`` loop then gates + dispatches it to the owning skill) and
        returns ``True`` when committed. Returns ``False`` without committing if
        the chosen action is missing required fields — after appending a
        correction so the caller can loop and let the model retry.
        """
        chosen = action_calls[0]
        chosen_name = chosen.function.name
        dropped_actions = [tc.function.name for tc in action_calls[1:]]
        dropped_readonly = [tc.function.name for tc in readonly_calls]

        try:
            action_data = json.loads(chosen.function.arguments)
        except json.JSONDecodeError:
            action_data = {}
        if not isinstance(action_data, dict):
            action_data = {}
        _rescue_unpack_json_strings(action_data)
        action_data["action"] = chosen_name

        # Record the commitment as an assistant turn carrying ONLY the chosen
        # action's tool call — dropping siblings keeps the trajectory valid for
        # any disposition (a CONTINUE action will make another LLM call).
        assistant_msg: dict[str, Any] = {"role": "assistant", "content": content or None}
        attach_reasoning_content(assistant_msg, choice.message)
        assistant_msg["tool_calls"] = [{
            "id": chosen.id,
            "type": "function",
            "function": {
                "name": chosen_name,
                "arguments": chosen.function.arguments,
            },
        }]
        messages.append(assistant_msg)

        # Pre-dispatch completeness check (belt-and-suspenders on top of the
        # skill handler's own validation). Missing fields → correct + retry.
        required = self.registry.action_required_fields(chosen_name)
        missing = [f for f in required if not action_data.get(f)]
        if missing:
            correction = (
                f"The '{chosen_name}' action is missing required field(s): "
                f"{', '.join(missing)}. Call it again with those fields filled in."
            )
            messages.append({
                "role": "tool",
                "tool_call_id": chosen.id,
                "content": f"ERROR: {correction}",
            })
            rlog.log("tool_execution", iteration=outer_iteration, tool=chosen_name,
                     input_summary="action_missing_fields",
                     output_summary=", ".join(missing), latency_ms=0, status="error")
            logger.warning("[AnalystAgent] Action '%s' missing fields %s, requesting retry",
                           chosen_name, missing)
            yield {"type": "tool_result", "tool": chosen_name, "status": "error",
                   "error": f"Missing fields: {', '.join(missing)}"}
            return False

        # Answer the action's tool call with a placeholder so the trajectory is
        # well-formed during dispatch; the run loop overwrites this with the
        # skill's observation (see _set_action_observation) once the action has
        # rendered. This is what makes an action's result ride the same lane as
        # an inspection tool result.
        messages.append({
            "role": "tool",
            "tool_call_id": chosen.id,
            "content": "",
        })

        # If we dropped anything, teach the one-action rule so the model
        # converges (the note rides along on the next CONTINUE turn's context).
        if dropped_actions or dropped_readonly:
            dropped_desc: list[str] = []
            if dropped_actions:
                dropped_desc.append(
                    f"additional action call(s) ({', '.join(dropped_actions)})"
                )
            if dropped_readonly:
                dropped_desc.append(
                    f"inspection call(s) ({', '.join(dropped_readonly)}) made alongside it"
                )
            messages.append({
                "role": "user",
                "content": (
                    f"[SYSTEM] A turn commits exactly one action. Kept "
                    f"'{chosen_name}'; ignored {' and '.join(dropped_desc)}. Do any "
                    "inspection in its own round before the action, and "
                    "emit only one action per turn."
                ),
            })
            logger.info(
                "[AnalystAgent] Cardinality guard: kept '%s', dropped actions=%s readonly=%s",
                chosen_name, dropped_actions, dropped_readonly,
            )

        rlog.log("tool_execution", iteration=outer_iteration, tool=chosen_name,
                 input_summary="action_committed", output_summary="ok",
                 latency_ms=0, status="ok")
        yield {"type": "agent_action", "action_data": action_data, "reason": "ok",
               "tool_call_id": chosen.id, "llm_calls": llm_calls_in_cycle}
        return True

    _MAX_LLM_RETRIES = 3

    @staticmethod
    def _is_transient_error(exc: Exception) -> bool:
        msg = str(exc).lower()
        if any(kw in msg for kw in (
            "timeout", "timed out", "rate limit", "rate_limit",
            "429", "503", "502", "connection", "reset by peer",
        )):
            return True
        name = type(exc).__name__.lower()
        return any(kw in name for kw in ("timeout", "ratelimit", "connection"))

    def _open_stream(self, messages: list[dict], tools: list[dict]):
        """Open a *streaming* LLM call with tool definitions, retrying on
        transient errors *before* any tokens are consumed.

        ``stream=True`` is what makes live report streaming possible: the loop's
        LLM call always streams, and the agent forwards a streaming action's
        argument as it arrives (design-docs/36 §5). ``parallel_tool_calls=False``
        forces one tool call per response — the structural backstop for the
        one-action-per-turn rule: actions are sequential (each result shapes the
        next), so the model must never batch them. It also serializes inspection
        tools — a minor extra round-trip — an acceptable trade for never silently
        dropping batched actions. Providers that don't support the flag drop it
        (``drop_params=True``); the first-wins cardinality guard remains as a
        belt-and-suspenders net.
        """
        last_exc: Exception | None = None
        for attempt in range(self._MAX_LLM_RETRIES):
            try:
                return self.client.get_completion_with_tools(
                    messages, tools=tools, stream=True,
                    reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model),
                    parallel_tool_calls=False,
                )
            except Exception as e:
                last_exc = e
                if self._is_transient_error(e) and attempt < self._MAX_LLM_RETRIES - 1:
                    wait = 2 ** attempt
                    logger.warning(
                        "[AnalystAgent] Transient LLM error (attempt %d/%d), "
                        "retrying in %ds: %s",
                        attempt + 1, self._MAX_LLM_RETRIES, wait, e,
                    )
                    time.sleep(wait)
                    continue
                raise
        raise last_exc  # pragma: no cover

    def _stream_llm(
        self, messages: list[dict], tools: list[dict],
    ) -> Generator[Event, None, Any]:
        """Stream the LLM call, forwarding any *streaming* action's argument live,
        and return a reconstructed non-streaming-shaped response for the loop.

        The agent owns this generic forwarding envelope (design-docs/36 §5): it
        accumulates content / reasoning / tool-call deltas exactly as a buffered
        call would, but when a tool call's name is a streaming action (per
        ``registry.action_stream_spec``) it emits the action's ``action`` event
        once and then forwards the growing ``stream_field`` argument as
        ``text_delta``s on the skill's declared channel as the tokens arrive.
        The reconstructed response carries the *full* assembled tool calls, so
        the downstream partition / commit / dispatch path is byte-for-byte the
        same as the old buffered call — the only difference is that the report's
        text reached the frontend live. The skill's later (buffered) re-emission
        of the same content is suppressed by the router (see ``run`` /
        ``_route_skill_events``); on a provider without tool-arg streaming nothing
        is forwarded here and the buffered path delivers it instead.
        """
        # Each LLM call starts a fresh streamed-channel map; only the round that
        # actually commits a streaming action leaves an entry for the run loop.
        self._streamed_channels = {}

        stream = self._open_stream(messages, tools)

        content_parts: list[str] = []
        reasoning_acc: str | None = None
        finish_reason = "stop"
        # idx -> {"id", "name", "arguments"}
        tool_calls_acc: dict[int, dict[str, Any]] = {}
        # idx -> {"active", "channel", "extractor", "announced"} for streaming actions
        streamers: dict[int, dict[str, Any]] = {}

        for chunk in stream:
            if not getattr(chunk, "choices", None):
                continue
            choice0 = chunk.choices[0]
            delta = getattr(choice0, "delta", None)
            if delta is None:
                continue
            if getattr(choice0, "finish_reason", None):
                finish_reason = choice0.finish_reason

            reasoning_acc = accumulate_reasoning_content(reasoning_acc, delta)

            content = getattr(delta, "content", None)
            if content:
                content_parts.append(content)

            for tcd in getattr(delta, "tool_calls", None) or []:
                idx = getattr(tcd, "index", 0) or 0
                slot = tool_calls_acc.setdefault(
                    idx, {"id": None, "name": "", "arguments": ""},
                )
                if getattr(tcd, "id", None):
                    slot["id"] = tcd.id
                fn = getattr(tcd, "function", None)
                if fn is not None:
                    if getattr(fn, "name", None):
                        slot["name"] = fn.name
                    arg_delta = getattr(fn, "arguments", None)
                    if arg_delta:
                        slot["arguments"] += arg_delta
                yield from self._forward_stream_delta(slot, streamers)

        # Reconstruct a non-streaming-shaped response for the loop.
        tool_call_objs: list[Any] = []
        for i in sorted(tool_calls_acc):
            tc = tool_calls_acc[i]
            tool_call_objs.append(SimpleNamespace(
                id=tc["id"] or f"call_{i}",
                type="function",
                function=SimpleNamespace(name=tc["name"], arguments=tc["arguments"]),
            ))
        message = SimpleNamespace(
            content="".join(content_parts) or None,
            tool_calls=tool_call_objs or None,
            reasoning_content=reasoning_acc,
        )
        choice = SimpleNamespace(message=message, finish_reason=finish_reason)
        return SimpleNamespace(choices=[choice])

    def _forward_stream_delta(
        self, slot: dict[str, Any], streamers: dict[int, dict[str, Any]],
    ) -> Generator[Event, None, None]:
        """Forward a streaming action's growing argument as channel ``text_delta``s.

        Decides once per tool-call slot whether it is a streaming action (by
        name, via the registry); if so, emits the ``action`` commitment event the
        first time and then surfaces newly-decoded ``stream_field`` text as it
        arrives. No-ops for buffered actions and inspection tools.
        """
        name = slot.get("name") or ""
        if not name:
            return
        idx = id(slot)  # stable key for this slot within the call
        st = streamers.get(idx)
        if st is None:
            spec = self.registry.action_stream_spec(name)
            if spec is None:
                streamers[idx] = {"active": False}
                return
            field, channel = spec
            st = {
                "active": True,
                "channel": channel,
                "extractor": _StreamingArgExtractor(field),
                "announced": False,
            }
            streamers[idx] = st
        if not st["active"]:
            return

        if not st["announced"]:
            # Preserve the buffered order (action first, then report text).
            yield {"type": "action", "action": name}
            st["announced"] = True

        new_text = st["extractor"].feed(slot["arguments"])
        if new_text:
            yield {"type": "text_delta", "channel": st["channel"], "content": new_text}
            tcid = slot.get("id")
            if tcid:
                self._streamed_channels[tcid] = st["channel"]


    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_images(trajectory: list[dict]) -> list[dict]:
        """Return a copy of the trajectory with image_url blocks removed."""
        stripped: list[dict] = []
        for msg in trajectory:
            content = msg.get("content")
            if isinstance(content, list):
                text_parts = [p for p in content if p.get("type") == "text"]
                if text_parts:
                    stripped.append({**msg, "content": text_parts})
                else:
                    stripped.append({**msg, "content": "[image removed]"})
            else:
                stripped.append(msg)
        return stripped

    @staticmethod
    def _log_session_end(
        rlog,
        status: str,
        total_iterations: int,
        total_llm_calls: int,
        session_start_time: float,
    ) -> None:
        """Write ``session_end`` to the reasoning log (does not close it)."""
        rlog.log(
            "session_end",
            status=status,
            total_iterations=total_iterations,
            total_llm_calls=total_llm_calls,
            total_latency_ms=int((time.time() - session_start_time) * 1000),
        )

    @staticmethod
    def _error_event(
        iteration: int,
        message: str,
        *,
        display_instruction: str = "",
        message_code: str = "",
        message_params: dict | None = None,
    ) -> dict[str, Any]:
        """Build an ``"error"`` event dict for the streaming response."""
        event: dict[str, Any] = {
            "type": "error",
            "iteration": iteration,
            "message": message,
        }
        if message_code:
            event["message_code"] = message_code
        if message_params:
            event["message_params"] = message_params
        if display_instruction:
            event["display_instruction"] = display_instruction
        return event

    @staticmethod
    def _snapshot_dialog(messages: list[dict] | None) -> list[dict]:
        """Snapshot the conversation for the Agent Log dialog."""
        if not messages:
            return []
        snapshot: list[dict] = []
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content")

            if isinstance(content, list):
                content = "\n".join(
                    p.get("text", "") for p in content if p.get("type") == "text"
                )

            if role == "assistant" and msg.get("tool_calls"):
                tool_details = []
                for tc in msg["tool_calls"]:
                    fn = tc.get("function", {})
                    name = fn.get("name", "?")
                    args_str = fn.get("arguments", "{}")
                    try:
                        args_obj = json.loads(args_str)
                        if name == "execute_python_script" and "code" in args_obj:
                            tool_details.append(f"[tool: {name}]\n```python\n{args_obj['code']}\n```")
                        else:
                            formatted = json.dumps(args_obj, indent=2, ensure_ascii=False)
                            tool_details.append(f"[tool: {name}]\n```json\n{formatted}\n```")
                    except (json.JSONDecodeError, TypeError):
                        tool_details.append(f"[tool: {name}]\n{args_str}")
                text_part = content or ""
                combined = (text_part + "\n\n" + "\n\n".join(tool_details)).strip()
                snapshot.append({"role": role, "content": combined})

            elif role == "tool":
                tool_content = content or ""
                if isinstance(tool_content, str) and len(tool_content) > 3000:
                    tool_content = tool_content[:3000] + "\n... (truncated)"
                snapshot.append({"role": "assistant", "content": f"[tool result]\n{tool_content}"})

            elif content:
                if role != "system" and isinstance(content, str) and len(content) > 4000:
                    content = content[:4000] + "\n... (truncated)"
                snapshot.append({"role": role, "content": content})
        return snapshot
