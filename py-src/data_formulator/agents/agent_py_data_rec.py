# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import re
import pandas as pd

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary, extract_code_from_gpt_response, extract_and_log_user_prompt
from data_formulator.agents.prompt_guard_agent import PromptGuardAgent, extract_all_columns_from_input_tables
from data_formulator.agents.qc_chart_config import is_qc_data, QC_SYSTEM_PROMPT_EXTENSION
from data_formulator.agents.field_metadata import FieldMeta, QC_ROLE_MAP
from data_formulator.agents.chart_compatibility import (
    RejectInfo,
    check_chart_data_compatibility,
    validate_chart,
    strict_validation_enabled,
    reject_info_to_response,
    format_field_metadata_hint,
    validate_template_constraints,
    normalize_to_template_chart,
)
import data_formulator.py_sandbox as py_sandbox

import traceback
import logging

logger = logging.getLogger(__name__)

_ID_NAME_PATTERN = re.compile(r"(?:^|_)(id|no|code|seq|key|num)(?:_|$)", re.IGNORECASE)


def _classify_cardinality(cardinality: int) -> str:
    """Classify cardinality into low/mid/high/huge buckets.

    Local copy (mirroring field_metadata thresholds) — used by the pandas-based
    metadata builder below, which doesn't go through DuckDB.
    """
    if cardinality <= 12:
        return "low"
    if cardinality <= 50:
        return "mid"
    if cardinality <= 500:
        return "high"
    return "huge"


