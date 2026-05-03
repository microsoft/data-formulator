# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Experience distillation agent — extracts reusable knowledge from analysis context.

Given a user-visible analysis context, this agent calls an LLM to produce a
structured Markdown experience document with YAML front matter suitable for
storage in the knowledge base.

Usage::

    agent = ExperienceDistillAgent(client)
    md_content = agent.run_from_context(experience_context)
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
You are a knowledge distiller. Given the context of a data analysis session,
extract reusable methodology that can help with similar future tasks.

The knowledge entry must include:

1. **Title**: a descriptive title following the pattern \
"[Method/technique]: [applicable scenario] — [core takeaway]". \
Focus on the method, not the specific dataset. Aim for 10–30 words.
2. **When to Use**: describe the general conditions where this method applies.
3. **Method**: the concrete steps, abstracted from the specific dataset. \
Use generic placeholders (e.g. "the target column", "the grouping key") \
instead of actual column names when the names are not universally meaningful.
4. **Pitfalls & Tips**: gotchas encountered during the session, workarounds, \
and things to watch out for. This is the most valuable section.
5. **Tags**: keywords for future search (as a YAML list). Include the data \
domain, chart type, key pandas/vega operations, and general technique names \
so that future semantic search can match this entry.

Output the result as a Markdown file with YAML front matter, like this:

```
---
title: <title>
tags: [<tag1>, <tag2>, ...]
created: <today's date YYYY-MM-DD>
updated: <today's date YYYY-MM-DD>
source: distill
source_context: <context_id>
---

## When to Use

<general conditions>

## Method

<step by step, abstracted>

## Pitfalls & Tips

<gotchas and workarounds>
```

