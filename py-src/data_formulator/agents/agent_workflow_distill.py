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
analysis session plus an optional user instruction, extract a short,
**replayable workflow** that captures *what the user wanted and got* — so
the same analysis can be reproduced later on a similarly-shaped dataset.

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

Your job is to recover the **ordered list of requests** the user actually
wanted, and the outputs (tables/charts) they ended up keeping. Beyond the
concrete steps, also distill the analysis at TWO levels of abstraction so
it can be reused later:
- **Adapting to similar data** (concrete) — how to rerun essentially the
  same analysis on a near-identical dataset, e.g. the business report for
  a different month, region, or product line. Same shape and intent, only
  the specific inputs/filters change.
- **Generalizing to other data** (abstract, dataset-agnostic) — the
  underlying analytical pattern, independent of this domain: the kinds of
  questions, computations, and charts involved, phrased so they transfer
  to a different domain or a differently-shaped dataset.

CRITICAL extraction rules — keep only what the user wanted and got:
- Each step = one user request, written in plain language. Say BOTH the
  question being explored AND what was produced to answer it — including
  the chart that was created and the key fields it uses (e.g. "Ask how
  sales trend over time, and plot monthly total sales as a line chart";
  "Compare regions by breaking revenue down per region as a sorted bar
  chart"). Order them as the analysis progressed.
- DROP corrective back-and-forth. If the user changed their mind
  ("no, it should be…", "actually use median instead"), keep ONLY the
  final resolved intent — not the wrong first attempt or the correction.
- DROP abandoned work. If a chart or table was created and then deleted
  or never kept, leave it out entirely.
- DROP mechanics. Do NOT include error-repair loops, dtype fixes, tool
  call noise, or low-level code. Describe intent, not implementation.
- Do NOT lean on code or exact column names unless a name is essential to
  the request's meaning. Keep steps dataset-agnostic where possible so
  they replay on a new slice of similar data.
- Capture genuine gotchas separately as short notes (advisory warnings to
  carry forward), NOT as steps to re-perform.

If a user instruction is provided, let it steer what to keep or emphasise.

Output format (Markdown with YAML front matter, nothing else):

```
---
subtitle: <plain-language description of what this workflow is about, up to ~25 words; a full sentence is fine; start with an action verb; no jargon, no colons, dashes, or run-on lists>
filename: <short 2-5 word lowercase name for the file, e.g. "monthly sales trend"; no dates, no extension>
created: <today YYYY-MM-DD>
updated: <today YYYY-MM-DD>
source: distill
source_context: <context_id>
---

## Goal
<one or two sentences: the overall question(s) this analysis answers and
what it produces>

## Steps
1. <first question explored, and the table/chart created to answer it>
2. <next question, and what was produced>
3. <…>

## Adapting to similar data
<how to rerun essentially the same analysis on a near-identical dataset —
e.g. the same kind of report for a different month, region, or product
line. Keep the structure and outputs the same; call out which inputs,
filters, or columns would change. 1-4 short sentences or bullets.>

## Generalizing to other data
<the dataset-agnostic analytical pattern behind this workflow: the kinds
of questions, computations, and charts it represents, described in
domain-neutral terms so it can transfer to a different domain or a
differently-shaped dataset. Focus on the reasoning and technique, not the
specific fields or values. 1-4 short sentences or bullets.>

## Notes
<optional short bullets: caveats/gotchas to watch for when reproducing this
analysis on new data — e.g. "sort by time before computing deltas". Omit
this section entirely if there is nothing worth warning about.>
```

Rules:
- Subtitle must DESCRIBE what the workflow is about in PLAIN LANGUAGE that
  a non-expert can fully understand at a glance, so they can decide
  whether to replay it on new data. Favor clarity over brevity: it can be
  a full sentence (up to ~25 words) if that makes the analysis genuinely
  understandable. Write it like you would explain the analysis to a
  colleague in one breath, covering the subject and the main thing you do
  with it. The hosting application uses this subtitle directly as the
  workflow's display title, so make it self-contained and do NOT prefix it
  with the session name.
  - Start with a concrete action verb (Plot, Compare, Break down, Rank,
    Track, Summarize, Find…).
  - Name the real-world subject in everyday words (sales, revenue,
    customers, events), NOT the internal mechanics or derived-column
    names you happened to create.
  - AVOID abstract or technical jargon and invented noun-phrases
    ("deltas", "composition", "window", "distribution shift"). If a
    technique matters, phrase it plainly ("change from one period to the
    next" instead of "deltas").
  Good: "Plot monthly sales over time and compare each year against the
         previous one to spot volatile periods".
        "Break revenue down by region and show how each region
         contributes to the total as a stacked area chart".
        "Track how many events happen in each time window and what kinds
         of events make up each window".
  Bad:  "Time series analysis". "Data workflow". "Chart exploration".
        "Event window deltas with composition". "Distribution shift inspection".
- Filename must be a SHORT (2-5 word) lowercase name for the file — just
  the core subject and action, e.g. "monthly sales trend", "region revenue
  breakdown". No dates, no file extension, no session name. It is only
  used to name the file on disk; the descriptive subtitle is what users see.
- Steps must be ordered and reproducible. Each step should make clear the
  question being explored and the chart/output produced to answer it.
- "Adapting to similar data" stays close to this analysis (same domain,
  same shape) — only the concrete inputs change. "Generalizing to other
  data" must be domain-neutral: strip out this dataset's subject matter and
  describe only the transferable analytical pattern (question types,
  computations, chart kinds). Do NOT just repeat the steps in either
  section; add genuine reuse guidance. Keep each section brief.
- Be as long as the analysis needs — do not omit meaningful steps,
  questions, or charts just to stay short. Stay focused, but completeness
  matters more than brevity.
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
