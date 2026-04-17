# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import time

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response, generate_data_summary, supplement_missing_block, ensure_output_variable_in_code
from data_formulator.agents.agent_diagnostics import AgentDiagnostics

import traceback
import pandas as pd

import logging

logger = logging.getLogger(__name__)

# =============================================================================
# Shared prompt sections  (imported by DataTransformationAgent)
# =============================================================================

SHARED_ENVIRONMENT = '''**About the execution environment:**
- You can use BOTH DuckDB SQL and pandas operations in the same script
- The script will run in the workspace data directory (all data files are in the current directory)
- Each table in [CONTEXT] has a **file path** (e.g., `student_exam.parquet`, `sales.csv`). Use EXACTLY that path to load data:
    - `.parquet`: `pd.read_parquet('file.parquet')` or DuckDB `read_parquet('file.parquet')`
    - `.csv`: `pd.read_csv('file.csv')` or DuckDB `read_csv_auto('file.csv')`
    - `.json`: `pd.read_json('file.json')`
    - `.xlsx`/`.xls`: `pd.read_excel('file.xlsx')`
    - `.txt`: `pd.read_csv('file.txt', sep='\\t')`
- **IMPORTANT:** Use the exact filename from the context — do NOT change the file extension or assume all files are parquet.
- **Allowed libraries:** pandas, numpy, duckdb, math, datetime, json, statistics, collections, re, sklearn, scipy, random, itertools, functools, operator, time
- **Not allowed:** matplotlib, plotly, seaborn, requests, subprocess, os, sys, io, or any other library not listed above.
- File system access (open, write) and network access are also forbidden.

**When to use DuckDB vs pandas:**
- **Prefer plain pandas** for most tasks — it's simpler and more readable.
- Only use DuckDB when the dataset is very large and you need efficient SQL aggregations, filtering, joins, or window functions.
- You can combine both: DuckDB for initial loading/filtering on large files, then pandas for complex operations.

**Code structure:** standalone script (no function wrapper), imports at top. **CRITICAL:** The final result DataFrame MUST be assigned to the exact variable name you specified in `"output_variable"` in the JSON spec — the system uses this name to extract the result. For example, if your output_variable is `sales_by_region`, the script must contain `sales_by_region = ...`.'''


SHARED_SEMANTIC_TYPE_REFERENCE = '''**[SEMANTIC TYPE REFERENCE]**

Choose the most specific type that fits. Only annotate fields used in chart encodings.

| Category | Types |
|---|---|
| Temporal | DateTime, Date, Time, Timestamp, Year, Quarter, Month, Week, Day, Hour, YearMonth, YearQuarter, YearWeek, Decade, Duration |
| Monetary measures | Amount, Price |
| Physical measures | Quantity, Temperature |
| Proportion | Percentage |
| Signed/diverging | Profit, PercentageChange, Sentiment, Correlation |
| Generic measures | Count, Number |
| Discrete numeric | Rank, Score |
| Identifier | ID |
| Geographic | Latitude, Longitude, Country, State, City, Region, Address, ZipCode |
| Entity names | Category, Name |
| Coded categorical | Status, Boolean, Direction |
| Binned ranges | Range |
| Fallback | Unknown |

Key guidelines:
- Use **Amount** for summed monetary totals, **Price** for per-unit prices, **Profit** for values that can be negative.
- Use **Temperature** (not Quantity) for temperature — it has special diverging behavior.
- Use **Year** (not Number) for columns like "year" with values 2020, 2021.'''


