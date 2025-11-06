# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import random
import string

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response
import pandas as pd

import logging 
import re
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

Here are our datasets, here are their field summaries and samples:

table_0 (weather_seattle_atlanta) fields:
	Date -- type: object, values: 1/1/2020, 1/10/2020, 1/11/2020, ..., 9/6/2020, 9/7/2020, 9/8/2020, 9/9/2020
	City -- type: object, values: Atlanta, Seattle
	Temperature -- type: int64, values: 30, 31, 32, ..., 83, 84, 85, 86

table_0 (weather_seattle_atlanta) sample:
```
|Date|City|Temperature
0|1/1/2020|Seattle|51
1|1/1/2020|Atlanta|45
2|1/2/2020|Seattle|45
3|1/2/2020|Atlanta|47
4|1/3/2020|Seattle|48
......
```

[GOAL]

{
    "instruction": "create a scatter plot to with seattle and atlanta temperatures on x,y axes, color points by which city is warmer",
    "chart_type": "scatter",
    "chart_encodings": {"x": "Seattle Temperature", "y": "Atlanta Temperature", "color": "Warmer City"}
}

[OUTPUT]

{  
    "detailed_instruction": "Create a scatter plot to compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis. Color the points by which city is warmer.",  
    "display_instruction": "Create a scatter plot to compare Seattle and Atlanta temperatures",
    "output_fields": ["Date", "Seattle Temperature", "Atlanta Temperature", "Warmer City"],  
    "chart_encodings": {"x": "Seattle Temperature", "y": "Atlanta Temperature", "color": "Warmer City"},  
    "reason": "To compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis, and color points by which city is warmer, separate temperature fields for Seattle and Atlanta are required. Additionally, a new field 'Warmer City' is needed to indicate which city is warmer."  
}

