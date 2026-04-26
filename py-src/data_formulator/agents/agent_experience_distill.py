# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Experience distillation agent — extracts reusable knowledge from reasoning logs.

Given a session's reasoning log (JSONL lines) and the user's original question,
this agent calls an LLM to produce a structured Markdown experience document
with YAML front matter suitable for storage in the knowledge base.

Usage::

    agent = ExperienceDistillAgent(client)
    md_content = agent.run(reasoning_log_lines, user_question)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import litellm
import openai

from data_formulator.agents.client_utils import Client

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """\
You are a data analysis experience summarizer. Given the reasoning log of
a successful data analysis session, distill a reusable experience document.

The experience document must include:

1. **Title**: a short, descriptive title (one line)
2. **Scenario**: when is this experience applicable?
3. **Method**: the concrete analysis steps or techniques used
4. **Key findings**: important discoveries or caveats
5. **Tags**: keywords for future search (as a YAML list)

Output the result as a Markdown file with YAML front matter, like this:

```
---
title: <title>
tags: [<tag1>, <tag2>, ...]
created: <today's date YYYY-MM-DD>
updated: <today's date YYYY-MM-DD>
source: agent_summarized
source_session: <session_id>
---

## Scenario

<when to use>

## Method

<step by step>

## Key Findings

<important points>
```

Rules:
- Keep the experience concise and actionable (under 500 words).
- Focus on *reusable* patterns, not one-off specifics.
- Tags should be broad enough to match future queries.
- Do NOT include raw data, API keys, or sensitive information.
- Output ONLY the Markdown document, nothing else.

{language_instruction}
"""


class ExperienceDistillAgent:
    """Distills a reasoning log into a reusable experience document."""

    def __init__(
        self,
        client: Client,
        language_instruction: str = "",
    ) -> None:
        self.client = client
        self.language_instruction = language_instruction

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

        system = SYSTEM_PROMPT.format(
            language_instruction=self.language_instruction or "",
        )

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ]

        content = self._call_llm(messages)

        if not content.strip().startswith("---"):
            content = self._add_fallback_front_matter(
                content, session_id, today,
            )

        return content

    # -- internals ---------------------------------------------------------

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
        content: str, session_id: str, today: str,
    ) -> str:
        """Prepend front matter if the LLM didn't include it."""
        first_line = content.strip().split("\n")[0] if content.strip() else ""
        title = first_line.lstrip("# ").strip()[:80] or "Untitled Experience"

        header = (
            f"---\ntitle: {title}\n"
            f"tags: []\n"
            f"created: {today}\n"
            f"updated: {today}\n"
            f"source: agent_summarized\n"
            f"source_session: {session_id}\n"
            f"---\n\n"
        )
        return header + content
