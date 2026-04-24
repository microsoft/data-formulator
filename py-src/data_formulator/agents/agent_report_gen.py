# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Report generation agent with tool-calling for inspect + embed.

Two-phase architecture:
  - **Phase 1 (Inspect)**: Non-streaming LLM call with inspection tools.
    Agent calls inspect_chart / inspect_source_data to gather information.
    Results are fed back as context. Invisible to the user.
  - **Phase 2 (Generate)**: Streaming LLM call with embedding tools.
    Agent writes the report narrative token-by-token.
    embed_chart / embed_table tool calls produce structured blocks
    in the output stream — rendered by the frontend as inline content.
"""

import json
import logging
from typing import Any, Generator

import litellm
import openai
import pandas as pd

from data_formulator.agents.agent_utils import generate_data_summary
from data_formulator.agents.context import (
    build_focused_thread_context,
    build_lightweight_table_context,
    build_peripheral_thread_context,
    handle_inspect_source_data,
)
from data_formulator.workflows.create_vl_plots import (
    assemble_vegailte_chart,
    coerce_field_type,
    resolve_field_type,
    spec_to_base64,
    field_metadata_to_semantic_types,
)

logger = logging.getLogger(__name__)

# ── Tool definitions ──────────────────────────────────────────────────────

INSPECT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "inspect_chart",
            "description": (
                "Get the visualization image and underlying data for one or more charts. "
                "Returns the chart image (PNG), a sample of the chart's data, "
                "and the transformation code that created it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "chart_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of chart IDs from [AVAILABLE CHARTS] to inspect.",
                    },
                },
                "required": ["chart_ids"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "inspect_source_data",
            "description": (
                "Get a detailed summary of one or more source tables — schema, "
                "field-level statistics, and sample rows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "table_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of table names to inspect.",
                    },
                },
                "required": ["table_names"],
            },
        },
    },
]


# ── System prompt ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a data journalist who creates concise, insightful reports based on data explorations.

The user message contains context about the workspace:
- **[PRIMARY TABLE(S)]** / **[OTHER AVAILABLE TABLES]**: Lightweight schema of datasets.
- **[FOCUSED THREAD]** (optional): The exploration thread the user is continuing.
- **[OTHER THREADS]** (optional): Brief summaries of other exploration threads.
- **[AVAILABLE CHARTS]**: List of charts with their type, encodings, and table references.

## Phase 1 — Inspect
Before writing, use `inspect_chart` and `inspect_source_data` to gather information about the charts and data you want to include. You don't need to inspect everything — focus on what's relevant to the user's request.

## Phase 2 — Write the report
Write a concise report (under 200 words, ~1 minute read).

To embed a chart image, use markdown image syntax with a `chart://` URL:
  ![Caption describing the chart](chart://chart_id)

Example: `![Monthly trade balance trend](chart://chart-123)`

The chart_id must match one from [AVAILABLE CHARTS]. Place each chart embed on its own line.

For data tables, just write standard markdown tables directly:
| date | value |
| --- | --- |
| 2020-01 | -43.5 |

Guidelines:
- Start with a `# Title`
- Connect findings into a coherent narrative
- For each chart, briefly explain what it shows and the key insight
- Use chart embeds at appropriate places
- Use markdown tables when you want to show specific data points
- End with a **In summary** paragraph
- Write in markdown, be concise, respect facts in the data
- Adapt your style to the user's request (blog, executive summary, casual, etc.)
- Do NOT make up facts or judgements beyond what the data shows
"""


