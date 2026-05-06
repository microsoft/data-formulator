# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Experience distillation agent — extracts reusable knowledge from analysis context.

Given a user-visible analysis context (timeline of events) plus an optional
user instruction, this agent calls an LLM to produce a structured Markdown
experience document with YAML front matter suitable for storage in the
knowledge base.

Usage::

    agent = ExperienceDistillAgent(client)
    md_content = agent.run(experience_context, user_instruction="...")
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import litellm
import openai

from data_formulator.agents.client_utils import Client

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """\
You are a knowledge distiller. Given the chronological events of a data
analysis session plus an optional user instruction, write a short reusable
Markdown note that will help with similar future tasks.

The events use three types:
- `message` — directed speech, formatted as `[<from>→<to>/<role>] <content>`.
  Self-loops like `[data-agent→data-agent/tool_call] <tool>` mark tool invocations.
- `create_table via=visualize|repair` — the agent ran code that produced a
  derived table (followed by columns, row count, sample, and code).
  `via=repair` means the prior failure is visible in the surrounding messages.
- `create_chart` — a chart emitted on a table (mark + encoding summary).

If a user instruction is provided, focus the note on that instruction.
Otherwise, distill the most transferable methodology from the events.

Output format (Markdown with YAML front matter, nothing else):

```
---
title: <short, scannable noun phrase, 3-8 words; no colons, dashes, or run-on lists>
tags: [<broad search keywords: domain, chart type, key operations, technique>]
created: <today YYYY-MM-DD>
updated: <today YYYY-MM-DD>
source: distill
source_context: <context_id>
---

## When to Use
<general conditions where this method applies>

## Method
<concrete steps, abstracted; use generic placeholders like "the target column"
instead of actual column names when names aren't universally meaningful>

## Pitfalls & Tips
<gotchas, workarounds, and things to watch out for — the most valuable section.
If a repair was needed, explain *why* it failed and the general fix.>
```

Rules:
- Title must be a short, scannable noun phrase (3-8 words). Name the
  technique or pattern. Do NOT pack scenario, takeaway, and steps into the
  title — leave the details for `## When to Use` and `## Method`.
  Good: "Year-over-year volatility comparison". "Repairing pandas dtype mismatches".
  Bad:  "Time series analysis workflow: aggregate, visualize trends, quantify YoY spikes, and compare volatility across periods".
- Focus on *transferable* methods and caveats, not case-specific details.
- Keep the body under 500 words.
- No raw data, PII, secrets, or specific values unless they show a universal pattern.
- Write the title, headings, body, and tags in {output_language}.
  YAML front-matter keys stay in English.

{language_instruction}
"""


class ExperienceDistillAgent:
    """Distills analysis context into a reusable experience document."""

    # Language display names for experience-specific prompts
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
        """Distill an experience document from user-visible session context."""
        summary = self._extract_context_summary(context)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        context_id = str(context.get("context_id", "") or "")

        instruction_block = (
            f"\n[USER INSTRUCTION]\n{user_instruction.strip()}\n"
            f"Focus the distilled experience on the above instruction.\n"
        ) if user_instruction and user_instruction.strip() else ""

        user_msg = (
            f"Context ID: {context_id}\n"
            f"Today's date: {today}\n"
            f"{instruction_block}\n"
            f"Session events (chronological):\n{summary}"
        )

        system = SYSTEM_PROMPT.format(**self._prompt_format_kwargs())

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ]

        from data_formulator.knowledge.store import KNOWLEDGE_LIMITS
        content = self._call_with_length_retry(
            messages, KNOWLEDGE_LIMITS.get("experiences", 2000),
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
                f"Write the title, all section headings, all body text, and tags "
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
        body_limit: int,
    ) -> str:
        """Call LLM and retry once if the body exceeds *body_limit* characters.

        If the retry *still* overshoots, hard-truncate the body so the
        document is saved instead of the entire distillation being lost.
        """
        from data_formulator.knowledge.store import parse_front_matter

        content = self._call_llm(messages)
        _, body = parse_front_matter(content)
        if len(body.strip()) <= body_limit:
            return content

        retry_target = max(body_limit - self.RETRY_MARGIN, 1)
        logger.info(
            "Distilled content too long (%d > %d), retrying with condensation prompt (target ≤ %d)",
            len(body.strip()), body_limit, retry_target,
        )
        messages = messages + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": (
                f"Your output body is {len(body.strip())} characters, which exceeds "
                f"the limit of {body_limit}. Please condense the document to fit "
                f"within {retry_target} characters while keeping the most important "
                f"insights. Output ONLY the revised Markdown document."
            )},
        ]
        retried = self._call_llm(messages)

        # Hard-trim if the retry still overshoots — better a slightly
        # truncated experience than a save failure.
        return self._truncate_body_to_limit(retried, body_limit)

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
        """Render the timeline payload (events[]) as a compact text block.

        See design-docs/21.3-distill-payload-vs-preview-alignment.md §5.2.
        Three event types are recognized:

        - ``message``       — directed speech act
        - ``create_table``  — derived table side-effect
        - ``create_chart``  — chart side-effect on a table
        """
        events = context.get("events") or []
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

            elif kind == "create_table":
                via = ev.get("via", "?")
                table_id = ev.get("table_id", "?")
                parts.append(f"[create_table via={via}] {table_id}")
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
        """Single LLM call to generate the experience document."""
        if self.client.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.client.params.get("api_base"),
                api_key=self.client.params.get("api_key", ""),
                timeout=self.timeout_seconds,
            )
            resp = client.chat.completions.create(
                model=self.client.model,
                messages=messages,
            )
        else:
            params = self.client.params.copy()
            params.setdefault("timeout", self.timeout_seconds)
            resp = litellm.completion(
                model=self.client.model,
                messages=messages,
                drop_params=True,
                **params,
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
            f"tags: []\n"
            f"created: {today}\n"
            f"updated: {today}\n"
            f"source: distill\n"
            f"{source_field}: {source_id}\n"
            f"---\n\n"
        )
        return header + content