Rules:
- Focus on *transferable* methods and caveats, not case-specific details.
- If a repair/retry was needed, explain *why* it failed and the general fix, \
not just what happened in this specific run.
- Keep under 500 words. Prefer concise, actionable guidance.
- Omit specific data values, column names, and row counts unless they \
illustrate a universal pattern.
- Tags should be broad enough to match future queries.
- Do NOT include raw data, private identifiers, API keys, or sensitive information.
- Output ONLY the Markdown document, nothing else.
- The `title` value, all section headings (## When to Use, ## Method, \
## Pitfalls & Tips), all section body text, and `tags` MUST be written \
in {output_language}. Only YAML front-matter keys (`title`, `tags`, \
`created`, `updated`, `source`, `source_context`) stay in English.

{language_instruction}
"""


LOG_SYSTEM_PROMPT = """\
You are a knowledge distiller. Given a structured reasoning log summary from
a data analysis session, extract reusable methodology that can help with
similar future tasks.

The knowledge entry must include:

1. **Title**: a descriptive title following the pattern \
"[Method/technique]: [applicable scenario] — [core takeaway]". \
Focus on the method, not the specific dataset. Aim for 10–30 words.
2. **When to Use**: describe the general conditions where this method applies.
3. **Method**: the concrete steps, abstracted from the specific dataset. \
Use generic placeholders (e.g. "the target column", "the grouping key") \
instead of actual column names when the names are not universally meaningful.
4. **Pitfalls & Tips**: gotchas encountered during the session, workarounds, \
and things to watch out for. This is the most valuable section.
5. **Tags**: keywords for future search (as a YAML list). Include the data \
domain, chart type, key pandas/vega operations, and general technique names \
so that future semantic search can match this entry.

Output the result as a Markdown file with YAML front matter, like this:

```
---
title: <title>
tags: [<tag1>, <tag2>, ...]
created: <today's date YYYY-MM-DD>
updated: <today's date YYYY-MM-DD>
source: distill
source_session: <session_id>
---

## When to Use

<general conditions>

## Method

<step by step, abstracted>

## Pitfalls & Tips

<gotchas and workarounds>
```

Rules:
- Focus on *transferable* methods and caveats, not case-specific details.
- If a repair/retry was needed, explain *why* it failed and the general fix, \
not just what happened in this specific run.
- Keep under 500 words. Prefer concise, actionable guidance.
- Omit specific data values, column names, and row counts unless they \
illustrate a universal pattern.
- Tags should be broad enough to match future queries.
- Do NOT include raw data, private identifiers, API keys, or sensitive information.
- Output ONLY the Markdown document, nothing else.
- The `title` value, all section headings (## When to Use, ## Method, \
## Pitfalls & Tips), all section body text, and `tags` MUST be written \
in {output_language}. Only YAML front-matter keys (`title`, `tags`, \
`created`, `updated`, `source`, `source_session`) stay in English.

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

    def __init__(
        self,
        client: Client,
        language_instruction: str = "",
        language_code: str = "en",
    ) -> None:
        self.client = client
        self.language_instruction = language_instruction
        self.language_code = (language_code or "en").strip().lower()

    def run(
        self,
        reasoning_log: list[dict[str, Any]],
        user_question: str,
        session_id: str = "",
    ) -> str:
        """Distill *reasoning_log* into a Markdown experience.

        Parameters
        ----------
        reasoning_log:
            Parsed JSONL lines from a reasoning log file.
        user_question:
            The original question the user asked.
        session_id:
            The session ID (embedded in front matter ``source_session``).

        Returns
        -------
        str
            The Markdown content (with YAML front matter).
        """
        summary = self._extract_log_summary(reasoning_log)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        user_msg = (
            f"User question: {user_question}\n\n"
            f"Session ID: {session_id}\n"
            f"Today's date: {today}\n\n"
            f"Reasoning log summary:\n{summary}"
        )

        system = LOG_SYSTEM_PROMPT.format(**self._prompt_format_kwargs())

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
                content, session_id, today, source_field="source_session",
            )

        return content

    def run_from_context(self, context: dict[str, Any]) -> str:
        """Distill an experience document from user-visible session context."""
        summary = self._extract_context_summary(context)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        context_id = str(context.get("context_id", "") or "")

        user_msg = (
            f"User question: {context.get('user_question', '')}\n\n"
            f"Context ID: {context_id}\n"
            f"Today's date: {today}\n\n"
            f"Experience context summary:\n{summary}"
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
        """Build template kwargs for SYSTEM_PROMPT / LOG_SYSTEM_PROMPT."""
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

    def _call_with_length_retry(
        self,
        messages: list[dict],
        body_limit: int,
    ) -> str:
        """Call LLM and retry once if the body exceeds *body_limit* characters."""
        from data_formulator.knowledge.store import parse_front_matter

        content = self._call_llm(messages)
        _, body = parse_front_matter(content)
        if len(body.strip()) <= body_limit:
            return content

        logger.info(
            "Distilled content too long (%d > %d), retrying with condensation prompt",
            len(body.strip()), body_limit,
        )
        messages = messages + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": (
                f"Your output body is {len(body.strip())} characters, which exceeds "
                f"the limit of {body_limit}. Please condense the document to fit "
                f"within {body_limit} characters while keeping the most important "
                f"insights. Output ONLY the revised Markdown document."
            )},
        ]
        return self._call_llm(messages)

    # -- internals ---------------------------------------------------------

    @staticmethod
    def _truncate(value: Any, limit: int = 500) -> str:
        text = "" if value is None else str(value)
        return text if len(text) <= limit else text[:limit] + "..."

    @staticmethod
    def _extract_tool_name_from_dialog_content(content: Any) -> str | None:
        """Extract a bracketed tool name without forwarding dialog content."""
        text = "" if content is None else str(content).strip()
        if not text.startswith("[tool:"):
            return None

        first_line = text.splitlines()[0].strip()
        if not first_line.endswith("]"):
            return None

        tool_name = first_line[len("[tool:"):-1].strip()
        return tool_name or None

    @staticmethod
    def _summarize_code_shape(code: Any) -> str:
        """Summarize generated code without forwarding source text."""
        text = "" if code is None else str(code)
        lines = [
            line.strip()
            for line in text.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        checks = (
            ("groupby", "groupby"),
            ("agg(", "aggregate"),
            (".sum(", "sum"),
            ("merge(", "merge/join"),
            (".join(", "merge/join"),
            ("pivot", "pivot"),
            ("melt(", "reshape"),
            ("query(", "filter"),
            (".loc[", "filter"),
            ("sort_values", "sort"),
            ("reset_index", "reset-index"),
            ("assign(", "derive-column"),
            ("value_counts", "count"),
            ("to_datetime", "datetime-conversion"),
            ("fillna", "missing-value handling"),
            ("dropna", "missing-value handling"),
        )
        operations = [
            label
            for needle, label in checks
            if needle in text
        ]
        unique_operations = list(dict.fromkeys(operations))

        if unique_operations:
            return (
                f"{len(lines)} non-empty lines; operations="
                f"{', '.join(unique_operations)}"
            )
        return f"{len(lines)} non-empty lines; operations=unspecified"

    @staticmethod
    def _extract_log_summary(log_lines: list[dict[str, Any]]) -> str:
        """Extract key information from reasoning log lines.

        Only includes step_type, action summaries, tool names, and key
        findings — never full message content or raw data.
        """
        parts: list[str] = []
        for entry in log_lines:
            step = entry.get("step_type", "unknown")

            if step == "session_start":
                parts.append(
                    f"- Session started: question={entry.get('user_question', '?')}, "
                    f"tables={entry.get('input_tables', [])}, "
                    f"model={entry.get('model', '?')}"
                )
            elif step == "context_built":
                parts.append(
                    f"- Context: {entry.get('total_tables', '?')} tables, "
                    f"primary={entry.get('primary_tables', [])}"
                )
            elif step == "llm_response":
                tc = entry.get("tool_calls", [])
                if tc:
                    tools = ", ".join(t.get("name", "?") for t in tc)
                    parts.append(f"- LLM called tools: {tools}")
                fr = entry.get("finish_reason", "")
                if fr == "stop":
                    action = entry.get("action", {})
                    if isinstance(action, dict):
                        parts.append(
                            f"- LLM action: {action.get('action', '?')}"
                        )
            elif step == "tool_execution":
                tool = entry.get("tool", "?")
                output = entry.get("output_summary", "")[:150]
                parts.append(f"- Tool {tool}: {output}")
            elif step == "action_execution":
                action = entry.get("action", "?")
                status = entry.get("status", "?")
                extra = ""
                if entry.get("chart_type"):
                    extra = f", chart={entry['chart_type']}"
                if entry.get("output_rows"):
                    extra += f", rows={entry['output_rows']}"
                parts.append(f"- Action {action}: {status}{extra}")
            elif step == "repair_attempt":
                parts.append(
                    f"- Repair attempt {entry.get('attempt', '?')}: "
                    f"{entry.get('status', '?')}"
                )
            elif step == "session_end":
                parts.append(
                    f"- Session ended: status={entry.get('status', '?')}, "
                    f"iterations={entry.get('total_iterations', '?')}, "
                    f"llm_calls={entry.get('total_llm_calls', '?')}, "
                    f"latency={entry.get('total_latency_ms', '?')}ms"
                )

        return "\n".join(parts) if parts else "(empty log)"

    @classmethod
    def _extract_context_summary(cls, context: dict[str, Any]) -> str:
        """Extract reusable signals from a frontend experience context."""
        parts: list[str] = []
        parts.append(f"- User question: {cls._truncate(context.get('user_question', ''), 500)}")

        interaction = context.get("interaction", [])
        if isinstance(interaction, list):
            for item in interaction:
                if not isinstance(item, dict):
                    continue
                role = str(item.get("role", ""))
                source = str(item.get("from", ""))
                if role == "prompt" and source == "user":
                    content = item.get("displayContent") or item.get("content", "")
                    parts.append(
                        f"- User prompt or clarification: {cls._truncate(content, 500)}"
                    )
                elif role == "clarify":
                    content = item.get("displayContent") or item.get("content", "")
                    parts.append(
                        f"- Agent clarification question: {cls._truncate(content, 500)}"
                    )
                elif role == "instruction":
                    content = item.get("displayContent") or item.get("content", "")
                    parts.append(
                        f"- Agent instruction summary: {cls._truncate(content, 500)}"
                    )
                elif role == "summary":
                    parts.append("- Agent summary was shown")

        attempts = context.get("execution_attempts", [])
        if isinstance(attempts, list):
            for attempt in attempts:
                if not isinstance(attempt, dict):
                    continue
                parts.append(
                    f"- Attempt {attempt.get('kind', '?')}: "
                    f"{attempt.get('status', '?')} - "
                    f"{cls._truncate(attempt.get('summary', ''), 400)}"
                )
                if attempt.get("error"):
                    parts.append(
                        f"  Error: {cls._truncate(attempt.get('error'), 400)}"
                    )
                if attempt.get("failed_code_summary"):
                    parts.append(
                        "  Failed code summary: "
                        f"{cls._truncate(attempt.get('failed_code_summary'), 400)}"
                    )
                if attempt.get("repair_code_summary"):
                    parts.append(
                        "  Repair code summary: "
                        f"{cls._truncate(attempt.get('repair_code_summary'), 400)}"
                    )

        result = context.get("result_summary", {})
        if isinstance(result, dict):
            source_tables = result.get("source_tables") or []
            if source_tables:
                parts.append(f"- Source tables: {source_tables}")
            parts.append(
                f"- Final result: fields={result.get('output_fields', [])}, "
                f"rows={result.get('output_rows')}, "
                f"chart={result.get('chart_type')}"
            )
            if result.get("display_instruction"):
                parts.append(
                    "- Final display instruction: "
                    f"{cls._truncate(result.get('display_instruction'), 500)}"
                )
            if result.get("code"):
                parts.append(
                    f"- Final code summary: {cls._summarize_code_shape(result.get('code'))}"
                )

        dialog = context.get("dialog", [])
        if isinstance(dialog, list) and dialog:
            dialog_roles: dict[str, int] = {}
            dialog_tools: list[str] = []
            tool_result_count = 0

            for msg in dialog[-20:]:
                if not isinstance(msg, dict):
                    continue

                role = str(msg.get("role", "?"))
                dialog_roles[role] = dialog_roles.get(role, 0) + 1

                if role == "tool":
                    tool_result_count += 1

                content = msg.get("content", "")
                tool_name = cls._extract_tool_name_from_dialog_content(content)
                if tool_name:
                    dialog_tools.append(tool_name)
                elif isinstance(content, str) and content.strip().startswith("[tool result"):
                    tool_result_count += 1

            if dialog_roles:
                role_counts = ", ".join(
                    f"{role}={count}" for role, count in sorted(dialog_roles.items())
                )
                parts.append(f"- Dialog structure: {role_counts}")
            if dialog_tools:
                parts.append(f"- Dialog tool calls: {', '.join(dialog_tools)}")
            if tool_result_count:
                parts.append(f"- Dialog tool results observed: {tool_result_count}")

        return "\n".join(parts) if parts else "(empty context)"

    def _call_llm(self, messages: list[dict]) -> str:
        """Single LLM call to generate the experience document."""
        if self.client.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.client.params.get("api_base"),
                api_key=self.client.params.get("api_key", ""),
                timeout=60,
            )
            resp = client.chat.completions.create(
                model=self.client.model,
                messages=messages,
            )
        else:
            params = self.client.params.copy()
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
