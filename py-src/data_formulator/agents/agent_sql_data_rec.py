# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response
from data_formulator.agents.agent_sql_data_transform import get_sql_table_statistics_str, sanitize_table_name

import random
import string

import traceback


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

Concretely, you should infer the appropriate data and create a SQL query in the [OUTPUT] section based off the [CONTEXT] and [GOAL] in two steps:

    1. First, based on users' [GOAL]. Create a json object that represents the inferred user intent. The json object should have the following format:

```json
{
    "mode": "" // string, one of "infer", "overview", "distribution", "summary"
    "recommendation": "..." // string, explain why this recommendation is made 
    "output_fields": [...] // string[], describe the desired output fields that the output data should have (i.e., the goal of transformed data), it's a good idea to preseve intermediate fields here
    "chart_type": "" // string, one of "point", "bar", "line", "boxplot". "chart_type" should either be inferred from user instruction, or recommend if the user didn't specify any.
    "visualization_fields": [] // string[]: select a subset of the output_fields should be visualized (no more than 3 unless the user explicitly mentioned), ordered based on if the field will be used in x,y axes or legends for the recommended chart type, do not include other intermediate fields from "output_fields".
}
```

Concretely:
    (1) If the user's [GOAL] is clear already, simply infer what the user mean. Set "mode" as "infer" and create "output_fields" and "visualization_fields_list" based off user description.
    (2) If the user's [GOAL] is not clear, make recommendations to the user:
        - choose one of "distribution", "overview", "summary" in "mode":
            * if it is "overview" and the data is in wide format, reshape it into long format.
            * if it is "distribution", select a few fields that would be interesting to visualize together.
            * if it is "summary", calculate some aggregated statistics to show intresting facts of the data.
        - describe the recommendation reason in "recommendation"
        - based on the recommendation, determine what is an ideal output data. Note, the output data must be in tidy format.
        - then suggest recommendations of visualization fields that should be visualized.
    (3) "visualization_fields" should be ordered based on whether the field will be used in x,y axes or legends, do not include other intermediate fields from "output_fields".
    (4) "visualization_fields" should be no more than 3 (for x,y,legend).
    (5) "chart_type" must be one of "point", "bar", "line", or "boxplot"

    2. Then, write a SQL query based on the inferred goal, the query input are tables (or multiple tables presented in the [CONTEXT] section) and the output is the transformed data. The output data should contain all "output_fields" from the refined goal.
The query should be as simple as possible and easily readable. If there is no data transformation needed based on "output_fields", the transformation function can simply "SELECT * FROM table".
note:   
     - the sql query should be written in the style of duckdb.
     - if the user provided multiple tables, you should consider the join between tables to derive the output.

    3. The [OUTPUT] must only contain two items:
        - a json object (wrapped in ```json```) representing the refined goal (including "mode", "recommendation", "output_fields", "chart_type", "visualization_fields")
        - a sql query block (wrapped in ```sql```) representing the transformation code, do not add any extra text explanation.

some notes:
- in DuckDB, you escape a single quote within a string by doubling it ('') rather than using a backslash (\').
- in DuckDB, you need to use proper date functions to perform date operations.
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
    "mode": "infer",  
    "recommendation": "To rank students based on their average scores, we need to calculate the average score for each student and then rank them accordingly.",  
    "output_fields": ["student", "major", "math", "reading", "writing", "average_score", "rank"],  
    "chart_type": "bar",  
    "visualization_fields": ["student", "average_score"]  
}  
```

```sql
SELECT   
    student,  
    major,  
    math,  
    reading,  
    writing,  
    (math + reading + writing) / 3.0 AS average_score,  
    RANK() OVER (ORDER BY (math + reading + writing) / 3.0 DESC) AS rank  
FROM   
    student_exam;  
```
"""

class SQLDataRecAgent(object):

    def __init__(self, client, conn, system_prompt=None):
        self.client = client
        self.conn = conn
        self.system_prompt = system_prompt if system_prompt is not None else SYSTEM_PROMPT

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
                refined_goal = { 'mode': "", 'recommendation': "", 'output_fields': [], 'visualization_fields': [], }

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
    

    def run(self, input_tables, description, n=1):
        data_summary = ""
        for table in input_tables:
            table_name = sanitize_table_name(table['name'])
            table_summary_str = get_sql_table_statistics_str(self.conn, table_name)
            data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": self.system_prompt},
                    {"role":"user","content": user_query}]
        
        response = self.client.get_completion(messages = messages)
        
        return self.process_gpt_response(input_tables, messages, response)
        

    def followup(self, input_tables, dialog, new_instruction: str, n=1):
        """extend the input data (in json records format) to include new fields"""

        logger.info(f"GOAL: \n\n{new_instruction}")

        messages = [*dialog, {"role":"user", "content": f"Update: \n\n{new_instruction}"}]

        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)