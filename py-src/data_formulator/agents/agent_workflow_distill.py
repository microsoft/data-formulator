# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Workflow distillation agent — extracts a replayable workflow from analysis context.

Given a user-visible analysis context (timeline of events) plus an optional
user instruction, this agent calls an LLM to produce a structured Markdown
workflow document with YAML front matter suitable for storage in the
knowledge base.

Usage::

    agent = WorkflowDistillAgent(client)
    md_content = agent.run(workflow_context, user_instruction="...")
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.client_utils import Client

logger = logging.getLogger(__name__)

_AGENT_ID = "workflow_distill"


SYSTEM_PROMPT = """\
You are a workflow distiller. Given the chronological events of a data
analysis session plus an optional user distillation instruction, extract a **replayable
workflow** that captures *what the user wanted and got* — and write it at
TWO levels so it can be reused in two different situations:

1. An **Abstract workflow** — dataset-independent. The underlying analytical
   pattern, stripped of this dataset's subject matter: the sequence of
   questions, computations, and chart kinds, phrased in domain-neutral terms.
   Following it on a *different and possibly very differently-shaped* dataset
   should walk the same process and arrive at structurally similar
   visualizations.
2. A **Concrete workflow** — for *similar* data (same shape, only minor
   differences — a different period, region, or filter). It names the real
   fields, aggregations, filters, and chart encodings used here, so the
   analysis can be replayed closely with minimal thought.

Both describe the SAME analysis at different distances. They should be
consistent, but they do NOT need an exact 1:1 step mapping — let each be as
long as it needs (typically 3-7 steps each).

Where the analysis hinges on a few choices a user might change on replay (a
period, a filter, a top-N), surface them as named **parameters** with
`{{token}}` placeholders in the steps — see the `## Parameters` section below.

The session contains one or more threads (separate analysis branches in
the same session) each rendered under a `### Thread N` header. When
multiple threads are provided, merge them into one coherent ordered
workflow — do NOT enumerate per-thread.

The events use three types:
- `message` — directed speech, formatted as `[<from>→<to>/<role>] <content>`.
  Self-loops like `[data-agent→data-agent/tool_call] <tool>` mark tool invocations.
  Errors and repairs (e.g. `[CODE ERROR]` user turns) appear as messages too.
- `create_table` — the agent ran code that produced a derived table
  (followed by columns, row count, sample, and code).
- `create_chart` — a chart emitted on a table (mark + encoding summary).

CRITICAL extraction rules — keep only what the user wanted and got:
- Recover the ORDERED list of requests the user actually wanted, and the
  outputs (tables/charts) they kept. Each step states BOTH the question
  explored AND what was produced to answer it — including the chart and the
  key fields it uses.
- DROP corrective back-and-forth. If the user changed their mind
  ("no, it should be…", "actually use median instead"), keep ONLY the
  final resolved intent — not the wrong first attempt or the correction.
- DROP abandoned work. If a chart or table was created and then deleted
  or never kept, leave it out entirely.
- DROP mechanics. Do NOT include error-repair loops, dtype fixes, tool
  call noise, or low-level code dumps. Describe intent, not implementation.
- Capture genuine gotchas as short Notes (advisory warnings to carry
  forward), NOT as steps to re-perform.

If a user instruction is provided, let it steer what to keep or emphasise.

Output format (Markdown with YAML front matter, nothing else):

```
---
subtitle: <abstract, library-friendly TITLE naming the KIND of analysis, not this dataset — see rules below; a few words, e.g. "Year-over-year KPI volatility analysis">
filename: <short 2-5 word lowercase name for the file, e.g. "kpi volatility analysis"; no dates, no extension>
created: <today YYYY-MM-DD>
updated: <today YYYY-MM-DD>
source: distill
source_context: <context_id>
---

## Goal
<one or two sentences: the overall question(s) this analysis answers and
what it produces. This is where the dataset-grounded explanation belongs —
you MAY name the real subject here (e.g. "originally distilled from a
monthly gasoline-price session").>

## Parameters
<the FEW analysis-specific choices a replay may want to change or re-confirm
— your judgment about which knobs genuinely matter (often 0-4; omit the
section entirely if none). Knobs may be run-specific (a period, region, top-N
the user repicks each run) or dataset-specific (a domain value or column tied
to this data). List each as a named parameter using a short `{{token}}`
matching the placeholders in the steps. Give what it controls, the value used
in THIS session, and a replay hint: `ask` (prompt the user to confirm/fill)
or `keep` (a safe default unless told otherwise).>
- `{{period}}` — the time range analysed; used here: 2024; on replay: ask.
- `{{top_n}}` — how many top categories to keep; used here: 10; on replay: keep.
- `{{region}}` — geographic filter applied; used here: National; on replay: ask.

## Abstract workflow
<dataset-INDEPENDENT. An ordered list of moves, each phrased as the question
explored, the computation, and the chart kind — in domain-neutral terms
(metric, category, period, cohort, event), with NO column names or this
dataset's subject matter. Reference parameters by their `{{token}}` where a
choice is analysis-specific. Following this on a different dataset should
reproduce a structurally similar set of visualizations.>
1. <e.g. "Aggregate a metric over a `{{time_grain}}` and plot it as a line to establish the baseline trend.">
2. <e.g. "Compare each period against the prior comparable period to surface change, shown as a diverging bar.">
3. <…>

## Concrete workflow
<for SIMILAR data (same shape, only minor differences). Follows the same
analysis but names the real fields, aggregations, filters, and chart
encodings used here, referencing the same `{{token}}` parameters where a value
should be swapped on replay. A short code/encoding snippet is fine where it
guards an easy-to-make mistake, but don't over-rely on code — keep it mostly
plain language.>
1. <e.g. "Filter to `{{region}}`, group `sales` by month, sum it; line chart x=month y=total. Swap `{{period}}` for the target run.">
2. <…>

## Notes
<optional short bullets: caveats/gotchas to watch for when reproducing this
analysis on new data — e.g. "sort by time before computing period-over-period
change". Omit this section entirely if there is nothing worth warning about.>
```

Rules:
- The subtitle is the workflow's display TITLE. Make it ABSTRACT and
  library-friendly: name the *kind of analysis* — a technique plus a GENERIC
  subject (KPI, metric, category, event, cohort) — so someone browsing the
  workflow library can tell whether this is the KIND of analysis they want to
  reuse. Do NOT pin it to this dataset's specific subject, period, or column
  names, and do NOT prefix it with the session name.
  - Pair a real technique with a generic subject; avoid bare category words.
  Good: "Year-over-year KPI volatility analysis".
        "Category contribution-to-total breakdown".
        "Time-windowed event composition analysis".
  Bad:  "Plot monthly gasoline prices in 2024 and compare each year".  (too specific)
        "Time series analysis". "Data workflow". "Chart exploration".    (too vague)
  The dataset-grounded, full-sentence explanation goes in `## Goal`, NOT the title.
- Filename must be a SHORT (2-5 word) lowercase name for the file — just
  the technique/subject, e.g. "kpi volatility analysis", "region revenue
  breakdown". No dates, no file extension, no session name. It only names the
  file on disk; the subtitle is what users see.
- Abstract workflow must be domain-neutral — strip this dataset's subject
  matter and column names; describe only the transferable pattern (question
  types, computations, chart kinds). Concrete workflow must be runnable on a
  near-identical dataset: real field names, the aggregation, the filter to
  vary, the chart mark + key encodings. Do NOT have the two sections merely
  repeat each other — each adds its own grain of reuse guidance.
- Parameters are optional and a judgment call: surface only the FEW knobs
  that materially change the outcome and that a user would revisit on replay
  (often 0-4). When in doubt, leave the value inline — a spurious `{{token}}`
  is worse than none. Knobs may be run-specific (period, region, top-N —
  usually `ask`) or dataset-specific (a domain value/column — usually `keep`,
  and may be skipped in the Abstract workflow). Every `{{token}}` in the steps
  must be listed in `## Parameters` and vice versa.
- Steps in both sections must be ordered and reproducible.
- Be as long as the analysis needs — do not omit meaningful steps, questions,
  or charts just to stay short. Stay focused, but completeness matters more
  than brevity.
- No raw data, PII, secrets, or specific values unless essential to a request.
- Write the subtitle, headings, and body in {output_language}.
  YAML front-matter keys stay in English.

{language_instruction}
"""



