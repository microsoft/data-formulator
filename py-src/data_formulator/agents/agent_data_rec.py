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

**About the execution environment:**
- You can use BOTH DuckDB SQL and pandas operations in the same script
- The script will run in the workspace data directory (all data files are in the current directory)
- Each table in [CONTEXT] has a **file path** (e.g., `student_exam.parquet`, `sales.csv`, `report.xlsx`). Use EXACTLY that path to load data:
    - `.parquet` files: `pd.read_parquet('file.parquet')` or DuckDB `read_parquet('file.parquet')`
    - `.csv` files: `pd.read_csv('file.csv')` or DuckDB `read_csv_auto('file.csv')`
    - `.json` files: `pd.read_json('file.json')`
    - `.xlsx`/`.xls` files: `pd.read_excel('file.xlsx')`
    - `.txt` files: `pd.read_csv('file.txt', sep='\t')` (or appropriate delimiter)
- **IMPORTANT:** Use the exact filename from the context — do NOT change the file extension or assume all files are parquet.
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
    "input_tables": [...] // string[], names of input tables from [CONTEXT] that will be used.
    "output_fields": [...] // string[], desired output fields for the transformed data; include intermediate fields too.
    "chart": { // object, chart specification for the recommended visualization.
        "chart_type": "" // string, one of the chart types defined in [CHART TYPE REFERENCE] below.
        "encodings": {} // object, map visual channels to output field names. Available channels depend on chart_type (see reference below).
        "config": {} // object (optional), chart styling options. Available options depend on chart_type (see reference below). Only include when there's a clear reason.
    }
    "field_metadata": { // object, semantic type for each field used in chart encodings.
        "<field_name>": "SemanticType" // string, one of the types from [SEMANTIC TYPE REFERENCE] below.
    }
    "output_variable": "" // string, descriptive snake_case Python variable name for the final DataFrame.
}
```

**[SEMANTIC TYPE REFERENCE]**

Choose the most specific type that fits. Only annotate fields used in chart encodings.

| Category | Types |
|---|---|
| Temporal | DateTime, Date, Time, Timestamp, Year, Quarter, Month, Week, Day, Hour, YearMonth, YearQuarter, YearWeek, Decade, Duration |
| Monetary measures | Amount, Price, Revenue, Cost |
| Physical measures | Quantity, Temperature |
| Proportion | Percentage |
| Signed/diverging | Profit, PercentageChange, Sentiment, Correlation |
| Generic measures | Count, Number |
| Discrete numeric | Rank, Score, Rating, Index |
| Identifier | ID |
| Geographic | Latitude, Longitude, Country, State, City, Region, Address, ZipCode |
| Entity names | PersonName, Company, Product, Category, Name |
| Coded categorical | Status, Type, Boolean, Direction |
| Binned ranges | Range, AgeGroup |
| Fallback | String, Unknown |

Key guidelines:
- Use **Revenue/Cost** for summed monetary totals, **Price** for per-unit prices, **Profit** for values that can be negative.
- Use **Temperature** (not Quantity) for temperature — it has special diverging behavior.
- Use **Year** (not Number) for columns like "year" with values 2020, 2021.

**[CHART TYPE REFERENCE]**

Each chart type specifies: encodings (visual channels → field types), when to use it, data expectations, and optional config.

| chart_type | encodings | config |
|---|---|---|
| point | x, y, color, size, opacity, facet | opacity (0.1–1.0) |
| bar | x, y, color, opacity, facet | cornerRadius (0–15) |
| group_bar | x, y, color, facet | cornerRadius (0–15) |
| histogram | x, color, facet | binCount (5–50) |
| line | x, y, color, opacity, facet | interpolate |
| area | x, y, color, facet | — |
| heatmap | x, y, color, facet | colorScheme |
| boxplot | x, y, color, facet | — |
| pie | theta, color, facet | innerRadius (0–100) |
| worldmap | longitude, latitude, color, size | projection, projectionCenter |
| usmap | longitude, latitude, color, size | — |

**Chart type details:**

- **point** (Scatter Plot)
    - x, y: Quantitative or Categorical; color: Categorical (optional); size: Quantitative (optional, for bubble chart)
    - Best for: relationships, correlations, distributions, regression analysis
    - Good default when other chart types don't clearly apply
    - config: `{"opacity": 0.5}` — marker opacity (default 1.0). Use lower values for dense/overlapping data.

- **histogram**
    - x: Quantitative or Categorical; color: Categorical (optional, for grouped histogram)
    - Best for: distribution of a single quantitative field
    - Values are auto-binned; color grouping is automatic
    - config: `{"binCount": 20}` — number of bins (default 10).

- **bar** (Bar / Stacked Bar Chart)
    - x: Categorical (nominal/ordinal); y: Quantitative; color: Categorical or Quantitative (optional)
    - Best for: comparisons across categories
    - Multiple rows with the same x value are automatically stacked
    - When stacking doesn't make sense: aggregate y values or introduce facets
    - config: `{"cornerRadius": 5}` — rounded bar ends (default 0).

- **group_bar** (Grouped Bar Chart)
    - x: Categorical; y: Quantitative; color: Categorical (required, defines groups)
    - Bars from different color groups are placed side by side
    - config: `{"cornerRadius": 5}` — rounded bar ends (default 0).

- **line** (Line Chart)
    - x: Temporal (preferred) or ordinal; y: Quantitative; color: Categorical (optional, for multiple lines)
    - Best for: trends over time, continuous data, forecasting
    - Multiple rows with same x+color but different y: aggregate y or use facets
    - config: `{"interpolate": "monotone"}` — options: "linear", "monotone" (smooth), "step", "step-before", "step-after", "basis" (smooth), "cardinal", "catmull-rom".

- **area** (Area Chart)
    - x: Temporal (preferred) or ordinal; y: Quantitative; color: Categorical (optional, for stacked areas)
    - Best for: trends over time, part-to-whole over time

- **heatmap**
    - x, y: Categorical (convert quantitative to nominal); color: Quantitative (intensity)
    - Best for: pattern discovery in matrix data
    - config: `{"colorScheme": "viridis"}` — options: "viridis", "inferno", "magma", "plasma", "turbo", "blues", "reds", "greens", "oranges", "purples", "greys", "blueorange" (diverging), "redblue" (diverging).

- **boxplot** (Box Plot)
    - x: Categorical; y: Quantitative; color: Categorical (optional, for grouped boxplots)
    - Best for: distribution comparison across categories

- **pie** (Pie / Donut Chart)
    - theta: Quantitative (slice size); color: Categorical (slice labels)
    - Best for: part-to-whole relationships, proportions
    - Avoid when >7-8 categories — use bar chart instead
    - config: `{"innerRadius": 50}` — 0 = pie, >0 = donut chart.

- **worldmap** (World Map)
    - longitude: Quantitative (-180 to 180); latitude: Quantitative (-90 to 90); color: Categorical/Quantitative (optional); size: Quantitative (optional)
    - Best for: geographic data with coordinates (cities, events, sales by location)
    - config: `{"projection": "equalEarth", "projectionCenter": [105, 35]}`
        - projection options: "mercator", "equalEarth" (default), "naturalEarth1", "orthographic", "stereographic", "conicEqualArea", "gnomonic", "azimuthalEquidistant"
        - projectionCenter: [lon, lat] — e.g., [105, 35] China, [-98, 39] USA, [10, 50] Europe, [139, 36] Japan

- **usmap** (US Map)
    - longitude: Quantitative; latitude: Quantitative; color: Categorical/Quantitative (optional); size: Quantitative (optional)
    - Best for: US-focused geographic data
    - Uses fixed albersUsa projection (includes Alaska and Hawaii); no config options.

**General encoding rules:**
- facet: available for all chart types; use a categorical field with small cardinality.
- opacity: available as an additional legend channel (Quantitative or Categorical).
- All fields in "encodings" must also appear in "output_fields".
- Typically use 2-3 encoding channels (x, y, color/size); add facet only when needed.

Concretely:
    - recap what the user's goal is in a short summary in "recap".
    - If the user's [GOAL] is clear already, simply infer what the user mean. Set "mode" as "infer" and create "output_fields" and "chart" based off user description.
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
    - "output_variable": descriptive snake_case name for the final DataFrame (e.g., "sales_by_region", "monthly_trends"). Avoid generic names like "result_df" or "data".

2. Then, write a Python script based on the inferred goal. The script should transform input data into the desired output table containing all "output_fields" from the refined goal.
The script should be as simple as possible and easily readable. If there is no data transformation needed based on "output_fields", the script can simply load and assign the data.

3. The output must only contain two items:
    - a json object (wrapped in ```json```) representing the refined goal (including "mode", "recommendation", "output_fields", "chart", "output_variable")
    - a python code block (wrapped in ```python```) representing the transformation script, do not add any extra text explanation.

**Example data loading patterns:**

Always use the exact **file path** from [CONTEXT] to load data. Choose the reader based on the file extension:

```python
# Parquet files (most common for workspace-generated tables)
import pandas as pd
import duckdb

