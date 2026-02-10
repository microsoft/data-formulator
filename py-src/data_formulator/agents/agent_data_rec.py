# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response, generate_data_summary

import traceback
import pandas as pd

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to recommend data that will be used for visualization.
The user will provide you information about what visualization they would like to create, and your job is to recommend a transformed data that can be used to create the visualization and write a Python script to transform the data.
The recommendation and transformation function should be based on the [CONTEXT] and [GOAL] provided by the user.
The [CONTEXT] shows what the current dataset is, and the [GOAL] describes what the user wants the data for.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with NULL or np.nan.

**About the execution environment:**
- You can use BOTH DuckDB SQL and pandas operations in the same script
- The script will run in the workspace data directory
- Use the file path shown in the [CONTEXT] section (under "**file path:**") to load data (e.g., `read_parquet('student_exam.parquet')` or `pd.read_parquet('data/sales.parquet')`)
- **Allowed libraries:** pandas, numpy, duckdb, math, datetime, json, statistics, collections, re, sklearn, scipy, random, itertools, functools, operator, time
- **Not allowed:** matplotlib, plotly, seaborn, requests, subprocess, os, sys, io, or any other library not listed above. Do NOT import them — the sandbox will reject the import.
- File system access (open, write) and network access are also forbidden.

**When to use DuckDB vs pandas:**
- For large datasets (parquet files with many rows): prefer DuckDB SQL for aggregations, filtering, joins, window functions, and groupby — DuckDB can process parquet files efficiently without loading all data into memory.
- For small datasets (even if stored as parquet): prefer pandas for readability and simplicity.
- Use pandas for: complex transformations, time series operations, ML features, reshaping.
- You can combine both: use DuckDB for initial data loading/filtering on large files, then pandas for complex operations.

**Code structure:**
- The script should be standalone (no function wrapper)
- Import statements at the top
- Data loading using DuckDB or pandas
- Transformations combining SQL and pandas as needed
- Assign the final result to a variable (you will specify the variable name in JSON)

Concretely, you should infer the appropriate data and create a Python script based off the [CONTEXT] and [GOAL] in two steps:

1. First, based on users' [GOAL]. Create a json object that represents the inferred user intent. The json object should have the following format:

```json
{
    "mode": "" // string, one of "infer", "overview", "distribution", "summary", "forecast"
    "recap": "..." // string, a short summary of the user's goal.
    "display_instruction": "..." // string, the even shorter verb phrase describing the users' goal.
    "recommendation": "..." // string, explain why this recommendation is made
    "input_tables": [...] // string[], describe names of the input tables that will be used in the transformation.
    "output_fields": [...] // string[], describe the desired output fields that the output data should have (i.e., the goal of transformed data), it's a good idea to preserve intermediate fields here
    "chart_type": "" // string, one of "point", "bar", "line", "area", "heatmap", "group_bar", "boxplot", "worldmap", "usmap". "chart_type" should either be inferred from user instruction, or recommend if the user didn't specify any.
    "chart_encodings": {
        "x": "",
        "y": "",
        "color": "",
        "size": "",
        "opacity": "",
        "facet": "",
        "longitude": "",
        "latitude": ""
    } // object: map visualization channels (x, y, color, size, opacity, facet, longitude, latitude, etc.) to a subset of output fields, appropriate visual channels for different chart types are defined below.
    "projection": "" // string (optional, only for worldmap/usmap): one of "mercator", "equalEarth", "naturalEarth1", "orthographic", "stereographic", "albersUsa", "conicEqualArea", "gnomonic", "azimuthalEquidistant". Default is "equalEarth" for worldmap, "albersUsa" for usmap.
    "projection_center": [0, 0] // [longitude, latitude] (optional, only for worldmap): the center point of the map projection. Use to focus on specific regions, e.g., [105, 35] for China, [-98, 39] for USA, [10, 50] for Europe, [139, 36] for Japan.
}
```