```sql
WITH MovingAverage AS (  
    SELECT   
        Date,  
        Cases,  
        AVG(Cases) OVER (ORDER BY Date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS "7-day average cases"  
    FROM us_covid_cases  
)  
SELECT Date, "7-day average cases"  
FROM MovingAverage;  
```
'''

def sanitize_table_name(table_name: str) -> str:
    """Sanitize table name to be used in SQL queries"""
    # Replace spaces with underscores
    sanitized_name = table_name.replace(" ", "_")
    sanitized_name = sanitized_name.replace("-", "_")
    # Allow alphanumeric, underscore, dot, dash, and dollar sign
    sanitized_name = re.sub(r'[^a-zA-Z0-9_\.$]', '', sanitized_name)
    return sanitized_name

class SQLDataTransformationAgent(object):

    def __init__(self, client, conn, system_prompt=None, agent_coding_rules=""):
        self.client = client
        self.conn = conn # duckdb connection
        
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
                    # Generate unique table name directly with timestamp and random suffix
                    random_suffix = ''.join(random.choices(string.ascii_lowercase, k=4))
                    table_name = f"view_{random_suffix}"
                    
                    create_query = f"CREATE VIEW IF NOT EXISTS {table_name} AS {query_str}"
                    self.conn.execute(create_query)
                    self.conn.commit()

                    # Check how many rows are in the table
                    row_count = self.conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                    
                    # Only limit to 5000 if there are more rows
                    if row_count > 5000:
                        query_output = self.conn.execute(f"SELECT * FROM {table_name} LIMIT 5000").fetch_df()
                    else:
                        query_output = self.conn.execute(f"SELECT * FROM {table_name}").fetch_df()
                
                    result = {
                        "status": "ok",
                        "code": query_str,
                        "content": {
                            'rows': json.loads(query_output.to_json(orient='records')),
                            'virtual': {
                                'table_name': table_name,
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
            input_tables: list[dict], each dict contains 'name' and 'rows'
            description: str, the description of the data transformation
            chart_type: str, the chart type for visualization
            chart_encodings: dict, the chart encodings mapping visualization channels to fields
            prev_messages: list[dict], the previous messages
            n: int, the number of candidates
        """

        for table in input_tables:
            table_name = sanitize_table_name(table['name'])

            # Check if table exists in the connection
            try:
                self.conn.execute(f"DESCRIBE {table_name}")
            except Exception:
                # Table doesn't exist, create it from the dataframe
                df = pd.DataFrame(table['rows'])

                # Register the dataframe as a temporary view
                self.conn.register(f'df_temp', df)
                # Create a permanent table from the temporary view
                self.conn.execute(f"CREATE TABLE {table_name} AS SELECT * FROM df_temp")
                # Drop the temporary view
                self.conn.execute(f"DROP VIEW df_temp")

                r = self.conn.execute(f"SELECT * FROM {table_name} LIMIT 10").fetch_df()
                print(r)
                # Log the creation of the table
                logger.info(f"Created table {table_name} from dataframe")


        data_summary = ""
        for table in input_tables:
            table_name = sanitize_table_name(table['name'])
            table_summary_str = get_sql_table_statistics_str(self.conn, table_name)
            data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"

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
        

    def followup(self, input_tables, dialog, latest_data_sample, chart_type: str, chart_encodings: dict, new_instruction: str, n=1):
        """
        extend the input data (in json records format) to include new fields
        latest_data_sample: the latest data sample that the user is working on, it's a json object that contains the data sample of the current table
        chart_type: the chart type that the user wants to use
        chart_encodings: the chart encodings that the user wants to use
        new_instruction: the new instruction that the user wants to add to the latest data sample
        """

        goal = {
            "followup_instruction": new_instruction,
            "chart_type": chart_type,
            "chart_encodings": chart_encodings
        }

        logger.info(f"GOAL: \n\n{goal}")

        #logger.info(dialog)

        updated_dialog = [{"role":"system", "content": self.system_prompt}, *dialog[1:]]

        # get the current table name
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        messages = [*updated_dialog, {"role":"user", 
                              "content": f"This is the result from the latest sql query:\n\n{sample_data_str}\n\nUpdate the sql query above based on the following instruction:\n\n{json.dumps(goal, indent=4)}"}]

        response = self.client.get_completion(messages = messages)

        return self.process_gpt_sql_response(response, messages)
        

def get_sql_table_statistics_str(conn, table_name: str, 
        row_sample_size: int = 5, # number of rows to be sampled in the sample data part
        field_sample_size: int = 7, # number of example values for each field to be sampled
        max_val_chars: int = 140 # max number of characters to be shown for each example value
    ) -> str:
    """Get a string representation of the table statistics"""

    table_name = sanitize_table_name(table_name)

    # Get column information
    columns = conn.execute(f"DESCRIBE {table_name}").fetchall()
    sample_data = conn.execute(f"SELECT * FROM {table_name} LIMIT {row_sample_size}").fetchall()
    
    # Format sample data as pipe-separated string
    col_names = [col[0] for col in columns]
    formatted_sample_data = "| " + " | ".join(col_names) + " |\n"
    for i, row in enumerate(sample_data):
        formatted_sample_data += f"{i}| " + " | ".join(str(val)[:max_val_chars]+ "..." if len(str(val)) > max_val_chars else str(val) for val in row) + " |\n"
    
    col_metadata_list = []
    for col in columns:
        col_name = col[0]
        col_type = col[1]
        
        # Properly quote column names to avoid SQL keywords issues
        quoted_col_name = f'"{col_name}"'
        
        # Basic stats query
        stats_query = f"""
        SELECT 
            COUNT(*) as count,
            COUNT(DISTINCT {quoted_col_name}) as unique_count,
            COUNT(*) - COUNT({quoted_col_name}) as null_count
        FROM {table_name}
        """
        
        # Add numeric stats if applicable
        if col_type in ['INTEGER', 'DOUBLE', 'DECIMAL']:
            stats_query = f"""
            SELECT 
                COUNT(*) as count,
                COUNT(DISTINCT {quoted_col_name}) as unique_count,
                COUNT(*) - COUNT({quoted_col_name}) as null_count,
                MIN({quoted_col_name}) as min_value,
                MAX({quoted_col_name}) as max_value,
                AVG({quoted_col_name}) as avg_value
            FROM {table_name}
            """
        
        col_stats = conn.execute(stats_query).fetchone()
        
        # Create a dictionary with appropriate keys based on column type
        if col_type in ['INTEGER', 'DOUBLE', 'DECIMAL']:
            stats_dict = dict(zip(
                ["count", "unique_count", "null_count", "min", "max", "avg"],
                col_stats
            ))
        else:
            stats_dict = dict(zip(
                ["count", "unique_count", "null_count"],
                col_stats
            ))

            # Combined query for top 4 and bottom 3 values using UNION ALL
            query_for_sample_values = f"""
            (SELECT DISTINCT {quoted_col_name}
                FROM {table_name} 
                WHERE {quoted_col_name} IS NOT NULL 
                LIMIT {field_sample_size})
            """
            
            sample_values = conn.execute(query_for_sample_values).fetchall()
            
            stats_dict['sample_values'] = [str(val)[:max_val_chars]+ "..." if len(str(val)) > max_val_chars else str(val) for val in sample_values]

        col_metadata_list.append({
            "column": col_name,
            "type": col_type,
            "statistics": stats_dict,
        })

    table_metadata = {
        "column_metadata": col_metadata_list,
        "sample_data_str": formatted_sample_data
    }

    table_summary_str = f"Column metadata:\n\n"
    for col_metadata in table_metadata['column_metadata']:
        table_summary_str += f"\t{col_metadata['column']} ({col_metadata['type']}) ---- {col_metadata['statistics']}\n"
    table_summary_str += f"\n\nSample data:\n\n{table_metadata['sample_data_str']}\n"

    return table_summary_str
