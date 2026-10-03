# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Lightweight single-turn agents that wrap a system prompt + one LLM call.

Each method takes a ``Client`` instance plus task-specific parameters and
returns a plain dict result (no streaming, no workspace access).
"""

import logging

from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.agent_language import inject_language_instruction

logger = logging.getLogger(__name__)

_AGENT_ID = "simple"


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_WORKSPACE_NAME_SYSTEM_PROMPT = (
    "You name data analysis workspaces for display in the product UI. "
    "Generate a very short workspace/session display name based on the context below. "
    "Describe the subject of the data sources (tables, files); use the user's first request, if any, to sharpen the focus. "
    "Do not mention counts or generic words such as 'table', 'data', or 'session'. "
    "The name is user-visible, so it must follow the user's interface language. "
    "Keep it concise: 3-5 words for English, or a similarly short phrase for other languages. "
    "Return ONLY the name, no quotes, no explanation, no trailing punctuation."
)


# ---------------------------------------------------------------------------
# Class
# ---------------------------------------------------------------------------

class SimpleAgents:
    """Collection of lightweight single-turn LLM agents."""

    def __init__(self, client, language_instruction: str = ""):
        self.client = client
        self.language_instruction = language_instruction

    # -- Workspace display name / auto-name ---------------------------------

    def workspace_name(self, table_names: list[str], user_query: str = "") -> str:
        """Generate a short display name for a workspace.

        Returns the display name string (already truncated to 60 chars).
        """
        prompt_parts = []
        if table_names:
            prompt_parts.append(f"Data sources: {', '.join(table_names)}")
        if user_query:
            prompt_parts.append(f"User's first request: {user_query}")

        context_str = ". ".join(prompt_parts) if prompt_parts else "A data analysis session"

        system_prompt = inject_language_instruction(
            _WORKSPACE_NAME_SYSTEM_PROMPT, self.language_instruction,
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": context_str},
        ]

        logger.info("[SimpleAgents.workspace_name] run start")
        response = self.client.get_completion(messages=messages, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model))
        display_name = response.choices[0].message.content.strip().strip("\"'")
        if len(display_name) > 60:
            display_name = display_name[:57] + "..."

        logger.info(f"[SimpleAgents.workspace_name] done | \"{display_name}\"")
        return display_name