Concretely:
    - recap what the user's goal is in a short summary in "recap".
    - If the user's [GOAL] is clear already, simply infer what the user mean. Set "mode" as "infer" and create "output_fields" and "chart_encodings" based off user description.
    - If the user's [GOAL] is not clear, make recommendations to the user:
        - choose one of "distribution", "overview", "summary", "forecast" in "mode":
            * if it is "overview" and the data is in wide format, reshape it into long format.
            * if it is "distribution", select a few fields that would be interesting to visualize together.
            * if it is "summary", calculate some aggregated statistics to show interesting facts of the data.
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
    - determine "input_tables", the names of a subset of input tables from [CONTEXT] section that will be used to achieve the user's goal.
        - **IMPORTANT** Note that the Table 1 in [CONTEXT] section is the table the user is currently viewing, it should take precedence if the user refers to insights about the "current table".
        - At the same time, leverage table information to determine which tables are relevant to the user's goal and should be used.
    - "chart_type" must be one of "point", "bar", "line", "area", "heatmap", "group_bar", "boxplot", "worldmap", "usmap"
    - "chart_encodings" should specify which fields should be used to create the visualization
        - decide which visual channels should be used to create the visualization appropriate for the chart type.
            - point: x, y, color, size, facet
            - histogram: x, color, facet
            - bar: x, y, color, facet
            - line: x, y, color, facet
            - area: x, y, color, facet
            - heatmap: x, y, color, facet
            - group_bar: x, y, color, facet
            - boxplot: x, y, color, facet
            - worldmap: longitude, latitude, color, size
            - usmap: longitude, latitude, color, size
        - note that all fields used in "chart_encodings" should be included in "output_fields".
            - all fields you need for visualizations should be transformed into the output fields!
            - "output_fields" should include important intermediate fields that are not used in visualization but are used for data transformation.
        - typically only 2-3 fields should be used to create the visualization (x, y, color/size), facet can be added if it's a faceted visualization.
    - Guidelines for choosing chart type and visualization fields:
        - Consider chart types as follows:
            - (point) Scatter Plots: x,y: Quantitative/Categorical, color: Categorical (optional), size: Quantitative (optional for creating bubble chart),
                - best for: Relationships, correlations, distributions, forecasting, regression analysis
                - scatter plots are good default way to visualize data when other chart types are not applicable.
                - use color to visualize points from different categories.
                - use size to visualize data points with an additional quantitative dimension of the data points.
            - (histogram) Histograms: x: Quantitative/Categorical, color: Categorical (optional for creating grouped histogram),
                - best for: Distribution of a quantitative field
                - use x values directly if x values are categorical, and transform the data into bins if the field values are quantitative.
                - when color is specified, the histogram will be grouped automatically (items with the same x values will be grouped).
            - (bar) Bar Charts: x: Categorical (nominal/ordinal), y: Quantitative, color: Categorical/Quantitative (for stacked bar chart / showing additional quantitative dimension),
                - best for: Comparisons across categories
                - use (bar) for simple bar chart or stacked bar chart (when it makes sense to add up Y values for each category with the same X value),
                    - when color is specified, the bar will be stacked automatically (items with the same x values will be stacked).
                    - note that when there are multiple rows in the data with same x values, the bar will be stacked automatically.
                        - 1. consider to use an aggregated field for y values if the value is not suitable for stacking.
                        - 2. consider to introduce facets so that each group is visualized in a separate bar.
            - (group_bar) for grouped bar chart, x: Categorical (nominal/ordinal), y: Quantitative, color: Categorical
                - when color is specified, bars from different groups will be grouped automatically.
                - only use facet if the cardinality of color field is small (less than 5).
            - (line) Line Charts: x: Temporal (preferred) or ordinal, y: Quantitative, color: Categorical (optional for creating multiple lines),
                - best for: Trends over time, continuous data, forecasting, regression analysis
                - note that when there are multiple rows in the data belong to the same group (same x and color values) but different y values, the line will not look correct.
                - consider to use an aggregated field for y values, or introduce facets so that each group is visualized in a separate line.
            - (area) Area Charts: x: Temporal (preferred) or ordinal, y: Quantitative, color: Categorical (optional for creating stacked areas),
                - best for: Trends over time, continuous data
            - (heatmap) Heatmaps: x,y: Categorical (you need to convert quantitative to nominal), color: Quantitative intensity,
                - best for: Pattern discovery in matrix data
            - (boxplot) Box plots: x: Categorical (nominal/ordinal), y: Quantitative, color: Categorical (optional for creating grouped boxplots),
                - best for: Distribution of a quantitative field
                - use x values directly if x values are categorical, and transform the data into bins if the field values are quantitative.
                - when color is specified, the boxplot will be grouped automatically (items with the same x values will be grouped).
            - (worldmap) World Map: longitude: Quantitative (geographic longitude -180 to 180), latitude: Quantitative (geographic latitude -90 to 90), color: Categorical/Quantitative (optional), size: Quantitative (optional)
                - best for: Geographic data visualization on a world map
                - use when the data contains geographic coordinates (longitude, latitude) for locations around the world
                - the data must have longitude and latitude fields representing geographic coordinates
                - color can be used to show categories (e.g., country, region) or quantitative values (e.g., population, sales)
                - size can be used to show quantitative values (e.g., magnitude, count)
                - example use cases: plotting cities, earthquakes, sales by location, etc.
                - projection options: "mercator", "equalEarth" (default), "naturalEarth1", "orthographic", "stereographic", "albers", "conicEqualArea"
                - projection_center: set [longitude, latitude] to center the map on a specific region:
                    * China: [105, 35], USA: [-98, 39], Europe: [10, 50], Japan: [139, 36], India: [78, 22]
                    * Brazil: [-55, -10], Australia: [134, -25], Russia: [100, 60], South Africa: [25, -29]
            - (usmap) US Map: longitude: Quantitative (geographic longitude), latitude: Quantitative (geographic latitude), color: Categorical/Quantitative (optional), size: Quantitative (optional)
                - best for: Geographic data visualization focused on the United States
                - use when the data is specifically about US locations
                - uses albersUsa projection optimized for US geography (includes Alaska and Hawaii)
                - the data must have longitude and latitude fields representing US geographic coordinates
        - facet channel is available for all chart types, it supports a categorical field with small cardinality to visualize the data in different facets.
        - if you really need additional legend fields:
            - you can use opacity for legend (support Quantitative and Categorical).
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
    - specify "output_variable", the name of the Python variable that will contain the final DataFrame result.
      The name should be descriptive and reflect the data content (e.g., "sales_by_region", "monthly_trends", "customer_segments").
      Avoid generic names like "result_df", "output", or "data". Use snake_case naming convention.