SHARED_CHART_REFERENCE = '''**[CHART TYPE REFERENCE]**

| chart_type | encodings | config |
|---|---|---|
| Scatter Plot | x, y, color, size, facet | opacity (0.1–1.0) |
| Regression | x, y, color, size, facet | regressionMethod ("linear","log","exp","pow","quad","poly"), polyOrder (2–10) |
| Bar Chart | x, y, color, facet | — |
| Grouped Bar Chart | x, y, group, facet | — |
| Line Chart | x, y, color, strokeDash, facet | interpolate ("linear","monotone","step") |
| Area Chart | x, y, color, facet | — |
| Heatmap | x, y, color, facet | colorScheme ("viridis","blues","reds","oranges","greens","blueorange","redblue") |
| Boxplot | x, y, color, facet | — |
| Pie Chart | size, color, facet | innerRadius (0–100; 0=pie, >0=donut) |
| Lollipop Chart | x, y, color, facet | — |
| Waterfall Chart | x, y, color, facet | — |
| Candlestick Chart | x, open, high, low, close, facet | — |
| World Map | longitude, latitude, color, size | projection ("mercator","equalEarth","naturalEarth1","orthographic"), projectionCenter ([lon,lat]) |
| US Map | longitude, latitude, color, size | — (fixed albersUsa) |

**Critical chart rules:**
- **Scatter Plot**: good default for relationships/correlations. Use config opacity (0.1–1.0) for dense data instead of encoding opacity.
- **Regression**: automatically overlays a trend line — do NOT compute regression in Python. Use color to get separate trend lines per group.
- **Bar Chart**: x=categorical, y=quantitative (vertical bars). Swap x↔y for horizontal bars. For histograms/distributions, bin the data in the Python step. Same-x rows are auto-stacked.
- **Grouped Bar Chart**: use the group channel (not color) for side-by-side bars.
- **Line Chart**: use strokeDash to differentiate line styles (e.g. actual vs forecast).
- **Pie Chart**: use "size" channel (not "theta") for the wedge values. Avoid when >7–8 categories.
- **Lollipop Chart**: like bar but with dot+line — cleaner for ranked comparisons.
- **Waterfall Chart**: cumulative gain/loss — each bar starts where the previous ended.
- **Candlestick Chart**: OHLC financial data — requires open, high, low, close columns.
- **World Map/US Map**: use "longitude"/"latitude" as channel names, not "x"/"y".
- **facet**: available for all chart types; use a categorical field with small cardinality.
- All fields in "encodings" must also appear in "output_fields". Typically use 2–3 channels (x, y, color/size).'''


SHARED_STATISTICAL_ANALYSIS = '''**Statistical analysis guide:**
- **Regression**: use chart_type "Regression" — the trend line is automatic, do NOT compute regression values in Python code. Configure method via `{"regressionMethod": "linear"}` (options: "linear", "log", "exp", "pow", "quad", "poly"; for poly add `{"polyOrder": 3}`).
- **Forecasting**: compute predicted future values in Python. Use Line Chart with strokeDash to distinguish actual vs forecast, and color for series grouping.
- **Clustering**: compute cluster assignments in Python. Output [x, y, cluster_id]. Use Scatter Plot with color → cluster_id.'''


SHARED_DUCKDB_NOTES = '''**DuckDB notes:**
- Escape single quotes with '' (not \\')
- No Unicode escapes (\\u0400); use character ranges directly: [а-яА-Я]
- Cast date columns explicitly: `CAST(col AS DATE)`, `CAST(col AS TIMESTAMP)`
- For complex datetime operations, load data first then use pandas datetime functions
- Critical identifier quoting rule:
  * If a table/column name contains non-ASCII characters (e.g., Chinese, Japanese, Korean, Cyrillic, etc.), spaces, or punctuation,
    you MUST wrap it in double quotes, e.g. SELECT "金额" FROM "客户表".
  * Never output placeholder identifiers like your_table_name, your_column, your_condition.'''


# =============================================================================
# DataRecAgent system prompt
# =============================================================================