# pandas
df = pd.read_parquet('student_exam.parquet')

# DuckDB (preferred for large datasets)
df = duckdb.sql("SELECT * FROM read_parquet('student_exam.parquet')").df()
```

```python
# CSV files
import pandas as pd
import duckdb

# pandas
df = pd.read_csv('sales.csv')

# DuckDB
df = duckdb.sql("SELECT * FROM read_csv_auto('sales.csv')").df()
```

```python
# Excel / JSON / TXT files (use pandas)
import pandas as pd

df = pd.read_excel('report.xlsx')    # .xlsx or .xls
df = pd.read_json('data.json')       # .json
df = pd.read_csv('log.txt', sep='\t') # .txt (tab-delimited)
```

```python
# Hybrid example: DuckDB for aggregation, pandas for reshaping
import pandas as pd
import duckdb

df = duckdb.sql("""
    SELECT category, SUM(value) as total
    FROM read_parquet('data.parquet')
    GROUP BY category
""").df()

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
    "chart": {
        "chart_type": "bar",
        "encodings": {"x": "student", "y": "average_score"}
    },
    "field_metadata": {
        "student": "ID",
        "average_score": "Score"
    },
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

    def __init__(self, client, workspace, system_prompt=None, agent_coding_rules="", max_display_rows=10000):
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
                refined_goal = {'mode': "", 'recommendation': "", 'output_fields': [], 'chart': {'chart_type': "", 'encodings': {}, 'config': {}}, 'output_variable': 'result_df'}
                output_variable = 'result_df'

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code = code_blocks[-1]

                try:
                    from data_formulator.sandbox import create_sandbox

                    # Get sandbox setting (with fallback for non-Flask contexts like MCP server)
                    try:
                        from flask import current_app
                        sandbox_mode = current_app.config.get('CLI_ARGS', {}).get('sandbox', 'local')
                    except (ImportError, RuntimeError):
                        sandbox_mode = 'local'

                    # Execute the Python script in the appropriate sandbox
                    sandbox = create_sandbox(sandbox_mode)
                    execution_result = sandbox.run_python_code(
                        code=code,
                        workspace=self.workspace,
                        output_variable=output_variable,
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