2. Then, write a Python script based on the inferred goal. The script should transform input data into the desired output table containing all "output_fields" from the refined goal.
The script should be as simple as possible and easily readable. If there is no data transformation needed based on "output_fields", the script can simply load and assign the data.

3. The output must only contain two items:
    - a json object (wrapped in ```json```) representing the refined goal (including "mode", "recommendation", "output_fields", "chart_type", "chart_encodings", "output_variable")
    - a python code block (wrapped in ```python```) representing the transformation script, do not add any extra text explanation.

**Example data loading patterns:**

Use the **file path** shown in the [CONTEXT] section to load data:

```python
# Option 1: Load with DuckDB SQL (use file path from context)
import pandas as pd
import duckdb

# If context shows: - **file path:** `student_exam.parquet`
df = duckdb.sql("""
    SELECT
        student,
        major,
        (math + reading + writing) / 3.0 AS average_score,
        RANK() OVER (ORDER BY (math + reading + writing) / 3.0 DESC) AS rank
    FROM read_parquet('student_exam.parquet')
    ORDER BY average_score DESC
""").df()

result_df = df
```

```python
# Option 2: Load with pandas (use file path from context)
import pandas as pd

# If context shows: - **file path:** `student_exam.parquet`
df = pd.read_parquet('student_exam.parquet')
df['average_score'] = (df['math'] + df['reading'] + df['writing']) / 3.0
df['rank'] = df['average_score'].rank(ascending=False, method='min')
df = df.sort_values('average_score', ascending=False)

result_df = df[['student', 'major', 'average_score', 'rank']]
```

```python
# Option 3: Hybrid - DuckDB for aggregation, pandas for reshaping
import pandas as pd
import duckdb

# Aggregate with DuckDB
df = duckdb.sql("""
    SELECT category, SUM(value) as total
    FROM read_parquet('data.parquet')
    GROUP BY category
""").df()

# Reshape with pandas
result_df = df.pivot(columns='category', values='total')
```

