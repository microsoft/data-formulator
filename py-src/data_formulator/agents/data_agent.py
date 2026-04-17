# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Streaming tool-calling data exploration agent.

The agent is a single-turn, tool-calling agent that streams text + tool
results to the frontend.  It has 3 tools (``explore``, ``visualize``,
``clarify``) and generates its own code + chart specs directly — no
sub-agent calls.

The agent's natural text output serves as narration/explanation (no
separate ``chat`` or ``present`` actions).  Each ``visualize`` result is
identical to the current ``DataRecAgent`` output, so the existing frontend
checkpoint pipeline works unchanged.
"""

import json
import logging
import time
from typing import Any, Generator

import litellm
import openai
import pandas as pd

from data_formulator.agents.agent_utils import (
    ensure_output_variable_in_code,
    generate_data_summary,
)
from data_formulator.agents.client_utils import Client
from data_formulator.prompts.chart_creation_guide import CHART_CREATION_GUIDE
from data_formulator.security.code_signing import sign_result
from data_formulator.workflows.create_vl_plots import (
    assemble_vegailte_chart,
    coerce_field_type,
    resolve_field_type,
    spec_to_base64,
    field_metadata_to_semantic_types,
)

logger = logging.getLogger(__name__)

# ── Max tool calls per turn (safety) ──────────────────────────────────────
MAX_TOOL_CALLS = 12

# ── Threshold for switching between full summaries and lightweight schema ──
SOURCE_TABLE_SUMMARY_THRESHOLD = 5

# ── Tool definitions (OpenAI function-calling format) ─────────────────────

INSPECT_SOURCE_DATA_TOOL = {
    "type": "function",
    "function": {
        "name": "inspect_source_data",
        "description": (
            "Get a detailed summary of one or more source tables — schema, "
            "field-level statistics, and sample rows. Use this to understand "
            "a table before writing visualize code. Much cheaper than explore()."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "table_names": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of table names from [SOURCE TABLES] to inspect.",
                },
            },
            "required": ["table_names"],
        },
    },
}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "explore",
            "description": (
                "Run Python code in a sandbox. Use for custom computations, "
                "verifying assumptions, or anything beyond basic table inspection. "
                "pandas, numpy, duckdb, sklearn, scipy are available. "
                "Use print() to see results — stdout is returned."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python code to execute. Use print() to see output.",
                    },
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "visualize",
            "description": (
                "Transform data and create a chart. Write a Python script that produces a "
                "result DataFrame, and specify the chart type and encoding channels. "
                "The code runs in a sandbox. The result is rendered as a Vega-Lite chart."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python code that produces a DataFrame assigned to the variable named in output_variable.",
                    },
                    "output_variable": {
                        "type": "string",
                        "description": "Name of the variable holding the result DataFrame (e.g. 'revenue_by_year').",
                    },
                    "chart": {
                        "type": "object",
                        "description": "Chart specification with chart_type, encodings, and optional config.",
                        "properties": {
                            "chart_type": {
                                "type": "string",
                                "description": "Chart type (e.g. 'Bar Chart', 'Line Chart', 'Scatter Plot').",
                            },
                            "encodings": {
                                "type": "object",
                                "description": "Mapping of visual channels to field names (e.g. {\"x\": \"year\", \"y\": \"revenue\"}).",
                            },
                            "config": {
                                "type": "object",
                                "description": "Optional chart configuration (e.g. {\"colorScheme\": \"viridis\"}).",
                            },
                        },
                        "required": ["chart_type", "encodings"],
                    },
                    "field_metadata": {
                        "type": "object",
                        "description": "Semantic type for each encoding field (e.g. {\"year\": \"Year\", \"revenue\": \"Amount\"}).",
                    },
                    "display_instruction": {
                        "type": "string",
                        "description": "Short verb phrase (<12 words) summarizing this visualization. Bold **column names**.",
                    },
                    "view": {
                        "type": "boolean",
                        "description": "If true, also return rendered chart image for verification. Default false.",
                    },
                },
                "required": ["code", "output_variable", "chart", "field_metadata", "display_instruction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clarify",
            "description": (
                "Ask the user a clarification question. Use only when genuinely ambiguous. "
                "Prefer making a reasonable assumption and proceeding."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "A polite, concise clarification question.",
                    },
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "2-4 short options covering the most likely interpretations.",
                    },
                },
                "required": ["question", "options"],
            },
        },
    },
]


# ── System prompt ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a data exploration agent.  Help the user answer their question by
exploring data and creating visualizations.

You have three tools:

1. **explore(code)** — run Python code for custom computations or to
   verify assumptions.  Use for anything beyond basic table inspection.
2. **visualize(code, output_variable, chart, field_metadata, display_instruction)** —
   transform data and create a chart.  The code must produce a DataFrame
   assigned to `output_variable`.
3. **clarify(question, options)** — ask the user a clarification question.
   Only use when genuinely ambiguous; prefer assuming and proceeding.
4. **inspect_source_data(table_names)** _(when available)_ — get a
   detailed summary of source tables (schema, stats, sample rows).
   Cheaper than `explore()` for basic inspection.

## Understanding your context

- **[SOURCE TABLES]**: Schema of every source table.  When there are few
  tables, full summaries with sample data are included.  When there are
  many, only column names + types + row count are shown — use
  `inspect_source_data()` to get details on tables you need.
- **[FOCUSED THREAD]** (if present): The thread the user is continuing.
  Build on this — do not repeat visualizations already created here.
- **[OTHER THREADS]** (if present): Brief summaries of other exploration
  threads.  Use these to avoid duplicating work done elsewhere.

## Workflow — describe → visualize → takeaway → repeat

Follow this interleaving pattern for each chart:

1. **Describe** (text): ONE sentence stating what you will analyze and
   why — e.g., "Cluster 0 has high fertility but low life expectancy —
   let me see how it changed over time."
2. **Visualize** (tool call): Create the chart.
3. **Takeaway** (text): ONE sentence with the key insight from the
   result — e.g., "Cluster 0 gained 15 years of life expectancy while
   fertility dropped by half."
4. **Repeat or stop**: If there is more to explore, go back to step 1
   for the next chart.  If findings are sufficient, stop — do not add
   extra text.

For the first chart you may need to inspect data first (`explore` or
`inspect_source_data`), but still follow describe → visualize → takeaway
after that.

## Decision guidelines

- **Start** by understanding the user question and the data.  If the
  question is clear, go ahead and describe + visualize.  If it is
  ambiguous, `clarify` first.
- **After each visualization**, review the result (data sample), write
  a takeaway, and decide your next move:
  - Describe + visualize again to go deeper (drill into a subset, add a
    breakdown, compare groups) if the question is not yet fully answered.
  - Stop if the findings are sufficient.
  - `clarify` if the result reveals the question needs scoping.
- **Build a narrative**: each chart should follow logically from the
  previous one — overview → drill-down → comparison.  Do not create
  unrelated charts.
- **Never** repeat a visualization that already exists in the trajectory.

## Text output rules

- Each text output should be exactly **ONE sentence**.
- **Before a visualize call** (describe): State what you will chart and
  why.
- **After a visualize result** (takeaway): State the single most
  important finding from the result.
- Your final text after the last chart is the takeaway for that chart.
  Do not add extra summaries, do not recap, do not list follow-ups.
- **Never** produce numbered lists, bullet points, markdown headers, or
  multi-paragraph text.

## Guidelines

- **Always produce at least one visualization.**  Never end a turn with
  only text.
- If code fails, fix the error and retry within the same turn.
{agent_exploration_rules}
"""


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class DataAgent:
    """Streaming tool-calling data exploration agent."""

    def __init__(
        self,
        client: Client,
        workspace,
        agent_exploration_rules: str = "",
        agent_coding_rules: str = "",
        language_instruction: str = "",
        rec_language_instruction: str | None = None,
        max_iterations: int = 5,
        max_repair_attempts: int = 1,
    ):
        self.client = client
        self.workspace = workspace
        self.agent_exploration_rules = agent_exploration_rules
        self.agent_coding_rules = agent_coding_rules
        self.language_instruction = language_instruction
        self.max_iterations = max_iterations
        self.max_repair_attempts = max_repair_attempts
        # Tools list is built per-run based on number of source tables
        self._tools = list(TOOLS)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        input_tables: list[dict[str, Any]],
        user_question: str,
        focused_thread: list[dict[str, Any]] | None = None,
        other_threads: list[dict[str, Any]] | None = None,
        trajectory: list[dict] | None = None,
        completed_step_count: int = 0,
    ) -> Generator[dict[str, Any], None, None]:
        """Run the streaming tool-calling exploration loop.

        Yields SSE event dicts with ``type`` in:
            ``"text_delta"``  – streamed text from the agent
            ``"tool_start"`` – agent is about to call a tool
            ``"tool_result"``– tool execution result
            ``"clarify"``    – clarification question (loop pauses)
            ``"done"``       – turn complete
            ``"error"``      – error information

        The ``"result"`` type (tool_result for visualize) produces a payload
        identical to the current DataRecAgent result, so the existing
        frontend checkpoint pipeline works unchanged.
        """
        messages = trajectory if trajectory is not None else self._build_initial_messages(
            input_tables, user_question, focused_thread, other_threads
        )

        # Conditionally add inspect_source_data tool for large workspaces
        source_count = sum(1 for t in input_tables if not t.get('name', '').startswith('d-'))
        if source_count > SOURCE_TABLE_SUMMARY_THRESHOLD:
            self._tools = [INSPECT_SOURCE_DATA_TOOL] + list(TOOLS)
        else:
            self._tools = list(TOOLS)

        tool_call_count = 0
        iteration = 0

        while True:
            iteration += 1

            # ── Call LLM with streaming + tools ──
            t_llm_start = time.time()
            try:
                stream = self._call_llm(messages, stream=True)
            except Exception as e:
                logger.error(f"[DataAgent] LLM call failed: {e}")
                yield {"type": "error", "error_message": str(e)}
                return

            # ── Accumulate streamed response ──
            collected_text: list[str] = []
            tool_calls_acc: dict[int, dict] = {}

            for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta is None:
                    continue

                # Stream text deltas
                if delta.content:
                    collected_text.append(delta.content)
                    yield {"type": "text_delta", "content": delta.content}

                # Accumulate tool calls from streamed deltas
                if hasattr(delta, 'tool_calls') and delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {
                                "id": getattr(tc_delta, 'id', None) or f"call_{idx}",
                                "name": "",
                                "arguments": "",
                            }
                        if hasattr(tc_delta, 'id') and tc_delta.id:
                            tool_calls_acc[idx]["id"] = tc_delta.id
                        if hasattr(tc_delta.function, 'name') and tc_delta.function.name:
                            tool_calls_acc[idx]["name"] = tc_delta.function.name
                        if hasattr(tc_delta.function, 'arguments') and tc_delta.function.arguments:
                            tool_calls_acc[idx]["arguments"] += tc_delta.function.arguments

            t_llm_elapsed = time.time() - t_llm_start
            logger.info(f"[DataAgent] iteration {iteration} LLM={t_llm_elapsed:.2f}s, "
                        f"text_len={sum(len(t) for t in collected_text)}, "
                        f"tool_calls={len(tool_calls_acc)}")

            # ── No tool calls → agent is done ──
            if not tool_calls_acc:
                break

            # ── Build assistant message for trajectory ──
            assistant_msg: dict[str, Any] = {
                "role": "assistant",
                "content": "".join(collected_text) or None,
            }
            assistant_msg["tool_calls"] = []
            for idx in sorted(tool_calls_acc.keys()):
                tc = tool_calls_acc[idx]
                assistant_msg["tool_calls"].append({
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": tc["arguments"],
                    },
                })
            messages.append(assistant_msg)

            # ── Execute each tool call ──
            for idx in sorted(tool_calls_acc.keys()):
                tc = tool_calls_acc[idx]
                tool_name = tc["name"]
                try:
                    tool_args = json.loads(tc["arguments"])
                except json.JSONDecodeError:
                    tool_args = {}

                tool_call_count += 1

                if tool_name == "inspect_source_data":
                    yield from self._handle_inspect_source_data(
                        tc, tool_args, messages, input_tables
                    )
                elif tool_name == "explore":
                    yield from self._handle_explore(
                        tc, tool_args, messages, input_tables
                    )
                elif tool_name == "visualize":
                    yield from self._handle_visualize(
                        tc, tool_args, messages, input_tables
                    )
                elif tool_name == "clarify":
                    yield from self._handle_clarify(
                        tc, tool_args, messages
                    )
                    # Clarify pauses the loop
                    return
                else:
                    # Unknown tool
                    error_msg = f"Unknown tool: {tool_name}"
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": json.dumps({"error": error_msg}),
                    })
                    yield {"type": "error", "error_message": error_msg}

            # ── Safety limit ──
            if tool_call_count >= MAX_TOOL_CALLS:
                logger.warning(f"[DataAgent] Hit max tool call limit ({MAX_TOOL_CALLS})")
                yield {"type": "text_delta", "content": "\n\nReached the tool call limit. Stopping exploration."}
                break

        # ── Done ──
        yield {
            "type": "done",
            "full_text": "".join(collected_text) if collected_text else "",
        }

    # ------------------------------------------------------------------
    # Tool handlers
    # ------------------------------------------------------------------

    def _handle_inspect_source_data(
        self,
        tc: dict,
        tool_args: dict,
        messages: list[dict],
        input_tables: list[dict[str, Any]],
    ) -> Generator[dict[str, Any], None, None]:
        """Handle the ``inspect_source_data`` tool call."""
        table_names = tool_args.get("table_names", [])

        yield {
            "type": "tool_start",
            "tool": "inspect_source_data",
            "args": {"table_names": table_names},
        }

        # Filter input_tables to only those requested
        tables_to_inspect = [
            t for t in input_tables if t.get("name") in table_names
        ]

        if not tables_to_inspect:
            result_content = f"No tables found matching: {table_names}"
        else:
            result_content = generate_data_summary(
                tables_to_inspect, workspace=self.workspace
            )

        yield {
            "type": "tool_result",
            "tool": "inspect_source_data",
            "status": "ok",
            "stdout": result_content,
        }

        messages.append({
            "role": "tool",
            "tool_call_id": tc["id"],
            "content": result_content,
        })

    def _handle_explore(
        self,
        tc: dict,
        tool_args: dict,
        messages: list[dict],
        input_tables: list[dict[str, Any]],
    ) -> Generator[dict[str, Any], None, None]:
        """Handle the ``explore`` tool call."""
        code = tool_args.get("code", "")

        yield {
            "type": "tool_start",
            "tool": "explore",
            "code": code,
        }

        result = self._run_explore_code(code, input_tables)

        yield {
            "type": "tool_result",
            "tool": "explore",
            "status": result.get("status", "ok"),
            "stdout": result.get("stdout", ""),
            "error": result.get("error"),
        }

        # Append tool result to messages
        messages.append({
            "role": "tool",
            "tool_call_id": tc["id"],
            "content": json.dumps(result, default=str),
        })

    def _handle_visualize(
        self,
        tc: dict,
        tool_args: dict,
        messages: list[dict],
        input_tables: list[dict[str, Any]],
    ) -> Generator[dict[str, Any], None, None]:
        """Handle the ``visualize`` tool call."""
        code = tool_args.get("code", "")
        output_variable = tool_args.get("output_variable", "result_df")
        chart_spec = tool_args.get("chart", {})
        field_metadata = tool_args.get("field_metadata", {})
        display_instruction = tool_args.get("display_instruction", "")
        view = tool_args.get("view", False)

        yield {
            "type": "tool_start",
            "tool": "visualize",
            "display_instruction": display_instruction,
            "code": code,
        }

        # Execute code in sandbox
        viz_result = self._run_visualize_code(
            code=code,
            output_variable=output_variable,
            chart_spec=chart_spec,
            field_metadata=field_metadata,
            display_instruction=display_instruction,
            view=view,
            input_tables=input_tables,
            messages=messages,
        )

        if viz_result["status"] == "ok":
            # Build a result payload identical to DataRecAgent output
            transform_result = viz_result["transform_result"]
            sign_result(transform_result)

            yield {
                "type": "tool_result",
                "tool": "visualize",
                "status": "ok",
                "display_instruction": display_instruction,
                "content": {
                    "question": display_instruction,
                    "result": transform_result,
                },
            }

            # Provide a concise summary back to the LLM
            data_content = transform_result["content"]
            sample_rows = data_content.get("rows", [])[:5]
            col_names = list(sample_rows[0].keys()) if sample_rows else []
            row_count = data_content.get("virtual", {}).get("row_count", len(sample_rows))

            tool_response: dict[str, Any] = {
                "status": "ok",
                "table_name": data_content.get("virtual", {}).get("table_name", output_variable),
                "columns": col_names,
                "row_count": row_count,
                "sample": sample_rows,
            }

            # Optionally include chart image
            if view and viz_result.get("chart_image"):
                tool_response["chart_image_available"] = True

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(tool_response, default=str),
            })
        else:
            error_msg = viz_result.get("error_message", "Unknown error")
            yield {
                "type": "tool_result",
                "tool": "visualize",
                "status": "error",
                "error_message": error_msg,
                "display_instruction": display_instruction,
            }
            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps({"status": "error", "error": error_msg}),
            })

    def _handle_clarify(
        self,
        tc: dict,
        tool_args: dict,
        messages: list[dict],
    ) -> Generator[dict[str, Any], None, None]:
        """Handle the ``clarify`` tool call."""
        question = tool_args.get("question", "")
        options = tool_args.get("options", [])

        # Append to messages for trajectory
        messages.append({
            "role": "tool",
            "tool_call_id": tc["id"],
            "content": json.dumps({"status": "waiting_for_user"}),
        })

        yield {
            "type": "clarify",
            "thought": "",
            "message": question,
            "options": options,
            "trajectory": self._strip_images(messages),
            "completed_step_count": 0,
        }

    # ------------------------------------------------------------------
    # Code execution
    # ------------------------------------------------------------------

    def _run_explore_code(
        self,
        code: str,
        input_tables: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Run explore code in sandbox, capturing stdout.

        Uses the same execution approach as the data loading chat agent:
        bypasses ``run_python_code`` (which requires a DataFrame output)
        and calls ``_run_in_warm_subprocess`` directly with a wrapper that
        captures stdout into ``_pack``.
        """
        from data_formulator.sandbox import create_sandbox

        try:
            from flask import current_app
            sandbox_mode = current_app.config.get('CLI_ARGS', {}).get('sandbox', 'local')
        except (ImportError, RuntimeError):
            sandbox_mode = 'local'

        sandbox = create_sandbox(sandbox_mode)

        # Wrap code: capture stdout + collect DataFrames (same as data loading chat)
        capture_code = (
            "import io as _io, sys as _sys, pandas as _pd\n"
            "_old_stdout = _sys.stdout\n"
            "_sys.stdout = _captured = _io.StringIO()\n"
            "\n"
            f"{code}\n"
            "\n"
            "_sys.stdout = _old_stdout\n"
            "_pack = {\n"
            "    'stdout': _captured.getvalue(),\n"
            "}\n"
        )

        try:
            with self.workspace.local_dir() as local_path:
                import os as _os
                workspace_path = _os.path.abspath(str(local_path))
                allowed_objects = {"_pack": None}
                raw = sandbox._run_in_warm_subprocess(
                    capture_code, allowed_objects, workspace_path
                )

            if raw["status"] == "ok":
                pack = raw["allowed_objects"].get("_pack", {})
                stdout = pack.get("stdout", "") if isinstance(pack, dict) else ""
                if not isinstance(stdout, str):
                    stdout = str(stdout)
                # Truncate for safety
                if len(stdout) > 8000:
                    stdout = stdout[:8000] + "\n... (truncated)"
                return {"status": "ok", "stdout": stdout}
            else:
                return {
                    "status": "error",
                    "error": raw.get("error_message", raw.get("content", "Unknown error")),
                    "stdout": "",
                }
        except Exception as e:
            return {"status": "error", "error": str(e), "stdout": ""}

    def _run_visualize_code(
        self,
        code: str,
        output_variable: str,
        chart_spec: dict,
        field_metadata: dict,
        display_instruction: str,
        view: bool,
        input_tables: list[dict[str, Any]],
        messages: list[dict] | None = None,
    ) -> dict[str, Any]:
        """Run visualize code in sandbox and assemble chart."""
        from data_formulator.sandbox import create_sandbox

        try:
            from flask import current_app
            sandbox_mode = current_app.config.get('CLI_ARGS', {}).get('sandbox', 'local')
            max_display_rows = current_app.config['CLI_ARGS'].get('max_display_rows', 5000)
        except (ImportError, RuntimeError):
            sandbox_mode = 'local'
            max_display_rows = 5000

        # Patch output_variable if needed
        code, was_patched, detected_var = ensure_output_variable_in_code(code, output_variable)
        if was_patched:
            logger.info(f"[DataAgent] patched output_variable: {output_variable} = {detected_var}")

        sandbox = create_sandbox(sandbox_mode)

        try:
            execution_result = sandbox.run_python_code(
                code=code,
                workspace=self.workspace,
                output_variable=output_variable,
            )

            if execution_result['status'] != 'ok':
                error_message = execution_result.get('content', 'Unknown error')
                return {"status": "error", "error_message": str(error_message)}

            full_df = execution_result['content']
            row_count = len(full_df)

            output_table_name = self.workspace.get_fresh_name(f"d-{output_variable}")
            self.workspace.write_parquet(full_df, output_table_name)

            if row_count > max_display_rows:
                query_output = full_df.head(max_display_rows)
            else:
                query_output = full_df
            query_output = query_output.loc[:, ~query_output.columns.duplicated()]

            # Build chart
            chart_image = self._create_chart(
                {"rows": json.loads(query_output.to_json(orient='records'))},
                chart_spec, field_metadata, view,
            )

            # Build refined_goal for frontend compatibility
            refined_goal = {
                "display_instruction": display_instruction,
                "output_variable": output_variable,
                "output_fields": list(query_output.columns),
                "chart": chart_spec,
                "field_metadata": field_metadata,
            }

            transform_result = {
                "status": "ok",
                "code": code,
                "content": {
                    "rows": json.loads(query_output.to_json(orient='records')),
                    "virtual": {
                        "table_name": output_table_name,
                        "row_count": row_count,
                    },
                },
                "refined_goal": refined_goal,
                "dialog": self._snapshot_dialog(messages),
                "agent": "DataAgent",
            }

            return {
                "status": "ok",
                "transform_result": transform_result,
                "chart_image": chart_image,
            }

        except Exception as e:
            logger.error(f"[DataAgent] Visualize execution error: {e}")
            return {"status": "error", "error_message": str(e)}

    def _create_chart(
        self,
        data: dict[str, Any],
        chart_spec: dict[str, Any],
        field_metadata: dict[str, Any] | None = None,
        view: bool = False,
    ) -> str | None:
        """Create a chart from data and return a base64 PNG string (if view=True)."""
        chart_type = chart_spec.get("chart_type", "Bar Chart")
        chart_encodings = chart_spec.get("encodings", {})
        chart_config = chart_spec.get("config", {})

        try:
            df = pd.DataFrame(data["rows"])
            if df.empty:
                return None

            encodings = {}
            for channel, field in chart_encodings.items():
                if field and field in df.columns:
                    field_type = resolve_field_type(df[field], field)
                    field_type = coerce_field_type(chart_type, channel, field_type)
                    encodings[channel] = {"field": field, "type": field_type}

            spec = assemble_vegailte_chart(
                df, chart_type, encodings, config=chart_config,
                semantic_types=field_metadata_to_semantic_types(field_metadata),
            )

            if view and spec:
                return spec_to_base64(spec)
            return None
        except Exception as e:
            logger.error(f"[DataAgent] Chart creation error: {e}")
            return None

    # ------------------------------------------------------------------
    # Message construction
    # ------------------------------------------------------------------

    def _build_system_prompt(self) -> str:
        rules_block = ""
        if self.agent_exploration_rules and self.agent_exploration_rules.strip():
            rules_block = (
                "\n## Additional exploration rules\n\n"
                + self.agent_exploration_rules.strip()
                + "\n\nPlease follow the above rules when exploring data."
            )
        prompt = SYSTEM_PROMPT.format(
            agent_exploration_rules=rules_block,
        )
        # Append the chart creation guide so the LLM knows chart types,
        # encoding channels, semantic types, and code rules from the start.
        prompt += "\n\n" + CHART_CREATION_GUIDE
        if self.agent_coding_rules and self.agent_coding_rules.strip():
            prompt += (
                "\n\n## Agent Coding Rules\n\n"
                + self.agent_coding_rules.strip()
            )
        if self.language_instruction:
            prompt = prompt + "\n\n" + self.language_instruction
        return prompt

    def _build_initial_messages(
        self,
        input_tables: list[dict[str, Any]],
        user_question: str,
        focused_thread: list[dict[str, Any]] | None = None,
        other_threads: list[dict[str, Any]] | None = None,
    ) -> list[dict]:
        """Build the initial messages with 3-tier context.

        Tier 1: Source tables (lightweight — column names + types + row count)
        Tier 2: Focused thread (detailed — per-step interaction history)
        Tier 3: Peripheral threads (minimal — one-line per step)
        """
        # Tier 1: Source table context — full summaries for small workspaces,
        # lightweight schema for large ones (agent uses inspect_source_data)
        source_count = sum(1 for t in input_tables if not t.get('name', '').startswith('d-'))
        if source_count <= SOURCE_TABLE_SUMMARY_THRESHOLD:
            table_summaries = generate_data_summary(input_tables, workspace=self.workspace)
        else:
            table_summaries = self._build_lightweight_table_context(input_tables)

        # Tier 2: Focused thread (detailed)
        focused_block = ""
        if focused_thread:
            focused_block = self._build_focused_thread_context(focused_thread)

        # Tier 3: Peripheral threads (minimal)
        peripheral_block = ""
        if other_threads:
            peripheral_block = self._build_peripheral_thread_context(other_threads)

        user_content = (
            f"[SOURCE TABLES]\n\n{table_summaries}\n\n"
        )
        if focused_block:
            user_content += f"{focused_block}\n\n"
        if peripheral_block:
            user_content += f"{peripheral_block}\n\n"
        user_content += f"[USER QUESTION]\n\n{user_question}"

        return [
            {"role": "system", "content": self._build_system_prompt()},
            {"role": "user", "content": user_content},
        ]

    def _build_focused_thread_context(
        self, focused_thread: list[dict[str, Any]]
    ) -> str:
        """Build Tier 2: detailed focused thread context.

        Each step includes user question, agent reasoning, chart type +
        encodings, created table metadata, and agent summary.
        """
        lines = ["[FOCUSED THREAD]"]
        for i, step in enumerate(focused_thread, 1):
            lines.append(f"\nStep {i}:")
            if step.get("user_question"):
                lines.append(f"  User: {step['user_question']}")
            if step.get("agent_thinking"):
                lines.append(f"  Agent thinking: {step['agent_thinking']}")
            if step.get("display_instruction"):
                lines.append(f"  Visualization: {step['display_instruction']}")
            # Table info
            table_name = step.get("table_name", "")
            columns = step.get("columns", [])
            row_count = step.get("row_count", 0)
            if table_name:
                col_str = ", ".join(columns[:15])
                if len(columns) > 15:
                    col_str += f", ... ({len(columns)} total)"
                lines.append(f"  Created: {table_name} ({row_count:,} rows: {col_str})")
            # Chart info
            chart_type = step.get("chart_type", "")
            encodings = step.get("encodings", {})
            if chart_type:
                enc_str = ", ".join(f"{k}: {v}" for k, v in encodings.items() if v)
                lines.append(f"  Chart: {chart_type} ({enc_str})")
            if step.get("agent_summary"):
                lines.append(f"  Summary: {step['agent_summary']}")
        return "\n".join(lines)

    def _build_peripheral_thread_context(
        self, other_threads: list[dict[str, Any]]
    ) -> str:
        """Build Tier 3: minimal peripheral thread context.

        One line per step, just display_instruction + chart type.
        """
        lines = ["[OTHER THREADS]"]
        for thread in other_threads:
            source = thread.get("source_table", "")
            leaf = thread.get("leaf_table", "")
            step_count = thread.get("step_count", 0)
            steps = thread.get("steps", [])
            lines.append(f"\nThread from {source} → {leaf} ({step_count} steps):")
            for step_line in steps:
                lines.append(f"  - {step_line}")
        return "\n".join(lines)

    def _build_lightweight_table_context(
        self, input_tables: list[dict[str, Any]]
    ) -> str:
        """Build lightweight table context: name, filename, columns+types, row count.

        The agent can ``explore()`` to inspect any table it needs in detail.
        """
        sections = []
        for table in input_tables:
            table_name = table['name']
            try:
                df = self.workspace.read_data_as_df(table_name)
                data_file_path = self.workspace.get_relative_data_file_path(table_name)
                num_rows = len(df)

                col_info = []
                for col in df.columns:
                    dtype = str(df[col].dtype)
                    # Simplify dtype names
                    if 'int' in dtype:
                        dtype = 'int'
                    elif 'float' in dtype:
                        dtype = 'float'
                    elif dtype == 'object':
                        dtype = 'str'
                    elif 'datetime' in dtype:
                        dtype = 'datetime'
                    elif 'bool' in dtype:
                        dtype = 'bool'
                    col_info.append(f"{col}({dtype})")

                section = (
                    f"Table: {table_name} (file: {data_file_path}, {num_rows:,} rows)\n"
                    f"  Columns: {', '.join(col_info)}"
                )
                sections.append(section)
            except Exception as e:
                logger.warning(f"[DataAgent] Could not read table {table_name}: {e}")
                sections.append(f"Table: {table_name} (error reading schema)")

        load_hint = (
            "\nTo load a table in code: pd.read_parquet('file.parquet') or "
            "duckdb.sql(\"SELECT * FROM read_parquet('file.parquet')\")\n"
            "Use the exact filename shown above."
        )
        return "\n\n".join(sections) + "\n" + load_hint

    # ------------------------------------------------------------------
    # LLM call
    # ------------------------------------------------------------------

    def _call_llm(self, messages: list[dict], stream: bool = True):
        """Call the LLM with tool definitions and streaming."""
        if self.client.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.client.params.get("api_base", None),
                api_key=self.client.params.get("api_key", ""),
                timeout=120,
            )
            return client.chat.completions.create(
                model=self.client.model,
                messages=messages,
                tools=self._tools,
                stream=stream,
            )
        else:
            params = self.client.params.copy()
            return litellm.completion(
                model=self.client.model,
                messages=messages,
                tools=self._tools,
                drop_params=True,
                stream=stream,
                **params,
            )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_images(trajectory: list[dict]) -> list[dict]:
        """Return a copy of the trajectory with image_url blocks removed."""
        stripped: list[dict] = []
        for msg in trajectory:
            content = msg.get("content")
            if isinstance(content, list):
                text_parts = [p for p in content if p.get("type") == "text"]
                if text_parts:
                    stripped.append({**msg, "content": text_parts})
                else:
                    stripped.append({**msg, "content": "[image removed]"})
            else:
                stripped.append(msg)
        return stripped

    @staticmethod
    def _snapshot_dialog(messages: list[dict] | None) -> list[dict]:
        """Snapshot the current conversation for the Agent Log dialog.

        Strips images and tool_calls internals to keep the payload
        manageable while preserving the full conversation flow.
        """
        if not messages:
            return []
        snapshot: list[dict] = []
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content")

            # Flatten multimodal content to text-only
            if isinstance(content, list):
                content = "\n".join(
                    p.get("text", "") for p in content if p.get("type") == "text"
                )

            # For assistant messages with tool_calls, summarize the calls
            if role == "assistant" and msg.get("tool_calls"):
                tool_summaries = []
                for tc in msg["tool_calls"]:
                    fn = tc.get("function", {})
                    tool_summaries.append(f"[tool call: {fn.get('name', '?')}]")
                text_part = content or ""
                combined = (text_part + "\n" + "\n".join(tool_summaries)).strip()
                snapshot.append({"role": role, "content": combined})
            elif role == "tool":
                # Show tool results as assistant context
                tool_content = content or ""
                # Truncate large tool results
                if len(tool_content) > 2000:
                    tool_content = tool_content[:2000] + "\n... (truncated)"
                snapshot.append({"role": "assistant", "content": f"[tool result]\n{tool_content}"})
            elif content:
                snapshot.append({"role": role, "content": content})
        return snapshot
