# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import random
import string

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response, generate_data_summary
from data_formulator.agents.agent_utils_sql import create_duckdb_conn_with_parquet_views
import pandas as pd

from data_formulator.datalake.parquet_utils import sanitize_table_name as parquet_sanitize_table_name

import logging 
# Replace/update the logger configuration
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = '''You are a data scientist to help user to transform data that will be used for visualization.
The user will provide you information about what data would be needed, and your job is to create a sql query based on the input data summary, transformation instruction and expected fields.
The users' instruction includes "chart_type" and "chart_encodings" that describe the visualization they want, and natural language instructions "goal" that describe what data is needed.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with NULL.

Concretely, you should first refine users' goal and then create a sql query in the output section based off the [CONTEXT] and [GOAL]:

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

    Prepare the result in the following json format:

```
{
    "input_tables": ["student_exam"],
    "detailed_instruction": "..." // string, elaborate user instruction with details if the user
    "display_instruction": "..." // string, the short verb phrase describing the users' goal.
    "output_fields": [...] // string[], describe the desired output fields that the output data should have based on the user's goal, it's a good idea to preserve intermediate fields here (i.e., the goal of transformed data)
    "chart_encodings": {
        "x": "",
        "y": "",
        "color": "",
        "size": "",
        "opacity": "",
        "facet": "",
        ... // other visualization channels user used
    } // object: map visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of "output_fields" that will be visualized.
    "reason": "..." // string, explain why this refinement is made
}
```

    2. Then, write a sql query based on the refined goal, the query input are table (or multiple tables presented in the [CONTEXT] section) and the output is the desired table. The output table should contain all "output_fields" from the refined goal.
The query should be as simple as possible and easily readable. If there is no data transformation needed based on "output_fields", the transformation function can simply "SELECT * FROM table".
note:
    - the sql query should be written in the style of duckdb.

    3. The output must only contain two items:
        - a json object (wrapped in ```json```) representing the refined goal (including "detailed_instruction", "output_fields", "chart_encodings" and "reason")
        - a sql query block (wrapped in ```sql```) representing the transformation code, do not add any extra text explanation.

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
'''

EXAMPLE='''
[CONTEXT]

Here are 1 dataset with their summaries:

## Table 1: weather_seattle_atlanta (548 rows × 3 columns)

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
    "instruction": "create a scatter plot to with seattle and atlanta temperatures on x,y axes, color points by which city is warmer",
    "chart_type": "scatter",
    "chart_encodings": {"x": "Seattle Temperature", "y": "Atlanta Temperature", "color": "Warmer City"}
}

[OUTPUT]

{  
    "input_tables": ["weather_seattle_atlanta"],
    "detailed_instruction": "Create a scatter plot to compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis. Color the points by which city is warmer.",  
    "display_instruction": "Create a scatter plot to compare Seattle and Atlanta temperatures",
    "output_fields": ["Date", "Seattle Temperature", "Atlanta Temperature", "Warmer City"],  
    "chart_encodings": {"x": "Seattle Temperature", "y": "Atlanta Temperature", "color": "Warmer City"},  
    "reason": "To compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis, and color points by which city is warmer, separate temperature fields for Seattle and Atlanta are required. Additionally, a new field 'Warmer City' is needed to indicate which city is warmer."  
}

```sql
WITH pivoted AS (
    SELECT 
        Date,
        MAX(CASE WHEN City = 'Seattle' THEN Temperature END) AS "Seattle Temperature",
        MAX(CASE WHEN City = 'Atlanta' THEN Temperature END) AS "Atlanta Temperature"
    FROM weather_seattle_atlanta
    GROUP BY Date
)
SELECT 
    Date,
    "Seattle Temperature",
    "Atlanta Temperature",
    CASE WHEN "Seattle Temperature" > "Atlanta Temperature" THEN 'Seattle' ELSE 'Atlanta' END AS "Warmer City"
FROM pivoted;
```
'''


