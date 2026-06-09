# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Report generation agent with tool-calling for inspect + embed.

Single agentic loop:
  - Each round is a streaming LLM call with the inspection tools available.
    The agent calls inspect_chart / inspect_source_data to gather information
    whenever it needs it; the results (and rendered chart images) are fed back
    as context and the loop continues.
  - When the agent stops calling tools and starts writing prose, that prose IS
    the report — it streams token-by-token to the user, with charts embedded
    inline via ![caption](chart://chart_id) markdown links.
  - Because the tool channel stays available throughout, the agent uses real
    tool calls instead of leaking tool-call syntax into the report text.
"""

import json
import logging
import re
from typing import Any, Generator

import pandas as pd

from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.agent_utils import (
    accumulate_reasoning_content,
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

## Inspecting charts and data
You have two tools available the whole time: `inspect_chart` and
`inspect_source_data`. Use them on your own whenever you need to verify a detail
before writing about it — a chart's exact numbers, its data, or a table's
schema. `inspect_chart` returns the chart's rendered image, a data sample, and
the code that produced it. Check the charts behind the key findings you present.

## Write the report
Write the report directly in markdown — your prose streams straight to the
reader. Inspect whatever you need as you go.

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


# Defense-in-depth: keeping the tool channel available across the whole loop
# means the model normally uses real tool calls instead of writing tool-call
# syntax as text. But some harmony / gpt-oss style models still occasionally leak
# their tool-call channel into the text stream (e.g. "to=functions.inspect_chart
# ... json {\"chart_ids\": [...]}"), sometimes with degenerate spam tokens. As a
# cheap last line of defense we strip the obvious leak markers out of each
# streamed delta before it reaches the report.
_LEAK_SPECIAL_TOKEN = re.compile(r"<\|[^|>]*\|>")
_LEAK_TOOLCALL = re.compile(
    r"(?:\bcommentary\b\s*)?\bto\s*=\s*functions\.[A-Za-z0-9_]+"
    r"[\s\S]*?\{[\s\S]*?\}",
)


def _strip_leaked_tool_syntax(text: str) -> str:
    """Remove leaked harmony special tokens and tool-call headers (with their
    trailing JSON args) from a streamed report delta. Clean prose is untouched."""
    text = _LEAK_TOOLCALL.sub("", text)
    text = _LEAK_SPECIAL_TOKEN.sub("", text)
    return text


class ReportGenAgent:
    """Tool-calling report generation agent with a single streaming loop."""

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
        """Generate a report via a single tool-calling loop.

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

        write_instruction = (
            "Write a report in markdown that covers the key findings across the "
            "exploration — don't reduce it to a single chart unless the request "
            "explicitly asks for something that brief. Pull up whatever charts or "
            "data you need to look at as you go (this happens automatically and "
            "is invisible to the reader), and embed each chart you discuss with "
            "![caption](chart://chart_id)."
        )
        messages: list[dict] = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"{context}\n\n[USER REQUEST]\n\n{user_prompt}\n\n{write_instruction}",
            },
        ]

        # Single agentic loop: the model inspects via tool calls as needed, then
        # streams the report. Tools stay available throughout, so it uses the
        # real tool channel instead of leaking tool-call syntax as text.
        yield from self._run_agent_loop(messages, charts, input_tables)

    # ------------------------------------------------------------------
    # Agentic loop: inspect-as-needed, then stream the report
    # ------------------------------------------------------------------

    def _run_agent_loop(
        self,
        messages: list[dict],
        charts: list[dict[str, Any]],
        input_tables: list[dict[str, Any]],
    ) -> Generator[dict[str, Any], None, None]:
        """Single streaming tool-calling loop.

        Each round is a streaming LLM call with the inspect tools available. If
        the model emits tool calls, we execute them (attaching rendered chart
        images) and loop. When the model stops calling tools and just writes
        prose, that prose IS the report and streams straight to the user.
        Because the tool channel stays available the whole time, the model never
        has to fall back to writing tool-call syntax as text.
        """
        max_rounds = 6

        for round_idx in range(max_rounds):
            try:
                stream = self._call_llm_streaming(messages, tools=INSPECT_TOOLS)
            except Exception as e:
                logger.error(f"[ReportAgent] LLM call failed: {e}")
                yield {"type": "text_delta", "content": f"Error generating report: {e}"}
                return

            text_parts: list[str] = []
            reasoning_acc: str | None = None
            tool_calls_acc: dict[int, dict[str, Any]] = {}

            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                reasoning_acc = accumulate_reasoning_content(reasoning_acc, delta)

                content = getattr(delta, "content", None)
                if content:
                    text_parts.append(content)
                    cleaned = _strip_leaked_tool_syntax(content)
                    if cleaned:
                        yield {"type": "text_delta", "content": cleaned}

                for tcd in getattr(delta, "tool_calls", None) or []:
                    idx = getattr(tcd, "index", 0) or 0
                    slot = tool_calls_acc.setdefault(
                        idx, {"id": None, "name": "", "arguments": ""}
                    )
                    if getattr(tcd, "id", None):
                        slot["id"] = tcd.id
                    fn = getattr(tcd, "function", None)
                    if fn is not None:
                        if getattr(fn, "name", None):
                            slot["name"] = fn.name
                        if getattr(fn, "arguments", None):
                            slot["arguments"] += fn.arguments

            # No tool calls this round → the model wrote the report. Done.
            if not tool_calls_acc:
                return

            # Inspection round: record the tool calls, execute them, then loop.
            ordered = [tool_calls_acc[i] for i in sorted(tool_calls_acc)]
            for i, tc in enumerate(ordered):
                if not tc["id"]:
                    tc["id"] = f"call_{round_idx}_{i}"

            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(text_parts) or None,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["arguments"] or "{}",
                        },
                    }
                    for tc in ordered
                ],
            }
            if reasoning_acc:
                assistant_msg["reasoning_content"] = reasoning_acc
            messages.append(assistant_msg)

            # Chart images can't ride along in tool-result messages on most
            # providers, so we collect them and attach them as a single
            # follow-up vision message after all tool results.
            pending_images: list[str] = []
            for tc in ordered:
                tool_name = tc["name"]
                try:
                    tool_args = json.loads(tc["arguments"] or "{}")
                except json.JSONDecodeError:
                    tool_args = {}

                # Tell the frontend what the agent is doing (start/end), the
                # same way the data agent streams tool_start / tool_result.
                yield {
                    "type": "tool_start",
                    "tool": tool_name,
                    "chart_ids": tool_args.get("chart_ids") if tool_name == "inspect_chart" else None,
                    "table_names": tool_args.get("table_names") if tool_name == "inspect_source_data" else None,
                }

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

                yield {"type": "tool_result", "tool": tool_name, "status": "ok"}

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
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

            logger.info(
                f"[ReportAgent] Round {round_idx + 1}: executed "
                f"{len(ordered)} tool call(s)"
            )

        logger.warning("[ReportAgent] Tool-call rounds exhausted without a report")

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

    def _call_llm_streaming(self, messages: list[dict], tools: list[dict] | None = None):
        """Streaming LLM call with optional tool definitions."""
        if tools:
            return self.client.get_completion_with_tools(
                messages, tools=tools, stream=True, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model),
            )
        return self.client.get_completion(messages, stream=True, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model))