**Important notes:**
- In DuckDB, escape single quotes by doubling them ('') not with backslash (\')
- DuckDB does NOT support Unicode escape sequences like \\u0400-\\u04FF. Use character ranges directly: [а-яА-Я] for Cyrillic
- When using date/time functions in DuckDB, cast date columns to explicit types to avoid ambiguity:
  * Use `CAST(date_column AS DATE)` for date operations
  * Use `CAST(datetime_column AS TIMESTAMP)` for timestamp operations
- For complex datetime operations, consider loading data first then using pandas datetime functions
'''

example = """
For example:

[CONTEXT]

Here are our datasets, here are their field summaries and samples:

## Table 1: student_exam (1000 rows × 5 columns)
- **file path:** `student_exam.parquet`

### Schema (5 fields)
  - student -- type: int64, values: 1, 2, 3, ..., 997, 998, 999, 1000
  - major -- type: object, values: liberal arts, science
  - math -- type: int64, values: 0, 8, 18, ..., 97, 98, 99, 100
  - reading -- type: int64, values: 17, 23, 24, ..., 96, 97, 99, 100
  - writing -- type: int64, values: 10, 15, 19, ..., 97, 98, 99, 100

### Sample Data (first 5 rows)
```
   student         major  math  reading  writing
0        1  liberal arts    72       72       74
1        2  liberal arts    69       90       88
2        3  liberal arts    90       95       93
3        4       science    47       57       44
4        5       science    76       78       75
```

[GOAL]

{"goal": "Rank students based on their average scores"}

[OUTPUT]

```json
{
    "input_tables": ["student_exam"],
    "recap": "Rank students based on their average scores",
    "display_instruction": "Rank students by **average scores**",
    "mode": "infer",
    "recommendation": "To rank students based on their average scores, we need to calculate the average score for each student, then sort the data, and finally assign a rank to each student based on their average score.",
    "output_fields": ["student", "major", "average_score", "rank"],
    "chart_type": "bar",
    "chart_encodings": {"x": "student", "y": "average_score"},
    "output_variable": "student_rankings"
}
```

```python
import pandas as pd
import duckdb

# Use DuckDB for efficient ranking and aggregation
student_rankings = duckdb.sql('''
    SELECT
        student,
        major,
        (math + reading + writing) / 3.0 AS average_score,
        RANK() OVER (ORDER BY (math + reading + writing) / 3.0 DESC) AS rank
    FROM read_parquet('student_exam.parquet')
    ORDER BY average_score DESC
''').df()
```
"""


class DataRecAgent(object):

    def __init__(self, client, workspace, system_prompt=None, agent_coding_rules="", max_display_rows=5000):
        self.client = client
        self.workspace = workspace
        self.max_display_rows = max_display_rows

        # Incorporate agent coding rules into system prompt if provided
        if system_prompt is not None:
            self.system_prompt = system_prompt
        else:
            base_prompt = SYSTEM_PROMPT
            if agent_coding_rules and agent_coding_rules.strip():
                self.system_prompt = base_prompt + "\n\n[AGENT CODING RULES]\nPlease follow these rules when generating code. Note: if the user instruction conflicts with these rules, you should prioritize user instructions.\n\n" + agent_coding_rules.strip()
            else:
                self.system_prompt = base_prompt

    def process_gpt_response(self, input_tables, messages, response):
        """Process GPT response to handle Python code execution"""

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
                output_variable = refined_goal.get('output_variable', 'result_df')
            else:
                refined_goal = {'mode': "", 'recommendation': "", 'output_fields': [], 'chart_encodings': {}, 'chart_type': "", 'output_variable': 'result_df'}
                output_variable = 'result_df'

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code = code_blocks[-1]

                try:
                    # Import the sandbox execution function
                    from data_formulator.sandbox.py_sandbox import run_unified_transform_in_sandbox

                    # Get exec_python_in_subprocess setting (with fallback for non-Flask contexts like MCP server)
                    try:
                        from flask import current_app
                        exec_python_in_subprocess = current_app.config.get('CLI_ARGS', {}).get('exec_python_in_subprocess', False)
                    except (ImportError, RuntimeError):
                        exec_python_in_subprocess = False

                    # Execute the Python script in sandbox
                    execution_result = run_unified_transform_in_sandbox(
                        code=code,
                        workspace_path=self.workspace._path,
                        output_variable=output_variable,
                        exec_python_in_subprocess=exec_python_in_subprocess
                    )

                    if execution_result['status'] == 'ok':
                        full_df = execution_result['content']
                        row_count = len(full_df)

                        # Generate unique table name for workspace storage
                        output_table_name = self.workspace.get_fresh_name(f"d-{output_variable}")

                        # Write full result to workspace as parquet
                        self.workspace.write_parquet(full_df, output_table_name)

                        # Limit rows for response payload
                        if row_count > self.max_display_rows:
                            query_output = full_df.head(self.max_display_rows)
                        else:
                            query_output = full_df

                        # Remove duplicate columns to avoid orient='records' error
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
                        # Execution error
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
            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task."}

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataRecAgent'
            result['refined_goal'] = refined_goal
            candidates.append(result)

        logger.info("=== Recommendation Candidates ===>")
        for candidate in candidates:
            for key, value in candidate.items():
                if key in ['dialog', 'content']:
                    logger.info(f"##{key}:\n{str(value)[:1000]}...")
                else:
                    logger.info(f"## {key}:\n{value}")

        return candidates


    def run(self, input_tables, description, n=1, prev_messages: list[dict] = []):
        """
        Args:
            input_tables: list[dict], each dict contains 'name' (table name in workspace) and 'rows'
            description: str, the description of what the user wants
            n: int, the number of candidates
            prev_messages: list[dict], the previous messages
        """
        # Generate data summary with file references
        data_summary = generate_data_summary(input_tables, workspace=self.workspace)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}"
        if len(prev_messages) > 0:
            user_query = f"The user wants a new recommendation based off the following updated context and goal:\n\n[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}"

        logger.info(user_query)

        # Filter out system messages from prev_messages
        filtered_prev_messages = [msg for msg in prev_messages if msg.get("role") != "system"]

        messages = [{"role":"system", "content": self.system_prompt},
                    *filtered_prev_messages,
                    {"role":"user","content": user_query}]

        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)


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
        logger.info(f"GOAL: \n\n{new_instruction}")

        # Format sample data
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        messages = [*dialog,
                    {"role":"user",
                    "content": f"This is the result from the latest transformation:\n\n{sample_data_str}\n\nUpdate the Python script above based on the following instruction:\n\n{new_instruction}"}]

        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)
