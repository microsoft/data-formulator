# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Autonomous data exploration agent (SWE-agent style).

The agent receives a high-level user question, then enters an
observe → think → act loop where it picks one of three actions per turn:

    visualize  – call DataRecAgent to transform data & create a chart
    clarify    – ask the user a clarification question (pauses the loop)
    present    – summarize findings and terminate the loop

The full trajectory (system prompt + observations) is maintained as a
standard message list and sent to the LLM on every turn so the model has
complete context to make decisions.
"""

import json
import logging
import time
import uuid
from typing import Any, Generator

from data_formulator.agents.agent_data_rec import DataRecAgent
from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary
from data_formulator.agents.client_utils import Client
from data_formulator.security.code_signing import sign_result
from data_formulator.workflows.create_vl_plots import (
    assemble_vegailte_chart,
    coerce_field_type,
    resolve_field_type,
    spec_to_base64,
    field_metadata_to_semantic_types,
)

import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = '''\
You are an autonomous data exploration agent.

Your goal is to help the user answer their question by creating one or more
data visualizations.  You operate in a loop: at every turn you MUST output
**exactly one action** as a JSON object (nothing else).

## Available actions

### 1. `visualize`
Use this when you want to create a visualization.  You provide a concise
analytical question that will be forwarded to a data-transformation agent
which will write code, transform the data, and pick a chart type.

```json
{{
    "action": "visualize",
    "thought": "<your reasoning about what to explore next>",
    "question": "<concise analytical question / instruction for the chart>"
}}
```

Guidelines for the question:
- It should be self-contained: mention which fields, aggregations, filters
  or derived metrics to use.
- Each question should target ONE chart.
- Keep it concise but precise enough so the data transformation agent can
  execute without ambiguity.

### 2. `clarify`
Use this when the user's question is ambiguous, there are multiple
reasonable interpretations, or critical information is missing.

```json
{{
    "action": "clarify",
    "thought": "<why you need clarification>",
    "message": "<a polite, concise clarification question for the user>",
    "options": ["<option 1>", "<option 2>", "<option 3>"]
}}
```

Guidelines:
- Only clarify when genuinely necessary; prefer making a reasonable
  assumption and proceeding.
- Ask at most one question per turn.
- Provide 2-4 short options that cover the most likely interpretations.
- Options should describe broad, high-level exploration directions.

### 3. `present`
Use this when you believe you have sufficiently answered the user's
question and can summarize findings.

```json
{{
    "action": "present",
    "thought": "<why you are done>",
    "summary": "<one short sentence summarizing the key finding>"
}}
```

Guidelines:
- The summary should be a single concise sentence (≤ 25 words).
- Present after at most {max_iterations} visualization steps, even if
  there is more to explore.

## Decision guidelines

- **Start** by understanding the user question and the data. If the
  question is clear, go ahead and `visualize`. If it is ambiguous,
  `clarify` first.
- **After a visualization** is created, review the result (data sample +
  chart image) and decide:
  - `visualize` again if the question is not yet fully answered.
  - `present` if the findings are sufficient or interesting enough.
  - `clarify` if the result reveals that the original question needs
    scoping.
- **Never** output two actions in one turn.
- **Never** repeat a visualization that already exists in the trajectory.
- Always output valid JSON with one of the three action types.

{agent_exploration_rules}
'''

# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class DataAgent:
    """Autonomous data exploration agent with observe-think-act loop."""

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

        # Sub-agent for data transformation + chart recommendation.
        # Uses a separate (compact) language instruction so the code-gen
        # model is not distracted by field-level rules irrelevant to it.
        self.rec_agent = DataRecAgent(
            client=client,
            workspace=workspace,
            agent_coding_rules=agent_coding_rules,
            language_instruction=rec_language_instruction if rec_language_instruction is not None else language_instruction,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        input_tables: list[dict[str, Any]],
        user_question: str,
        conversation_history: list[dict[str, str]] | None = None,
        trajectory: list[dict] | None = None,
        completed_step_count: int = 0,
    ) -> Generator[dict[str, Any], None, None]:
        """Run the autonomous exploration loop.

        Yields event dicts with ``type`` in:
            ``"action"``      – the agent's chosen action (for logging/UI)
            ``"result"``      – a visualization result (data + chart)
            ``"clarify"``     – a clarification question (loop pauses)
            ``"completion"``  – final summary (loop terminates)
            ``"error"``       – error information

        To resume after a ``clarify`` event, call ``run()`` again with
        the ``trajectory`` returned in the clarify payload (the caller
        should have appended the user's clarification as a user message).
        """
        if trajectory is None:
            trajectory = self._build_initial_messages(
                input_tables, user_question, conversation_history
            )

        completed_steps: list[dict[str, Any]] = []
        # Track DataRecAgent dialog for follow-up calls
        rec_dialog: list[dict] = []
        rec_last_data: dict | list = []
        iteration = completed_step_count

        while iteration < self.max_iterations:
            iteration += 1

            # --- THINK: ask the LLM to pick an action -----------------
            t_llm_start = time.time()
            action = self._get_next_action(trajectory)
            logger.info(f"[DataAgent] timing: iteration {iteration} think llm={time.time() - t_llm_start:.3f}s")

            if action is None:
                yield self._error_event(iteration, "Failed to parse agent action from LLM response")
                break

            action_type = action.get("action")
            logger.info(f"[DataAgent] Iteration {iteration}: action={action_type}")

            # Append the agent's response to the trajectory
            trajectory.append({
                "role": "assistant",
                "content": json.dumps(action, ensure_ascii=False),
            })

            # --- ACT --------------------------------------------------
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
                # Loop pauses – caller resumes by calling run() again
                # with the trajectory + user's clarification appended.
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
                question = action.get("question", user_question)

                # Yield action event so the UI can show what the agent is doing
                yield {
                    "type": "action",
                    "iteration": iteration,
                    "action": "visualize",
                    "thought": action.get("thought", ""),
                    "question": question,
                }

                # Execute the visualize action
                viz_result = self._execute_visualize(
                    input_tables=input_tables,
                    question=question,
                    prev_dialog=rec_dialog,
                    prev_data=rec_last_data,
                )

                if viz_result["status"] != "ok":
                    # Append error observation and let agent decide
                    error_msg = viz_result.get("error_message", "Unknown error")
                    observation = f"[OBSERVATION – Step {len(completed_steps) + 1} FAILED]\n\nError: {error_msg}"
                    trajectory.append({"role": "user", "content": observation})
                    yield self._error_event(iteration, error_msg, question=question)
                    continue

                # Successful visualization
                transform_result = viz_result["transform_result"]
                sign_result(transform_result)
                chart_image = viz_result.get("chart_image")
                transformed_data = transform_result["content"]
                code = transform_result.get("code", "")

                # Update rec agent state for follow-ups
                rec_dialog = transform_result.get("dialog", [])
                rec_last_data = transformed_data

                # Build step record
                step = {
                    "question": question,
                    "code": code,
                    "data": {
                        "rows": transformed_data["rows"],
                        "name": (
                            transformed_data["virtual"]["table_name"]
                            if "virtual" in transformed_data
                            else None
                        ),
                    },
                    "visualization": chart_image,
                }
                completed_steps.append(step)

                # Yield the result to the frontend
                yield {
                    "type": "result",
                    "iteration": iteration,
                    "status": "success",
                    "content": {
                        "question": question,
                        "result": transform_result,
                    },
                }

                # Append observation to trajectory for the next think step
                observation_msg = self._format_observation(
                    step_index=len(completed_steps),
                    question=question,
                    code=code,
                    data=transformed_data,
                    chart_image=chart_image,
                )
                trajectory.append(observation_msg)

            else:
                # Unrecognised action – let the LLM know
                trajectory.append({
                    "role": "user",
                    "content": (
                        f"[ERROR] Unknown action '{action_type}'. "
                        "Please choose one of: visualize, clarify, present."
                    ),
                })
                yield self._error_event(
                    iteration,
                    f"Unknown action: {action_type}",
                )

        # Exhausted max iterations – force a completion yield
        yield {
            "type": "completion",
            "iteration": iteration,
            "status": "max_iterations",
            "content": {
                "summary": "Reached the maximum number of exploration steps.",
                "total_steps": len(completed_steps),
            },
        }

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
            max_iterations=self.max_iterations,
            agent_exploration_rules=rules_block,
        )
        if self.language_instruction:
            prompt = prompt + "\n\n" + self.language_instruction
        return prompt

    def _build_initial_messages(
        self,
        input_tables: list[dict[str, Any]],
        user_question: str,
        conversation_history: list[dict[str, str]] | None = None,
    ) -> list[dict]:
        """Build the initial trajectory with system prompt + data context + user question."""
        data_summary = generate_data_summary(input_tables, workspace=self.workspace)

        # Optionally prepend conversation history
        history_block = ""
        if conversation_history:
            lines = []
            for msg in conversation_history:
                role = "User" if msg.get("role") == "user" else "Assistant"
                lines.append(f"{role}: {msg.get('content', '')}")
            history_block = (
                "[PREVIOUS CONVERSATION FOR REFERENCE]\n"
                + "\n".join(lines)
                + "\n\n"
            )

        user_content = (
            f"{history_block}"
            f"[DATASETS]\n\n{data_summary}\n\n"
            f"[USER QUESTION]\n\n{user_question}"
        )

        return [
            {"role": "system", "content": self._build_system_prompt()},
            {"role": "user", "content": user_content},
        ]

    # ------------------------------------------------------------------
    # LLM interaction
    # ------------------------------------------------------------------

    def _get_next_action(self, trajectory: list[dict]) -> dict | None:
        """Call the LLM with the current trajectory and parse the action JSON."""
        response = self.client.get_completion(messages=trajectory)

        if isinstance(response, Exception):
            logger.error(f"[DataAgent] LLM error: {response}")
            return None

        if not response.choices:
            return None

        content = response.choices[0].message.content or ""
        logger.debug(f"[DataAgent] Raw LLM response:\n{content}")

        json_blocks = extract_json_objects(content)
        if not json_blocks:
            # Try to salvage – the model might have wrapped in markdown
            return None

        return json_blocks[0]

    # ------------------------------------------------------------------
    # Visualize action execution
    # ------------------------------------------------------------------

    def _execute_visualize(
        self,
        input_tables: list[dict[str, Any]],
        question: str,
        prev_dialog: list[dict],
        prev_data: dict | list,
    ) -> dict[str, Any]:
        """Execute a visualize action via DataRecAgent, with repair retries.

        Returns a dict with:
            status: "ok" | "error"
            transform_result: the DataRecAgent result (when ok)
            chart_image: base64 chart image or None
            error_message: str (when error)
        """
        # Decide whether to follow-up or start fresh
        if prev_dialog:
            if isinstance(prev_data, dict) and "rows" in prev_data:
                sample = prev_data["rows"]
            else:
                sample = []
            results = self.rec_agent.followup(
                input_tables=input_tables,
                new_instruction=question,
                latest_data_sample=sample,
                dialog=prev_dialog,
            )
        else:
            results = self.rec_agent.run(
                input_tables=input_tables,
                description=question,
            )

        # Repair loop
        attempt = 0
        while results and results[0]["status"] != "ok" and attempt < self.max_repair_attempts:
            attempt += 1
            error_msg = results[0].get("content", "Unknown error")
            dialog = results[0].get("dialog", [])
            logger.warning(
                f"[DataAgent] Repair attempt {attempt}/{self.max_repair_attempts}: {error_msg}"
            )
            repair_instruction = (
                f"We ran into the following problem executing the code, please fix it:\n\n"
                f"{error_msg}\n\n"
                "Please think step by step, reflect why the error happened and fix the code."
            )
            results = self.rec_agent.followup(
                input_tables=input_tables,
                new_instruction=repair_instruction,
                latest_data_sample=[],
                dialog=dialog,
            )

        if not results or results[0]["status"] != "ok":
            return {
                "status": "error",
                "error_message": results[0]["content"] if results else "No results from DataRecAgent",
            }

        transform_result = results[0]
        transformed_data = transform_result["content"]

        # Create chart
        chart_image = self._create_chart(transformed_data, transform_result.get("refined_goal", {}))

        return {
            "status": "ok",
            "transform_result": transform_result,
            "chart_image": chart_image,
        }

    def _create_chart(
        self,
        transformed_data: dict[str, Any],
        refined_goal: dict[str, Any],
    ) -> str | None:
        """Create a chart from transformed data and return a base64 PNG string."""
        chart_obj = refined_goal.get("chart", {})
        chart_type = chart_obj.get("chart_type", "Bar Chart")
        chart_encodings = chart_obj.get("encodings", {})
        chart_config = chart_obj.get("config", {})

        try:
            df = pd.DataFrame(transformed_data["rows"])
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
                semantic_types=field_metadata_to_semantic_types(refined_goal.get("field_metadata")),
            )
            return spec_to_base64(spec) if spec else None
        except Exception as e:
            logger.error(f"[DataAgent] Chart creation error: {e}")
            return None

    # ------------------------------------------------------------------
    # Observation formatting
    # ------------------------------------------------------------------

    def _format_observation(
        self,
        step_index: int,
        question: str,
        code: str,
        data: dict[str, Any],
        chart_image: str | None,
    ) -> dict:
        """Format a completed step as a user message for the trajectory."""
        # Build data summary
        data_summary = generate_data_summary(
            [{"name": data.get("virtual", {}).get("table_name", f"step_{step_index}"),
              "rows": data["rows"]}],
            workspace=self.workspace,
        )

        text = (
            f"[OBSERVATION – Step {step_index}]\n\n"
            f"**Question**: {question}\n\n"
            f"**Code**:\n```python\n{code}\n```\n\n"
            f"**Transformed Data Sample**:\n{data_summary}"
        )

        if chart_image:
            # Multimodal content with chart image
            content: list[dict[str, Any]] = [
                {"type": "text", "text": text + "\n\n**Visualization**:"},
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
    def _error_event(iteration: int, error_message: str, **extra) -> dict[str, Any]:
        return {
            "type": "error",
            "iteration": iteration,
            "status": "error",
            "error_message": error_message,
            **extra,
        }

    @staticmethod
    def _strip_images(trajectory: list[dict]) -> list[dict]:
        """Return a copy of the trajectory with image_url blocks removed.

        This keeps the payload small when sending the trajectory back
        to the client for stateless resumption.
        """
        stripped: list[dict] = []
        for msg in trajectory:
            content = msg.get("content")
            if isinstance(content, list):
                # Multimodal message – keep only text parts
                text_parts = [p for p in content if p.get("type") == "text"]
                if text_parts:
                    stripped.append({**msg, "content": text_parts})
                else:
                    stripped.append({**msg, "content": "[image removed]"})
            else:
                stripped.append(msg)
        return stripped
