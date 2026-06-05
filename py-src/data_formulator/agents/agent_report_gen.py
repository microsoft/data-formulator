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

import pandas as pd

from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.agent_utils import (
    attach_reasoning_content,
    generate_data_summary,
)
from data_formulator.agents.agent_language import inject_language_instruction
from data_formulator.datalake.parquet_utils import df_to_safe_records
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

_AGENT_ID = "report_gen"

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
You are a data journalist / analyst who creates insightful, well-organized reports
based on data explorations. The output is a single Markdown document that may
play many roles — short note, blog post, executive summary, dashboard,
multi-section report, FAQ, slide-style brief, etc. Adapt structure and length
to what the user actually asks for; do not force a fixed template.

The user message contains context about the workspace:
- **[PRIMARY TABLE(S)]** / **[OTHER AVAILABLE TABLES]**: Lightweight schema of datasets.
- **[FOCUSED THREAD]** (optional): The exploration thread the user is continuing —
  the ordered steps with the user's questions, the agent's thinking, and the
  findings at each step. This is the spine of the story you are telling.
- **[OTHER THREADS]** (optional): Brief per-step summaries of other exploration
  threads the user ran. These are additional findings worth weaving in.
- **[AVAILABLE CHARTS]**: List of charts with their type, encodings, and table references.

## Ground the report in the exploration
The thread context is your most important input. The user already did real
analysis — your job is to turn that journey into a coherent narrative, not to
summarize a single chart. Before writing:
- Read the FOCUSED THREAD and OTHER THREADS to understand the full set of
  questions asked and findings reached.
- Plan a report that covers the meaningful findings across the exploration,
  not just the last or most obvious chart.

## Phase 1 — Inspect
Use `inspect_chart` and `inspect_source_data` to gather what you need before
writing. `inspect_chart` returns the chart's rendered image, a data sample, and
the transformation code — so you can see exactly what each chart shows and write
accurate captions and insights.
- Inspect the charts that correspond to the key findings you plan to present.
  For a multi-section report or dashboard, that usually means several charts.
- You can inspect multiple charts in one call (pass several chart_ids).
- Don't fetch charts you have no intention of discussing, but don't under-inspect
  either — a report that ignores most of the exploration is a poor report.

## Phase 2 — Write the report