class SQLDataTransformationAgent(object):

    def __init__(self, client, workspace, system_prompt=None, agent_coding_rules="", max_display_rows=5000):
        self.client = client
        self.workspace = workspace
        self.max_display_rows = max_display_rows
        self.conn = None  # set per request, closed after use
        
        # Incorporate agent coding rules into system prompt if provided
        if system_prompt is not None:
            self.system_prompt = system_prompt
        else:
            base_prompt = SYSTEM_PROMPT
            if agent_coding_rules and agent_coding_rules.strip():
                self.system_prompt = base_prompt + "\n\n[AGENT CODING RULES]\nPlease follow these rules when generating code. Note: if the user instruction conflicts with these rules, you should priortize user instructions.\n\n" + agent_coding_rules.strip()
            else:
                self.system_prompt = base_prompt


    def process_gpt_sql_response(self, response, messages):
        """process gpt response to handle execution"""

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}
        #logger.info("=== prompt_filter_results ===>")
        #logger.info(response.prompt_filter_results)

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': str(response.body)}
            return [result]
        
        candidates = []
        for choice in response.choices:
            logger.info("=== SQL query result ===>")
            logger.info(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            if len(json_blocks) > 0:
                refined_goal = json_blocks[0]
            else:
                refined_goal = {'chart_encodings': {}, 'instruction': '', 'reason': ''}

            query_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "sql")

            if len(query_blocks) > 0:
                query_str = query_blocks[-1]

                try:
                    # Generate unique view name for this execution, then write result to datalake as parquet
                    random_suffix = ''.join(random.choices(string.ascii_lowercase, k=4))
                    view_name = f"view_{random_suffix}"
                    
                    create_query = f"CREATE VIEW IF NOT EXISTS {view_name} AS {query_str}"
                    self.conn.execute(create_query)
                    self.conn.commit()

                    # Check how many rows are in the result
                    row_count = self.conn.execute(f"SELECT COUNT(*) FROM {view_name}").fetchone()[0]
                    
                    # Fetch result: full for datalake write, limited for response payload
                    if row_count > self.max_display_rows:
                        query_output = self.conn.execute(f"SELECT * FROM {view_name} LIMIT {self.max_display_rows}").fetch_df()
                        full_df = self.conn.execute(f"SELECT * FROM {view_name}").fetch_df()
                    else:
                        full_df = self.conn.execute(f"SELECT * FROM {view_name}").fetch_df()
                        query_output = full_df
                    
                    # Write full result to datalake as parquet (parquet-to-parquet)
                    output_table_name = parquet_sanitize_table_name(f"derived_{random_suffix}")
                    self.workspace.write_parquet(full_df, output_table_name)
                
                    result = {
                        "status": "ok",
                        "code": query_str,
                        "content": {
                            'rows': json.loads(query_output.to_json(orient='records')),
                            'virtual': {
                                'table_name': output_table_name,
                                'row_count': row_count
                            }
                        },
                    }

                except Exception as e:
                    logger.warning('Error occurred during code execution:')
                    error_message = f"An error occurred during code execution. Error type: {type(e).__name__}"
                    logger.warning(error_message)
                    result = {'status': 'error', 'code': query_str, 'content': error_message}

            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task."}
            
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'SQLDataTransformationAgent'
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
            input_tables: list[dict], each dict contains 'name' (table name in datalake); tables are parquet.
            description: str, the description of the data transformation
            chart_type: str, the chart type for visualization
            chart_encodings: dict, the chart encodings mapping visualization channels to fields
            prev_messages: list[dict], the previous messages
            n: int, the number of candidates
        """
        self.conn = create_duckdb_conn_with_parquet_views(self.workspace, input_tables)
        try:
            data_summary = generate_data_summary(input_tables, self.workspace)

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

            return self.process_gpt_sql_response(response, messages)
        finally:
            if self.conn:
                self.conn.close()
                self.conn = None
        

    def followup(self, input_tables, dialog, latest_data_sample, chart_type: str, chart_encodings: dict, new_instruction: str, n=1):
        """
        extend the input data (in json records format) to include new fields
        latest_data_sample: the latest data sample that the user is working on, it's a json object that contains the data sample of the current table
        chart_type: the chart type that the user wants to use
        chart_encodings: the chart encodings that the user wants to use
        new_instruction: the new instruction that the user wants to add to the latest data sample
        """
        self.conn = create_duckdb_conn_with_parquet_views(self.workspace, input_tables)
        try:
            goal = {
                "followup_instruction": new_instruction,
                "chart_type": chart_type,
                "chart_encodings": chart_encodings
            }

            logger.info(f"GOAL: \n\n{goal}")

            updated_dialog = [{"role":"system", "content": self.system_prompt}, *dialog[1:]]

            # get the current table name
            sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

            messages = [*updated_dialog, {"role":"user", 
                                  "content": f"This is the result from the latest sql query:\n\n{sample_data_str}\n\nUpdate the sql query above based on the following instruction:\n\n{json.dumps(goal, indent=4)}"}]

            response = self.client.get_completion(messages = messages)

            return self.process_gpt_sql_response(response, messages)
        finally:
            if self.conn:
                self.conn.close()
                self.conn = None
