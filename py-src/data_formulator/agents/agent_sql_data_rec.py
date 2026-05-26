# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response, extract_and_log_user_prompt
from data_formulator.agents.agent_sql_data_transform import get_sql_table_statistics_str, sanitize_table_name
from data_formulator.agents.prompt_guard_agent import PromptGuardAgent, extract_all_columns_from_input_tables
from data_formulator.agents.qc_chart_config import (
    get_full_qc_chart_rules,
    get_compact_qc_chart_info,
    fix_qc_chart_encodings,
    validate_qc_chart_encodings,
    is_qc_data,
    QC_SYSTEM_PROMPT_EXTENSION,
)
from data_formulator.agents.field_metadata import FieldMeta, compute_field_metadata
from data_formulator.agents.chart_compatibility import (
    RejectInfo,
    check_chart_data_compatibility,
    validate_chart,
    strict_validation_enabled,
    reject_info_to_response,
    format_field_metadata_hint,
)

import random
import string

import traceback
import duckdb
import pandas as pd

import logging
import re

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to recommend data that will be used for visualization.
The user will provide you information about what visualization they would like to create, and your job is to recommend a transformed data that can be used to create the visualization and write a SQL query to transform the data.
The recommendation and transformation function should be based on the [CONTEXT] and [GOAL] provided by the user. 
The [CONTEXT] shows what the current dataset is, and the [GOAL] describes what the user wants the data for.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with NULL.

Concretely, you should infer the appropriate data and create a SQL query based off the [CONTEXT] and [GOAL] in two steps:

**⚠️ CRITICAL INSTRUCTION FOR CHART TYPE HANDLING - DO NOT SKIP:**

🔴 **RULE #1: NEVER OVERRIDE USER'S CHART TYPE SELECTION**
- If the [GOAL] object contains a "chart_type" field with a value, you MUST use EXACTLY that chart type in your response.
- Do NOT suggest, recommend, or change to a different chart type, even if you think a different chart would be better for the data.
- Examples:
  * If [GOAL] has "chart_type": "linear-regression", output MUST have "chart_type": "linear-regression" (not "qc_trend_line")
  * If [GOAL] has "chart_type": "scatter", output MUST have "chart_type": "scatter" (not "histogram" or "boxplot")
  * If [GOAL] has "chart_type": "bar", output MUST have "chart_type": "bar" (not any other type)
- This applies EVEN IF the data looks like QC data or control limit data.
- This applies EVEN IF you think a different chart would visualize the data better.

🟡 **RULE #2: HONOR CHART_TYPE_SOURCE MARKERS**
- If [GOAL] has "chart_type_source": "user_selected_from_ui", the user explicitly selected this chart type from a dropdown menu.
- If [GOAL] has "chart_type_source": "user_explicitly_requested", the user explicitly requested this chart type in their description.
- BOTH cases mean: this is NOT a suggestion - this is a user DECISION. You MUST honor it.

🟢 **RULE #3: ONLY INFER IF NO CHART_TYPE IN GOAL**
- Only infer/suggest a chart_type if the [GOAL] object does NOT have a "chart_type" field.
- If chart_type is absent from [GOAL], then you may recommend based on the user description.

**Your responsibility:** Transform the data to work well with the user's selected chart type, NOT to convince them to use a different chart type.

1. First, based on users' [GOAL]. Create a json object that represents the inferred user intent. The json object should have the following format:

{
    "mode": "" // string, one of "infer", "overview", "distribution", "summary"
    "recap": "..." // string, a short summary of the user's goal.
    "display_instruction": "..." // string, the even shorter verb phrase describing the users' goal.
    "recommendation": "..." // string, explain why this recommendation is made
    "output_fields": ["INDEX", ...] // string[], Fields that will be in the output. This includes: (1) INDEX (if it exists in input, list it first), (2) Any NEW computed/transformed columns you create. output_fields describes the complete output including original + new columns.
    "chart_type": "" // string, one of "point", "bar", "line", "area", "heatmap", "group_bar", "boxplot", "rolling_average", "radial_plot", "linear_regression", "qc_trend_line", "qc_histogram", "qc_trend_bar", "waterfall", "radar", "pie", "donut", "bubble", "histogram", "pareto", "gauge", "funnel", "treemap", "sankey", "timeline", "pyramid", "threshold". "chart_type" should be inferred from user instruction only if explicitly mentioned; otherwise omit this field and let LLM infer from context.
    "chart_encodings": {
        "x": "",
        "y": "",
        "color": "",
        "size": "",
        "opacity": "",
        "facet": "",
    } // object: map visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of output fields, appropriate visual channels for different chart types are defined below.
}

🎯 **RULE #4: PICK FIELDS BY SEMANTIC ROLE (NEVER hardcode by column name)**

The [CONTEXT] section labels each column with a role. Pick fields whose role
matches the channel's intent:

| Chart                  | x                                                  | y               | color           |
|------------------------|----------------------------------------------------|-----------------|-----------------|
| line, area, rolling_avg| temporal > sequential > quantitative               | quantitative    | categorical_low |
| linear_regression      | quantitative > temporal > sequential               | quantitative    | categorical_low |
| bar, group_bar         | categorical_low > temporal > categorical_mid       | quantitative    | categorical_low |
| histogram              | quantitative ONLY (NEVER sequential/categorical)   | —               | categorical_low |
| boxplot                | categorical_low/mid                                | quantitative    | categorical_low |
| point (scatter)        | quantitative > temporal                            | quantitative≠x  | categorical_low |
| heatmap                | temporal > categorical_low/mid                     | categorical_low/mid | quantitative |
| pie, donut             | label=categorical_low (≤12 distinct), value=quantitative — NO x/y channels |||
| funnel, pyramid        | label=categorical_low/mid, value=quantitative — NO x/y channels            |||
| pareto                 | categorical_low/mid                                | quantitative    | —               |
| timeline               | temporal (required)                                | categorical_low/mid | —           |