SYSTEM_PROMPT = f'''You are a data scientist who recommends data and visualizations.
Given [CONTEXT] (dataset summaries) and [GOAL] (user intent), recommend a transformed dataset and visualization, then write a Python script to produce it.

{SHARED_ENVIRONMENT}

You will produce two outputs: a JSON spec (```json```) and a Python script (```python```). No extra text.

**Step 1: JSON spec** — infer user intent and recommend a visualization.

```json
{{{{
    "display_instruction": "", // short verb phrase (<12 words) capturing computation intent. Bold **column names** (semantic matches count). For follow-ups, describe only the new part.
    "input_tables": [...],   // table names from [CONTEXT] to use. Table 1 is the currently viewed table — prioritize it.
    "output_fields": [...],  // desired output fields (include intermediate fields)
    "chart": {{{{
        "chart_type": "",    // from [CHART TYPE REFERENCE]
        "encodings": {{{{}}}},   // visual channels → output field names
        "config": {{{{}}}}       // optional styling
    }}}},
    "field_metadata": {{{{     // semantic type for each encoding field
        "<field>": "Category"    // from [SEMANTIC TYPE REFERENCE]
    }}}},
    "output_variable": ""   // descriptive snake_case name (e.g. "sales_by_region"), not "result_df"
}}}}
```

**Data format rules:**
- Output must be tidy (one field per visual channel, like VegaLite/ggplot2).
- For multiple similar columns: reshape to long format (only same semantic type in one column).
- For derived metrics: compute new fields (correlation, difference, profit, etc.).
- Keep encodings to 2–3 channels (x, y, color/size). Add facet only when needed.

{SHARED_SEMANTIC_TYPE_REFERENCE}

{SHARED_CHART_REFERENCE}

{SHARED_STATISTICAL_ANALYSIS}

**Step 2: Python script** — transform input data to produce a DataFrame with all "output_fields". Keep it simple and readable. The script MUST assign the final result to the variable named in `"output_variable"` from Step 1.

**Datetime handling:**
- Year → number. Year-month / year-month-day → string ("2020-01" / "2020-01-01").
- Hour alone → number. Hour:min or h:m:s → string. Never return raw datetime objects.

{SHARED_DUCKDB_NOTES}'''