SYSTEM_PROMPT = '''You are a data scientist to help user to recommend data that will be used for visualization.
The user will provide you information about what visualization they would like to create, and your job is to recommend a transformed data that can be used to create the visualization and write a python function to transform the data.
The recommendation and transformation function should be based on the [CONTEXT] and [GOAL] provided by the user. 
The [CONTEXT] shows what the current dataset is, and the [GOAL] describes what the user wants the data for.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with np.nan.

**⚠️ CRITICAL INSTRUCTION FOR CHART TYPE HANDLING - DO NOT SKIP:**

🔴 **RULE #1: NEVER OVERRIDE USER'S CHART TYPE SELECTION**
- If the [GOAL] object contains a "chart_type" field with a value, you MUST use EXACTLY that chart type in your response.
- Do NOT suggest, recommend, or change to a different chart type, even if you think a different chart would be better for the data.
- Examples:
  * If [GOAL] has "chart_type": "scatter", output MUST have "chart_type": "scatter" (not "histogram" or "boxplot")
  * If [GOAL] has "chart_type": "line", output MUST have "chart_type": "line" (not "area" or "linear-regression")
  * If [GOAL] has "chart_type": "bar", output MUST have "chart_type": "bar" (not any other type)
- This applies EVEN IF you think a different chart would visualize the data better.

🟡 **RULE #2: HONOR CHART_TYPE_SOURCE MARKERS**
- If [GOAL] has "chart_type_source": "user_selected_from_ui", the user explicitly selected this chart type from a dropdown menu.
- If [GOAL] has "chart_type_source": "user_explicitly_requested", the user explicitly requested this chart type in their description.
- BOTH cases mean: this is NOT a suggestion - this is a user DECISION. You MUST honor it.

🟢 **RULE #3: ONLY INFER IF NO CHART_TYPE IN GOAL**
- Only infer/suggest a chart_type if the [GOAL] object does NOT have a "chart_type" field.
- If chart_type is absent from [GOAL], then you may recommend based on the user description.

**Your responsibility:** Transform the data to work well with the user's selected chart type, NOT to convince them to use a different chart type.

Concretely, you should infer the appropriate data and create in the output section a python function based off the [CONTEXT] and [GOAL] in two steps:

1. First, based on users' [GOAL]. Create a json object that represents the inferred user intent. The json object should have the following format:

{
    "mode": "" // string, one of "infer", "overview", "distribution", "summary", "forecast"
    "recap": "..." // string, a short summary of the user's goal.
    "display_instruction": "..." // string, the even shorter verb phrase describing the users' goal.
    "recommendation": "..." // string, explain why this recommendation is made
    "output_fields": [...] // string[], describe the desired output fields that the output data should have (i.e., the goal of transformed data), it's a good idea to preseve intermediate fields here
    "chart_type": "" // string, one of "point", "bar", "line", "area", "heatmap", "group_bar", "linear_regression", "pie", "donut", "bubble", "waterfall", "radar", "funnel", "sankey", "tree", "network", "histogram", "boxplot", "violin", "sunburst", "scatter". "chart_type" should either be inferred from user instruction, or recommend if the user didn't specify any.
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
| line, area             | temporal > sequential > quantitative               | quantitative    | categorical_low |
| linear_regression      | quantitative > temporal > sequential               | quantitative    | categorical_low |
| bar, group_bar         | categorical_low > temporal > categorical_mid       | quantitative    | categorical_low |
| histogram              | quantitative ONLY (NEVER sequential/categorical)   | —               | categorical_low |
| boxplot, violin        | categorical_low/mid                                | quantitative    | categorical_low |
| point (scatter)        | quantitative > temporal                            | quantitative≠x  | categorical_low |
| heatmap                | temporal > categorical_low/mid                     | categorical_low/mid | quantitative |
| pie, donut             | label=categorical_low (≤12 distinct), value=quantitative — NO x/y channels |||
| funnel                 | label=categorical_low/mid (stages), value=quantitative — NO x/y channels   |||
| bubble                 | quantitative (x), quantitative (y), quantitative (size), categorical_low (color)        |||
| radar                  | categorical (categories), quantitative (radius), categorical_low (groups)               |||
| waterfall              | categorical (stages, ordered), quantitative (changes — can be negative)                 |||
| sankey, network        | categorical (source), categorical (target), quantitative (value)                        |||
| tree, sunburst         | hierarchical categorical + quantitative value (NO x/y)                                  |||

🚫 **HARD CONSTRAINTS (violating these = invalid chart):**
- NEVER put control_limit columns (TARGET, LL, UL, ARLL, ARUL) in chart_encodings — they render as reference lines.
- NEVER use sequential columns (INDEX, id-like) for bar.x, histogram.x, heatmap.x, boxplot.x — chart becomes unreadable.
- NEVER use categorical_huge columns (>500 distinct) for ANY encoding — overloads the chart.
- pie/donut/funnel use label+value, NOT x/y. tree/sunburst use hierarchy + value.

Concretely:
    - recap what the user's goal is in a short summary in "recap".
    - If the user's [GOAL] is clear already, simply infer what the user mean. Set "mode" as "infer" and create "output_fields" and "chart_encodings" based off user description.
    - If the user's [GOAL] is not clear, make recommendations to the user:
        - choose one of "distribution", "overview", "summary", "forecast" in "mode":
            * if it is "overview" and the data is in wide format, reshape it into long format.
            * if it is "distribution", select a few fields that would be interesting to visualize together.
            * if it is "summary", calculate some aggregated statistics to show intresting facts of the data.
            * if it is "forecast", concretize the x,y fields that will be used for forecasting and decide if it is about regression or forecasting.
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
    - "chart_type" must be one of "point", "bar", "line", "area", "heatmap", "group_bar"
    - "chart_encodings" should specify which fields should be used to create the visualization. See RULE #4 above for the role-based channel mapping — DO NOT hardcode defaults by column name.
    - All fields used in "chart_encodings" MUST appear in "output_fields".
    - "output_fields" should include important intermediate fields used for data transformation even if they aren't visualized.
    - Typically 2-3 fields per chart (x, y, color/size); add facet for faceted views (4 total).
    - Chart-type intent (use ROLE TABLE in RULE #4 for channel mappings):
        - point (scatter): correlations / forecasting / regression. Color = category, size = extra quantitative dim.
        - histogram: distribution of ONE quantitative field. Bin if needed. Color groups bars.
        - bar / group_bar: compare metric across categories. Multiple rows with same x → stack or facet. Group_bar: keep color cardinality < 5.
        - line / area: trends along an ordered axis. Duplicate (x, color) with different y breaks the line — aggregate or facet.
        - linear_regression: 2 quantitative variables; output is long-format with is_predicted column (see forecasting guide below).
        - heatmap: 2 categorical axes + quantitative color intensity. Bin quantitative axes if needed.
        - pie / donut: composition (≤ 12 slices). Avoid for many categories.
        - boxplot / violin: distribution of quantitative per categorical group.
        - bubble: 3 quantitative (x, y, size) + categorical color.
        - waterfall: stages + signed values (cumulative effect).
        - radar: 3-12 dimensions, quantitative per dim, categorical groups.
        - funnel: ordered stages + values (process dropoff).
        - sankey / network: source + target + flow value.
        - tree / sunburst: hierarchical category + quantitative value.
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
    - guide on statistical analysis:
        - when the user asks for forecasting or regression analysis, you should consider the following:
            - the output should be a long format table where actual x, y pairs and predicted x, y pairs are included in the X, Y columns, they are differentiated with a third column "is_predicted" that is a boolean field.
            - i.e., if the user ask for forecasting based on two columns T and Y, the output should be three columns: T, Y, is_predicted, where
                - T, Y columns contain BOTH original values from the data and predicted values from the data.
                - is_predicted is a boolean field to indicate whether the x, y pairs are original values from the data or predicted / regression values from the data.
            - the recommended chart should be line chart (time series) or scatter plot (quantitative x, y)
            - if the user asks for forecasting, it's good to include predicted x, y pairs for both x in the original data and future x values (i.e., combine regression and forecasting results)
                - in this case, is_predicted should be of three values 'original', 'regression', 'forecasting'
                - put is_predicted field in 'opacity' channel to distinguish them.
        - when the user asks for clustering:
            - the output should be a long format table where actual x, y pairs with a third column "cluster_id" that indicates the cluster id of the data point.
            - the recommended chart should be scatter plot (quantitative x, y)
            
    2. Then, write a python function based on the inferred goal, the function input is a dataframe "df" (or multiple dataframes based on tables presented in the [CONTEXT] section) and the output is the transformed dataframe "transformed_df". 
"transformed_df" should contain all "output_fields" from the refined user intent in the json object.
The python function must follow the template provided in [TEMPLATE], do not import any other libraries or modify function name. The function should be as simple as possible and easily readable. 
If there is no data transformation needed based on "output_fields", the transformation function can simply "return df".

[TEMPLATE]

```python
import pandas as pd
import collections
import numpy as np
from sklearn import ... # import necessary libraries from sklearn if needed

def transform_data(df1, df2, ...): 
    # complete the template here
    return transformed_df
```

note: 
- if the user provided one table, then it should be `def transform_data(df1)`, if the user provided multiple tables, then it should be `def transform_data(df1, df2, ...)` and you should consider the join between tables to derive the output.
- **VERY IMPORTANT** the number of arguments in the function must match the number of tables provided, and the order of arguments must match the order of tables provided.
- you can use intuitive table names to refer to the input dataframes, for example, if the user provided two tables city and weather, you can use `transform_data(df_city, df_weather)` to refer to the two dataframes, as long as the number and order of the arguments match the number and order of the tables provided.
- datetime objects handling:
    - if the output field is year, convert it to number, if it is year-month / year-month-day, convert it to string object (e.g., "2020-01" / "2020-01-01").
    - if the output is time only: convert hour to number if it's just the hour (e.g., 10), but convert hour:min or h:m:s to string object (e.g., "10:30", "10:30:45")
    - never return datetime object directly, convert it to either number (if it only contains year) or string so it's readable.
    
    3. The output must only contain a json object representing inferred user intent and a python code block representing the transformation code, do not add any extra text explanation.
'''

