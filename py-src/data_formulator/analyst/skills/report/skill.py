# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""report skill — turns an exploration into a Markdown report.

The analyst shell decides to write a report (the ``write_report`` **action**),
then dispatches here. The model assembles the report in the **main agent loop**:
it loads this skill, inspects whatever charts/data it needs via the
skill-private ``inspect_chart`` tool (plus the always-on ``inspect_source_data``),
and then emits ``write_report`` — a committing tool call carrying the **full
Markdown** in its ``report`` argument.

``write_report`` is the one *streaming* action (``stream_field="report"`` on
the ``report`` channel — declared via ``streaming_actions`` below). When the
model writes the report as that argument, the **agent loop** forwards it live as
incremental ``report``-channel ``text_delta``s as the tokens arrive
(design-docs/36 §5: the agent owns the generic forwarding envelope, the skill
stays declarative). This handler is then the buffered *fallback*: if the report
was not streamed (e.g. a provider without tool-arg streaming), it validates the
report, runs defense-in-depth cleanup, and yields the whole report as a single
``report``-channel event. Either way the emitted events are identical in shape —
live streaming is just the *same* event with more, smaller deltas, so the shell
and frontend contract is unchanged. ``write_report`` does not end the run on its
own — the shell feeds the returned observation back and the agent stops on the
next turn by committing no action.

  - ``{"type": "action", "action": "write_report"}``              — commitment
  - ``{"type": "text_delta", "channel": "report", "content": …}`` — report prose
"""

from __future__ import annotations

import logging
import re
from typing import Any, Generator

import pandas as pd

from data_formulator.analyst.skills.base import (
    Event,
    SkillContext,
    ToolResult,
)

logger = logging.getLogger(__name__)


# ── Leaked-tool-syntax stripping (defense in depth) ───────────────────────

_LEAK_SPECIAL_TOKEN = re.compile(r"<\|[^|>]*\|>")
_LEAK_TOOLCALL = re.compile(
    r"(?:\bcommentary\b\s*)?\bto\s*=\s*functions\.[A-Za-z0-9_]+"
    r"[\s\S]*?\{[\s\S]*?\}",
)


def _strip_leaked_tool_syntax(text: str) -> str:
    """Remove leaked harmony special tokens and tool-call headers (with their
    trailing JSON args) from the report. Clean prose is untouched."""
    text = _LEAK_TOOLCALL.sub("", text)
    text = _LEAK_SPECIAL_TOKEN.sub("", text)
    return text


# ---------------------------------------------------------------------------
# Skill
# ---------------------------------------------------------------------------


class ReportWritingSkill:
    """The report skill processor: the ``inspect_chart`` tool handler and the
    ``write_report`` action handler.

    Tool/action *schemas* live in ``report/tools.json`` and the skill's
    metadata in ``SKILL.md`` frontmatter; this class is purely behaviour. The
    ``write_report`` action streams its ``report`` argument on the ``report``
    channel; the agent loop owns that forwarding envelope and this handler is
    the buffered fallback (see ``handle_action``).
    """

    # Streaming declaration (design-docs/36 §5): ``write_report`` streams its
    # ``report`` argument live on the ``report`` channel. The agent reads this
    # via ``registry.action_stream_spec`` to forward the argument as the model
    # writes it; behaviour (which arg, which channel) lives here in code, not in
    # the JSON schema sent to the model.
    streaming_actions = {"write_report": ("report", "report")}

    # ------------------------------------------------------------------
    # Tool handler (inspection, called by the shell's tool loop)
    # ------------------------------------------------------------------

    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        if name != "inspect_chart":
            return ToolResult(text=f"report has no tool '{name}'.")
        charts: list[dict[str, Any]] = (ctx.payload or {}).get("charts") or []
        text = self._handle_inspect_chart(args.get("chart_ids", []), charts)
        return ToolResult(text=text)

    # ------------------------------------------------------------------
    # Action handler (buffered fallback — delivers the finished report)
    #
    # When the agent loop streamed the ``report`` argument live, it already
    # emitted the ``action`` + ``report``-channel ``text_delta`` events and
    # suppresses the duplicates this handler yields below; this handler still
    # runs to validate and return the observation. On a provider without
    # tool-arg streaming nothing was forwarded, so these yields are what the
    # frontend receives — the same events, buffered.
    # ------------------------------------------------------------------

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action != "write_report":
            yield {
                "type": "error",
                "message": f"report cannot handle action '{action}'.",
                "message_code": "agent.unknownAction",
            }
            return f"report cannot handle action '{action}'."

        report = str(spec.get("report") or "").strip()
        if not report:
            msg = "write_report action requires a non-empty 'report'."
            yield {
                "type": "error",
                "message": msg,
                "message_code": "agent.parseActionFailed",
            }
            return msg

        # Announce the commitment (mirrors how visualize emits an action event).
        yield {
            "type": "action",
            "action": "write_report",
        }

        # Buffered delivery: emit the whole report as a single ``report``-channel
        # event. Streaming later is the same event with more, smaller deltas.
        yield {
            "type": "text_delta",
            "channel": "report",
            "content": _strip_leaked_tool_syntax(report),
        }

        return "[REPORT DELIVERED] The report was written and shown to the user."


    def _handle_inspect_chart(
        self,
        chart_ids: list[str],
        charts: list[dict[str, Any]],
    ) -> str:
        """Inspect charts by *reading their data*, not by rendering them.

        The agent "reads" a chart from its encodings + sample rows (+ the code
        that produced it), which it can further interrogate with
        ``execute_python_script``. This avoids fragile server-side rasterization
        and the multi-modal round-trip — rendered chart images are no longer fed
        to the agent (experiments showed they don't improve narration over
        reading the data + spec directly).

        Returns the text summary of the inspected charts.
        """
        results = []
        for chart_id in chart_ids:
            chart = next((c for c in charts if c["chart_id"] == chart_id), None)
            if not chart:
                results.append(f"Chart {chart_id}: not found")
                continue

            parts = [f"Chart: {chart_id}"]
            parts.append(f"  Type: {chart.get('chart_type', 'Unknown')}")

            encodings = chart.get("encodings", {})
            if encodings:
                enc_str = ", ".join(f"{k}: {v}" for k, v in encodings.items() if v)
                parts.append(f"  Encodings: {enc_str}")

            if chart.get("code"):
                parts.append(f"  Code:\n```python\n{chart['code']}\n```")

            chart_data = chart.get("chart_data")
            if chart_data and chart_data.get("rows"):
                df = pd.DataFrame(chart_data["rows"])
                parts.append(f"  Data ({len(df)} rows, {len(df.columns)} cols):")
                parts.append(f"  Columns: {', '.join(df.columns.tolist())}")
                parts.append(f"  Sample:\n{df.head(5).to_string()}")
                if chart_data.get("name"):
                    parts.append(
                        f"  To analyze the full chart data, run execute_python_script "
                        f"against table '{chart_data['name']}'."
                    )

            parts.append("  [Read the chart from its encodings + data above]")

            results.append("\n".join(parts))

        return "\n\n".join(results)


def get_skill() -> ReportWritingSkill:
    """Factory used by the registry's eager instantiation."""
    return ReportWritingSkill()
