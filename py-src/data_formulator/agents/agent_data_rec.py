# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary, extract_code_from_gpt_response
from data_formulator.agents.agent_data_transform_v2 import completion_response_wrapper

import data_formulator.py_sandbox as py_sandbox

import traceback


import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to recommend data that will be used for visualization.
The user will provide you information about what visualization they would like to create, and your job is to recommend a transformed data that can be used to create the visualization and write a python function to transform the data.
The recommendation and transformation function should be based on the [CONTEXT] and [GOAL] provided by the user. 
The [CONTEXT] shows what the current dataset is, and the [GOAL] describes what the user wants the data for.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with np.nan.

Concretely, you should infer the appropriate data and create a python function in the [OUTPUT] section based off the [CONTEXT] and [GOAL] in two steps:

    1. First, based on users' [GOAL]. Create a json object that represents the inferred user intent. The json object should have the following format:

{
    "mode": "" // string, one of "infer", "overview", "distribution", "summary"
    "recommendation": "..." // string, explain why this recommendation is made 
    "output_fields": [...] // string[], describe the desired output fields that the output data should have (i.e., the goal of transformed data), it's a good idea to preseve intermediate fields here
    "chart_type": "" // string, one of "point", "bar", "line", "boxplot". "chart_type" should either be inferred from user instruction, or recommend if the user didn't specify any.
    "visualization_fields": [] // string[]: select a subset of the output_fields should be visualized (no more than 3 unless the user explicitly mentioned), ordered based on if the field will be used in x,y axes or legends for the recommended chart type, do not include other intermediate fields from "output_fields".
}

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

    2. Then, write a python function based on the inferred goal, the function input is a dataframe "df" and the output is the transformed dataframe "transformed_df". "transformed_df" should contain all "output_fields" from the refined goal.
The python function must follow the template provided in [TEMPLATE], do not import any other libraries or modify function name. The function should be as simple as possible and easily readable. 
If there is no data transformation needed based on "output_fields", the transformation function can simply "return df".

[TEMPLATE]

```python
import pandas as pd
import collections
import numpy as np

def transform_data(df):
    # complete the template here
    return transformed_df
```

    3. The [OUTPUT] must only contain a json object representing the refined goal and a python code block representing the transformation code, do not add any extra text explanation.
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

{  
    "mode": "infer",
    "recommendation": "To rank students based on their average scores, we need to calculate the average score for each student, then sort the data, and finally assign a rank to each student based on their average score.",  
    "output_fields": ["student", "major", "average_score", "rank"],  
    "visualization_fields": ["student", "average_score"],  
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

class DataRecAgent(object):

    def __init__(self, client, model, system_prompt=None):
        self.client = client
        self.model = model
        self.system_prompt = system_prompt if system_prompt is not None else SYSTEM_PROMPT

    def process_gpt_response(self, input_tables, messages, response):
        """process gpt response to handle execution"""

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': response.body}
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

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]
                try:
                    result = py_sandbox.run_transform_in_sandbox2020(code_str, [t['rows'] for t in input_tables])

                    if result['status'] == 'ok':
                        new_data = json.loads(result['content'])
                        result['content'] = new_data
                    else:
                        logger.info(result['content'])
                    result['code'] = code_str
                except Exception as e:
                    logger.warning('other error:')
                    error_message = traceback.format_exc()
                    logger.warning(error_message)
                    result = {'status': 'other error', 'content': error_message}
            else:
                result = {'status': 'no transformation', 'content': input_tables[0]['rows']}
            
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataRecAgent'
            result['refined_goal'] = refined_goal
            candidates.append(result)

        return candidates
    

    def run(self, input_tables, description, n=1):

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": self.system_prompt},
                    {"role":"user","content": user_query}]
        
        response = completion_response_wrapper(self.client, self.model, messages, n)
        
        return self.process_gpt_response(input_tables, messages, response)
        

    def followup(self, input_tables, dialog, new_instruction: str, n=1):
        """extend the input data (in json records format) to include new fields"""

        logger.info(f"GOAL: \n\n{new_instruction}")

        messages = [*dialog, {"role":"user", "content": f"Update: \n\n{new_instruction}"}]

        ##### the part that calls open_ai
        response = completion_response_wrapper(self.client, self.model, messages, n)

        return self.process_gpt_response(input_tables, messages, response)