example = """
For example:

[CONTEXT]

Here are our datasets, here are their field summaries and samples:

df1 (student_exam) fields:
	student -- type: int64, values: 1, 2, 3, ..., 997, 998, 999, 1000
	major -- type: object, values: liberal arts, science
	math -- type: int64, values: 0, 8, 18, ..., 97, 98, 99, 100
	reading -- type: int64, values: 17, 23, 24, ..., 96, 97, 99, 100
	writing -- type: int64, values: 10, 15, 19, ..., 97, 98, 99, 100

df1 (student_exam) sample:

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

{  
    "recap": "Rank students based on their average scores",
    "display_instruction": "Rank students by average scores",
    "mode": "infer",
    "recommendation": "To rank students based on their average scores, we need to calculate the average score for each student, then sort the data, and finally assign a rank to each student based on their average score.",  
    "output_fields": ["student", "major", "average_score", "rank"],  
    "chart_type": "bar",  
    "chart_encodings": {"x": "student", "y": "average_score"},  
}  

```python
import pandas as pd  
import collections  
import numpy as np  
  
def transform_data(df):  
    df['average_score'] = df[['math', 'reading', 'writing']].mean(axis=1)  
    df = df.sort_values(by='average_score', ascending=False)  
    df['rank'] = df['average_score'].rank(ascending=False, method='dense').astype(int)  
    transformed_df = df[['student', 'major', 'average_score', 'rank']]  
    return transformed_df 
```
"""