🚫 **HARD CONSTRAINTS (violating these = invalid chart):**
- NEVER put control_limit columns (TARGET, LL, UL, ARLL, ARUL) in chart_encodings — they render as reference lines.
- NEVER use sequential columns (INDEX, id-like) for bar.x, histogram.x, heatmap.x, boxplot.x — chart becomes unreadable.
- NEVER use categorical_huge columns (>500 distinct) for ANY encoding — overloads the chart.
- pie/donut/funnel/pyramid use label+value, NOT x/y.

Additional rules:
- CRITICAL: Prioritize natural language matching for chart type selection. ALWAYS respect user's explicit chart type request.
- Chart types "qc_trend_line", "qc_histogram", and "qc_trend_bar" should ONLY be used when user explicitly requests the specific QC chart type. Full QC specifications are provided separately when QC data is detected in input.
- **IMPORTANT: Always respect the user's explicit chart type request**, regardless of data characteristics.
- "qc_trend_line" means a quality control trend chart. "qc_trend_bar" means a QC trend bar chart. "qc_histogram" means a QC distribution chart.

**Use Actual Column Names from Input Data:**
- ONLY use column names that actually exist in [CONTEXT]. Do NOT invent placeholder names.
- Match columns to channels using the role table in RULE #4 — pick by ROLE, not by name pattern.
- If no column with the required role exists, leave that channel empty.

