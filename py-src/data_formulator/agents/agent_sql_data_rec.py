# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response
from data_formulator.agents.agent_sql_data_transform import get_sql_table_statistics_str, sanitize_table_name

import random
import string

import traceback
import duckdb
import pandas as pd

import logging

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

1. First, based on users' [GOAL]. Create a json object that represents the inferred user intent. The json object should have the following format:

{
    "mode": "" // string, one of "infer", "overview", "distribution", "summary"
    "recap": "..." // string, a short summary of the user's goal.
    "display_instruction": "..." // string, the even shorter verb phrase describing the users' goal.
    "recommendation": "..." // string, explain why this recommendation is made
    "output_fields": [...] // string[], describe the desired output fields that the output data should have (i.e., the goal of transformed data), it's a good idea to preseve intermediate fields here
    "chart_type": "" // string, one of "point", "bar", "line", "area", "heatmap", "group_bar". "chart_type" should either be inferred from user instruction, or recommend if the user didn't specify any.
    "chart_encodings": {
        "x": "",
        "y": "",
        "color": "",
        "size": "",
        "opacity": "",
        "facet": "",
    } // object: map visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of output fields, appropriate visual channels for different chart types are defined below.
}

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
    - "chart_type" must be one of "point", "bar", "line", "area", "heatmap", "group_bar"
    - "chart_encodings" should specify which fields should be used to create the visualization
        - decide which visual channels should be used to create the visualization appropriate for the chart type.
            - point: x, y, color, size, facet
            - histogram: x, color, facet
            - bar: x, y, color, facet
            - line: x, y, color, facet
            - area: x, y, color, facet
            - heatmap: x, y, color, facet
            - group_bar: x, y, color, facet
        - note that all fields used in "chart_encodings" should be included in "output_fields".
            - all fields you need for visualizations should be transformed into the output fields!
            - "output_fields" should include important intermediate fields that are not used in visualization but are used for data transformation.
        - typically only 2-3 fields should be used to create the visualization (x, y, color/size), facet use be added if it's a faceted visualization (totally 4 fields used).
    - Guidelines for choosing chart type and visualization fields:
        - Consider chart types as follows:
             - (point) Scatter Plots: x,y: Quantitative/Categorical, color: Categorical (optional), size: Quantitative (optional for creating bubble chart), 
                - best for: Relationships, correlations, distributions
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
                - when color is specifed, bars from different groups will be grouped automatically.
                - only use facet if the cardinality of color field is small (less than 5).
            - (line) Line Charts: x: Temporal (preferred) or ordinal, y: Quantitative, color: Categorical (optional for creating multiple lines), 
                - best for: Trends over time, continuous data
                - note that when there are multiple rows in the data belong to the same group (same x and color values) but different y values, the line will not look correct.
                - consider to use an aggregated field for y values, or introduce facets so that each group is visualized in a separate line.
            - (area) Area Charts: x: Temporal (preferred) or ordinal, y: Quantitative, color: Categorical (optional for creating stacked areas), 
                - best for: Trends over time, continuous data
            - (heatmap) Heatmaps: x,y: Categorical (you need to convert quantitative to nominal), color: Quantitative intensity, 
                - best for: Pattern discovery in matrix data
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
            
    2. Then, write a SQL query based on the inferred goal, the query input are tables (or multiple tables presented in the [CONTEXT] section) and the output is the transformed data. The output data should contain all "output_fields" from the refined goal.
The query should be as simple as possible and easily readable. If there is no data transformation needed based on "output_fields", the transformation function can simply "SELECT * FROM table".
note:   
     - the sql query should be written in the style of duckdb.
     - if the user provided multiple tables, you should consider the join between tables to derive the output.

    3. The output must only contain two items:
        - a json object (wrapped in ```json```) representing the refined goal (including "mode", "recommendation", "output_fields", "chart_type", "chart_encodings")
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
"""

class SQLDataRecAgent(object):

    def __init__(self, client, conn, system_prompt=None, agent_coding_rules=""):
        self.client = client
        self.conn = conn
        
        # Incorporate agent coding rules into system prompt if provided
        if system_prompt is not None:
            self.system_prompt = system_prompt
        else:
            base_prompt = SYSTEM_PROMPT
            if agent_coding_rules and agent_coding_rules.strip():
                self.system_prompt = base_prompt + "\n\n[AGENT CODING RULES]\nPlease follow these rules when generating code. Note: if the user instruction conflicts with these rules, you should priortize user instructions.\n\n" + agent_coding_rules.strip()
            else:
                self.system_prompt = base_prompt

    def process_gpt_response(self, input_tables, messages, response):
        """process gpt response to handle execution"""

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

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

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "sql")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]

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
        data_summary = ""
        for table in input_tables:
            table_name = sanitize_table_name(table['name'])
            table_summary_str = get_sql_table_statistics_str(self.conn, table_name)
            data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"

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
        """extend the input data (in json records format) to include new fields
        latest_data_sample: the latest data sample that the user is working on, it's a json object that contains the data sample of the current table
        new_instruction: the new instruction that the user wants to add to the latest data sample
        """

        logger.info(f"GOAL: \n\n{new_instruction}")

        # get the current table name
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        messages = [*dialog, 
                    {"role":"user", 
                    "content": f"This is the result from the latest sql query:\n\n{sample_data_str}\n\nUpdate the sql query above based on the following instruction:\n\n{new_instruction}"}]

        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)