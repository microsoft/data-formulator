# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import random
import string
import os

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response
import pandas as pd

from data_formulator.datalake.parquet_utils import sanitize_table_name as parquet_sanitize_table_name

import logging
import re
# Replace/update the logger configuration
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = '''You are a data scientist to help user to transform data that will be used for visualization.
The user will provide you information about what data would be needed, and your job is to create a Python script based on the input data summary, transformation instruction and expected fields.
The users' instruction includes "chart_type" and "chart_encodings" that describe the visualization they want, and natural language instructions "goal" that describe what data is needed.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with NULL or np.nan.

**About the execution environment:**
- You can use BOTH DuckDB SQL and pandas operations in the same script
- The script will run in the workspace data directory where all files are located
- You can reference files directly by their filename (e.g., 'sales_data.parquet')
- Available libraries: pandas, numpy, duckdb, math, datetime, json, statistics, collections, re, sklearn

**When to use DuckDB vs pandas:**
- Use DuckDB SQL for: filtering, joins, aggregations, window functions, groupby operations
- Use pandas for: complex transformations, time series operations, ML features, reshaping
- You can combine both: use DuckDB for initial data loading/filtering, then pandas for complex operations

**Code structure:**
- The script should be standalone (no function wrapper)
- Import statements at the top
- Data loading using DuckDB or pandas
- Transformations combining SQL and pandas as needed
- Assign the final result to a variable (you will specify the variable name in JSON)

Concretely, you should first refine users' goal and then create a Python script in the output section based off the [CONTEXT] and [GOAL]:

    1. First, refine users' [GOAL]. The main objective in this step is to check if "chart_type" and "chart_encodings" provided by the user are sufficient to achieve their "goal". Concretely:
        - based on the user's "goal" and "chart_type" and "chart_encodings", elaborate the goal into a "detailed_instruction".
        - determine "input_tables", the names of a subset of input tables from [CONTEXT] section that will be used to achieve the user's goal.
            - **IMPORTANT** Note that the Table 1 in [CONTEXT] section is the table the user is currently viewing, it should take precedence if the user refers to insights about the "current table".
            - At the same time, leverage table information to determine which tables are relevant to the user's goal and should be used.
        - "display_instruction" is a short verb phrase describing the users' goal.
            - it would be a short verbal description of user intent as a verb phrase (<12 words).
            - generate it based on detailed_instruction and the suggested chart_type and chart_encodings, but don't need to mention the chart details.
            - should capture key computation ideas: by reading the display, the user can understand the purpose and what's derived from the data.
            - if the user specification follows up the previous instruction, the 'display_instruction' should only describe how it builds up the previous instruction without repeating information from previous steps.
            - the phrase can be presented in different styles, e.g., question (what's xxx), instruction (show xxx), description, etc.
            - if you mention column names from the input or the output data, highlight the text in **bold**.
                * the column can either be a column in the input data, or a new column that will be computed in the output data.
                * the mention don't have to be exact match, it can be semantically matching, e.g., if you mentioned "average score" in the text while the column to be computed is "Avg_Score", you should still highlight "**average score**" in the text.
        - determine "output_fields", the desired fields that the output data should have to achieve the user's goal, it's a good idea to include intermediate fields here.
        - then decide "chart_encodings", which maps visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of "output_fields" that will be visualized,
            - the "chart_encodings" should be created to support the user's "chart_type".
            - first, determine whether the user has provided sufficient fields in "chart_encodings" that are needed to achieve their goal:
                - if the user's "chart_encodings" are sufficient, simply copy it.
                - if the user didn't provide sufficient fields in "chart_encodings", add missing fields in "chart_encodings" (ordered them based on whether the field will be used in x,y axes or legends);
                    - "chart_encodings" should only include fields that will be visualized (do not include other intermediate fields from "output_fields")
                    - when adding new fields to "chart_encodings", be efficient and add only a minimal number of fields that are needed to achive the user's goal.
                    - generally, the total number of fields in "chart_encodings" should be no more than 3 for x,y,legend.
                - if the user's "chart_encodings" is sufficient but can be optimized, you can reorder encodings to visualize the data more effectively.
            - sometimes, user may provide instruction to update visualizations fields they provided. You should leverage the user's goal to resolve the conflict and decide the final "chart_encodings"
                - e.g., they may mention "use B metric instead" while A metric is in provided fields, in this case, you should update "chart_encodings" to update A metric with B metric.
            - if the user provides latitude and longitude as visual channels, use "latitude" and "longitude" as visual channels in "chart_encodings" as opposed to "x" and "y".
        - guide on statistical analysis:
            - when the user asks for forecasting or regression analysis, you should consider the following:
                - the output should be a long format table where actual x, y pairs and predicted x, y pairs are included in the X, Y columns, they are differentiated with a third column "is_predicted".
                - i.e., if the user ask for forecasting based on two columns T and Y, the output should be three columns: T, Y, is_predicted, where
                    - T, Y columns contain BOTH original values from the data and predicted values from the data.
                    - is_predicted is a boolean field to indicate whether the x, y pairs are original values from the data or predicted / regression values from the data.
                - the recommended chart should be line chart (time series) or scatter plot (quantitative x, y)
                - if the user asks for forecasting, it's good to include predicted x, y pairs for both x in the original data and future x values (i.e., combine regression and forecasting results)
                    - in this case, is_predicted should be of three values 'original', 'regression', 'forecasting'
            - when the user asks for clustering:
                - the output should be a long format table where actual x, y pairs with a third column "cluster_id" that indicates the cluster id of the data point.
                - the recommended chart should be scatter plot (quantitative x, y)
        - specify "output_variable", the name of the Python variable that will contain the final DataFrame result (e.g., "result_df", "transformed_data", etc.)

    Prepare the result in the following json format:

```json
{
    "input_tables": ["student_exam"],
    "detailed_instruction": "...", // string, elaborate user instruction with details
    "display_instruction": "...", // string, the short verb phrase describing the users' goal
    "output_fields": [...], // string[], describe the desired output fields that the output data should have based on the user's goal
    "chart_encodings": {
        "x": "",
        "y": "",
        "color": "",
        "size": "",
        "opacity": "",
        "facet": "",
        ... // other visualization channels user used
    }, // object: map visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of "output_fields" that will be visualized
    "output_variable": "result_df", // string, the name of the Python variable containing the final result
    "reason": "..." // string, explain why this refinement is made
}
```

    2. Then, write a Python script based on the refined goal. The script should transform input data into the desired output table containing all "output_fields" from the refined goal.
The script should be as simple as possible and easily readable. If there is no data transformation needed based on "output_fields", the script can simply load and assign the data.

    3. The output must only contain two items:
        - a json object (wrapped in ```json```) representing the refined goal (including "detailed_instruction", "output_fields", "chart_encodings", "output_variable" and "reason")
        - a python code block (wrapped in ```python```) representing the transformation script, do not add any extra text explanation.

**Datetime handling notes:**
- If the output field is year, convert it to number. If it is year-month / year-month-day, convert it to string (e.g., "2020-01" / "2020-01-01").
- If the output is time only: convert hour to number if it's just the hour (e.g., 10), but convert hour:min or h:m:s to string (e.g., "10:30", "10:30:45").
- Never return datetime objects directly; convert to either number (if it only contains year) or string so it's readable.

**Example data loading patterns:**

```python
# Option 1: Load with DuckDB SQL
import pandas as pd
import duckdb

df = duckdb.sql("""
    SELECT
        date,
        SUM(sales) as total_sales
    FROM read_parquet('sales_data.parquet')
    GROUP BY date
""").df()

# Option 2: Load with pandas
import pandas as pd
df = pd.read_parquet('sales_data.parquet')

# Option 3: Hybrid - DuckDB for aggregation, pandas for time series
import pandas as pd
import duckdb

df = duckdb.sql("""
    SELECT date, SUM(value) as total
    FROM read_parquet('data.parquet')
    GROUP BY date
""").df()

df['rolling_avg'] = df['total'].rolling(7).mean()
result_df = df
```

**Important notes:**
- In DuckDB, escape single quotes by doubling them ('') not with backslash (\')
- DuckDB does NOT support Unicode escape sequences like \\u0400-\\u04FF. Use character ranges directly: [а-яА-Я] for Cyrillic
- When using date/time functions in DuckDB, cast date columns to explicit types to avoid ambiguity:
  * Use `CAST(date_column AS DATE)` for date operations
  * Use `CAST(datetime_column AS TIMESTAMP)` for timestamp operations
  * Example: `CAST(strftime('%Y', CAST(date_column AS DATE)) AS INTEGER) AS year`
- For complex datetime operations, consider loading data first then using pandas datetime functions
'''