class WorkflowDistillAgent:
    """Distills analysis context into a reusable workflow document."""

    # Language display names for workflow-specific prompts
    _LANG_NAMES: dict[str, str] = {
        "zh": "Simplified Chinese (简体中文)",
        "ja": "Japanese (日本語)",
        "ko": "Korean (한국어)",
        "fr": "French",
        "de": "German",
        "es": "Spanish",
        "pt": "Portuguese",
    }

    DEFAULT_TIMEOUT = 120

    def __init__(
        self,
        client: Client,
        language_instruction: str = "",
        language_code: str = "en",
        timeout_seconds: int | float | None = None,
    ) -> None:
        self.client = client
        self.language_instruction = language_instruction
        self.language_code = (language_code or "en").strip().lower()
        self.timeout_seconds = int(timeout_seconds) if timeout_seconds else self.DEFAULT_TIMEOUT

    def run(self, context: dict[str, Any], user_instruction: str = "") -> str:
        """Distill a workflow document from user-visible session context."""
        summary = self._extract_context_summary(context)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        context_id = str(context.get("context_id", "") or "")
        workspace_name = str(context.get("workspace_name", "") or "").strip()
        payload_notes = context.get("payload_notes") or []

        instruction_block = (
            f"\n[USER INSTRUCTION]\n{user_instruction.strip()}\n"
            f"Focus the distilled workflow on the above instruction.\n"
        ) if user_instruction and user_instruction.strip() else ""

        workspace_block = (
            f"Session name: {workspace_name}\n" if workspace_name else ""
        )
        notes_block = ""
        if isinstance(payload_notes, list) and payload_notes:
            note_lines = "\n".join(f"- {n}" for n in payload_notes if n)
            if note_lines:
                notes_block = f"\n[PAYLOAD NOTES]\n{note_lines}\n"

        user_msg = (
            f"Context ID: {context_id}\n"
            f"{workspace_block}"
            f"Today's date: {today}\n"
            f"{instruction_block}"
            f"{notes_block}\n"
            f"Session events (chronological):\n{summary}"
        )

        system = SYSTEM_PROMPT.format(**self._prompt_format_kwargs())

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ]

        from data_formulator.knowledge.store import KNOWLEDGE_LIMITS, WORKFLOW_HARD_MAX
        content = self._call_with_length_retry(
            messages,
            KNOWLEDGE_LIMITS.get("workflows", 6000),
            WORKFLOW_HARD_MAX,
        )

        if not content.strip().startswith("---"):
            content = self._add_fallback_front_matter(
                content, context_id, today, source_field="source_context",
            )

        return content

    def _prompt_format_kwargs(self) -> dict[str, str]:
        """Build template kwargs for SYSTEM_PROMPT."""
        lang = self.language_code
        display_name = self._LANG_NAMES.get(lang, "English")
        if lang == "en":
            output_language = "English"
            lang_block = ""
        else:
            output_language = display_name
            lang_block = (
                f"[LANGUAGE INSTRUCTION]\n"
                f"The user's language is **{display_name}**.\n"
                f"Write the title, all section headings, and all body text "
                f"in {display_name}. YAML front-matter keys stay in English."
            )
        return {
            "output_language": output_language,
            "language_instruction": self.language_instruction or lang_block,
        }

    # Slack the model gets on the condensation retry: we ask for
    # `body_limit - RETRY_MARGIN` so a small overshoot still fits in
    # `body_limit`. If the retry still overshoots, we hard-truncate.
    RETRY_MARGIN: int = 100
    TRUNCATION_MARKER: str = "\n\n…(truncated to fit length limit)"

    def _call_with_length_retry(
        self,
        messages: list[dict],
        soft_limit: int,
        hard_limit: int,
    ) -> str:
        """Call the LLM, nudging it to stay near *soft_limit* characters.

        ``soft_limit`` is advisory guidance: if the first response overshoots
        it we retry once asking the model to condense. We only ever
        hard-truncate at ``hard_limit`` — a much larger safety ceiling — so
        rich, multi-section workflows are kept intact while runaway output
        is still bounded.
        """
        from data_formulator.knowledge.store import parse_front_matter

        content = self._call_llm(messages)
        _, body = parse_front_matter(content)
        if len(body.strip()) <= soft_limit:
            return content

        retry_target = max(soft_limit - self.RETRY_MARGIN, 1)
        logger.info(
            "Distilled content over soft target (%d > %d), retrying with condensation prompt (target ≤ %d)",
            len(body.strip()), soft_limit, retry_target,
        )
        messages = messages + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": (
                f"Your output body is {len(body.strip())} characters, which is "
                f"longer than ideal. Please tighten the document to around "
                f"{retry_target} characters while keeping the most important "
                f"insights and all sections. Output ONLY the revised Markdown document."
            )},
        ]
        retried = self._call_llm(messages)

        # Hard-trim only if the retry blows past the absolute ceiling —
        # better a slightly truncated workflow than a save failure.
        return self._truncate_body_to_limit(retried, hard_limit)

    @classmethod
    def _truncate_body_to_limit(cls, content: str, body_limit: int) -> str:
        """If the body of *content* exceeds *body_limit*, truncate it.

        Front matter is preserved verbatim; only the body is trimmed.
        Returns *content* unchanged when within the limit.
        """
        from data_formulator.knowledge.store import _FM_PATTERN

        m = _FM_PATTERN.match(content)
        if m:
            head = content[: m.end()]
            body = content[m.end():]
        else:
            head = ""
            body = content

        stripped_len = len(body.strip())
        if stripped_len <= body_limit:
            return content

        marker = cls.TRUNCATION_MARKER
        keep = max(body_limit - len(marker), 0)
        truncated_body = body[:keep].rstrip() + marker
        logger.warning(
            "Distilled body still over budget after retry (%d > %d); hard-trimming to %d chars",
            stripped_len, body_limit, len(truncated_body.strip()),
        )
        return head + truncated_body

    # -- internals ---------------------------------------------------------

    @staticmethod
    def _truncate(value: Any, limit: int = 500) -> str:
        text = "" if value is None else str(value)
        return text if len(text) <= limit else text[:limit] + "..."

    @staticmethod
    def _truncate_code(code: str, limit: int = 1500) -> str:
        """Return the first *limit* characters of meaningful code lines."""
        lines = [
            line for line in code.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        text = "\n".join(lines)
        if len(text) <= limit:
            return text
        return text[:limit] + "\n# ... (truncated)"

    @staticmethod
    def _render_sample(rows: Any, max_rows: int = 5) -> str:
        """Render a small data sample as a compact one-line-per-row block.

        Mirrors the frontend preview — the user sees the same sample.
        """
        if not isinstance(rows, list) or not rows:
            return "    (no sample)"
        out: list[str] = []
        for r in rows[:max_rows]:
            try:
                if isinstance(r, dict):
                    pairs = ", ".join(f"{k}={r[k]!r}" for k in list(r.keys())[:8])
                    out.append(f"    - {pairs}")
                else:
                    out.append(f"    - {r!r}")
            except Exception:
                out.append("    - (unrenderable row)")
        return "\n".join(out)

    @classmethod
    def _extract_context_summary(cls, context: dict[str, Any]) -> str:
        """Render the multi-thread session payload as a compact text block.

        ``context['threads']`` is a list of ``{thread_id, events[]}``
        dicts (session-scoped distillation, see design-docs/24). Threads
        are rendered under ``### Thread N`` headers so the LLM can see
        the boundaries.

        Three event types are recognized inside each timeline:

        - ``message``       — directed speech act
        - ``create_table``  — derived table side-effect
        - ``create_chart``  — chart side-effect on a table
        """
        threads = context.get("threads")
        if not isinstance(threads, list) or not threads:
            return "(empty context)"

        blocks: list[str] = []
        for idx, thread in enumerate(threads, start=1):
            if not isinstance(thread, dict):
                continue
            thread_id = thread.get("thread_id") or f"t{idx}"
            events = thread.get("events") or []
            rendered = cls._render_events(events)
            blocks.append(f"### Thread {idx} (id={thread_id})\n{rendered}")
        return "\n\n".join(blocks) if blocks else "(empty context)"

    @classmethod
    def _render_events(cls, events: list[Any]) -> str:
        """Render a flat event list as a compact text block."""
        if not isinstance(events, list):
            return "(empty context)"

        parts: list[str] = []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            kind = ev.get("type")

            if kind == "message":
                f = ev.get("from", "?")
                t = ev.get("to", "?")
                role = ev.get("role", "?")
                line = f"[{f}→{t}/{role}]"
                if ev.get("content"):
                    line += f" {cls._truncate(ev['content'], 500)}"
                if ev.get("summary"):
                    line += f" — {cls._truncate(ev['summary'], 200)}"
                parts.append(line)
                # Tool-call args/code preview (only present for tool_call events).
                if role == "tool_call" and ev.get("args"):
                    parts.append(f"  args: {cls._truncate(ev['args'], 600)}")

            elif kind == "create_table":
                table_id = ev.get("table_id", "?")
                parts.append(f"[create_table] {table_id}")
                source_tables = ev.get("source_tables") or []
                if source_tables:
                    parts.append(f"  sources: {', '.join(str(s) for s in source_tables)}")
                columns = ev.get("columns") or []
                if columns:
                    parts.append(f"  columns: {list(columns)}")
                if ev.get("row_count") is not None:
                    parts.append(f"  rows: {ev.get('row_count')}")
                sample = ev.get("sample_rows") or []
                if isinstance(sample, list) and sample:
                    parts.append(f"  sample (first {len(sample)} rows):")
                    parts.append(cls._render_sample(sample))
                if ev.get("code"):
                    parts.append(f"  code:\n{cls._truncate_code(str(ev['code']), 1500)}")

            elif kind == "create_chart":
                mark = ev.get("mark_or_type", "?")
                related = ev.get("related_table_id", "?")
                parts.append(f"[create_chart] {mark} on {related}")
                if ev.get("encoding_summary"):
                    parts.append(f"  encoding: {ev.get('encoding_summary')}")

        return "\n".join(parts) if parts else "(empty context)"

    def _call_llm(self, messages: list[dict]) -> str:
        """Single LLM call to generate the workflow document."""
        resp = self.client.get_completion(
            messages, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model), timeout=self.timeout_seconds,
        )
        return resp.choices[0].message.content or ""

    @staticmethod
    def _add_fallback_front_matter(
        content: str, source_id: str, today: str, source_field: str,
    ) -> str:
        """Prepend front matter if the LLM didn't include it."""
        first_line = content.strip().split("\n")[0] if content.strip() else ""
        title = first_line.lstrip("# ").strip()[:80] or "Untitled Knowledge"

        header = (
            f"---\ntitle: {title}\n"
            f"created: {today}\n"
            f"updated: {today}\n"
            f"source: distill\n"
            f"{source_field}: {source_id}\n"
            f"---\n\n"
        )
        return header + content
