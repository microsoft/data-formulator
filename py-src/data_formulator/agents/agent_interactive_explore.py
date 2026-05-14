# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
import time

import pandas as pd

import litellm
import openai

from data_formulator.agents.agent_utils import (
    attach_reasoning_content,
    extract_json_objects,
    generate_data_summary,
)
from data_formulator.agents.context import (
    build_focused_thread_context,
    build_lightweight_table_context,
    build_peripheral_thread_context,
    handle_inspect_source_data,
)

logger = logging.getLogger(__name__)

# ── Tool definition (inspect only) ────────────────────────────────────────

INSPECT_TOOL = {
    "type": "function",
    "function": {
        "name": "inspect_source_data",
        "description": (
            "Get a detailed summary of one or more source tables — schema, "
            "field-level statistics, and sample rows. Call this before suggesting "
            "questions if you need to understand a table's contents."
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
}

# ── Intent tags ───────────────────────────────────────────────────────────

INTENT_TAGS = ['deep-dive', 'pivot', 'broaden', 'cross-data', 'statistical']

# ── System prompt ─────────────────────────────────────────────────────────

SYSTEM_PROMPT = '''You are a data exploration expert who suggests interesting questions to help users explore their datasets.

The user message contains tiered context:
- **[PRIMARY TABLE(S)]** / **[OTHER AVAILABLE TABLES]**: Compact dataset context with schema, metadata descriptions, representative field values, numeric stats, and bounded sample rows.
- **[FOCUSED THREAD]** (optional): The exploration thread the user is continuing — each step shows what was asked, what was created, and what chart was made.
- **[OTHER THREADS]** (optional): Brief summaries of other exploration threads in the workspace.
- **[CURRENT CHART]** (optional): Image of the chart the user is currently viewing.
- **[START QUESTION]** (optional): A seed question from the user for context.

Your task is to suggest 4 exploration questions that users can follow to gain insights from their data.

Guidelines:
1. Suggest interesting analytical questions that can uncover new insights from the data.
2. Use a diverse language style (questions, statements, etc).
3. If there are multiple datasets, consider relationships between them.
4. CONCISENESS: questions should be concise and to the point.
5. QUESTION QUALITY:
    - If no exploration thread is provided, start with high-level overview questions.
    - If a thread exists, build on it — do not repeat questions already explored.
    - If the current analysis is already very specialized, suggest broadening or pivoting rather than drilling deeper into a tiny subset.
    - Leverage other tables in the workspace to suggest cross-data questions.
6. DIVERSITY: each question MUST have a different intent tag. Cover diverse exploration directions:
    - `deep-dive`: Zoom in — refine, filter, drill down, focus on outliers or sub-dimensions.
    - `pivot`: Same data, different analytical angle — change the metric, aggregation, or chart type.
    - `broaden`: Zoom out — higher-level view, remove filters, return to an earlier table.
    - `cross-data`: Bring in another workspace table not yet used in this thread. Only suggest when other tables are available.
    - `statistical`: Apply a statistical technique — forecasting, regression, clustering, anomaly detection.
7. VISUALIZATION: each question should be visualizable with a chart.
8. FORMATTING: for each question, include:
    - `text`: The full question text.
    - `goal`: A concise summary (<10 words) with **bold** keywords for key attributes/metrics.
    - `tag`: One of: `deep-dive`, `pivot`, `broaden`, `cross-data`, `statistical`.

Output a list of JSON objects, one per line (NDJSON format). Each line must be valid JSON with NO prefix:

{"type": "question", "text": ..., "goal": ..., "tag": ...}
{"type": "question", "text": ..., "goal": ..., "tag": ...}
...
'''

class InteractiveExploreAgent(object):

    def __init__(self, client, workspace, agent_exploration_rules="", language_instruction="", knowledge_store=None):
        self.client = client
        self.agent_exploration_rules = agent_exploration_rules
        self.workspace = workspace
        self.language_instruction = language_instruction
        self._knowledge_store = knowledge_store

    def run(self, input_tables, start_question=None,
            focused_thread=None, other_threads=None,
            primary_tables=None,
            current_chart=None,
            # Legacy params — kept for backward compatibility
            exploration_thread=None, current_data_sample=None,
            enable_inspect_round=False,
            **kwargs):
        """
        Suggest exploration questions for a dataset or exploration thread.

        Args:
            input_tables: List of dataset objects with name, rows, description
            start_question: Optional seed question for context
            focused_thread: Rich thread context (list of step dicts from frontend)
            other_threads: Peripheral thread summaries
            primary_tables: List of primary table names for prioritization
            current_chart: PNG data URL of the current visualization
            exploration_thread: Legacy — flat list of tables (used if focused_thread not provided)
            current_data_sample: Legacy — raw rows (ignored when focused_thread is provided)
            enable_inspect_round: Optional fallback for unusual cases where an
                extra inspect_source_data tool round is explicitly requested.
        """

        # ── Progress: context building ─────────────────────────────────
        yield {"type": "progress", "phase": "building_context"}

        # ── Build tiered context ──────────────────────────────────────
        t_ctx = time.time()

        context = build_lightweight_table_context(
            input_tables, self.workspace, primary_tables=primary_tables,
        )

        if focused_thread:
            context += "\n\n" + build_focused_thread_context(focused_thread)
        elif exploration_thread:
            # Legacy fallback: build a simple thread summary from flat table list
            thread_summary = generate_data_summary(
                [{
                    'name': table.get('name', f'Table {i}'),
                    'rows': table.get('rows', []),
                } for i, table in enumerate(exploration_thread, 1)],
                self.workspace,
                table_name_prefix="Thread Table",
            )
            context += f"\n\n[EXPLORATION THREAD]\n\n{thread_summary}"

        if other_threads:
            context += "\n\n" + build_peripheral_thread_context(other_threads)

        if current_data_sample and not focused_thread:
            context += f"\n\n[CURRENT DATA SAMPLE]\n\n{pd.DataFrame(current_data_sample).head(10).to_string()}"

        if start_question:
            context += f"\n\n[START QUESTION]\n\n{start_question}"

        # ── Inject relevant experiences from knowledge store ──────────
        if self._knowledge_store:
            try:
                query = start_question or ""
                table_names = [t.get("name", "") for t in input_tables if t.get("name")]
                search_query = " ".join([query] + table_names[:5]).strip()
                if search_query:
                    relevant = self._knowledge_store.search(
                        search_query, categories=["experiences"], max_results=3,
                    )
                    if relevant:
                        knowledge_block = "[RELEVANT KNOWLEDGE]\n"
                        for item in relevant:
                            knowledge_block += f"\n### {item['title']}\n{item['snippet']}\n"
                        context += f"\n\n{knowledge_block}"
            except Exception:
                logger.warning("Failed to search knowledge experiences", exc_info=True)

        # ── Build system prompt ───────────────────────────────────────
        system_prompt = SYSTEM_PROMPT

        if self.agent_exploration_rules and self.agent_exploration_rules.strip():
            system_prompt += "\n\n[AGENT EXPLORATION RULES]\n\n" + self.agent_exploration_rules.strip() + "\n\nPlease follow the above agent exploration rules when suggesting questions."

        if self._knowledge_store:
            system_prompt += self._knowledge_store.format_rules_block()

        if self.language_instruction:
            system_prompt = system_prompt + "\n\n" + self.language_instruction

        ctx_elapsed = time.time() - t_ctx
        logger.info(
            "[InteractiveExploreAgent] context: %d chars (~%d tokens), "
            "tables=%d, primary=%s, built in %.2fs",
            len(context), len(context) // 4,
            len(input_tables),
            primary_tables,
            ctx_elapsed,
        )
        logger.debug("Interactive explore agent input: %s", context)
        logger.info("[InteractiveExploreAgent] run start")

        # ── Build initial messages ────────────────────────────────────
        if current_chart:
            user_content = [
                {"type": "text", "text": context},
                {"type": "image_url", "image_url": {"url": current_chart, "detail": "low"}}
            ]
        else:
            user_content = context

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

        # ── Optional inspect_source_data fallback ─────────────────────
        if enable_inspect_round:
            messages = self._run_inspect_round(messages, input_tables)

        # ── Progress: generating ──────────────────────────────────────
        yield {"type": "progress", "phase": "generating"}

        # ── Stream the final response ─────────────────────────────────
        try:
            stream = self.client.get_completion(messages=messages, stream=True)
        except Exception as e:
            # If image fails, retry without it
            if current_chart:
                messages[1] = {"role": "user", "content": context}
                stream = self.client.get_completion(messages=messages, stream=True)
            else:
                raise

        t_llm = time.time()
        first_token = False
        for part in stream:
            if hasattr(part, 'choices') and len(part.choices) > 0:
                delta = part.choices[0].delta
                if hasattr(delta, 'content') and delta.content:
                    if not first_token:
                        first_token = True
                        logger.info(
                            "[InteractiveExploreAgent] TTFB: %.2fs",
                            time.time() - t_llm,
                        )
                    yield delta.content

        logger.info(
            "[InteractiveExploreAgent] LLM total: %.2fs, run done",
            time.time() - t_llm,
        )

    def _run_inspect_round(self, messages, input_tables):
        """Run one non-streaming LLM call with the inspect_source_data tool.

        If the model calls the tool, execute it and append the result.
        If the model produces text without tool calls, skip (the main
        streaming call will generate the final output).

        Returns the updated messages list.
        """
        max_rounds = 3
        tools = [INSPECT_TOOL]

        for _ in range(max_rounds):
            try:
                response = self._call_llm_with_tools(messages, tools)
            except Exception as e:
                logger.warning(f"[InteractiveExploreAgent] Inspect round failed: {e}")
                from data_formulator.error_handler import collect_stream_warning
                collect_stream_warning(
                    "Data inspection round failed — results may be less accurate",
                    detail=str(e),
                    message_code="INSPECT_ROUND_FAILED",
                )
                break

            if not response or not response.choices:
                break

            choice = response.choices[0]
            content = choice.message.content or ""
            tool_calls = getattr(choice.message, 'tool_calls', None)

            if not tool_calls:
                # No tool call — model is ready to answer.
                # Don't append its text; we'll re-stream for the final response.
                break

            # Append assistant message with tool calls
            assistant_msg = {
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

            # Execute each tool call
            for tc in tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                if tool_name == "inspect_source_data":
                    table_names = tool_args.get("table_names", [])
                    tool_content = handle_inspect_source_data(
                        table_names, input_tables, self.workspace
                    )
                else:
                    tool_content = f"Unknown tool: {tool_name}"

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_content,
                })

            logger.info(f"[InteractiveExploreAgent] Inspect round: executed {len(tool_calls)} tool call(s)")

        return messages

    def _call_llm_with_tools(self, messages, tools):
        """Non-streaming LLM call with tool definitions."""
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
                    tools=tools,
                )
            except Exception as e:
                if self.client._is_image_deserialize_error(str(e)):
                    sanitized = self.client._strip_images_from_messages(messages)
                    return client.chat.completions.create(
                        model=self.client.model,
                        messages=sanitized,
                        tools=tools,
                    )
                raise
        else:
            params = self.client.params.copy()
            try:
                return litellm.completion(
                    model=self.client.model,
                    messages=messages,
                    tools=tools,
                    drop_params=True,
                    **params,
                )
            except Exception as e:
                if self.client._is_image_deserialize_error(str(e)):
                    sanitized = self.client._strip_images_from_messages(messages)
                    return litellm.completion(
                        model=self.client.model,
                        messages=sanitized,
                        tools=tools,
                        drop_params=True,
                        **params,
                    )
                raise