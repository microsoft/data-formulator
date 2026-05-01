# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import time

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response, supplement_missing_block, ensure_output_variable_in_code
from data_formulator.agents.agent_diagnostics import AgentDiagnostics
from data_formulator.security.sanitize import sanitize_error_message
from data_formulator.agents.agent_data_rec import (
    SHARED_ENVIRONMENT,
    SHARED_SEMANTIC_TYPE_REFERENCE,
    SHARED_CHART_REFERENCE,
    SHARED_STATISTICAL_ANALYSIS,
    SHARED_DUCKDB_NOTES,

)
import pandas as pd

import logging

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = f'''You are a data scientist who transforms data for visualization.
Given [CONTEXT] (dataset summaries) and [GOAL] (user intent + chart spec), refine the goal and write a Python script to produce the transformed data.

The user's [GOAL] includes a "chart" object (chart_type, encodings, config) describing the desired visualization and a natural language "goal".

{SHARED_ENVIRONMENT}

You will produce two outputs: a JSON spec (```json```) and a Python script (```python```). No extra text.

**Step 1: JSON spec** — refine the user's goal and finalize the chart.

Check if the user's "chart" (chart_type + encodings) is sufficient for their "goal":
- If encodings are sufficient, copy them.
- If encodings are missing fields, add minimal fields needed (aim for ≤3 channels: x, y, color/size).
- If encodings can be optimized, reorder for better visualization.
- If the user says "use B instead of A" while A is in encodings, update accordingly.
- For lat/lon data, use "latitude"/"longitude" as channel names, not "x"/"y".
- The user's chart_type may not be in [CHART TYPE REFERENCE] (e.g., "Radar Chart", "Bump Chart"). Preserve it as-is and infer valid encodings from channel names in the input.

```json
{{{{
    "input_tables": [...],       // table names from [CONTEXT]. Table 1 = currently viewed — prioritize it.
    "detailed_instruction": "",  // elaborated user instruction with details
    "display_instruction": "", // short verb phrase (<12 words) capturing computation intent. Bold **column names** (semantic matches count). For follow-ups, describe only the new part.
    "output_fields": [...],      // desired output fields (include intermediate fields)
    "chart": {{{{
        "chart_type": "",        // from [CHART TYPE REFERENCE], or keep the user's chart_type as-is if not listed
        "encodings": {{{{}}}},       // visual channels → output field names
        "config": {{{{}}}}           // optional styling
    }}}},
    "field_metadata": {{{{         // semantic type for each encoding field
        "<field>": "Category"        // from [SEMANTIC TYPE REFERENCE]
    }}}},
    "output_variable": "",       // descriptive snake_case name (e.g. "sales_by_region"), not "result_df"
    "reason": ""                 // why this refinement is made
}}}}
```

{SHARED_SEMANTIC_TYPE_REFERENCE}

{SHARED_CHART_REFERENCE}

{SHARED_STATISTICAL_ANALYSIS}

**Step 2: Python script** — transform input data to produce a DataFrame with all "output_fields". Keep it simple and readable. The script MUST assign the final result to the variable named in `"output_variable"` from Step 1.

**Datetime handling:**
- Year → number. Year-month / year-month-day → string ("2020-01" / "2020-01-01").
- Hour alone → number. Hour:min or h:m:s → string. Never return raw datetime objects.

{SHARED_DUCKDB_NOTES}'''


def _load_knowledge_rules(knowledge_store) -> list[dict]:
    """Load rules from KnowledgeStore. Returns list of {title, body} dicts."""
    if not knowledge_store:
        return []
    try:
        from data_formulator.knowledge.store import parse_front_matter
        items = knowledge_store.list_all("rules")
        result = []
        for item in items:
            try:
                content = knowledge_store.read("rules", item["path"])
                _, body = parse_front_matter(content)
                if body.strip():
                    result.append({"title": item["title"], "body": body.strip()})
            except Exception:
                pass
        return result
    except Exception:
        logger.warning("Failed to load knowledge rules", exc_info=True)
        return []


