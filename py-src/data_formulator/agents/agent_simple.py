# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Lightweight single-turn agents that wrap a system prompt + one LLM call.

Each method takes a ``Client`` instance plus task-specific parameters and
returns a plain dict result (no streaming, no workspace access).
"""

import json
import logging

from data_formulator.agents.agent_utils import extract_json_objects
from data_formulator.agents.agent_language import inject_language_instruction

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_NL_FILTER_SYSTEM_PROMPT = """\
You are a data loading assistant. The user wants to load a subset of a database table \
based on a natural language description. Your job is to translate their request into a \
structured JSON query specification (Selection, Projection-free, Join-free — SPJ without projection).

You will be given:
- A table's column schema (name + type)
- A user's natural language description of what data they want

Return a JSON object with:
{
  "conditions": [
    {"column": "<col_name>", "operator": "<op>", "value": <val>}
  ],
  "sort_columns": ["<col>"],   // optional — include if the user mentions ordering
  "sort_order": "asc" | "desc", // optional, default "asc"
  "limit": <number>             // optional — include if the user mentions a row limit
}

All columns will be selected (no projection). Focus on filtering (WHERE), sorting (ORDER BY), and limiting (LIMIT).

Valid operators: =, !=, >, <, >=, <=, LIKE, NOT LIKE, IN, NOT IN, BETWEEN, IS NULL, IS NOT NULL
- For LIKE: use SQL wildcards (e.g. "value": "%pattern%")
- For IN / NOT IN: "value" is an array
- For BETWEEN: "value" is [lo, hi]
- For IS NULL / IS NOT NULL: omit "value"

Rules:
- Only use column names from the provided schema.
- Infer reasonable filter values from context (e.g. "recent" → sort by date desc + limit, \
"last year" → date >= '2025-01-01').
- If the user mentions sorting or limiting, include sort_columns/sort_order/limit.
- If the instruction is empty or unclear, return {"conditions": []}.
- Return ONLY the JSON object, no markdown fences or explanation."""

_WORKSPACE_NAME_SYSTEM_PROMPT = (
    "You name data analysis workspaces for display in the product UI. "
    "Generate a very short workspace/session display name based on the context below. "
    "The name is user-visible, so it must follow the user's interface language. "
    "Keep it concise: 3-5 words for English, or a similarly short phrase for other languages. "
    "Return ONLY the name, no quotes, no explanation, no trailing punctuation."
)


_CHART_INTENT_SYSTEM_PROMPT = (
    "Route a chart edit request to one of two agents.\n"
    "\n"
    "  STYLE — restyling and presentation tweaks: colors, themes, fonts, axis\n"
    "    labels, legends, sort order, scale type, swapping or hiding existing\n"
    "    encodings. The chart's data stays as-is.\n"
    "\n"
    "  DATA — anything that needs new data: filter rows, compute a new column,\n"
    "    re-aggregate, join another table, change to a chart that needs a\n"
    "    column the table doesn't have.\n"
    "\n"
    "Mixed requests count as DATA. When in doubt, prefer DATA.\n"
    "\n"
    "Requests may be in any language. Reply with one word: STYLE or DATA."
)


# ---------------------------------------------------------------------------
# Class
# ---------------------------------------------------------------------------

class SimpleAgents:
    """Collection of lightweight single-turn LLM agents."""

    def __init__(self, client, language_instruction: str = ""):
        self.client = client
        self.language_instruction = language_instruction

    # -- NL → structured filter conditions ----------------------------------

    def nl_to_filter(self, columns: list[dict], instruction: str) -> dict:
        """Translate *instruction* into structured filter conditions.

        Parameters
        ----------
        columns : list[dict]
            Column schema, each entry ``{"name": ..., "type": ...}``.
        instruction : str
            Natural-language filter description from the user.

        Returns
        -------
        dict with keys ``conditions``, ``sort_columns``, ``sort_order``, ``limit``.
        """
        col_desc = "\n".join(
            f"  - {c['name']} ({c.get('type', 'unknown')})"
            + (f": {c['description']}" if c.get('description') else "")
            for c in columns
        )
        user_msg = f"Table columns:\n{col_desc}\n\nFilter instruction: {instruction}"

        messages = [
            {"role": "system", "content": _NL_FILTER_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ]

        logger.info("[SimpleAgents.nl_to_filter] run start")
        response = self.client.get_completion(messages=messages)
        raw = response.choices[0].message.content.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        result = json.loads(raw)

        # Validate: only allow known column names
        known_cols = {c["name"] for c in columns}
        valid_conditions = [
            cond for cond in (result.get("conditions") or [])
            if cond.get("column") in known_cols
        ]

        out = {
            "conditions": valid_conditions,
            "sort_columns": result.get("sort_columns"),
            "sort_order": result.get("sort_order"),
            "limit": result.get("limit"),
        }
        logger.info(f"[SimpleAgents.nl_to_filter] done | {len(valid_conditions)} conditions")
        return out

    # -- Workspace display name / auto-name ---------------------------------

    def workspace_name(self, table_names: list[str], user_query: str = "") -> str:
        """Generate a short display name for a workspace.

        Returns the display name string (already truncated to 60 chars).
        """
        prompt_parts = []
        if table_names:
            prompt_parts.append(f"Data tables: {', '.join(table_names)}")
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
        response = self.client.get_completion(messages=messages)
        display_name = response.choices[0].message.content.strip().strip("\"'")
        if len(display_name) > 60:
            display_name = display_name[:57] + "..."

        logger.info(f"[SimpleAgents.workspace_name] done | \"{display_name}\"")
        return display_name

    # -- Chart prompt intent classifier -------------------------------------

    def classify_chart_intent(self, instruction: str) -> str:
        """Classify a chart-prompt as STYLE or DATA.

        Used by the encoding-shelf input on Enter to decide whether to send
        the prompt to the chart-restyle agent (cheap, single LLM call,
        modifies vlSpec only) or to the full data agent (data shape changes,
        new fields, chart-type changes, etc.).

        Multilingual by design — keyword heuristics are too brittle for
        non-English prompts. Returns 'style' or 'data' (always lowercase).

        On any failure, returns 'data' as the safe default — the data agent
        can handle anything; mistakenly sending a style request there is
        slower but produces a usable result.
        """
        text = (instruction or "").strip()
        if not text:
            return "data"

        messages = [
            {"role": "system", "content": _CHART_INTENT_SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ]

        try:
            response = self.client.get_completion(messages=messages)
            raw = (response.choices[0].message.content or "").strip().upper()
        except Exception as e:
            logger.warning("[SimpleAgents.classify_chart_intent] LLM call failed: %s", e)
            return "data"

        # The model may add stray punctuation/quotes despite the prompt; be lenient.
        if "STYLE" in raw and "DATA" not in raw:
            verdict = "style"
        else:
            verdict = "data"
        logger.info("[SimpleAgents.classify_chart_intent] %r -> %s", text[:80], verdict)
        return verdict
