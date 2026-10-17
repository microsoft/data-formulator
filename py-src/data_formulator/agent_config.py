# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Single source of truth for per-agent execution and LLM call configuration.

Edit values here to tune latency vs. quality for each agent.

Per-agent overrides can also be set at runtime via environment variables:

    DF_REASONING_EFFORT_DATA_TRANSFORM=medium
    DF_REASONING_EFFORT_REPORT_GEN=high

Tiers
-----
- ``"minimal"`` — fastest. Honoured natively only on the OpenAI GPT-5
  base/mini/nano/5.x family (``gpt-5``, ``gpt-5-mini``, ``gpt-5-nano``,
  ``gpt-5.1``, ...). On the GPT-5 ``codex`` / ``pro`` variants
  :func:`reasoning_effort_for` maps it to ``"none"`` (their lightest
  supported tier). On every other reasoning model (o-series, Claude
  extended-thinking, Gemini, ...) it is downgraded to ``"low"``.
- ``"none"`` — only accepted by GPT-5 ``codex`` / ``pro``. Downgraded to
  ``"low"`` elsewhere.
- ``"low" | "medium" | "high"`` — portable across all reasoning providers via
  LiteLLM's normalisation
  (https://docs.litellm.ai/docs/reasoning_content).

Models that don't support reasoning at all silently drop the parameter
because the client is invoked with ``drop_params=True``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from math import isfinite
from typing import Literal

ReasoningEffort = Literal["none", "minimal", "low", "medium", "high"]
# Thinking levels a model setup may choose; unset means the per-agent defaults below.
MODEL_REASONING_LEVELS: tuple[str, ...] = ("low", "medium", "high")


@dataclass(frozen=True)
class AnalystExecutionConfig:
    """Provider retry configuration with legacy execution-count settings.

    Action, tool-round, and outer-iteration settings are retained for caller
    compatibility but no longer limit execution. Provider retries remain bounded.
    """

    max_actions: int = 10
    max_tool_rounds_per_action: int = 12
    empty_response_retries: int = 2
    empty_response_backoff_seconds: float = 3.0
    stream_open_retries: int = 2
    stream_open_backoff_seconds: float = 1.0
    outer_iteration_multiplier: int = 3
    min_outer_iterations: int = 12

    def __post_init__(self) -> None:
        for name in ("max_actions", "max_tool_rounds_per_action", "outer_iteration_multiplier", "min_outer_iterations"):
            value = getattr(self, name)
            if type(value) is not int or value < 1:
                raise ValueError(f"{name} must be a positive integer")
        for name in ("empty_response_retries", "stream_open_retries"):
            value = getattr(self, name)
            if type(value) is not int or value < 0:
                raise ValueError(f"{name} must be a non-negative integer")
        for name in ("empty_response_backoff_seconds", "stream_open_backoff_seconds"):
            value = getattr(self, name)
            if type(value) not in (int, float) or not isfinite(value) or value < 0:
                raise ValueError(f"{name} must be a finite non-negative number")

    @property
    def max_outer_iterations(self) -> int:
        return max(self.max_actions * self.outer_iteration_multiplier, self.min_outer_iterations)


ANALYST_EXECUTION_DEFAULTS = AnalystExecutionConfig()

# ---------------------------------------------------------------------------
# Per-agent reasoning effort
# ---------------------------------------------------------------------------
#
# Pick the lowest tier that produces acceptable quality. Heavy code-generation
# and multi-step agents stay at ``"low"``; trivial single-turn extractors and
# classifiers run at ``"minimal"`` (GPT-5) / ``"low"`` (everything else).

AGENT_REASONING_EFFORT: dict[str, ReasoningEffort] = {
    # ── Heavy: code-gen, multi-step, tool-using ─────────────────────────────
    "data_transform":      "low",      # generates Python transform scripts
    "data_rec":            "low",      # chart / transformation recommendation
    "analyst":             "low",      # unified multi-step exploration + report agent
    "interactive_explore": "low",      # exploration idea agent

    # ── Light: single-turn extractors / classifiers / formatters ────────────
    "data_load":           "minimal",  # one-shot type inference
    "data_clean":          "minimal",  # extract tables from text
    "workflow_distill":  "minimal",  # summarise an analysis context
    "chart_insight":       "minimal",  # title + 1–3 takeaways from a chart
    "chart_restyle":       "minimal",  # apply style edits to a Vega-Lite spec
    "code_explanation":    "minimal",  # describe derived fields
    "sort_data":           "minimal",  # natural-order sort a small list
    "simple":              "minimal",  # workspace_name
}

DEFAULT_REASONING_EFFORT: ReasoningEffort = "low"

_VALID_TIERS: frozenset[str] = frozenset(("none", "minimal", "low", "medium", "high"))


def get_reasoning_effort(agent_id: str | None) -> ReasoningEffort:
    """Return the *configured* tier for ``agent_id``.

    Resolution order:
        1. ``DF_REASONING_EFFORT_<AGENT_ID>`` env var
        2. ``AGENT_REASONING_EFFORT[agent_id]``
        3. ``DEFAULT_REASONING_EFFORT``

    Note: this does **not** consider the target model. Use
    :func:`reasoning_effort_for` at call time to also apply the
    GPT-5-only ``"minimal"`` gating.
    """
    if agent_id:
        env_key = f"DF_REASONING_EFFORT_{agent_id.upper()}"
        env_val = (os.environ.get(env_key) or "").strip().lower()
        if env_val in _VALID_TIERS:
            return env_val  # type: ignore[return-value]
        if agent_id in AGENT_REASONING_EFFORT:
            return AGENT_REASONING_EFFORT[agent_id]
    return DEFAULT_REASONING_EFFORT


def _supports_minimal(model: str | None) -> bool:
    """``"minimal"`` is only accepted by a subset of OpenAI GPT-5 chat models.

    Supported (per OpenAI API):
        ``gpt-5``, ``gpt-5-mini``, ``gpt-5-nano``, ``gpt-5.1``, ``gpt-5.4``,
        and future GPT-5.x sub-versions of those base variants.

    NOT supported (these reject ``"minimal"`` but accept ``"none"`` / ``xhigh``
    instead): ``gpt-5-codex``, ``gpt-5-pro``.

    Provider prefixes such as ``openai/gpt-5-mini``, ``azure/gpt-5``,
    ``openai/responses/gpt-5.4`` are all covered by the substring check.
    """
    if not model:
        return False
    m = model.lower()
    if "gpt-5" not in m:
        return False
    if "codex" in m or "-pro" in m or "/pro" in m:
        return False
    return True


def _supports_none(model: str | None) -> bool:
    """``"none"`` is the lightest tier on the GPT-5 ``codex`` / ``pro`` chat
    models (which reject ``"minimal"``). Other providers (Claude, Gemini,
    o-series) don't accept ``"none"`` as a reasoning_effort value, so we only
    use it for these specific GPT-5 variants.
    """
    if not model:
        return False
    m = model.lower()
    if "gpt-5" not in m:
        return False
    return "codex" in m or "-pro" in m or "/pro" in m


def reasoning_effort_for(agent_id: str | None, model: str | None, preference: str | None = None) -> ReasoningEffort:
    """Resolve the reasoning_effort to actually send to LiteLLM.

    - A model setup's thinking level (*preference*) wins when the caller passes it.
    - Reads the configured tier via :func:`get_reasoning_effort`.
    - For configured ``"minimal"``:
        * keep ``"minimal"`` on GPT-5 base / mini / nano / 5.x;
        * map to ``"none"`` on GPT-5 codex / pro (which support ``"none"``
          but not ``"minimal"``);
        * fall back to ``"low"`` on every other reasoning model.
    - For configured ``"none"`` on a non-supporting model, fall back to
      ``"low"``.
    """
    effort = get_reasoning_effort(agent_id)
    if preference in MODEL_REASONING_LEVELS:
        return preference  # type: ignore[return-value]
    if effort == "minimal":
        if _supports_minimal(model):
            return "minimal"
        if _supports_none(model):
            return "none"
        return "low"
    if effort == "none" and not _supports_none(model):
        return "low"
    return effort