class DataRecAgent(object):

    def __init__(self, client, workspace, system_prompt=None, agent_coding_rules="", language_instruction="", max_display_rows=10000, model_info=None):
        self.client = client
        self.workspace = workspace
        self.max_display_rows = max_display_rows
        self._model_info = model_info or {}
        self._agent_coding_rules = agent_coding_rules
        self._language_instruction = language_instruction

        if system_prompt is not None:
            self._base_prompt = system_prompt
            self.system_prompt = system_prompt
        else:
            self._base_prompt = SYSTEM_PROMPT
            base_prompt = SYSTEM_PROMPT
            if agent_coding_rules and agent_coding_rules.strip():
                self.system_prompt = base_prompt + "\n\n[AGENT CODING RULES]\nPlease follow these rules when generating code. Note: if the user instruction conflicts with these rules, you should prioritize user instructions.\n\n" + agent_coding_rules.strip()
            else:
                self.system_prompt = base_prompt

        if language_instruction:
            # Insert early (after role definition, before technical sections)
            # so the LLM's "last impression" remains chart/code rules,
            # reducing recency-bias interference on chart-type selection.
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
            agent_name="DataRecAgent",
            model_info=self._model_info,
            base_system_prompt=self._base_prompt,
            agent_coding_rules=self._agent_coding_rules,
            language_instruction=self._language_instruction,
            assembled_system_prompt=self.system_prompt,
        )

    def process_gpt_response(self, input_tables, messages, response, t_llm=None):
        """Process GPT response to handle Python code execution"""
        t_start = time.time()
        t_exec_total = 0.0

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': str(response.body),
                      'diagnostics': self._diag.for_error(messages, error=str(response.body))}
            return [result]

        candidates = []
        for choice in response.choices:

            logger.debug("\n=== Data recommendation result ===>\n")
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
                refined_goal, code_blocks, prefix="[DataRecAgent]"
            )

            # Apply fallbacks for missing JSON
            json_fallback_used = refined_goal is None
            if refined_goal is None:
                refined_goal = {'output_fields': [], 'chart': {'chart_type': "", 'encodings': {}, 'config': {}}, 'output_variable': 'result_df'}
                logger.warning(
                    "[DataRecAgent] JSON spec parsing failed — using fallback defaults. "
                    f"Response snippet: {choice.message.content[:300]!r}"
                )
            output_variable = refined_goal.get('output_variable', 'result_df') or 'result_df'
            logger.info(f"[DataRecAgent] extracted output_variable={output_variable!r}")

            # Diagnostics tracking
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
                            f"[DataRecAgent] output_variable {output_variable!r} not in code — "
                            f"patched: appended `{output_variable} = {detected_var}`"
                        )
                    else:
                        logger.warning(
                            f"[DataRecAgent] output_variable {output_variable!r} not in code "
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

                    _diag_exec = {
                        "status": execution_result['status'],
                        "error_message": execution_result.get('content') if execution_result['status'] != 'ok' else None,
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
                        error_message = execution_result.get('content', execution_result.get('error_message', 'Unknown error'))
                        result = {
                            'status': 'error',
                            'code': code,
                            'content': error_message
                        }

                except Exception as e:
                    logger.warning('Error occurred during code execution:')
                    error_message = traceback.format_exc()
                    logger.warning(error_message)
                    result = {'status': 'other error', 'code': code, 'content': f"Unexpected error: {error_message}"}
                    _diag_exec = {"status": "exception", "error_message": str(e)}
            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task."}

            _effective_content = choice.message.content
            if _supplement_content:
                _effective_content += "\n\n" + _supplement_content
            result['dialog'] = [*messages, {"role": choice.message.role, "content": _effective_content}]
            result['agent'] = 'DataRecAgent'
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

        logger.debug("=== Recommendation Candidates ===>")
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
        logger.info(f"[DataRecAgent] timing: llm={t_llm_val:.3f}s, supplement={t_supplement:.3f}s, exec={t_exec_total:.3f}s, total={t_total + t_llm_val:.3f}s{usage_str}")
        return candidates

    def run(self, input_tables, description, n=1, prev_messages: list[dict] = []):
        """
        Args:
            input_tables: list[dict], each dict contains 'name' (table name in workspace) and 'rows'
            description: str, the description of what the user wants
            n: int, the number of candidates
            prev_messages: list[dict], the previous messages
        """
        table_names = [t.get('name', '?') for t in input_tables]
        logger.info(f"[DataRecAgent] run start | tables={table_names}")

        # Generate data summary with file references
        data_summary = generate_data_summary(input_tables, workspace=self.workspace)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}"
        if len(prev_messages) > 0:
            user_query = f"The user wants a new recommendation based off the following updated context and goal:\n\n[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}"

        logger.debug(user_query)

        # Filter out system messages from prev_messages
        filtered_prev_messages = [msg for msg in prev_messages if msg.get("role") != "system"]

        messages = [{"role":"system", "content": self.system_prompt},
                    *filtered_prev_messages,
                    {"role":"user","content": user_query}]

        t_llm_start = time.time()
        response = self.client.get_completion(messages = messages)
        t_llm = time.time() - t_llm_start

        candidates = self.process_gpt_response(input_tables, messages, response, t_llm=t_llm)
        status = candidates[0].get('status', '?') if candidates else 'empty'
        logger.info(f"[DataRecAgent] run done | status={status}")
        return candidates


    def followup(self, input_tables, dialog, latest_data_sample, new_instruction: str, n=1):
        """
        Followup recommendation based on previous dialog and new instruction.

        Args:
            input_tables: list of input tables
            dialog: previous conversation history
            latest_data_sample: sample of the latest transformation result
            new_instruction: new user instruction for followup
            n: number of candidates
        """
        logger.debug(f"GOAL: \n\n{new_instruction}")
        logger.info(f"[DataRecAgent] followup start")

        # Format sample data
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        # Replace the old system prompt with the current one so that
        # conversations continued from older threads pick up prompt changes.
        updated_dialog = [{"role": "system", "content": self.system_prompt}, *dialog[1:]]

        messages = [*updated_dialog,
                    {"role":"user",
                    "content": f"This is the result from the latest transformation:\n\n{sample_data_str}\n\nUpdate the Python script above based on the following instruction:\n\n{new_instruction}"}]

        t_llm_start = time.time()
        response = self.client.get_completion(messages = messages)
        t_llm = time.time() - t_llm_start

        return self.process_gpt_response(input_tables, messages, response, t_llm=t_llm)