Concretely:
    - recap what the user's goal is in a short summary in "recap".
    - If the user's [GOAL] is clear already, simply infer what the user mean. Set "mode" as "infer" and create "output_fields" and "chart_encodings" based off user description.
    - If the user's [GOAL] is not clear, make recommendations to the user:
        - choose one of "distribution", "overview", "summary" in "mode":
            * if it is "overview" and the data is in wide format, reshape it into long format.
            * if it is "distribution", select a few fields that would be interesting to visualize together.
            * if it is "summary", calculate some aggregated statistics to show intresting facts of the data.
        - describe the recommendation reason in "recommendation"
        - based on the recommendation, determine what is an ideal output data. Note, the output data must be in tidy format.
        - then suggest recommendations of chart encoding that should be used to create the visualization.
    - "display_instruction" should be a short verb phrase describing the users' goal, it should be even shorter than "recap". 
        - it would be a short verbal description of user intent as a verb phrase (<12 words).
        - generate based on "recap" and the suggested visualization, but don't need to mention the visualization details.
        - should capture key computation ideas: by reading the display, the user can understand the purpose and what's derived from the data.
        - if the user instruction builds up the previous instruction, the 'display_instruction' should only describe how it builds up the previous instruction without repeating information from previous steps.
        - the phrase can be presented in different styles, e.g., question (what's xxx), instruction (show xxx), description, etc.
        - if you mention column names from the input or the output data, highlight the text in **bold**.
            * the column can either be a column in the input data, or a new column that will be computed in the output data.
            * the mention don't have to be exact match, it can be semantically matching, e.g., if you mentioned "average score" in the text while the column to be computed is "Avg_Score", you should still highlight "**average score**" in the text.
    - "chart_type" must be one of "point", "bar", "line", "area", "heatmap", "group_bar", "boxplot", "rolling_average", "radial_plot", "linear_regression", "qc_trend_line", "qc_histogram", "qc_trend_bar", "waterfall", "radar", "pie", "donut", "bubble", "histogram", "pareto", "gauge", "funnel", "treemap", "sankey", "timeline", "pyramid", "threshold"
    - "chart_encodings" should specify which fields should be used to create the visualization. See RULE #4 above for the role-based channel mapping — DO NOT hardcode defaults by column name.
    - ⚠️ QC CHARTS (qc_trend_line, qc_histogram, qc_trend_bar) use specific channel names (INDEX, VALUE, QCDATE, QCSHIFT, color) — NEVER use x or y. Full QC channel specifications are injected separately when QC data is detected.
    - All fields used in "chart_encodings" MUST appear in "output_fields".
    - Typically 2-3 fields are enough (x, y, color/size); add facet for faceted views (4 total). QC charts may use 3-5 channels.
    - Chart-type intent (use ROLE TABLE in RULE #4 for channel mappings):
        - point (scatter): correlations, relationships. Color = category, size = extra quantitative dim.
        - histogram: distribution of ONE quantitative field. If x is categorical, bin or transform first. Color groups bars.
        - bar / group_bar: compare metric ACROSS categories. Multiple rows with same x → stack or facet. Group_bar: keep color cardinality < 5.
        - line / area: trends along an ordered axis. Duplicate (x, color) with different y breaks the line — aggregate or facet.
        - linear_regression: 2 quantitative variables; frontend overlays regression line on scatter.
        - heatmap: 2 categorical axes + quantitative color intensity. Bin quantitative axes if needed.
        - pie / donut: composition (≤ 12 slices). Avoid for many categories.
        - boxplot: distribution of quantitative per categorical group.
        - QC charts (qc_trend_line, qc_histogram, qc_trend_bar): require QC data and use INDEX/VALUE/QCDATE/QCSHIFT/color channels — NOT x/y. Full specs injected separately.
        - facet: categorical with small cardinality, splits visualization into sub-panels.
        - opacity: legend channel for quantitative or categorical.
    - visualization fields require tidy data. 
        - similar to VegaLite and ggplot2 so that each field is mapped to a visualization axis or legend. 
        - consider data transformations if you want to visualize multiple fields together:
            - exapmle 1: suggest reshaping the data into long format in data transformation description (if these fields are all of the same type, e.g., they are all about sales, price, two columns about min/max-values, etc. don't mix different types of fields in reshaping) so we can visualize multiple fields as categories or in different facets.
            - exapmle 2: calculate some derived fields from these fields(e.g., correlation, difference, profit etc.) in data transformation description to visualize them in one visualization.
            - example 3: create a visualization only with a subset of the fields, you don't have to visualize all of them in one chart, you can later create a visualization with the rest of the fields. With the subset of charts, you can also consider reshaping or calculate some derived value.
            - again, it does not make sense to have five fields like [item, A, B, C, D, E] in visualization fields, you should consider data transformation to reduce the number of fields.
            - when reshaping data to long format, only fields of the same semantic type should be rehaped into the same column.
            
    2. Then, write a SQL query based on the inferred goal. The query input are tables (or multiple tables presented in the [CONTEXT] section) and the output is the transformed data.

**CRITICAL RULE FOR SQL QUERIES:**
- You can ADD new computed/transformed columns (like averages, ranks, etc.), but NEVER REMOVE original columns
- The input data typically already has an INDEX column - if it does, just use it directly with `SELECT *, computed_field_1, ... FROM table_name`
- Do NOT create a new INDEX column (don't use ROW_NUMBER() AS INDEX unless explicitly asked by user)
- Think of "output_fields" as the COMPUTED FIELDS TO ADD, not as the complete list of fields to keep
- If no transformation is needed, use `SELECT * FROM table` to keep all columns
- The user wants to see their complete original data PLUS any helpful new columns you generate

Example:
- Input table has columns: [INDEX, student, major, math, reading, writing]
- If user asks to "rank students", your output should have: [INDEX, student, major, math, reading, writing, rank] (ALL original + computed columns)
- NOT just [student, rank] (which removes original columns)
- Do NOT create a new INDEX by using ROW_NUMBER() - the existing INDEX column is already there

The query should be as simple as possible and easily readable.
note:
     - the sql query should be written in the style of duckdb.
     - if the user provided multiple tables, you should consider the join between tables to derive the output.

    3. The output must only contain two items:
        - a json object (wrapped in ```json```) representing the refined goal (including "mode", "recommendation", "output_fields", "chart_type", "chart_encodings")
        - a sql query block (wrapped in ```sql```) representing the transformation code, do not add any extra text explanation.

    **IMPORTANT: INDEX Column Handling**
    - "output_fields" should include "INDEX" but it typically already exists in the input data
    - Do NOT create a new INDEX column - if INDEX already exists in the input table, just use it directly
    - Only create ROW_NUMBER() AS INDEX if the input table genuinely does NOT have an INDEX column
    - **EXCEPTION - GROUP BY / AGGREGATION CASE (CRITICAL):**
      * When the user requests operations that change the row count (GROUP BY, aggregation like SUM/COUNT/AVG, DISTINCT, etc.), the number of output rows WILL DIFFER from input rows
      * In these cases, you MUST recalculate INDEX for the output using: `ROW_NUMBER() OVER (ORDER BY <sort_key>) AS INDEX`
      * The sort_key should make logical sense (e.g., ORDER BY the grouped column, or ORDER BY an aggregated measure)
      * Example: If user asks "Group by QCDATE and calculate the total VALUE for each group":
        - Input might have 1000 rows with many QCDATE values
        - Output will have only ~30 rows (one per unique QCDATE)
        - Use: `ROW_NUMBER() OVER (ORDER BY QCDATE) AS INDEX` (NOT GROUP BY INDEX)
      * Common patterns requiring INDEX recalculation:
        - GROUP BY with aggregations (SUM, COUNT, AVG, MIN, MAX)
        - DISTINCT (removes duplicate rows)
        - ORDER BY without GROUP BY (if reordering changes logical sequence)
        - Window functions that partition/reduce row count
      * Do NOT include the original INDEX in GROUP BY clause - only GROUP BY the grouping columns you want
    - INDEX should NOT be included in chart_encodings (it's a row identifier, not a visualization field)

some notes:
- in DuckDB, you escape a single quote within a string by doubling it ('') rather than using a backslash (\').
- in DuckDB, you need to use proper date functions to perform date operations.
- Critical: When using date/time functions in DuckDB, always cast date columns to explicit types to avoid function overload ambiguity:
  * Use `CAST(date_column AS DATE)` for date operations
  * Use `CAST(datetime_column AS TIMESTAMP)` for timestamp operations
  * Use `CAST(datetime_column AS TIMESTAMP_NS)` for nanosecond precision timestamps
  * Common patterns:
    - Extract year: `CAST(strftime('%Y', CAST(date_column AS DATE)) AS INTEGER) AS year`
    - Extract month: `CAST(strftime('%m', CAST(date_column AS DATE)) AS INTEGER) AS month`
    - Format date: `strftime('%Y-%m-%d', CAST(date_column AS DATE)) AS formatted_date`
    - Date arithmetic: `CAST(date_column AS DATE) + INTERVAL 1 DAY`
  * This prevents "Could not choose a best candidate function" errors in DuckDB
- Critical: DuckDB regex limitations:
  * Does NOT support Unicode escape sequences like \\u0400-\\u04FF
  * For Unicode character detection, use character ranges directly: [а-яА-Я] for Cyrillic, [一-龥] for Chinese, etc.
  * Alternative: Use ASCII ranges or specific character sets that DuckDB supports
  * Example: Instead of quote ~ '[\\u0400-\\u04FF]', use quote ~ '[а-яА-ЯёЁ]'

**QC_CHART_SPECIFICATIONS:**
QC chart types (qc_trend_line, qc_histogram, qc_trend_bar) require specific fixed channels.
Full specifications are injected into context when QC control limit data (TARGET + LL/UL/ARLL/ARUL) is detected.
'''

example = """
For example:

[CONTEXT]

Here are our datasets, here are their field summaries and samples:

table_0 (student_exam) fields:
	student -- type: int64, values: 1, 2, 3, ..., 997, 998, 999, 1000
	major -- type: object, values: liberal arts, science
	math -- type: int64, values: 0, 8, 18, ..., 97, 98, 99, 100
	reading -- type: int64, values: 17, 23, 24, ..., 96, 97, 99, 100
	writing -- type: int64, values: 10, 15, 19, ..., 97, 98, 99, 100

table_0 (student_exam) sample:

```
|student|major|math|reading|writing
0|1|liberal arts|72|72|74
1|2|liberal arts|69|90|88
2|3|liberal arts|90|95|93
3|4|science|47|57|44
4|5|science|76|78|75
......
```

[GOAL]

{"goal": "Rank students based on their average scores"}

[OUTPUT]

```json
{  
    "recap": "Rank students based on their average scores",
    "display_instruction": "Rank students by **average scores**",
    "mode": "infer",
    "recommendation": "To rank students based on their average scores, we need to calculate the average score for each student, then sort the data, and finally assign a rank to each student based on their average score.",  
    "output_fields": ["student", "major", "average_score", "rank"],  
    "chart_type": "bar",  
    "chart_encodings": {"x": "student", "y": "average_score"}  
}  
```

```sql
SELECT   
    student,  
    major,  
    (math + reading + writing) / 3.0 AS average_score,  
    RANK() OVER (ORDER BY (math + reading + writing) / 3.0 DESC) AS rank  
FROM   
    student_exam  
ORDER BY average_score DESC;
```

---

**GROUP BY EXAMPLE** (Showing correct INDEX recalculation):

[CONTEXT]

table_0 (qc_sample_data) fields:
    INDEX -- type: int64, values: 1, 2, 3, ..., 999, 1000 (original row numbers)
    QCDATE -- type: object, values: 2026-03-10, 2026-03-11, 2026-03-12, ...
    VALUE -- type: float64, values: 12.5, 13.2, 11.8, ..., 14.1

table_0 (qc_sample_data) sample:
```
|INDEX|QCDATE|VALUE
0|1|2026-03-10|12.5
1|2|2026-03-10|13.2
2|3|2026-03-10|11.8
3|4|2026-03-11|14.1
4|5|2026-03-11|15.0
......
```

[GOAL]

{"goal": "Group by QCDATE and calculate the total VALUE for each group, then visualize it using a bar chart"}

[OUTPUT]

❌ WRONG: Including original INDEX in GROUP BY (would return 1000 rows - each original row):
```sql
SELECT INDEX, QCDATE, SUM(VALUE) AS TOTAL_VALUE
FROM qc_sample_data
GROUP BY INDEX, QCDATE  -- WRONG! This defeats the purpose of GROUP BY
```

✅ CORRECT: Recalculate INDEX for the output (returns ~30 rows - one per QCDATE):
```json
{
    "recap": "Group by QCDATE and calculate total VALUE for each date",
    "display_instruction": "Calculate total **VALUE** per **QCDATE**",
    "mode": "infer",
    "recommendation": "To group by QCDATE and show total VALUE per date, we aggregate the data by date. Since grouping reduces the row count from 1000 to ~30 rows, a new INDEX must be calculated for the output.",
    "output_fields": ["INDEX", "QCDATE", "TOTAL_VALUE"],
    "chart_type": "bar",
    "chart_encodings": {"x": "QCDATE", "y": "TOTAL_VALUE"}
}
```

```sql
SELECT
    ROW_NUMBER() OVER (ORDER BY QCDATE) AS INDEX,
    QCDATE,
    SUM(VALUE) AS TOTAL_VALUE
FROM qc_sample_data
GROUP BY QCDATE
ORDER BY QCDATE;
```

Key points:
- Do NOT include original INDEX in the GROUP BY clause
- Use ROW_NUMBER() OVER (ORDER BY <sort_column>) AS INDEX to create new sequence numbers for the aggregated result
- The ROW_NUMBER() produces 1, 2, 3... for the output rows (not the input rows)
"""

class SQLDataRecAgent(object):

    def __init__(self, client, conn, system_prompt=None, agent_coding_rules="", guard_client=None):
        self.client = client
        self.conn = conn
        self.guard = PromptGuardAgent(client=guard_client or client)
        
        # Incorporate agent coding rules into system prompt if provided
        if system_prompt is not None:
            self.system_prompt = system_prompt
        else:
            base_prompt = SYSTEM_PROMPT
            if agent_coding_rules and agent_coding_rules.strip():
                self.system_prompt = base_prompt + "\n\n[AGENT CODING RULES]\nPlease follow these rules when generating code. Note: if the user instruction conflicts with these rules, you should priortize user instructions.\n\n" + agent_coding_rules.strip()
            else:
                self.system_prompt = base_prompt

    def validate_chart_data_compatibility(self, chart_type: str, output_fields: list, refined_goal: dict) -> tuple:
        """
        Validate if the output fields support the selected chart_type.
        Returns: (is_valid: bool, error_message: str)
        """
        if not chart_type or chart_type == "Auto" or chart_type == "Table":
            return True, ""
        
        if not output_fields:
            return False, f"No output fields available for {chart_type}"
        
        chart_encodings = refined_goal.get('chart_encodings', {})
        
        # Chart-specific validation rules
        validation_rules = {
            'scatter': {
                'minFields': 2,
                'minEncodings': ['x', 'y'],
                'message': 'Scatter plot requires at least 2 data fields (X and Y axes)'
            },
            'line': {
                'minFields': 1,
                'minEncodings': ['x'],
                'message': 'Line chart requires at least one X axis field (time series or sequence)'
            },
            'bar': {
                'minFields': 1,
                'message': 'Bar chart requires at least one data field'
            },
            'area': {
                'minFields': 2,
                'minEncodings': ['x', 'y'],
                'message': 'Area chart requires at least 2 data fields (X and Y axes)'
            },
            'histogram': {
                'minFields': 1,
                'message': 'Histogram requires at least one numeric field'
            },
            'boxplot': {
                'minFields': 1,
                'message': 'Box plot requires at least one numeric field'
            },
            'heatmap': {
                'minFields': 3,
                'minEncodings': ['x', 'y', 'color'],
                'message': 'Heatmap requires at least 3 fields (X, Y, and Color/Value)'
            },
            'linear-regression': {
                'minFields': 2,
                'minEncodings': ['x', 'y'],
                'message': 'Linear regression requires at least 2 numeric fields (X and Y axes)'
            },
            'bubble': {
                'minFields': 3,
                'minEncodings': ['x', 'y', 'size'],
                'message': 'Bubble chart requires at least 3 fields (X, Y, and Size)'
            }
        }
        
        rule = validation_rules.get(chart_type, {})
        
        # Check minimum field count
        if 'minFields' in rule:
            if len(output_fields) < rule['minFields']:
                return False, f"{rule['message']}. Got {len(output_fields)} field(s): {', '.join(output_fields[:3])}"
        
        # Check if required encodings are present
        if 'minEncodings' in rule:
            missing_encodings = [enc for enc in rule['minEncodings'] if not chart_encodings.get(enc)]
            if missing_encodings:
                return False, f"{rule['message']}. Missing encodings: {', '.join(missing_encodings)}"
        
        return True, ""

    def _compute_all_field_metas(self, input_tables) -> dict:
        """Compute FieldMeta for every column across all input tables.

        Returns a single flat dict (column_name → FieldMeta). When the same
        column name appears in multiple tables we keep the first occurrence —
        the validator only needs one entry per name to match against the
        LLM's encoding, and downstream SQL joins typically disambiguate.

        Failures per-table are logged and skipped, not raised — metadata is a
        BEST-EFFORT input to the validator; the agent should still attempt
        the LLM call if a single table fails introspection.
        """
        all_metas: dict = {}
        for table in input_tables:
            table_name = table.get('name', '')
            if not table_name:
                continue
            try:
                sanitized = sanitize_table_name(table_name)
                table_metas = compute_field_metadata(self.conn, sanitized)
                for col_name, meta in table_metas.items():
                    if col_name not in all_metas:
                        all_metas[col_name] = meta
            except Exception as e:
                logger.warning(f"⚠️ Failed to compute FieldMeta for table '{table_name}': {e}")
        return all_metas

    def process_gpt_response(
        self,
        input_tables,
        messages,
        response,
        user_preferred_chart_type: str = "",
        all_field_metas: dict = None,
        domain: str = "generic",
    ):
        """process gpt response to handle execution"""

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        # 🔍 DEBUG: Log what we received
        logger.info(f"🔍 process_gpt_response called with user_preferred_chart_type='{user_preferred_chart_type}'")
        logger.info(f"🔍 post-validate domain='{domain}', field_metas_count={len(all_field_metas) if all_field_metas else 0}")

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': str(response.body)}
            return [result]
        
        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Data recommendation result ===>\n")
            logger.info(choice.message.content + "\n")

            # Detect if the model returned HTML or other unexpected formats (e.g., an HTML error page)
            content = choice.message.content if hasattr(choice.message, 'content') else str(choice)
            lower_content = content.lower()
            if '<!doctype' in lower_content or '<html' in lower_content:
                logger.warning("Model returned HTML content instead of JSON/SQL.")
                result = {
                    'status': 'error',
                    'code': "",
                    'content': f"Model returned HTML/unknown format in response: {content[:1000]}"
                }

                result['dialog'] = [*messages, {"role": choice.message.role, "content": content}]
                result['agent'] = 'SQLDataRecAgent'
                result['refined_goal'] = { 'mode': "", 'recommendation': "", 'output_fields': [], 'chart_encodings': {}, 'chart_type': "" }
                candidates.append(result)
                continue

            json_blocks = extract_json_objects(content + "\n")
            if len(json_blocks) > 0:
                refined_goal = json_blocks[0]
            else:
                refined_goal = { 'mode': "", 'recommendation': "", 'output_fields': [], 'chart_encodings': {}, 'chart_type': "" }

            # ✅ ENFORCE INDEX REQUIREMENT: Always ensure INDEX is in output_fields
            if 'output_fields' in refined_goal and refined_goal['output_fields']:
                if 'INDEX' not in refined_goal['output_fields']:
                    logger.info("⚠️ INDEX not in output_fields, adding it automatically")
                    refined_goal['output_fields'].insert(0, 'INDEX')

            # 🔍 VALIDATE CHART COMPATIBILITY WITH DATA FIELDS
            chart_type = refined_goal.get('chart_type', '')
            output_fields = refined_goal.get('output_fields', [])
            is_compatible, compatibility_error = self.validate_chart_data_compatibility(chart_type, output_fields, refined_goal)
            
            if not is_compatible:
                logger.warning(f"❌ Chart compatibility error: {compatibility_error}")
                refined_goal['_chart_compatibility_error'] = compatibility_error

            # ⚠️ VALIDATION & AUTO-FIX for QC charts
            chart_encodings = refined_goal.get('chart_encodings', {})

            if chart_type and chart_type.startswith('qc_'):
                # Try to auto-fix common LLM mistakes (x, y instead of INDEX, VALUE, etc.)
                fixed_encodings = fix_qc_chart_encodings(chart_type, chart_encodings)
                if fixed_encodings != chart_encodings:
                    refined_goal['chart_encodings'] = fixed_encodings
                    chart_encodings = fixed_encodings
                    logger.info(f"✅ Auto-corrected QC chart encodings: {fixed_encodings}")

                # Validate the (possibly corrected) encodings
                is_valid, errors = validate_qc_chart_encodings(chart_type, chart_encodings)
                if not is_valid:
                    for error in errors:
                        logger.warning(f"❌ {error}")
                    # Log but continue - frontend may handle it
                    refined_goal['_qc_validation_errors'] = errors

            # === NEW (M3): POST VALIDATE for non-QC charts ===
            # QC chart validation above is auto-correcting (LLM mistakes get
            # fixed in place). Standard charts go through the strict
            # CHART_REQUIREMENTS validator instead — it REJECTS rather than
            # auto-corrects, per the "thà không vẽ còn hơn vẽ rác" principle.
            if (
                strict_validation_enabled()
                and all_field_metas
                and chart_type
                and not chart_type.startswith("qc_")
            ):
                validation = validate_chart(
                    chart_type, chart_encodings, all_field_metas, domain
                )
                if not validation.is_valid:
                    reject = validation.reject
                    # Allow derived columns referenced in encodings:
                    # at this stage validation sees only INPUT FieldMeta, while
                    # the LLM may intentionally encode on a computed output
                    # field (e.g. Avg_VALUE). If missing column exists in
                    # output_fields, defer strict check until after transform.
                    if (
                        reject
                        and reject.short == "missing_column"
                        and reject.context_columns
                    ):
                        output_fields = set(refined_goal.get("output_fields", []))
                        if all(col in output_fields for col in reject.context_columns):
                            logger.info(
                                "ℹ️ Skip POST reject missing_column for derived output field(s): %s",
                                reject.context_columns,
                            )
                            reject = None
                    if reject is None:
                        pass
                    else:
                        logger.warning(
                            f"🚫 POST REJECT: {reject.code} ({reject.short}) — {reject.message_vi}"
                        )
                        reject_resp = reject_info_to_response(
                            reject,
                            agent_name="SQLDataRecAgent",
                            messages=[*messages, {"role": choice.message.role, "content": content}],
                        )
                        # Preserve LLM output for client-side debugging
                        reject_resp["refined_goal"]["_llm_chart_type"] = chart_type
                        reject_resp["refined_goal"]["_llm_chart_encodings"] = chart_encodings
                        candidates.append(reject_resp)
                        continue

            code_blocks = extract_code_from_gpt_response(content + "\n", "sql")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]

                # ✅ INDEX HANDLING: Use existing INDEX column, don't create new ones
                # Note: Since input data typically already has INDEX column,
                # we should NOT auto-inject ROW_NUMBER() unless explicitly needed
                # The SQL from LLM should already include existing INDEX via SELECT *

                try:
                    random_suffix = ''.join(random.choices(string.ascii_lowercase, k=4))
                    table_name = f"view_{random_suffix}"
                    
                    create_query = f"CREATE VIEW IF NOT EXISTS {table_name} AS {code_str}"
                    self.conn.execute(create_query)
                    self.conn.commit()

                    # Check how many rows are in the table
                    row_count = self.conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                    
                    # Only limit to 5000 if there are more rows
                    query_output = self.conn.execute(f"SELECT * FROM {table_name} LIMIT 5000").fetch_df()
                
                    result = {
                        "status": "ok",
                        "code": code_str,
                        "content": {
                            'rows': json.loads(query_output.to_json(orient='records')),
                            'virtual': {
                                'table_name': table_name,
                                'row_count': row_count
                            }
                        },
                    }
                except duckdb.BinderException as e:
                    error_str = str(e)
                    if "Could not choose a best candidate function" in error_str:
                        logger.warning(f"DuckDB type ambiguity error: {error_str}")
                        result = {
                            'status': 'sql_error', 
                            'code': code_str, 
                            'content': f"SQL type casting required. DuckDB needs explicit type casting for date/time functions. Error: {error_str}. Please cast date columns to specific types (DATE, TIMESTAMP, etc.) before using date functions."
                        }
                    else:
                        logger.warning(f"DuckDB binder error: {error_str}")
                        result = {
                            'status': 'sql_error', 
                            'code': code_str, 
                            'content': f"SQL error: {error_str}"
                        }
                except Exception as e:
                    logger.warning('other error:')
                    error_message = traceback.format_exc()
                    logger.warning(error_message)
                    result = {'status': 'other error', 'code': code_str, 'content': f"Unexpected error: {error_message}"}
            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task."}
            
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'SQLDataRecAgent'
            
            # 🔴 HARD OVERRIDE: If user explicitly selected chart_type, FORCE it
            # This prevents LLM from overriding user's UI selection - NO EXCEPTIONS
            logger.info(f"🔍 OVERRIDE CHECK START")
            logger.info(f"   user_preferred_chart_type type: {type(user_preferred_chart_type)}")
            logger.info(f"   user_preferred_chart_type value: '{user_preferred_chart_type}'")
            logger.info(f"   user_preferred_chart_type bool: {bool(user_preferred_chart_type)}")
            logger.info(f"   user_preferred_chart_type len: {len(user_preferred_chart_type) if isinstance(user_preferred_chart_type, str) else 'N/A'}")
            
            if user_preferred_chart_type and len(user_preferred_chart_type.strip()) > 0:
                logger.warning(f"🔴🔴🔴 OVERRIDE IS ACTIVE! Forcing chart_type to '{user_preferred_chart_type}'")
                llm_chart_type = refined_goal.get('chart_type', '')
                logger.info(f"   LLM returned chart_type: '{llm_chart_type}'")
                
                # FORCE the override - no exceptions
                refined_goal['chart_type'] = user_preferred_chart_type
                refined_goal['chart_type_source'] = 'user_selected_from_ui'
                
                logger.warning(f"🔴 OVERRIDE APPLIED!")
                logger.warning(f"   refined_goal['chart_type'] is now: '{refined_goal['chart_type']}'")
                logger.warning(f"   Verification: {refined_goal.get('chart_type', 'NOT SET!')}")
            else:
                logger.info(f"ℹ️ No override - user_preferred_chart_type is empty or whitespace")
            
            result['refined_goal'] = refined_goal
            
            # 🔍 FINAL VERIFICATION: Log what's actually in the result
            logger.info(f"🔍 FINAL result['refined_goal']['chart_type'] = '{result['refined_goal'].get('chart_type', 'NOT SET!')}'")
            
            candidates.append(result)

        logger.info("=== Recommendation Candidates ===>")
        for candidate in candidates:
            for key, value in candidate.items():
                if key in ['dialog', 'content']:
                    logger.info(f"##{key}:\n{str(value)[:1000]}...")
                else:
                    logger.info(f"## {key}:\n{value}")

        return candidates
    

    def run(self, input_tables, description, n=1, prev_messages: list[dict] = [], prompt_source: str = "user", user_preferred_chart_type: str = ""):
        # � LOG USER'S CHART SELECTION
        if user_preferred_chart_type:
            logger.info(f"📊 User selected chart type from UI: '{user_preferred_chart_type}'")
        else:
            logger.info(f"📊 No chart type pre-selected by user")
        
        # === Compute FieldMeta FIRST so we have authoritative column metadata
        # (DuckDB schema is the source of truth — not the sample rows passed
        # through, which may be empty in tests or sliced in prod). ===
        all_field_metas = self._compute_all_field_metas(input_tables)

        # Derive column list from FieldMeta; fall back to row-based extraction
        # if introspection failed (preserves legacy behavior).
        if all_field_metas:
            data_columns = list(all_field_metas.keys())
        else:
            data_columns = extract_all_columns_from_input_tables(input_tables)

        # 🛡️ Guard: Validate prompt before processing
        # Skip guard validation for agent-generated prompts
        if prompt_source == "user":
            guard_result = self.guard.validate(description, data_columns=data_columns)
            if not guard_result["ok"]:
                logger.info(f"🚫 Prompt blocked by guard: {guard_result['reason']}")
                return [{
                    "status": "blocked",
                    "code": "",
                    "content": guard_result["user_message"],
                    "agent": "SQLDataRecAgent",
                    "refined_goal": {
                        "mode": "",
                        "recommendation": guard_result["reason"],
                        "output_fields": [],
                        "chart_encodings": {},
                        "chart_type": ""
                    },
                    "guard": guard_result,
                    "dialog": [*prev_messages, {"role": "user", "content": description}],
                }]
        else:
            logger.info(f"✅ Skipping guard validation for agent-generated prompt: '{description[:50]}...'")

        # === NEW (M3): Detect domain (field metadata already computed above) ===
        # Domain selects QC-aware vs generic field-picking rules.
        domain = "qc" if is_qc_data(data_columns) else "generic"
        logger.info(
            f"📊 Domain detected: '{domain}' "
            f"(field_metas_count={len(all_field_metas)})"
        )

        # === NEW (M3): EARLY REJECT if user-picked chart incompatible with data ===
        # This catches R1/R2/R4 BEFORE the LLM is invoked — fail-fast UX and
        # saves a token-expensive LLM call.
        if strict_validation_enabled() and user_preferred_chart_type:
            early_reject = check_chart_data_compatibility(
                user_preferred_chart_type, all_field_metas, domain
            )
            if early_reject is not None:
                logger.info(
                    f"🚫 EARLY REJECT: {early_reject.code} ({early_reject.short}) "
                    f"chart='{user_preferred_chart_type}' domain='{domain}'"
                )
                return [reject_info_to_response(
                    early_reject,
                    agent_name="SQLDataRecAgent",
                    messages=[*prev_messages, {"role": "user", "content": description}],
                )]

        data_summary = ""
        qc_notes = []

        # Detect if user specified an explicit chart type in the description or in previous messages
        search_text = description + " " + " ".join([msg.get('content','') for msg in prev_messages])
        logger.info(f"🔍 Searching for explicit chart type in text: '{search_text[:100]}'...")
        # Robust regex patterns to capture common chart requests (variants, spaces, hyphens, and phrases)
        # Patterns ordered by specificity (most specific first) to avoid false matches
        chart_patterns = [
            (r'\bqc[_\s-]*trend[_\s-]*line\b', 'qc_trend_line'),
            (r'\bqc[_\s-]*trend[_\s-]*bar\b', 'qc_trend_bar'),
            (r'\bqc[_\s-]*histogram\b', 'qc_histogram'),
            (r'\btrend[_\s-]*line\b', 'line'),
            (r'\btrend[_\s-]*bar\b', 'bar'),
            (r'\bbar[_\s-]*chart\b', 'bar'),
            (r'\bline[_\s-]*chart\b', 'line'),
            (r'\bhistogram\b', 'histogram'),
            (r'\bscatter[_\s-]*plot\b', 'point'),
            (r'\bscatter\b', 'point'),
            (r'\bpoint\b', 'point'),
            (r'\barea[_\s-]*chart\b', 'area'),
            (r'\barea\b', 'area'),
            (r'\bheat[_\s-]*map\b', 'heatmap'),
            (r'\bgroup[_\s-]*bar\b', 'group_bar'),
            (r'\bstacked[_\s-]*bar\b', 'stacked_bar'),
            (r'\bpie[\s-]*chart\b', 'pie'),
            (r'\bpie\b', 'pie'),
            (r'\bdonut[\s-]*chart\b', 'donut'),
            (r'\bdonut\b', 'donut'),
            (r'\bbubble[\s-]*plot\b', 'bubble'),
            (r'\bbubble[\s-]*chart\b', 'bubble'),
            (r'\bbubble\b', 'bubble'),
            (r'\bradar[\s-]*chart\b', 'radar'),
            (r'\bradar\b', 'radar'),
            (r'\bwaterfall[\s-]*chart\b', 'waterfall'),
            (r'\bwaterfall\b', 'waterfall'),
            (r'\bfunnel[\s-]*chart\b', 'funnel'),
            (r'\bfunnel\b', 'funnel'),
            (r'\bsankey[\s-]*diagram\b', 'sankey'),
            (r'\bsankey\b', 'sankey'),
            (r'\btree[\s-]*map\b', 'tree'),
            (r'\btreemap\b', 'tree'),
            (r'\btree\b', 'tree'),
            (r'\bnetwork[\s-]*diagram\b', 'network'),
            (r'\bnetwork[\s-]*graph\b', 'network'),
            (r'\bnetwork\b', 'network'),
            (r'\bboxplot\b', 'boxplot'),
            (r'\bviolin[\s-]*plot\b', 'violin'),
            (r'\bviolins\b', 'violin'),
            (r'\brectangle[\s-]*tree\b', 'rect_tree'),
            (r'\brect[\s-]*tree\b', 'rect_tree'),
            (r'\bsunburst\b', 'sunburst'),
            (r'\brolling[_\s-]*average\b', 'rolling_average'),
            (r'\blinear[_\s-]*regression\b', 'linear_regression'),
            (r'\bradial[_\s-]*plot\b', 'radial_plot'),
            (r'\bpareto[\s-]*chart\b', 'pareto'),
            (r'\bpareto\b', 'pareto'),
            (r'\bgauge[\s-]*chart\b', 'gauge'),
            (r'\bgauge\b', 'gauge'),
            (r'\btimeline[\s-]*chart\b', 'timeline'),
            (r'\btimeline\b', 'timeline'),
            (r'\bpyramid[\s-]*chart\b', 'pyramid'),
            (r'\bpyramid\b', 'pyramid'),
            (r'\bthreshold[\s-]*chart\b', 'threshold'),
            (r'\bthreshold\b', 'threshold')
        ]
        specified_chart = False
        extracted_chart_type = None
        for pat, chart_type in chart_patterns:
            if re.search(pat, search_text, re.I):
                specified_chart = True
                extracted_chart_type = chart_type
                logger.info(f"📊 ✅ Explicitly detected chart type request: '{chart_type}' (matched pattern: {pat})")
                break

        for table in input_tables:
            table_name = sanitize_table_name(table['name'])
            table_summary_str = get_sql_table_statistics_str(self.conn, table_name)
            data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"

        # === NEW (M4): Inject per-column semantic-role hints ===
        # Replaces the old prompt's hardcoded "x=INDEX (default)" pattern. The
        # LLM now reads ROLES per column and picks via the RULE #4 table.
        field_metadata_hint = format_field_metadata_hint(all_field_metas)
        if field_metadata_hint:
            data_summary += f"{field_metadata_hint}\n\n"


        # Build structured GOAL to send to the model
        # ⚠️ RULE: Only include chart_type if user explicitly requested it or selected from UI
        # Priority: user_preferred_chart_type (from UI dropdown) > extracted_chart_type (from text patterns)
        if user_preferred_chart_type:
            # User selected chart type from UI dropdown - MUST honor it
            goal_obj = {"description": description, "chart_type": user_preferred_chart_type, "chart_type_source": "user_selected_from_ui"}
            logger.info(f"✅ User selected chart type '{user_preferred_chart_type}' from UI - this MUST be honored in output")
        elif extracted_chart_type:
            goal_obj = {"description": description, "chart_type": extracted_chart_type, "chart_type_source": "user_explicitly_requested"}
            logger.info(f"✅ User explicitly requested chart type '{extracted_chart_type}' in text - this MUST be honored in output")
        else:
            goal_obj = {"description": description}
            logger.info("ℹ️ No explicit chart type specified - LLM will infer from description")

        user_goal_str = json.dumps(goal_obj, indent=4)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{user_goal_str}"
        if len(prev_messages) > 0:
            user_query = f"The user wants a new recommendation based off the following updated context and goal:\n\n[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{user_goal_str}"

        logger.info(user_query)

        # Filter out system messages from prev_messages
        filtered_prev_messages = [msg for msg in prev_messages if msg.get("role") != "system"]

        # Dynamically inject QC prompt extension only when input data has QC columns.
        # This keeps the base system prompt lean for non-QC queries (~1,500 tokens saved).
        system_content = self.system_prompt
        if is_qc_data(data_columns):
            system_content = system_content + QC_SYSTEM_PROMPT_EXTENSION
            logger.info("🔬 QC data detected — QC prompt extension injected into system message")
        else:
            logger.info("📊 Non-QC data — base system prompt used (no QC extension)")

        messages = [{"role":"system", "content": system_content},
                    *filtered_prev_messages,
                    {"role":"user","content": user_query}]
        
        logger.info("Messages sent to LLM:" + json.dumps(messages))
        
        # Log user prompt to ClickHouse
        #extract_and_log_user_prompt(messages, "SQLDataRecAgent")
        
        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(
            input_tables, messages, response,
            user_preferred_chart_type=user_preferred_chart_type,
            all_field_metas=all_field_metas,
            domain=domain,
        )


    def followup(self, input_tables, dialog, latest_data_sample, new_instruction: str, n=1):
        """extend the input data (in json records format) to include new fields
        latest_data_sample: the latest data sample that the user is working on, it's a json object that contains the data sample of the current table
        new_instruction: the new instruction that the user wants to add to the latest data sample
        """
        # Note: Guard validation already ran in run() method for the initial prompt
        # Followup refinements don't need re-validation - guard is a one-time check

        logger.info(f"GOAL: \n\n{new_instruction}")

        # get the current table name
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        messages = [*dialog, 
                    {"role":"user", 
                    "content": f"This is the result from the latest sql query:\n\n{sample_data_str}\n\nUpdate the sql query above based on the following instruction:\n\n{new_instruction}"}]

        # Log user prompt to ClickHouse
        #extract_and_log_user_prompt(messages, "SQLDataRecAgent")
        
        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)