EXAMPLE='''
[CONTEXT]

Here are 1 dataset with their summaries:

## Table 1: weather_seattle_atlanta (weather_seattle_atlanta.parquet)
(548 rows × 3 columns)

### Schema (3 fields)
  - Date -- type: VARCHAR, values: 1/1/2020, 1/10/2020, 1/11/2020, ..., 9/7/2020, 9/8/2020, 9/9/2020
  - City -- type: VARCHAR, values: Atlanta, Seattle
  - Temperature -- type: INTEGER, range: [30, 86]

### Sample Data (first 5 rows)
```
        Date    City  Temperature
0   1/1/2020  Seattle           51
1   1/1/2020  Atlanta           45
2   1/2/2020  Seattle           45
3   1/2/2020  Atlanta           47
4   1/3/2020  Seattle           48
```

[GOAL]

{
    "instruction": "create a scatter plot with seattle and atlanta temperatures on x,y axes, color points by which city is warmer",
    "chart_type": "scatter",
    "chart_encodings": {"x": "Seattle Temperature", "y": "Atlanta Temperature", "color": "Warmer City"}
}

[OUTPUT]

```json
{
    "input_tables": ["weather_seattle_atlanta"],
    "detailed_instruction": "Create a scatter plot to compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis. Color the points by which city is warmer.",
    "display_instruction": "Compare **Seattle** and **Atlanta** temperatures",
    "output_fields": ["Date", "Seattle Temperature", "Atlanta Temperature", "Warmer City"],
    "chart_encodings": {"x": "Seattle Temperature", "y": "Atlanta Temperature", "color": "Warmer City"},
    "output_variable": "result_df",
    "reason": "To compare Seattle and Atlanta temperatures, we need to pivot the data to have separate temperature columns for each city, then compute which city is warmer."
}
```

```python
import pandas as pd
import duckdb

# Use DuckDB for pivot operation
result_df = duckdb.sql("""
    WITH pivoted AS (
        SELECT
            Date,
            MAX(CASE WHEN City = 'Seattle' THEN Temperature END) AS "Seattle Temperature",
            MAX(CASE WHEN City = 'Atlanta' THEN Temperature END) AS "Atlanta Temperature"
        FROM read_parquet('weather_seattle_atlanta.parquet')
        GROUP BY Date
    )
    SELECT
        Date,
        "Seattle Temperature",
        "Atlanta Temperature",
        CASE WHEN "Seattle Temperature" > "Atlanta Temperature" THEN 'Seattle' ELSE 'Atlanta' END AS "Warmer City"
    FROM pivoted
""").df()
```
'''


