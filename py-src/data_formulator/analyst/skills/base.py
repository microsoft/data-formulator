# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Skill protocol and shared types for the analyst agent.

A *skill* is a passive plugin the single analyst agent can switch on. It never
runs its own agent loop; instead it contributes:
  1. a ``SKILL.md`` doc (frontmatter + how-to body) — progressive disclosure,
  2. zero or more **tools** the model may call once the skill is loaded,
  3. zero or more **gated actions** it unlocks, and
  4. **handlers** (``handle_tool`` / ``handle_action``) that perform any
     compute / rendering and yield channel-tagged events.

The shell stays skill-agnostic: it merges a loaded skill's tools into the
model's tool list, opens the gate for its actions, routes tool calls to
``handle_tool`` and emitted actions to ``handle_action``, and forwards whatever
events come back. "Loading" a skill controls only *exposure to the model* — the
skill's Python is always imported and callable.

Two output channels, never crossed:
  * **frontend** — a handler *yields* ``Event``s. A skill never yields straight
    to the user; it yields to the **agent**, whose router (see the shell's
    ``_route_skill_events``) is the single place that forwards / stamps /
    enriches / could drop each event before it reaches the stream. Yielding is
    how streaming works: the route consumes ``agent.run()`` as a synchronous
    generator, so nested output must propagate up via ``yield from``.
  * **agent loop** — a handler *returns* an ``observation`` string (or ``None``):
    LLM-facing feedback that the shell appends to the trajectory as the action's
    tool-call result, exactly like an inspection tool's output. There is no
    control verdict — the agent simply reads the result and decides its next
    move (commit another action, or stop by answering). A recoverable failure is
    just an observation describing what went wrong; the agent re-decides freely.

Frontend payloads therefore live in yielded events, never in the returned
observation; the ``observation`` is LLM-facing trajectory text, never shown to
the user.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generator, Protocol, runtime_checkable

# An ``Event`` is a channel-tagged dict yielded on the unified output stream.
# See design-docs/35 §5. Examples:
#   {"type": "text_delta", "channel": "report", "content": "..."}
#   {"type": "tool_start", "tool": "inspect_chart", ...}
#   {"type": "action", "action": "visualize", ...}
#   {"type": "result", ...}
#   {"type": "completion", ...}
# A committing action (visualize / delegate / write_report) is dispatched from a
# committing tool call and yields these same events; see design-docs/36.
Event = dict[str, Any]


@dataclass(frozen=True)
class SkillMeta:
    """A skill's frontmatter — the cheap, always-resident registry entry.

    Mirrors Anthropic Agent Skills tier-1 disclosure: only ``name`` and
    ``description`` (plus an optional ``when_to_use``) are kept resident in the
    base prompt so the model knows *when* to reach for the skill; the body is
    loaded on demand via the ``load_skill`` tool.
    """

    name: str
    description: str
    when_to_use: str = ""
    # ``always_on`` skills (e.g. visualization) are pre-loaded and their actions
    # are never gated. Everything else loads dynamically.
    always_on: bool = False
    # The inspection **tool** names this skill exposes (data gathering, no turn
    # commit). Declared in the ``SKILL.md`` frontmatter (``tools: [inspect_chart]``)
    # so the frontmatter is the complete, symmetric surface declaration; the
    # matching JSON schemas live in ``tools.json``.
    tool_names: tuple[str, ...] = ()
    # The gated **action** names this skill unlocks once loaded. Declared in the
    # ``SKILL.md`` frontmatter (``actions: [write_report]``) so the shell can
    # build its legal-action set from tier-1 metadata alone — without importing
    # the skill's code module.
    action_names: tuple[str, ...] = ()


@dataclass
class SkillContext:
    """Shared handles + per-turn state passed to a skill handler.

    Carries the substrate a handler needs (LLM client, workspace, language
    instruction) plus the live trajectory and any data the action operates on.
    Skills read from here rather than reaching into the agent shell.
    """

    client: Any
    workspace: Any
    language_instruction: str = ""
    # The running message trajectory (read/append as the handler streams).
    trajectory: list[dict] = field(default_factory=list)
    # Free-form per-turn payload (input tables, charts, etc.) the action needs.
    payload: dict[str, Any] = field(default_factory=dict)
    # Shell-provided execution substrate (sandbox-backed). Skills call back
    # through this for raw compute that the loop owns — e.g.
    # ``ctx.runtime.run_visualize_code(...)`` / ``run_explore_code(...)``. The
    # shell sets it to itself; ``None`` in standalone unit tests.
    runtime: Any = None


@dataclass(frozen=True)
class ToolResult:
    """Return value of a skill's ``handle_tool``.

    ``text`` is fed back to the model as the tool-result message. ``images``
    are base64 data-URLs (e.g. a rendered chart) that the shell attaches as a
    follow-up vision message, since tool-result messages cannot carry image
    content on most providers.
    """

    text: str = ""
    images: tuple[str, ...] = ()


@runtime_checkable
class Skill(Protocol):
    """A passive plugin the agent shell exposes once its skill is *loaded*.

    A skill never runs its own agent loop. It is a pure **processor**: two
    handlers that perform any compute / rendering. Its *declarative* surface —
    metadata (``SKILL.md`` frontmatter → ``SkillMeta``) and the inspection tool /
    committing action *schemas* (``tools.json``) — lives in data files the
    registry loads, not on the class. The frontmatter ``tools:`` / ``actions:``
    lists decide which schemas are inspection tools vs committing actions.

    The Python module is always imported and instantiated at registry build
    time; "loading" a skill only controls *exposure to the model*, never the
    availability of the code.
    """

    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        """Execute an inspection tool the model called. ``name`` is one of this
        skill's ``tools``; ``args`` is the parsed tool arguments. Parallel-safe;
        returns text (and optional images) for the model to read."""
        ...

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        """Dispatch a committing **action** the model emitted as a tool call:
        validate the arguments, run any compute / rendering, and yield
        channel-tagged events as it goes (result / delegate / text_delta / …).
        It then **returns** an ``observation`` string (or ``None``): LLM-facing
        feedback the shell appends to the trajectory as the action's tool-call
        result, exactly like an inspection tool's output.

        There is no control verdict. The agent reads the observation and decides
        its own next move — commit another action, or stop by giving its final
        answer (a turn with no action ends the run). A recoverable failure is
        just an observation describing what went wrong; the agent re-decides.

        Yielded events go to the **agent**, not the frontend: the shell's router
        forwards them (stamping ``iteration``, tracking steps) and is free to
        transform or drop any of them. Frontend output therefore lives only in
        these yields; the returned observation is never shown to the user.

        ``action`` is one of the skill's frontmatter ``actions:`` names; ``spec``
        is the parsed action tool-call arguments. Implement as a generator that
        ``return``s the observation; the shell captures it via ``yield from`` /
        ``StopIteration``.
        """
        ...


__all__ = [
    "Event",
    "Skill",
    "SkillContext",
    "SkillMeta",
    "ToolResult",
]
