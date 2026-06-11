# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Analyst agent — a single user-facing data agent hosting multiple skills.

This package unifies the former ``DataAgent`` (structured-action visualization
loop) and ``ReportGenAgent`` (streaming report writer) into one agent shell
that loads *skills* on demand. See ``design-docs/35-unified-agent-skills-
architecture.md`` for the full design.

Core ideas:
  - **Inspection tools** gather information and are parallel-safe; their results
    come back to the agent and are never shown to the user. The shell ships a
    small core set (``inspect_source_data``, ``execute_python_script``, ``load_skill``); a
    loaded skill may contribute additional tools (e.g. ``inspect_chart``).
  - **Actions** are committing surfaces — at most one per turn. Each returns an
    observation the shell feeds back as the action's tool-call result, so the
    agent reads it and decides its own next move. ``visualize`` / ``delegate``
    are core (always available); skill actions (``write_report``,
    ``restyle_chart``, …) are *gated* until their ``SKILL.md`` is loaded. The
    run ends when the model commits no action (its final plain text is the
    completion).
  - A **skill is a passive plugin**, not a mini-agent: it bundles its
    ``SKILL.md`` with optional ``tools`` + ``actions`` and the handlers
    (``handle_tool`` / ``handle_action``) that perform any compute / rendering.
    Its Python is always imported; ``load_skill`` only exposes it to the model.
"""

from data_formulator.analyst.skills import (
    Event,
    Skill,
    SkillContext,
    SkillMeta,
    SkillRegistry,
    ToolResult,
    build_registry,
)
from data_formulator.analyst.agent import AnalystAgent

__all__ = [
    "AnalystAgent",
    "Event",
    "Skill",
    "SkillContext",
    "SkillMeta",
    "SkillRegistry",
    "ToolResult",
    "build_registry",
]