class DataTransformationAgent(object):

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


    def process_gpt_response(self, response, messages):
        """Process GPT response to handle Python code execution"""

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': str(response.body)}
            return [result]

        candidates = []
        for choice in response.choices:
            logger.info("=== Python script result ===>")
            logger.info(choice.message.content + "\n")

            json_blocks = extract_json_objects(choice.message.content + "\n")
            if len(json_blocks) > 0:
                refined_goal = json_blocks[0]
                output_variable = refined_goal.get('output_variable', 'result_df')
            else:
                refined_goal = {'chart_encodings': {}, 'instruction': '', 'reason': '', 'output_variable': 'result_df'}
                output_variable = 'result_df'

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code = code_blocks[-1]

                try:
                    # Import the sandbox execution function
                    from data_formulator.sandbox.py_sandbox import run_unified_transform_in_sandbox
                    from flask import current_app

                    # Get exec_python_in_subprocess setting
                    exec_python_in_subprocess = current_app.config.get('CLI_ARGS', {}).get('exec_python_in_subprocess', False)

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
                        random_suffix = ''.join(random.choices(string.ascii_lowercase, k=4))
                        output_table_name = parquet_sanitize_table_name(f"derived_{random_suffix}")

                        # Write full result to workspace as parquet
                        self.workspace.write_parquet(full_df, output_table_name)

                        # Limit rows for response payload
                        if row_count > self.max_display_rows:
                            query_output = full_df.head(self.max_display_rows)
                        else:
                            query_output = full_df

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
                        result = {
                            'status': 'error',
                            'code': code,
                            'content': execution_result['content']
                        }

                except Exception as e:
                    logger.warning('Error occurred during code execution:')
                    logger.warning(f"Error type: {type(e).__name__}, message: {str(e)}")
                    error_message = f"An error occurred during code execution. Error type: {type(e).__name__}, message: {str(e)}"
                    result = {'status': 'error', 'code': code, 'content': error_message}

            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task."}

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataTransformationAgent'
            result['refined_goal'] = refined_goal
            candidates.append(result)

        logger.info("=== Transform Candidates ===>")
        for candidate in candidates:
            for key, value in candidate.items():
                if key in ['dialog', 'content']:
                    logger.info(f"##{key}:\n{str(value)[:1000]}...")
                else:
                    logger.info(f"## {key}:\n{value}")

        return candidates


    def run(self, input_tables, description, chart_type: str, chart_encodings: dict, prev_messages: list[dict] = [], n=1):
        """Args:
            input_tables: list[dict], each dict contains 'name' (table name in workspace)
            description: str, the description of the data transformation
            chart_type: str, the chart type for visualization
            chart_encodings: dict, the chart encodings mapping visualization channels to fields
            prev_messages: list[dict], the previous messages
            n: int, the number of candidates
        """
        # Generate data summary with file references
        from data_formulator.agents.agent_utils import generate_data_summary
        data_summary = generate_data_summary(input_tables, workspace=self.workspace)

        goal = {
            "instruction": description,
            "chart_type": chart_type,
            "chart_encodings": chart_encodings,
        }

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{json.dumps(goal, indent=4)}"
        if len(prev_messages) > 0:
            user_query = f"The user wants a new transformation based off the following updated context and goal:\n\n[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}"

        logger.info(user_query)

        # Filter out system messages from prev_messages
        filtered_prev_messages = [msg for msg in prev_messages if msg.get("role") != "system"]

        messages = [{"role":"system", "content": self.system_prompt},
                    *filtered_prev_messages,
                    {"role":"user","content": user_query}]

        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(response, messages)


    def followup(self, input_tables, dialog, latest_data_sample, chart_type: str, chart_encodings: dict, new_instruction: str, n=1):
        """
        Followup transformation based on previous dialog and new instruction.

        Args:
            input_tables: list of input tables
            dialog: previous conversation history
            latest_data_sample: sample of the latest transformation result
            chart_type: chart type
            chart_encodings: chart encodings
            new_instruction: new user instruction for followup
            n: number of candidates
        """
        goal = {
            "followup_instruction": new_instruction,
            "chart_type": chart_type,
            "chart_encodings": chart_encodings
        }

        logger.info(f"GOAL: \n\n{goal}")

        updated_dialog = [{"role":"system", "content": self.system_prompt}, *dialog[1:]]

        # Format sample data
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        messages = [*updated_dialog, {"role":"user",
                              "content": f"This is the result from the latest transformation:\n\n{sample_data_str}\n\nUpdate the Python script above based on the following instruction:\n\n{json.dumps(goal, indent=4)}"}]

        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(response, messages)