### Embedding charts (REQUIRED FORMAT — do not change this)
To embed a chart image, use markdown image syntax with a `chart://` URL:
  ![Caption describing the chart](chart://chart_id)

Example: `![Monthly trade balance trend](chart://chart-123)`

The chart_id must match one from [AVAILABLE CHARTS]. Place each chart embed on
its own line (it renders as a block). You can embed the same chart at most
once. Captions are short — one line describing what the chart shows.

### Tables
For data tables, write standard markdown tables directly:
| date | value |
| --- | --- |
| 2020-01 | -43.5 |

### Style & structure — adapt to the user's request
The user may ask for any of:
- a short note or social-style summary (a few sentences, one or two charts),
- a blog post / narrative report (intro → findings → takeaway),
- an executive summary (key numbers up top, then context),
- a KPI dashboard / multi-section overview (headings per topic, multiple charts
  arranged with short commentary between them),
- a slide-style brief (compact sections with bullet points and embedded charts),
- a deeper analytical report with sub-sections, methodology notes, and caveats.

Pick the structure that fits the request and the available material. Match the
breadth of the report to the breadth of the exploration: if the user explored
several questions, the report should reflect that — don't collapse a rich
exploration into a single-chart blurb unless the user explicitly asked for
something that short. Reasonable defaults if the user is vague:
- Start with a `# Title` that reflects the topic.
- Group related findings under `##` (and `###` if useful) headings, typically
  one section per key finding / thread.
- Around each embedded chart, briefly explain what it shows and the key insight.
- Use bullets / short paragraphs / tables where they help; don't pad.
- Close with a brief takeaway or summary section if the report is more than a
  few paragraphs. For very short outputs (notes, single-chart blurbs), a closing
  summary is optional.

### Guardrails
- Write in Markdown. Keep prose tight; let the data and charts carry the weight.
- Stay faithful to the data — do not invent numbers, comparisons, or causation
  that the data does not actually support.
- It is fine to flag uncertainty ("based on the sample shown…") when appropriate.
- Embed every chart you discuss; don't reference a chart in prose without showing it.
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
            input_tables, self.workspace, primary_tables=primary_tables,
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
        system_prompt = inject_language_instruction(system_prompt, self.language_instruction)

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
            attach_reasoning_content(assistant_msg, choice.message)
            messages.append(assistant_msg)

            # Execute each tool. Chart images can't ride along in tool-result
            # messages on most providers, so we collect them and attach them as
            # a single follow-up vision message after all tool results.
            pending_images: list[str] = []
            for tc in tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                if tool_name == "inspect_chart":
                    tool_content, image_urls = self._handle_inspect_chart(
                        tool_args.get("chart_ids", []), charts
                    )
                    pending_images.extend(image_urls)
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

            # Attach rendered chart images so the agent can visually inspect
            # them before deciding what to embed.
            if pending_images:
                image_blocks: list[dict[str, Any]] = [{
                    "type": "text",
                    "text": (
                        "[INSPECTED CHART IMAGE(S)] Rendered images for the "
                        "charts you just inspected, in request order:"
                    ),
                }]
                for url in pending_images:
                    image_blocks.append({
                        "type": "image_url",
                        "image_url": {"url": url, "detail": "high"},
                    })
                messages.append({"role": "user", "content": image_blocks})

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
                "Now write the report in markdown, grounded in the exploration "
                "threads and the charts/data you inspected. Cover the key "
                "findings across the exploration — don't reduce it to a single "
                "chart unless the request explicitly calls for something that "
                "brief. Embed each chart you discuss with "
                "![caption](chart://chart_id)."
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
    ) -> tuple[str, list[str]]:
        """Inspect charts: return a text summary plus rendered chart images.

        Returns ``(text_summary, image_urls)`` where ``image_urls`` is a list of
        base64 PNG data URLs (one per chart that could be rendered). Images are
        returned separately so the caller can attach them as a follow-up vision
        message — tool-result messages cannot carry image content on most
        providers.
        """
        results = []
        image_urls: list[str] = []
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

            # Render the chart image server-side, on demand. We prefer a
            # frontend-supplied thumbnail; otherwise we render from the chart
            # data + encodings so the agent can actually see what it embeds.
            image = chart.get("chart_image") or self._render_chart_image(chart)
            if image:
                image_urls.append(image)
                parts.append("  [Chart image attached below for visual inspection]")
            else:
                parts.append("  [Chart image unavailable — reason about it from data + encodings]")

            results.append("\n".join(parts))

        return "\n\n".join(results), image_urls

    def _render_chart_image(self, chart: dict[str, Any]) -> str | None:
        """Render a chart to a base64 PNG data URL from its data + encodings.

        Mirrors the DataAgent thumbnail path: resolve field types from the
        chart's sample data, assemble a Vega-Lite spec, and rasterize it.
        Returns ``None`` if there is not enough information to render.
        """
        chart_data = chart.get("chart_data") or {}
        rows = chart_data.get("rows")
        if not rows:
            return None

        chart_type = chart.get("chart_type", "Bar Chart")
        raw_encodings = chart.get("encodings", {}) or {}
        try:
            df = pd.DataFrame(rows)
            if df.empty:
                return None

            encodings: dict[str, dict[str, str]] = {}
            for channel, field in raw_encodings.items():
                if field and field in df.columns:
                    field_type = resolve_field_type(df[field], field)
                    field_type = coerce_field_type(chart_type, channel, field_type)
                    encodings[channel] = {"field": field, "type": field_type}

            if not encodings:
                return None

            spec = assemble_vegailte_chart(df, chart_type, encodings)
            return spec_to_base64(spec) if spec else None
        except Exception as e:
            logger.warning(f"[ReportAgent] Chart render error for {chart.get('chart_id')}: {e}")
            return None


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
                "rows": df_to_safe_records(df),
            }
        except Exception as e:
            logger.error(f"[ReportAgent] resolve_table_data error: {e}")
            return {"columns": [], "rows": []}

    # ------------------------------------------------------------------
    # LLM call helpers
    # ------------------------------------------------------------------

    def _call_llm(self, messages: list[dict], tools: list[dict] | None = None):
        """Non-streaming LLM call with optional tool definitions."""
        if tools:
            return self.client.get_completion_with_tools(
                messages, tools=tools, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model),
            )
        return self.client.get_completion(messages, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model))

    def _call_llm_streaming(self, messages: list[dict], tools: list[dict] | None = None):
        """Streaming LLM call with optional tool definitions."""
        if tools:
            return self.client.get_completion_with_tools(
                messages, tools=tools, stream=True, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model),
            )
        return self.client.get_completion(messages, stream=True, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model))