class ReportGenAgent:
    """Tool-calling report generation agent with two-phase streaming."""

    def __init__(self, client, workspace, language_instruction=""):
        self.client = client
        self.workspace = workspace
        self.language_instruction = language_instruction

    def run(
        self,
        input_tables: list[dict[str, Any]],
        charts: list[dict[str, Any]],
        user_prompt: str = "Create a report summarizing the exploration.",
        focused_thread: list[dict[str, Any]] | None = None,
        other_threads: list[dict[str, Any]] | None = None,
        primary_tables: list[str] | None = None,
    ) -> Generator[dict[str, Any], None, None]:
        """Generate a report via two-phase tool-calling.

        Yields SSE-style dicts:
            {"type": "text_delta", "content": "..."}
            {"type": "embed_chart", "chart_id": "...", "caption": "..."}
            {"type": "embed_table", "table_id": "...", ...}

        Args:
            input_tables: Source table objects with name (rows optional for lightweight mode)
            charts: Chart descriptors: {chart_id, chart_type, encodings, table_ref, code?, chart_data?, chart_image?}
            user_prompt: The user's report request
            focused_thread: Rich thread context (from buildFocusedThread)
            other_threads: Peripheral thread summaries
            primary_tables: List of primary table names for prioritization
        """
        # Build context
        context = build_lightweight_table_context(
            input_tables, self.workspace, primary_tables=primary_tables
        )
        if focused_thread:
            context += "\n\n" + build_focused_thread_context(focused_thread)
        if other_threads:
            context += "\n\n" + build_peripheral_thread_context(other_threads)

        # Build available charts section
        if charts:
            chart_lines = ["[AVAILABLE CHARTS]"]
            for c in charts:
                enc_str = ", ".join(f"{k}: {v}" for k, v in c.get("encodings", {}).items() if v)
                chart_lines.append(
                    f"  - {c['chart_id']}: {c.get('chart_type', 'Unknown')} "
                    f"({enc_str}) → table: {c.get('table_ref', '?')}"
                )
            context += "\n\n" + "\n".join(chart_lines)

        # Build system prompt
        system_prompt = SYSTEM_PROMPT
        if self.language_instruction:
            system_prompt += "\n\n" + self.language_instruction

        messages: list[dict] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"{context}\n\n[USER REQUEST]\n\n{user_prompt}"},
        ]

        # ── Phase 1: Inspect (non-streaming) ──────────────────────────
        messages = self._run_inspect_phase(messages, input_tables, charts)

        # ── Phase 2: Generate (streaming with embed tools) ────────────
        yield from self._run_generate_phase(messages, charts, input_tables)

    # ------------------------------------------------------------------
    # Phase 1: Inspection loop
    # ------------------------------------------------------------------

    def _run_inspect_phase(
        self,
        messages: list[dict],
        input_tables: list[dict[str, Any]],
        charts: list[dict[str, Any]],
    ) -> list[dict]:
        """Run non-streaming inspect calls. Returns updated messages."""
        max_rounds = 5

        for _ in range(max_rounds):
            try:
                response = self._call_llm(messages, tools=INSPECT_TOOLS)
            except Exception as e:
                logger.warning(f"[ReportAgent] Inspect phase error: {e}")
                from data_formulator.error_handler import collect_stream_warning
                collect_stream_warning(
                    "Report data inspection failed — report may be incomplete",
                    detail=str(e),
                    message_code="INSPECT_PHASE_FAILED",
                )
                break

            if not response or not response.choices:
                break

            choice = response.choices[0]
            content = choice.message.content or ""
            tool_calls = getattr(choice.message, "tool_calls", None)

            if not tool_calls:
                # Agent is ready to write — don't append its text yet,
                # Phase 2 will re-prompt with embed tools
                break

            # Append assistant message
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": content or None,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ],
            }
            messages.append(assistant_msg)

            # Execute each tool
            for tc in tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                if tool_name == "inspect_chart":
                    tool_content = self._handle_inspect_chart(
                        tool_args.get("chart_ids", []), charts
                    )
                elif tool_name == "inspect_source_data":
                    tool_content = handle_inspect_source_data(
                        tool_args.get("table_names", []),
                        input_tables,
                        self.workspace,
                    )
                else:
                    tool_content = f"Unknown tool: {tool_name}"

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_content,
                })

            logger.info(f"[ReportAgent] Inspect phase: executed {len(tool_calls)} tool call(s)")

        return messages

    # ------------------------------------------------------------------
    # Phase 2: Streaming generation with embed tools
    # ------------------------------------------------------------------

    def _run_generate_phase(
        self,
        messages: list[dict],
        charts: list[dict[str, Any]],
        input_tables: list[dict[str, Any]],
    ) -> Generator[dict[str, Any], None, None]:
        """Stream the report as plain text with [IMAGE()] placeholders."""

        # Add a nudge to start writing
        messages.append({
            "role": "user",
            "content": (
                "Now write the report in markdown. "
                "Use ![caption](chart://chart_id) to embed charts."
            ),
        })

        try:
            stream = self._call_llm_streaming(messages, tools=None)
        except Exception as e:
            logger.error(f"[ReportAgent] Generate phase error: {e}")
            yield {"type": "text_delta", "content": f"Error generating report: {e}"}
            return

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if hasattr(delta, "content") and delta.content:
                yield {"type": "text_delta", "content": delta.content}

    # ------------------------------------------------------------------
    # Tool handlers
    # ------------------------------------------------------------------

    def _handle_inspect_chart(
        self,
        chart_ids: list[str],
        charts: list[dict[str, Any]],
    ) -> str:
        """Return chart details as text + image content for inspection."""
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

            # Data sample
            chart_data = chart.get("chart_data")
            if chart_data and chart_data.get("rows"):
                df = pd.DataFrame(chart_data["rows"])
                parts.append(f"  Data ({len(df)} rows, {len(df.columns)} cols):")
                parts.append(f"  Columns: {', '.join(df.columns.tolist())}")
                parts.append(f"  Sample:\n{df.head(5).to_string()}")

            # Chart image — return as base64 reference
            if chart.get("chart_image"):
                parts.append("  [Chart image available — shown below]")

            results.append("\n".join(parts))

        return "\n\n".join(results)

    def _resolve_table_data(
        self,
        table_id: str,
        input_tables: list[dict[str, Any]],
        charts: list[dict[str, Any]],
        columns: list[str] | None = None,
        max_rows: int = 10,
        sort_by: str | None = None,
    ) -> dict[str, Any]:
        """Resolve table data for embed_table — check both source tables and chart data tables."""
        # Check input tables
        table = next((t for t in input_tables if t.get("name") == table_id), None)

        # Check chart data tables
        if not table:
            for c in charts:
                cd = c.get("chart_data", {})
                if cd.get("name") == table_id:
                    table = cd
                    break

        if not table or not table.get("rows"):
            return {"columns": [], "rows": []}

        try:
            df = pd.DataFrame(table["rows"])
            if sort_by and sort_by in df.columns:
                df = df.sort_values(sort_by, ascending=False)
            if columns:
                valid_cols = [c for c in columns if c in df.columns]
                if valid_cols:
                    df = df[valid_cols]
            df = df.head(max_rows)
            return {
                "columns": df.columns.tolist(),
                "rows": df.to_dict(orient="records"),
            }
        except Exception as e:
            logger.error(f"[ReportAgent] resolve_table_data error: {e}")
            return {"columns": [], "rows": []}

    # ------------------------------------------------------------------
    # LLM call helpers
    # ------------------------------------------------------------------

    def _call_llm(self, messages: list[dict], tools: list[dict] | None = None):
        """Non-streaming LLM call with optional tool definitions."""
        if self.client.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.client.params.get("api_base", None),
                api_key=self.client.params.get("api_key", ""),
                timeout=120,
            )
            kwargs: dict[str, Any] = {
                "model": self.client.model,
                "messages": messages,
            }
            if tools:
                kwargs["tools"] = tools
            try:
                return client.chat.completions.create(**kwargs)
            except Exception as e:
                if self.client._is_image_deserialize_error(str(e)):
                    sanitized = self.client._strip_images_from_messages(messages)
                    kwargs["messages"] = sanitized
                    return client.chat.completions.create(**kwargs)
                raise
        else:
            params = self.client.params.copy()
            kwargs = {
                "model": self.client.model,
                "messages": messages,
                "drop_params": True,
            }
            if tools:
                kwargs["tools"] = tools
            kwargs.update(params)
            try:
                return litellm.completion(**kwargs)
            except Exception as e:
                if self.client._is_image_deserialize_error(str(e)):
                    sanitized = self.client._strip_images_from_messages(messages)
                    kwargs["messages"] = sanitized
                    return litellm.completion(**kwargs)
                raise

    def _call_llm_streaming(self, messages: list[dict], tools: list[dict] | None = None):
        """Streaming LLM call with optional tool definitions."""
        if self.client.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.client.params.get("api_base", None),
                api_key=self.client.params.get("api_key", ""),
                timeout=120,
            )
            kwargs: dict[str, Any] = {
                "model": self.client.model,
                "messages": messages,
                "stream": True,
            }
            if tools:
                kwargs["tools"] = tools
            try:
                return client.chat.completions.create(**kwargs)
            except Exception as e:
                if self.client._is_image_deserialize_error(str(e)):
                    sanitized = self.client._strip_images_from_messages(messages)
                    kwargs["messages"] = sanitized
                    return client.chat.completions.create(**kwargs)
                raise
        else:
            params = self.client.params.copy()
            kwargs = {
                "model": self.client.model,
                "messages": messages,
                "stream": True,
                "drop_params": True,
            }
            if tools:
                kwargs["tools"] = tools
            kwargs.update(params)
            try:
                return litellm.completion(**kwargs)
            except Exception as e:
                if self.client._is_image_deserialize_error(str(e)):
                    sanitized = self.client._strip_images_from_messages(messages)
                    kwargs["messages"] = sanitized
                    return litellm.completion(**kwargs)
                raise
