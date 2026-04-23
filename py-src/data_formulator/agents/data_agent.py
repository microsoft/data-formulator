# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Hybrid data exploration agent (Option A with tool-calling for data inspection).

Architecture:
  - **Tools** (explore, inspect_source_data): Called via OpenAI tool-calling
    API within a single LLM turn.  The agent gathers data silently — these
    are internal to the agent and not surfaced to the user.
  - **Actions** (visualize, clarify, present): Structured JSON output in
    the LLM's text response.  These are externalized to the user — each
    one ends the current turn and produces visible output.

The server-side while loop handles one action per iteration:
  1. Call LLM (with tools) → agent may call tools internally
  2. Parse the structured JSON action from the text response
  3. Execute the action (sandbox, chart assembly, etc.)
  4. Append rich observation to trajectory
  5. Repeat or terminate
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
    extract_json_objects,
    generate_data_summary,
)
from data_formulator.agents.context import (
    build_focused_thread_context,
    build_lightweight_table_context,
    build_peripheral_thread_context,
    handle_inspect_source_data,
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

# ── Tool definitions (OpenAI function-calling format) ─────────────────────
# These are internal tools the agent can use freely within a turn to
# gather data before committing to a user-visible action.

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "think",
            "description": (
                "Share your reasoning or findings with the user before taking "
                "an action. Use this to explain what you discovered from the "
                "data and what you plan to do next."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Your reasoning, findings, or plan.",
                    },
                },
                "required": ["message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explore",
            "description": (
                "Run Python code to inspect data, compute statistics, or verify "
                "assumptions.  Use print() to see results — stdout is returned. "
                "pandas, numpy, duckdb, sklearn, scipy are available."
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
            "name": "inspect_source_data",
            "description": (
                "Get a detailed summary of one or more source tables — schema, "
                "field-level statistics, and sample rows.  Cheaper than explore() "
                "for basic data inspection."
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
    },
]


# ── System prompt ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = '''\
You are an autonomous data exploration agent.

Your goal is to help the user answer their question by creating one or more
data visualizations.  You operate in a loop.

## Tools (internal — for data gathering)

You have tools you can call freely to gather data and share reasoning:

- **think(message)** — share your reasoning or findings with the user
  before taking an action.  Always call this before `visualize` to
  explain what you found and why you chose this chart.
- **explore(code)** — run Python code to inspect data, compute stats, etc.
- **inspect_source_data(table_names)** — get schema, stats, and sample rows
  for source tables (cheaper than explore for basic inspection).

Call tools as many times as needed.  Tool results are returned to you
before you produce your action.  Tools are NOT shown to the user.

## Actions (external — shown to the user)

After gathering data (or immediately if the data is clear), output
**exactly one action** as a JSON object in your text response.  Actions
are shown to the user and end the current turn.

### `visualize`
```json
{{
    "action": "visualize",
    "display_instruction": "<casual first-person, ≤25 words. Bold **column names**. e.g. 'Plotting **fertility** vs **life_expect** by **cluster** to see how demographic groups differ'>",
    "input_tables": ["<table names from [SOURCE TABLES] that the code reads>"],
    "code": "<Python code producing a DataFrame assigned to output_variable>",
    "output_variable": "<snake_case variable name>",
    "chart": {{
        "chart_type": "<from chart type reference>",
        "encodings": {{"x": "<field>", "y": "<field>", ...}},
        "config": {{}}
    }},
    "field_metadata": {{"<field>": "<SemanticType>", ...}},
    "field_display_names": {{"<field>": "<human-readable display name for chart axes and table headers>", ...}}
}}
```

### `clarify`
```json
{{
    "action": "clarify",
    "message": "<a polite, concise question>",
    "options": ["<option 1>", "<option 2>", "<option 3>"]
}}
```

### `present`
```json
{{
    "action": "present",
    "summary": "<one sentence (≤ 25 words) summarizing the key finding>"
}}
```

## Understanding your context

{{context_guide}}

## Decision guidelines

- **Start** by understanding the question and data.  Use tools if needed,
  then `visualize`.  If ambiguous, `clarify`.
- **After a visualization**, review the observation (data + chart) and:
  - `visualize` again to go deeper (drill-down, breakdown, comparison).
  - `present` if findings are sufficient.
  - `clarify` if the question needs scoping.
- **Build a narrative**: overview → drill-down → comparison.
- **Never** repeat a visualization already in the trajectory.
- Present after at most {max_iterations} visualization steps.

{agent_exploration_rules}
'''


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class DataAgent:
    """Structured JSON data exploration agent."""

    def __init__(
        self,
        client: Client,
        workspace,
        agent_exploration_rules: str = "",
        agent_coding_rules: str = "",
        language_instruction: str = "",
        max_iterations: int = 5,
        max_repair_attempts: int = 2,
    ):
        self.client = client
        self.workspace = workspace
        self.agent_exploration_rules = agent_exploration_rules
        self.agent_coding_rules = agent_coding_rules
        self.language_instruction = language_instruction
        self.max_iterations = max_iterations
        self.max_repair_attempts = max_repair_attempts

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
        primary_tables: list[str] | None = None,
        attached_images: list[str] | None = None,
    ) -> Generator[dict[str, Any], None, None]:
        """Run the structured exploration loop.

        Yields event dicts with ``type`` in:
            ``"action"``      – the agent's chosen action (for UI)
            ``"result"``      – a visualization result (data + chart)
            ``"explore_result"`` – explore code output
            ``"clarify"``     – clarification question (loop pauses)
            ``"completion"``  – final summary (loop terminates)
            ``"error"``       – error information
        """
        if trajectory is None:
            trajectory = self._build_initial_messages(
                input_tables, user_question, focused_thread, other_threads,
                primary_tables=primary_tables,
                attached_images=attached_images,
            )

        completed_steps: list[dict[str, Any]] = []
        iteration = completed_step_count
        action_retry_budget = 1  # one extra chance when the LLM fails to produce an action

        while iteration < self.max_iterations:
            iteration += 1

            # --- THINK: call LLM with tools, get action ---------------
            t_start = time.time()
            action = None
            action_reason = "ok"
            action_error = ""
            for event in self._get_next_action(trajectory, input_tables):
                if event.get("type") == "agent_action":
                    action = event.get("action_data")
                    action_reason = event.get("reason", "ok")
                    action_error = event.get("error_message", "")
                else:
                    yield event
            logger.info("[DataAgent] iteration %d total=%.2fs reason=%s",
                        iteration, time.time() - t_start, action_reason)

            if action is None:
                # ① tool rounds exhausted → pause and let the user decide
                if action_reason == "tool_rounds_exhausted":
                    steps_desc = "\n".join(
                        f"  • {s['display_instruction']}" for s in completed_steps
                    ) or "(none yet)"
                    yield {
                        "type": "clarify",
                        "iteration": iteration,
                        "thought": "",
                        "message": (
                            "I've been exploring extensively but haven't reached "
                            "a conclusion yet.\n\nCompleted steps so far:\n"
                            f"{steps_desc}\n\n"
                            "How would you like to proceed?"
                        ),
                        "message_code": "agent.clarifyExhausted",
                        "message_params": {"steps": steps_desc},
                        "options": [
                            "Continue exploring",
                            "Simplify the task",
                            "Present what you have so far",
                        ],
                        "option_codes": [
                            "agent.clarifyOptionContinue",
                            "agent.clarifyOptionSimplify",
                            "agent.clarifyOptionPresent",
                        ],
                        "trajectory": self._strip_images(trajectory),
                        "completed_step_count": len(completed_steps),
                    }
                    return

                # ② LLM API error (already retried in _call_llm) → fatal
                if action_reason == "llm_error":
                    yield self._error_event(
                        iteration,
                        action_error or "LLM API error",
                        message_code="agent.llmApiError",
                    )
                    break

                # ③ json_parse_failed or unknown → retry once with context
                if action_retry_budget > 0:
                    action_retry_budget -= 1
                    logger.info("[DataAgent] action=None (reason=%s), retrying "
                                "(%d retries left)", action_reason, action_retry_budget)
                    steps_summary = "\n".join(
                        f"  - Step {i + 1}: {s['display_instruction']}"
                        for i, s in enumerate(completed_steps)
                    ) or "  (no completed steps)"
                    trajectory.append({
                        "role": "user",
                        "content": (
                            "[SYSTEM] Your previous response could not be parsed. "
                            "Here is what was already completed:\n"
                            f"{steps_summary}\n\n"
                            "Please output a JSON action object (visualize / clarify / present) "
                            "to continue."
                        ),
                    })
                    continue

                yield self._error_event(
                    iteration,
                    action_error or "Failed to parse agent action from LLM response",
                    message_code="agent.parseActionFailed",
                )
                break

            action_type = action.get("action")
            logger.info(f"[DataAgent] Iteration {iteration}: action={action_type}")

            # --- ACT (only user-visible actions reach here) ------------
            if action_type == "clarify":
                yield {
                    "type": "clarify",
                    "iteration": iteration,
                    "thought": action.get("thought", ""),
                    "message": action.get("message", ""),
                    "options": action.get("options", []),
                    "trajectory": self._strip_images(trajectory),
                    "completed_step_count": len(completed_steps),
                }
                return

            elif action_type == "present":
                yield {
                    "type": "completion",
                    "iteration": iteration,
                    "status": "success",
                    "content": {
                        "thought": action.get("thought", ""),
                        "summary": action.get("summary", ""),
                        "total_steps": len(completed_steps),
                    },
                }
                return

            elif action_type == "visualize":
                code = action.get("code", "")
                output_variable = action.get("output_variable", "result_df")
                chart_spec = action.get("chart", {})
                field_metadata = action.get("field_metadata", {})
                field_display_names = action.get("field_display_names", {})
                display_instruction = action.get("display_instruction", "")

                # Yield action event so the UI can show what the agent is doing
                yield {
                    "type": "action",
                    "iteration": iteration,
                    "action": "visualize",
                    "thought": action.get("thought", ""),
                    "display_instruction": display_instruction,
                    "input_tables": action.get("input_tables", []),
                }

                # Execute with repair loop
                viz_result = self._execute_visualize(
                    code=code,
                    output_variable=output_variable,
                    chart_spec=chart_spec,
                    field_metadata=field_metadata,
                    field_display_names=field_display_names,
                    display_instruction=display_instruction,
                    input_tables=input_tables,
                    messages=trajectory,
                )

                if viz_result["status"] != "ok":
                    error_msg = viz_result.get("error_message", "Unknown error")
                    observation = f"[OBSERVATION – Step {len(completed_steps) + 1} FAILED]\n\nError: {error_msg}"
                    trajectory.append({"role": "user", "content": observation})
                    yield self._error_event(iteration, error_msg, display_instruction=display_instruction)
                    continue

                # Successful visualization
                transform_result = viz_result["transform_result"]
                sign_result(transform_result)
                transformed_data = transform_result["content"]

                completed_steps.append({
                    "display_instruction": display_instruction,
                    "code": transform_result.get("code", ""),
                })

                # Yield the result to the frontend
                yield {
                    "type": "result",
                    "iteration": iteration,
                    "status": "success",
                    "content": {
                        "question": display_instruction,
                        "result": transform_result,
                    },
                }

                # Append rich observation to trajectory (data-only, no chart image —
                # avoids rendering discrepancy between server and frontend)
                observation_msg = self._format_observation(
                    step_index=len(completed_steps),
                    display_instruction=display_instruction,
                    thought=action.get("thought", ""),
                    code=transform_result.get("code", ""),
                    data=transformed_data,
                    chart_image=None,
                )
                trajectory.append(observation_msg)

            else:
                trajectory.append({
                    "role": "user",
                    "content": (
                        f"[ERROR] Unknown action '{action_type}'. "
                        "Please choose one of: visualize, clarify, present."
                    ),
                })
                yield self._error_event(iteration, f"Unknown action: {action_type}", message_code="agent.unknownAction")

        # Exhausted max iterations
        yield {
            "type": "completion",
            "iteration": iteration,
            "status": "max_iterations",
            "content": {
                "summary": "Reached the maximum number of exploration steps.",
                "summary_code": "agent.maxIterationsSummary",
                "total_steps": len(completed_steps),
            },
        }

    # ------------------------------------------------------------------
    # Visualize execution (with repair)
    # ------------------------------------------------------------------

    def _execute_visualize(
        self,
        code: str,
        output_variable: str,
        chart_spec: dict,
        field_metadata: dict,
        field_display_names: dict,
        display_instruction: str,
        input_tables: list[dict[str, Any]],
        messages: list[dict],
    ) -> dict[str, Any]:
        """Execute a visualize action with repair retries."""
        viz_result = self._run_visualize_code(
            code=code,
            output_variable=output_variable,
            chart_spec=chart_spec,
            field_metadata=field_metadata,
            field_display_names=field_display_names,
            display_instruction=display_instruction,
            messages=messages,
        )

        attempt = 0
        while viz_result["status"] != "ok" and attempt < self.max_repair_attempts:
            attempt += 1
            error_msg = viz_result.get("error_message", "Unknown error")
            logger.warning(f"[DataAgent] Repair attempt {attempt}/{self.max_repair_attempts}: {error_msg}")

            # Ask LLM to fix the code
            repair_messages = list(messages)
            repair_messages.append({
                "role": "user",
                "content": (
                    f"[CODE ERROR]\n\n{error_msg}\n\n"
                    "Please fix the code and output a new visualize action."
                ),
            })
            repair_action = None
            for evt in self._get_next_action(repair_messages, input_tables):
                if evt.get("type") == "agent_action":
                    repair_action = evt.get("action_data")
            if repair_action and repair_action.get("action") == "visualize":
                viz_result = self._run_visualize_code(
                    code=repair_action.get("code", code),
                    output_variable=repair_action.get("output_variable", output_variable),
                    chart_spec=repair_action.get("chart", chart_spec),
                    field_metadata=repair_action.get("field_metadata", field_metadata),
                    field_display_names=repair_action.get("field_display_names", field_display_names),
                    display_instruction=display_instruction,
                    messages=messages,
                )
            else:
                break

        return viz_result

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
            logger.error("[DataAgent] Sandbox execution error", exc_info=e)
            return {"status": "error", "error": "Code execution failed", "stdout": ""}

    def _run_visualize_code(
        self,
        code: str,
        output_variable: str,
        chart_spec: dict,
        field_metadata: dict,
        field_display_names: dict,
        display_instruction: str,
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

            # Validate that all encoding fields exist in the output DataFrame
            chart_encodings = chart_spec.get("encodings", {})
            missing_fields = [
                f"{channel}: '{field}'"
                for channel, field in chart_encodings.items()
                if field and field not in full_df.columns
            ]
            if missing_fields:
                available = list(full_df.columns)
                return {
                    "status": "error",
                    "error_message": (
                        f"Chart encoding fields not found in output DataFrame: "
                        f"{', '.join(missing_fields)}. "
                        f"Available columns: {available}"
                    ),
                    "error_code": "agent.fieldsNotFound",
                    "error_params": {
                        "missing": ", ".join(missing_fields),
                        "available": str(available),
                    },
                }

            if row_count == 0:
                return {
                    "status": "error",
                    "error_message": "Output DataFrame is empty (0 rows). Check filters or data loading.",
                    "error_code": "agent.emptyDataframe",
                }

            output_table_name = self.workspace.get_fresh_name(f"d-{output_variable}")
            self.workspace.write_parquet(full_df, output_table_name)

            if row_count > max_display_rows:
                query_output = full_df.head(max_display_rows)
            else:
                query_output = full_df
            query_output = query_output.loc[:, ~query_output.columns.duplicated()]

            # Skip chart image generation for agent observation (avoids rendering
            # discrepancy between server-side matplotlib and frontend Vega-Lite).
            # User-submitted images (attached_images) and focused thread chart
            # thumbnails (rendered by the frontend) are still passed through.

            # Build refined_goal for frontend compatibility
            refined_goal = {
                "display_instruction": display_instruction,
                "output_variable": output_variable,
                "output_fields": list(query_output.columns),
                "chart": chart_spec,
                "field_metadata": field_metadata,
                "field_display_names": field_display_names or {},
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
            }

        except Exception as e:
            logger.error("[DataAgent] Visualize execution error", exc_info=e)
            return {"status": "error", "error_message": "Visualization execution failed"}

    def _create_chart(
        self,
        data: dict[str, Any],
        chart_spec: dict[str, Any],
        field_metadata: dict[str, Any] | None = None,
    ) -> str | None:
        """Create a chart and return a base64 PNG string for observation feedback."""
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
            return spec_to_base64(spec) if spec else None
        except Exception as e:
            logger.error(f"[DataAgent] Chart creation error: {e}")
            return None

    # ------------------------------------------------------------------
    # Message construction
    # ------------------------------------------------------------------

    def _build_system_prompt(
        self,
        has_primary_tables: bool = False,
        has_focused_thread: bool = False,
        has_other_threads: bool = False,
        has_attached_images: bool = False,
    ) -> str:
        rules_block = ""
        if self.agent_exploration_rules and self.agent_exploration_rules.strip():
            rules_block = (
                "\n## Additional exploration rules\n\n"
                + self.agent_exploration_rules.strip()
                + "\n\nPlease follow the above rules when exploring data."
            )

        # Build context guide dynamically based on what's actually present
        context_lines = []
        if has_primary_tables:
            context_lines.append(
                "- **[PRIMARY TABLE(S)]**: The table(s) the user is focused on. "
                "Prioritize these, but freely use other available tables if needed."
            )
            context_lines.append(
                "- **[OTHER AVAILABLE TABLES]**: Additional tables in the workspace."
            )
        else:
            context_lines.append(
                "- **[AVAILABLE TABLES]**: All tables in the workspace."
            )
        context_lines.append(
            "  Use `inspect_source_data` to get detailed stats and sample rows. "
            "Use `explore` for custom computations."
        )
        if has_focused_thread:
            context_lines.append(
                "- **[FOCUSED THREAD]**: The thread the user is continuing. "
                "Build on this — do not repeat visualizations already created here."
            )
        if has_other_threads:
            context_lines.append(
                "- **[OTHER THREADS]**: Brief summaries of other exploration threads."
            )
        if has_attached_images:
            context_lines.append(
                "- **[USER ATTACHMENT(S)]**: Image(s) provided by the user. "
                "Refer to these when relevant to the user's question."
            )
        context_guide = "\n".join(context_lines)

        prompt = SYSTEM_PROMPT.format(
            max_iterations=self.max_iterations,
            agent_exploration_rules=rules_block,
            context_guide=context_guide,
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
        primary_tables: list[str] | None = None,
        attached_images: list[str] | None = None,
    ) -> list[dict]:
        """Build the initial messages with 3-tier context.

        Tier 1: Source tables (lightweight — column names + types + row count)
        Tier 2: Focused thread (detailed — per-step interaction history)
        Tier 3: Peripheral threads (minimal — one-line per step)
        """
        # Tier 1: Always lightweight schema — agent uses inspect_source_data
        # tool for details on tables it needs
        table_summaries = self._build_lightweight_table_context(input_tables, primary_tables=primary_tables)

        # Tier 2: Focused thread (detailed)
        focused_block = ""
        if focused_thread:
            focused_block = self._build_focused_thread_context(focused_thread)

        # Tier 3: Peripheral threads (minimal)
        peripheral_block = ""
        if other_threads:
            peripheral_block = self._build_peripheral_thread_context(other_threads)

        # Use [SOURCE TABLES] when no tiering, omit section header when tiered
        # (the tiers already have their own headers)
        if primary_tables:
            user_content = f"{table_summaries}\n\n"
        else:
            user_content = f"[AVAILABLE TABLES]\n\n{table_summaries}\n\n"
        if focused_block:
            user_content += f"{focused_block}\n\n"
        if peripheral_block:
            user_content += f"{peripheral_block}\n\n"
        user_content += f"[USER QUESTION]\n\n{user_question}"

        # Check if any step in the focused thread has a chart thumbnail
        # (the focused leaf's chart image for visual context)
        chart_thumbnail = None
        if focused_thread:
            for step in focused_thread:
                if step.get("chart_thumbnail"):
                    chart_thumbnail = step["chart_thumbnail"]

        # Build system prompt with context-aware guide
        system_prompt = self._build_system_prompt(
            has_primary_tables=bool(primary_tables),
            has_focused_thread=bool(focused_thread),
            has_other_threads=bool(other_threads),
            has_attached_images=bool(attached_images),
        )

        # Determine if we need multimodal content (chart thumbnail or user-attached images)
        has_images = (chart_thumbnail and chart_thumbnail.startswith("data:")) or (attached_images and len(attached_images) > 0)

        if has_images:
            content_parts: list[dict] = [{"type": "text", "text": user_content}]
            if chart_thumbnail and chart_thumbnail.startswith("data:"):
                content_parts.append({"type": "text", "text": "\n[CURRENT CHART] (the chart the user is currently viewing):"})
                content_parts.append({"type": "image_url", "image_url": {"url": chart_thumbnail, "detail": "low"}})
            if attached_images:
                label = "[USER ATTACHMENT]" if len(attached_images) == 1 else "[USER ATTACHMENTS]"
                content_parts.append({"type": "text", "text": f"\n{label} (image(s) provided by the user):"})
                for img in attached_images:
                    if img.startswith("data:"):
                        content_parts.append({"type": "image_url", "image_url": {"url": img, "detail": "low"}})
            return [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content_parts},
            ]
        else:
            return [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ]

    def _build_focused_thread_context(
        self, focused_thread: list[dict[str, Any]]
    ) -> str:
        return build_focused_thread_context(focused_thread)

    def _build_peripheral_thread_context(
        self, other_threads: list[dict[str, Any]]
    ) -> str:
        return build_peripheral_thread_context(other_threads)

    def _build_lightweight_table_context(
        self, input_tables: list[dict[str, Any]], primary_tables: list[str] | None = None
    ) -> str:
        return build_lightweight_table_context(input_tables, self.workspace, primary_tables)

    # ------------------------------------------------------------------
    # LLM interaction (with internal tool-calling loop)
    # ------------------------------------------------------------------

    def _get_next_action(
        self,
        trajectory: list[dict],
        input_tables: list[dict[str, Any]] | None = None,
    ) -> Generator[dict[str, Any], None, None]:
        """Call the LLM with tools, handle tool calls internally, then
        parse the structured JSON action from the text response.

        Yields:
            - ``{"type": "tool_start", "tool": ..., ...}`` for each tool call
            - ``{"type": "tool_result", "tool": ..., ...}`` for each tool result
            - ``{"type": "agent_action", "action_data": dict, "reason": ...}``
              as the final yield.  ``action_data`` is *None* on failure;
              ``reason`` is one of ``"ok"``, ``"json_parse_failed"``,
              ``"llm_error"``, ``"tool_rounds_exhausted"``.
        """
        max_tool_rounds = 8
        max_json_retries = 1
        json_retries = 0
        messages = trajectory

        for round_idx in range(max_tool_rounds):
            # --- call LLM (transient errors already retried inside _call_llm) ---
            try:
                response = self._call_llm(messages)
            except Exception as exc:
                logger.error("[DataAgent] LLM call failed", exc_info=exc)
                from data_formulator.security.sanitize import classify_llm_error
                yield {
                    "type": "agent_action",
                    "action_data": None,
                    "reason": "llm_error",
                    "error_message": classify_llm_error(exc),
                }
                return

            if not response.choices:
                yield {"type": "agent_action", "action_data": None, "reason": "llm_error",
                       "error_message": "LLM returned empty response"}
                return

            choice = response.choices[0]
            content = choice.message.content or ""
            tool_calls = getattr(choice.message, 'tool_calls', None)

            # --- tool calls: execute and loop back ---
            if tool_calls:
                if content.strip():
                    yield {"type": "thinking_text", "content": content.strip()}

                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": content or None,
                }
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in tool_calls
                ]
                messages.append(assistant_msg)

                for tc in tool_calls:
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        tool_args = {}

                    yield {
                        "type": "tool_start",
                        "tool": tool_name,
                        "code": tool_args.get("code") if tool_name == "explore" else None,
                        "table_names": tool_args.get("table_names") if tool_name == "inspect_source_data" else None,
                    }

                    if tool_name == "think":
                        thought_msg = tool_args.get("message", "")
                        tool_content = "ok"
                        yield {"type": "thinking_text", "content": thought_msg}
                    elif tool_name == "explore":
                        result = self._run_explore_code(
                            tool_args.get("code", ""),
                            input_tables or [],
                        )
                        tool_content = result.get("stdout", "")
                        if result.get("error"):
                            tool_content += f"\n\nError: {result['error']}"
                        yield {
                            "type": "tool_result",
                            "tool": tool_name,
                            "status": result.get("status", "ok"),
                            "stdout": result.get("stdout", ""),
                            "error": result.get("error"),
                        }
                    elif tool_name == "inspect_source_data":
                        table_names = tool_args.get("table_names", [])
                        tool_content = handle_inspect_source_data(
                            table_names, input_tables or [], self.workspace
                        )
                        yield {
                            "type": "tool_result",
                            "tool": tool_name,
                            "status": "ok",
                            "stdout": tool_content,
                        }
                    else:
                        tool_content = f"Unknown tool: {tool_name}"

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_content,
                    })

                logger.info("[DataAgent] Executed %d tool call(s), looping back to LLM", len(tool_calls))
                continue

            # --- no tool calls — parse JSON action from text ---
            logger.debug("[DataAgent] Raw LLM response:\n%s", content)
            json_blocks = extract_json_objects(content)
            if json_blocks:
                messages.append({"role": "assistant", "content": content})
                yield {"type": "agent_action", "action_data": json_blocks[0], "reason": "ok"}
                return

            # --- JSON parse failed — focused retry (ask LLM to reformat only) ---
            if json_retries < max_json_retries:
                json_retries += 1
                logger.warning("[DataAgent] No JSON found (retry %d/%d), asking LLM to reformat",
                               json_retries, max_json_retries)
                messages.append({"role": "assistant", "content": content})
                messages.append({
                    "role": "user",
                    "content": (
                        "[FORMAT ERROR] Your previous response did not contain a valid JSON action. "
                        "Please output ONLY a JSON object with one of these actions: "
                        "visualize, clarify, or present. Do NOT repeat your analysis — "
                        "just reformat your conclusion as JSON."
                    ),
                })
                continue

            logger.warning("[DataAgent] JSON parse failed after retries: %s", content[:200])
            yield {"type": "agent_action", "action_data": None, "reason": "json_parse_failed"}
            return

        # --- tool rounds exhausted ---
        logger.warning("[DataAgent] Exceeded %d tool rounds without producing an action", max_tool_rounds)
        yield {"type": "agent_action", "action_data": None, "reason": "tool_rounds_exhausted"}
        return

    _MAX_LLM_RETRIES = 3

    @staticmethod
    def _is_transient_error(exc: Exception) -> bool:
        msg = str(exc).lower()
        if any(kw in msg for kw in (
            "timeout", "timed out", "rate limit", "rate_limit",
            "429", "503", "502", "connection", "reset by peer",
        )):
            return True
        name = type(exc).__name__.lower()
        return any(kw in name for kw in ("timeout", "ratelimit", "connection"))

    def _call_llm(self, messages: list[dict]):
        """Call the LLM with tool definitions (non-streaming).

        Retries up to ``_MAX_LLM_RETRIES`` times on transient errors
        (timeout, rate-limit, connection reset) with exponential back-off.
        """
        last_exc: Exception | None = None
        for attempt in range(self._MAX_LLM_RETRIES):
            try:
                return self._call_llm_once(messages)
            except Exception as e:
                last_exc = e
                if self._is_transient_error(e) and attempt < self._MAX_LLM_RETRIES - 1:
                    wait = 2 ** attempt
                    logger.warning(
                        "[DataAgent] Transient LLM error (attempt %d/%d), "
                        "retrying in %ds: %s",
                        attempt + 1, self._MAX_LLM_RETRIES, wait, e,
                    )
                    time.sleep(wait)
                    continue
                raise
        raise last_exc  # pragma: no cover

    def _call_llm_once(self, messages: list[dict]):
        """Single LLM call (no retry)."""
        if self.client.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.client.params.get("api_base", None),
                api_key=self.client.params.get("api_key", ""),
                timeout=120,
            )
            try:
                return client.chat.completions.create(
                    model=self.client.model,
                    messages=messages,
                    tools=TOOLS,
                )
            except Exception as e:
                if self.client._is_image_deserialize_error(str(e)):
                    sanitized = self.client._strip_images_from_messages(messages)
                    return client.chat.completions.create(
                        model=self.client.model,
                        messages=sanitized,
                        tools=TOOLS,
                    )
                raise
        else:
            params = self.client.params.copy()
            try:
                return litellm.completion(
                    model=self.client.model,
                    messages=messages,
                    tools=TOOLS,
                    drop_params=True,
                    **params,
                )
            except Exception as e:
                if self.client._is_image_deserialize_error(str(e)):
                    sanitized = self.client._strip_images_from_messages(messages)
                    return litellm.completion(
                        model=self.client.model,
                        messages=sanitized,
                        tools=TOOLS,
                        drop_params=True,
                        **params,
                    )
                raise

    # ------------------------------------------------------------------
    # Observation formatting
    # ------------------------------------------------------------------

    def _format_observation(
        self,
        step_index: int,
        display_instruction: str,
        thought: str,
        code: str,
        data: dict[str, Any],
        chart_image: str | None,
    ) -> dict:
        """Format a rich observation for the trajectory.

        Includes data summary, code, and optionally the chart image
        so the agent can make informed decisions about the next step.
        """
        data_summary = generate_data_summary(
            [{"name": data.get("virtual", {}).get("table_name", f"step_{step_index}"),
              "rows": data["rows"]}],
            workspace=self.workspace,
        )

        text = (
            f"[OBSERVATION – Step {step_index}]\n\n"
            f"**Visualization**: {display_instruction}\n\n"
            f"**Code**:\n```python\n{code}\n```\n\n"
            f"**Transformed Data**:\n{data_summary}"
        )

        if chart_image:
            content: list[dict[str, Any]] = [
                {"type": "text", "text": text + "\n\n**Chart**:"},
            ]
            if chart_image.startswith("data:") or chart_image.startswith("http"):
                content.append({
                    "type": "image_url",
                    "image_url": {"url": chart_image, "detail": "low"},
                })
            return {"role": "user", "content": content}

        return {"role": "user", "content": text}

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
    def _error_event(
        iteration: int,
        message: str,
        *,
        display_instruction: str = "",
        message_code: str = "",
        message_params: dict | None = None,
    ) -> dict[str, Any]:
        """Build an ``"error"`` event dict for the streaming response."""
        event: dict[str, Any] = {
            "type": "error",
            "iteration": iteration,
            "message": message,
        }
        if message_code:
            event["message_code"] = message_code
        if message_params:
            event["message_params"] = message_params
        if display_instruction:
            event["display_instruction"] = display_instruction
        return event

    @staticmethod
    def _snapshot_dialog(messages: list[dict] | None) -> list[dict]:
        """Snapshot the conversation for the Agent Log dialog.

        Handles plain text, multimodal content, tool_calls on assistant
        messages, and tool result messages.
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

            # Assistant messages with tool_calls — show tool call details
            if role == "assistant" and msg.get("tool_calls"):
                tool_details = []
                for tc in msg["tool_calls"]:
                    fn = tc.get("function", {})
                    name = fn.get("name", "?")
                    args_str = fn.get("arguments", "{}")
                    try:
                        args_obj = json.loads(args_str)
                        if name == "explore" and "code" in args_obj:
                            tool_details.append(f"[tool: {name}]\n```python\n{args_obj['code']}\n```")
                        else:
                            formatted = json.dumps(args_obj, indent=2, ensure_ascii=False)
                            tool_details.append(f"[tool: {name}]\n```json\n{formatted}\n```")
                    except (json.JSONDecodeError, TypeError):
                        tool_details.append(f"[tool: {name}]\n{args_str}")
                text_part = content or ""
                combined = (text_part + "\n\n" + "\n\n".join(tool_details)).strip()
                snapshot.append({"role": role, "content": combined})

            # Tool result messages
            elif role == "tool":
                tool_content = content or ""
                if isinstance(tool_content, str) and len(tool_content) > 3000:
                    tool_content = tool_content[:3000] + "\n... (truncated)"
                snapshot.append({"role": "assistant", "content": f"[tool result]\n{tool_content}"})

            # Regular messages (system, user, assistant without tool_calls)
            elif content:
                if isinstance(content, str) and len(content) > 4000:
                    content = content[:4000] + "\n... (truncated)"
                snapshot.append({"role": role, "content": content})
        return snapshot