class PythonDataRecAgent(object):

    def __init__(self, client, system_prompt=None, exec_python_in_subprocess=False, agent_coding_rules="", guard_client=None):
        self.client = client
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
                
        self.exec_python_in_subprocess = exec_python_in_subprocess

    def _build_field_meta(self, name: str, series: pd.Series, row_count: int) -> FieldMeta:
        non_null = int(series.notna().sum())
        cardinality = int(series.nunique(dropna=True))
        null_ratio = 0.0 if row_count == 0 else float((row_count - non_null) / row_count)
        cardinality_class = _classify_cardinality(cardinality)

        is_temporal = pd.api.types.is_datetime64_any_dtype(series)
        is_numeric = pd.api.types.is_numeric_dtype(series)
        is_integer = pd.api.types.is_integer_dtype(series)

        stddev = None
        min_val = None
        max_val = None
        if is_numeric and non_null > 0:
            stddev = float(series.std()) if pd.notna(series.std()) else 0.0
            min_val = float(series.min()) if pd.notna(series.min()) else None
            max_val = float(series.max()) if pd.notna(series.max()) else None

        is_sequential = (
            bool(is_integer)
            and non_null == row_count
            and cardinality == row_count
            and min_val is not None
            and max_val is not None
            and int(max_val - min_val + 1) == cardinality
        )
        is_quantitative = bool(is_numeric and (not is_sequential) and stddev is not None and stddev > 0 and cardinality >= 10)
        is_categorical = cardinality_class in ("low", "mid") and (not is_temporal) and (not is_sequential) and (not is_quantitative)
        qc_role = QC_ROLE_MAP.get(name.upper())
        looks_like_id = bool(_ID_NAME_PATTERN.search(name)) and cardinality_class in ("high", "huge")

        return FieldMeta(
            name=name,
            sql_type=str(series.dtype),
            cardinality=cardinality,
            null_ratio=null_ratio,
            cardinality_class=cardinality_class,
            is_temporal=is_temporal,
            is_sequential=is_sequential,
            is_quantitative=is_quantitative,
            is_categorical=is_categorical,
            qc_role=qc_role,
            looks_like_id=looks_like_id,
            row_count=row_count,
            stddev=stddev,
            min_value=min_val,
            max_value=max_val,
        )

    def _compute_all_field_metas(self, input_tables) -> dict:
        metas = {}
        for table in input_tables:
            df = pd.DataFrame.from_records(table.get("rows", []))
            row_count = len(df.index)
            if row_count == 0:
                continue
            for col in df.columns:
                if col not in metas:
                    metas[col] = self._build_field_meta(col, df[col], row_count)
        return metas

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

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': str(response.body)}
            return [result]
        
        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Data recommendation result ===>\n")
            logger.info(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            if len(json_blocks) > 0:
                refined_goal = json_blocks[0]
            else:
                refined_goal = { 'mode': "", 'recommendation': "", 'output_fields': [], 'chart_encodings': {}, 'chart_type': "" }

            # 🔍 VALIDATE CHART COMPATIBILITY WITH DATA FIELDS
            chart_type = refined_goal.get('chart_type', '')
            chart_encodings = refined_goal.get("chart_encodings", {})
            template_validation = validate_template_constraints(chart_type, chart_encodings)
            if not template_validation.is_valid:
                reject_resp = reject_info_to_response(
                    template_validation.reject,
                    agent_name="PythonDataRecAgent",
                    messages=[*messages, {"role": choice.message.role, "content": choice.message.content}],
                )
                reject_resp["refined_goal"]["_llm_chart_type"] = chart_type
                reject_resp["refined_goal"]["_llm_chart_encodings"] = chart_encodings
                candidates.append(reject_resp)
                continue
            normalized_template_chart, mapped_unknown = normalize_to_template_chart(chart_type)
            if normalized_template_chart and mapped_unknown:
                refined_goal["_mapped_template_chart_type"] = normalized_template_chart

            output_fields = refined_goal.get('output_fields', [])
            is_compatible, compatibility_error = self.validate_chart_data_compatibility(chart_type, output_fields, refined_goal)
            
            if not is_compatible:
                logger.warning(f"❌ Chart compatibility error: {compatibility_error}")
                refined_goal['_chart_compatibility_error'] = compatibility_error

            if (
                strict_validation_enabled()
                and all_field_metas
                and chart_type
                and not chart_type.startswith("qc_")
            ):
                validation = validate_chart(
                    chart_type,
                    refined_goal.get("chart_encodings", {}),
                    all_field_metas,
                    domain,
                )
                if not validation.is_valid:
                    reject = validation.reject
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
                    if reject is not None:
                        reject_resp = reject_info_to_response(
                            reject,
                            agent_name="PythonDataRecAgent",
                            messages=[*messages, {"role": choice.message.role, "content": choice.message.content}],
                        )
                        reject_resp["refined_goal"]["_llm_chart_type"] = chart_type
                        reject_resp["refined_goal"]["_llm_chart_encodings"] = refined_goal.get("chart_encodings", {})
                        candidates.append(reject_resp)
                        continue

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]

                try:
                    result = py_sandbox.run_transform_in_sandbox2020(code_str, [pd.DataFrame.from_records(t['rows']) for t in input_tables], self.exec_python_in_subprocess)
                    result['code'] = code_str

                    if result['status'] == 'ok':
                        result_df = result['content']
                        result['content'] = {
                            'rows': json.loads(result_df.to_json(orient='records')),
                        }
                    else:
                        logger.info(result['content'])
                except Exception as e:
                    logger.warning('other error:')
                    error_message = traceback.format_exc()
                    logger.warning(error_message)
                    result = {'status': 'other error', 'code': code_str, 'content': f"Unexpected error executing the code, please try again."}
            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task."}
            
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'PythonDataRecAgent'
            
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
        # LOG USER'S CHART SELECTION
        if user_preferred_chart_type:
            logger.info(f"📊 User selected chart type from UI: '{user_preferred_chart_type}'")
        else:
            logger.info(f"📊 No chart type pre-selected by user")
        
        all_field_metas = self._compute_all_field_metas(input_tables)
        data_columns = list(all_field_metas.keys()) if all_field_metas else extract_all_columns_from_input_tables(input_tables)
        domain = "qc" if is_qc_data(data_columns) else "generic"

        if strict_validation_enabled() and user_preferred_chart_type and all_field_metas:
            early_reject = check_chart_data_compatibility(
                user_preferred_chart_type, all_field_metas, domain
            )
            if early_reject is not None:
                return [reject_info_to_response(
                    early_reject,
                    agent_name="PythonDataRecAgent",
                    messages=[*prev_messages, {"role": "user", "content": description}],
                )]

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
                    "agent": "PythonDataRecAgent",
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

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

        # === (M4 parity): inject per-column semantic-role hints ===
        # Mirrors the SQL agent — gives the LLM a role table per column so it
        # can pick fields via RULE #4 instead of guessing by name pattern.
        field_metadata_hint = format_field_metadata_hint(all_field_metas)
        if field_metadata_hint:
            data_summary = f"{data_summary}\n\n{field_metadata_hint}\n"

        # Detect QC data for dynamic system prompt injection (data_columns already extracted above)

        # Build structured GOAL to send to the model - consistent with SQL agent
        # If user selected chart type from UI, include it in the goal
        if user_preferred_chart_type:
            goal_obj = {"description": description, "chart_type": user_preferred_chart_type, "chart_type_source": "user_selected_from_ui"}
            logger.info(f"✅ User selected chart type '{user_preferred_chart_type}' from UI - this MUST be honored in output")
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

        # Inject QC extension only when input data has QC control limit columns.
        # Keeps base system prompt lean for non-QC queries.
        system_content = self.system_prompt
        if is_qc_data(data_columns):
            system_content = system_content + QC_SYSTEM_PROMPT_EXTENSION
            logger.info("🔬 QC data detected — QC prompt extension injected into system message")
        else:
            logger.info("📊 Non-QC data — base system prompt used (no QC extension)")

        messages = [{"role":"system", "content": system_content},
                    *filtered_prev_messages,
                    {"role":"user","content": user_query}]
        
        # Log user prompt to ClickHouse
        #extract_and_log_user_prompt(messages, "PythonDataRecAgent")
        
        response = self.client.get_completion(messages = messages)
        
        return self.process_gpt_response(
            input_tables,
            messages,
            response,
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
                    "content": f"This is the result from the latest python code:\n\n{sample_data_str}\n\nUpdate the code above based on the following instruction:\n\n{new_instruction}"}]

        # Log user prompt to ClickHouse
        #extract_and_log_user_prompt(messages, "PythonDataRecAgent")
        
        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)