def _combine_rules(text_rules: str, knowledge_rules: list[dict]) -> str:
    """Merge text rules and knowledge-file rules into a single string."""
    parts = []
    if text_rules and text_rules.strip():
        parts.append(text_rules.strip())
    for rule in knowledge_rules:
        parts.append(f"### {rule['title']}\n{rule['body']}")
    return "\n\n".join(parts)


class DataTransformationAgent(object):

    def __init__(self, client, workspace, system_prompt=None, agent_coding_rules="", language_instruction="", max_display_rows=10000, model_info=None, knowledge_store=None):
        self.client = client
        self.workspace = workspace
        self.max_display_rows = max_display_rows
        self._model_info = model_info or {}
        self._agent_coding_rules = agent_coding_rules
        self._language_instruction = language_instruction

        knowledge_rules = _load_knowledge_rules(knowledge_store)
        combined_rules = _combine_rules(agent_coding_rules, knowledge_rules)

        if system_prompt is not None:
            self._base_prompt = system_prompt
            self.system_prompt = system_prompt
        else:
            self._base_prompt = SYSTEM_PROMPT
            base_prompt = SYSTEM_PROMPT
            if combined_rules:
                self.system_prompt = base_prompt + "\n\n[AGENT CODING RULES]\nPlease follow these rules when generating code. Note: if the user instruction conflicts with these rules, you should prioritize user instructions.\n\n" + combined_rules
            else:
                self.system_prompt = base_prompt

        if language_instruction:
            marker = "**About the execution environment:**"
            idx = self.system_prompt.find(marker)
            if idx > 0:
                self.system_prompt = (
                    self.system_prompt[:idx]
                    + language_instruction + "\n\n"
                    + self.system_prompt[idx:]
                )
            else:
                self.system_prompt = self.system_prompt + "\n\n" + language_instruction

        self._diag = AgentDiagnostics(
            agent_name="DataTransformationAgent",
            model_info=self._model_info,
            base_system_prompt=self._base_prompt,
            agent_coding_rules=self._agent_coding_rules,
            language_instruction=self._language_instruction,
            assembled_system_prompt=self.system_prompt,
        )

    def process_gpt_response(self, response, messages, t_llm=None):
        """Process GPT response to handle Python code execution"""
        t_start = time.time()
        t_exec_total = 0.0

        if isinstance(response, Exception):
            raw_error = str(getattr(response, "body", response))
            safe_error = sanitize_error_message(raw_error)
            result = {'status': 'other error', 'content': safe_error,
                      'diagnostics': self._diag.for_error(messages, error=safe_error)}
            return [result]

        candidates = []
        for choice in response.choices:
            logger.debug("=== Python script result ===>")
            logger.debug(choice.message.content + "\n")

            # --- Parse JSON spec and Python code ---
            json_blocks = extract_json_objects(choice.message.content + "\n")
            refined_goal = None
            for jb in json_blocks:
                if isinstance(jb, dict):
                    refined_goal = jb
                    break
            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            # If only one block was produced, request the missing one
            refined_goal, code_blocks, _supplement_content, t_supplement = supplement_missing_block(
                self.client, messages, choice.message.content,
                refined_goal, code_blocks, prefix="[DataTransformAgent]"
            )

            # Apply fallbacks for missing JSON
            json_fallback_used = refined_goal is None
            if refined_goal is None:
                refined_goal = {'chart': {'chart_type': '', 'encodings': {}, 'config': {}}, 'instruction': '', 'reason': '', 'output_variable': 'result_df'}
                logger.warning(
                    "[DataTransformAgent] JSON spec parsing failed — using fallback defaults. "
                    f"Response snippet: {choice.message.content[:300]!r}"
                )
            output_variable = refined_goal.get('output_variable', 'result_df') or 'result_df'
            logger.info(f"[DataTransformAgent] extracted output_variable={output_variable!r}")

            import re as _re
            _diag_code = code_blocks[-1] if code_blocks else None
            _diag_output_var_in_code = bool(
                _diag_code and output_variable
                and _re.search(rf'(?:^|\n)\s*{_re.escape(output_variable)}\s*=(?!=)', _diag_code)
            )
            _diag_sandbox_mode = None
            _diag_exec = {"status": None}
            _diag_code_patched = False

            if len(code_blocks) > 0:
                code = code_blocks[-1]

                if output_variable and not _diag_output_var_in_code:
                    code, was_patched, detected_var = ensure_output_variable_in_code(code, output_variable)
                    _diag_code_patched = was_patched
                    if was_patched:
                        logger.info(
                            f"[DataTransformAgent] output_variable {output_variable!r} not in code — "
                            f"patched: appended `{output_variable} = {detected_var}`"
                        )
                    else:
                        logger.warning(
                            f"[DataTransformAgent] output_variable {output_variable!r} not in code "
                            f"and auto-patch found no candidate variable."
                        )

                try:
                    from data_formulator.sandbox import create_sandbox

                    try:
                        from flask import current_app
                        sandbox_mode = current_app.config.get('CLI_ARGS', {}).get('sandbox', 'local')
                    except (ImportError, RuntimeError):
                        sandbox_mode = 'local'
                    _diag_sandbox_mode = sandbox_mode

                    t_exec_start = time.time()
                    sandbox = create_sandbox(sandbox_mode)
                    execution_result = sandbox.run_python_code(
                        code=code,
                        workspace=self.workspace,
                        output_variable=output_variable,
                    )
                    t_exec_total += time.time() - t_exec_start

                    if execution_result['status'] != 'ok':
                        diagnostics = execution_result.get("diagnostics", {})
                        raw_exec_error = diagnostics.get(
                            "safe_detail",
                            execution_result.get('content', execution_result.get('error_message', 'Unknown error')),
                        )
                        safe_exec_error = sanitize_error_message(raw_exec_error)
                    else:
                        safe_exec_error = None
                    _diag_exec = {
                        "status": execution_result['status'],
                        "error_message": safe_exec_error,
                        "available_dataframes": execution_result.get('df_names', []),
                    }

                    if execution_result['status'] == 'ok':
                        full_df = execution_result['content']
                        row_count = len(full_df)

                        output_table_name = self.workspace.get_fresh_name(f"d-{output_variable}")
                        self.workspace.write_parquet(full_df, output_table_name)

                        if row_count > self.max_display_rows:
                            query_output = full_df.head(self.max_display_rows)
                        else:
                            query_output = full_df
                        query_output = query_output.loc[:, ~query_output.columns.duplicated()]

                        result = {
                            "status": "ok",
                            "code": code,
                            "content": {
                                'rows': json.loads(query_output.to_json(orient='records')),
                                'virtual': {
                                    'table_name': output_table_name,
                                    'row_count': row_count
                                }
                            },
                        }
                    else:
                        result = {
                            'status': 'error',
                            'code': code,
                            'content': safe_exec_error or 'Unknown error'
                        }

                except Exception as e:
                    logger.exception('Error occurred during code execution')
                    safe_error = sanitize_error_message(f"{type(e).__name__}: {e}")
                    result = {
                        'status': 'error',
                        'code': code,
                        'content': "An error occurred during code execution."
                    }
                    _diag_exec = {"status": "exception", "error_message": safe_error}

            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task.", 'content_code': 'agent.noCodeBlock'}

            _effective_content = choice.message.content
            if _supplement_content:
                _effective_content += "\n\n" + _supplement_content
            result['dialog'] = [*messages, {"role": choice.message.role, "content": _effective_content}]
            result['agent'] = 'DataTransformationAgent'
            result['refined_goal'] = refined_goal

            # --- Build diagnostics ---
            usage = getattr(response, 'usage', None)
            result['diagnostics'] = self._diag.for_response(
                messages,
                raw_content=choice.message.content,
                finish_reason=getattr(choice, 'finish_reason', None),
                json_spec=refined_goal,
                json_fallback_used=json_fallback_used,
                code_found=len(code_blocks) > 0,
                code=_diag_code,
                output_variable=output_variable,
                output_variable_in_code=_diag_output_var_in_code,
                code_patched=_diag_code_patched,
                supplemented=_supplement_content is not None,
                sandbox_mode=_diag_sandbox_mode,
                exec_status=_diag_exec.get("status"),
                exec_error=_diag_exec.get("error_message"),
                exec_df_names=_diag_exec.get("available_dataframes"),
                t_llm=t_llm or 0,
                t_supplement=t_supplement,
                t_exec=t_exec_total,
                prompt_tokens=getattr(usage, 'prompt_tokens', None) if usage else None,
                completion_tokens=getattr(usage, 'completion_tokens', None) if usage else None,
            )

            candidates.append(result)

        t_total = time.time() - t_start
        t_llm_val = t_llm or 0.0

        logger.debug("=== Transform Candidates ===>")
        for candidate in candidates:
            for key, value in candidate.items():
                if key in ['dialog', 'content', 'diagnostics']:
                    logger.debug(f"##{key}:\n{str(value)[:1000]}...")
                else:
                    logger.debug(f"## {key}:\n{value}")

        usage = getattr(response, 'usage', None)
        usage_str = ""
        if usage:
            usage_str = f" | tokens: in={getattr(usage, 'prompt_tokens', None)}, out={getattr(usage, 'completion_tokens', None)}"
        logger.info(f"[DataTransformAgent] timing: llm={t_llm_val:.3f}s, supplement={t_supplement:.3f}s, exec={t_exec_total:.3f}s, total={t_total + t_llm_val:.3f}s{usage_str}")
        return candidates


    def run(self, input_tables, description, prev_messages: list[dict] = [], n=1,
             current_visualization=None, expected_visualization=None):
        """Args:
            input_tables: list[dict], each dict contains 'name' (table name in workspace)
            description: str, the description of the data transformation
            prev_messages: list[dict], the previous messages
            n: int, the number of candidates
            current_visualization: dict or None, contains chart_spec and optional chart_image for complete charts
            expected_visualization: dict or None, contains chart_spec for incomplete charts
        """
        table_names = [t.get('name', '?') for t in input_tables]
        logger.info(f"[DataTransformAgent] run start | tables={table_names}")

        # Generate data summary with file references
        from data_formulator.agents.agent_utils import generate_data_summary
        data_summary = generate_data_summary(input_tables, workspace=self.workspace)

        # Build visualization context section
        vis_section = ""
        if current_visualization:
            vis_section = f"\n\n[CURRENT VISUALIZATION] This is the current visualization the user has:\n\n{json.dumps(current_visualization.get('chart_spec', {}), indent=4, ensure_ascii=False)}"
        elif expected_visualization:
            vis_section = f"\n\n[EXPECTED VISUALIZATION] This is the visualization expected by the user:\n\n{json.dumps(expected_visualization.get('chart_spec', {}), indent=4, ensure_ascii=False)}"

        # Order: context → visualization → goal
        if len(prev_messages) > 0:
            user_query = f"The user wants a new transformation based off the following updated context and goal:\n\n[CONTEXT]\n\n{data_summary}{vis_section}\n\n[GOAL]\n\n{description}"
        else:
            user_query = f"[CONTEXT]\n\n{data_summary}{vis_section}\n\n[GOAL]\n\n{description}"

        logger.debug(user_query)

        # Filter out system messages from prev_messages
        filtered_prev_messages = [msg for msg in prev_messages if msg.get("role") != "system"]

        # Build user message content: include chart image if available
        chart_image = current_visualization.get('chart_image') if current_visualization else None
        has_image = bool(chart_image)
        logger.info(f"[DataTransformAgent] run LLM call | messages={1 + len(filtered_prev_messages) + 1}, has_image={has_image}")
        try:
            if chart_image:
                user_content = [
                    {"type": "text", "text": user_query},
                    {"type": "image_url", "image_url": {"url": chart_image, "detail": "low"}}
                ]
            else:
                user_content = user_query

            messages = [{"role":"system", "content": self.system_prompt},
                        *filtered_prev_messages,
                        {"role":"user","content": user_content}]

            t_llm_start = time.time()
            response = self.client.get_completion(messages = messages)
            t_llm = time.time() - t_llm_start
        except Exception as e:
            # Fallback to text-only if model doesn't support images
            logger.warning(f"Image-based completion failed, falling back to text-only: {e}")
            messages = [{"role":"system", "content": self.system_prompt},
                        *filtered_prev_messages,
                        {"role":"user","content": user_query}]
            t_llm_start = time.time()
            response = self.client.get_completion(messages = messages)
            t_llm = time.time() - t_llm_start

        candidates = self.process_gpt_response(response, messages, t_llm=t_llm)
        status = candidates[0].get('status', '?') if candidates else 'empty'
        logger.info(f"[DataTransformAgent] run done | status={status}")
        return candidates


    def followup(self, input_tables, dialog, latest_data_sample, new_instruction: str, n=1,
                 current_visualization=None, expected_visualization=None):
        """
        Followup transformation based on previous dialog and new instruction.

        Args:
            input_tables: list of input tables
            dialog: previous conversation history
            latest_data_sample: sample of the latest transformation result
            new_instruction: new user instruction for followup
            n: number of candidates
            current_visualization: dict or None, contains chart_spec and optional chart_image for complete charts
            expected_visualization: dict or None, contains chart_spec for incomplete charts
        """
        if not new_instruction or not new_instruction.strip():
            new_instruction = "Update the transformation based on the updated visualization context."

        logger.debug(f"GOAL: \n\n{new_instruction}")
        logger.info(f"[DataTransformAgent] followup start")

        updated_dialog = [{"role":"system", "content": self.system_prompt}, *dialog[1:]]

        # Format sample data
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        # Build visualization context section
        vis_section = ""
        if current_visualization:
            vis_section = f"\n\n[CURRENT VISUALIZATION] This is the current visualization the user has:\n\n{json.dumps(current_visualization.get('chart_spec', {}), indent=4, ensure_ascii=False)}"
        elif expected_visualization:
            vis_section = f"\n\n[EXPECTED VISUALIZATION] This is the visualization expected by the user:\n\n{json.dumps(expected_visualization.get('chart_spec', {}), indent=4, ensure_ascii=False)}"

        # Order: data sample → visualization → instruction
        followup_text = f"This is the result from the latest transformation:\n\n{sample_data_str}{vis_section}\n\nUpdate the Python script above based on the following instruction:\n\n{new_instruction}"

        logger.debug(followup_text)

        # Build user message content: include chart image if available
        chart_image = current_visualization.get('chart_image') if current_visualization else None
        has_image = bool(chart_image)
        logger.info(f"[DataTransformAgent] followup LLM call | messages={len(updated_dialog) + 1}, has_image={has_image}")
        try:
            if chart_image:
                user_content = [
                    {"type": "text", "text": followup_text},
                    {"type": "image_url", "image_url": {"url": chart_image, "detail": "low"}}
                ]
            else:
                user_content = followup_text

            messages = [*updated_dialog, {"role":"user", "content": user_content}]

            t_llm_start = time.time()
            response = self.client.get_completion(messages = messages)
            t_llm = time.time() - t_llm_start
        except Exception as e:
            # Fallback to text-only if model doesn't support images
            logger.warning(f"Image-based completion failed, falling back to text-only: {e}")
            messages = [*updated_dialog, {"role":"user", "content": followup_text}]
            t_llm_start = time.time()
            response = self.client.get_completion(messages = messages)
            t_llm = time.time() - t_llm_start

        candidates = self.process_gpt_response(response, messages, t_llm=t_llm)
        status = candidates[0].get('status', 'unknown') if candidates else 'empty'
        logger.info(f"[DataTransformAgent] followup done | status={status}")
        return candidates
