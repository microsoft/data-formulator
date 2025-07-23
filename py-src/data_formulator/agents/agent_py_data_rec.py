# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import pandas as pd

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary, extract_code_from_gpt_response
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
    "chart_type": "" // string, one of "point", "bar", "line", "area", "heatmap", "group_bar". "chart_type" should either be inferred from user instruction, or recommend if the user didn't specify any.
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
    (4) "visualization_fields" should be 2-3 (for x,y,legend) or 4 (if you consider faceted visualization).
    (5) "chart_type" must be one of "point", "bar", "line", "area", "heatmap", "group_bar"
        - Consider chart types as follows:
            - (bar) Bar Charts: X: Categorical (nominal/ordinal), Y: Quantitative, Color: Categorical (optional for group or stacked bar chart), Best for: Comparisons across categories
                - use (bar) for simple bar chart or stacked bar chart, 
                - use (group_bar) for grouped bar chart.
            - (point) Scatter Plots: X,Y: Quantitative/Categorical, Color: Quantitative/Categorical (optional), Size: Quantitative (optional for creating bubble chart), Best for: Relationships, correlations, distributions
            - (line) Line Charts: X: Temporal (preferred) or ordinal, Y: Quantitative, Color: Categorical (optional for creating multiple lines), Best for: Trends over time, continuous data
            - (area) Area Charts: X: Temporal (preferred) or ordinal, Y: Quantitative, Color: Categorical (optional for creating stacked areas), Best for: Trends over time, continuous data
            - (heatmap) Heatmaps: X,Y: Categorical (convert quantitative to nominal), Color: Quantitative intensity, Best for: Pattern discovery in matrix data
        - all charts have the option to add additional fields for legends (color, size, facet, etc.) to enrich the visualization if applicable.
    (6) visualization fields should be in tidy format with respect to the chart type to create the visualization, so it does not make sense to have too many or too few fields. 
        It should follow guidelines like VegaLite and ggplot2 so that each field is mapped to a visualization axis or legend. 
    (7) consider data transformations if you want to visualize multiple fields together.
        - exapmle 1: suggest reshaping the data into long format in data transformation description (if these fields are all of the same type, e.g., they are all about sales, price, two columns about min/max-values, etc. don't mix different types of fields in reshaping) so we can visualize multiple fields as categories or in different facets.
        - exapmle 2: calculate some derived fields from these fields(e.g., correlation, difference, profit etc.) in data transformation description to visualize them in one visualization.
        - example 3: create a visualization only with a subset of the fields, you don't have to visualize all of them in one chart, you can later create a visualization with the rest of the fields. With the subset of charts, you can also consider reshaping or calculate some derived value.
        - again, it does not make sense to have five fields like [item, A, B, C, D, E] in visualization fields, you should consider data transformation to reduce the number of fields.

    2. Then, write a python function based on the inferred goal, the function input is a dataframe "df" (or multiple dataframes based on tables presented in the [CONTEXT] section) and the output is the transformed dataframe "transformed_df". "transformed_df" should contain all "output_fields" from the refined goal.
The python function must follow the template provided in [TEMPLATE], do not import any other libraries or modify function name. The function should be as simple as possible and easily readable. 
If there is no data transformation needed based on "output_fields", the transformation function can simply "return df".

[TEMPLATE]

```python
import pandas as pd
import collections
import numpy as np

def transform_data(df1, df2, ...): 
    # complete the template here
    return transformed_df
```

note: 
- if the user provided one table, then it should be def transform_data(df1), if the user provided multiple tables, then it should be def transform_data(df1, df2, ...) and you should consider the join between tables to derive the output.
- try to use table names to refer to the input dataframes, for example, if the user provided two tables city and weather, you can use `transform_data(df_city, df_weather)` to refer to the two dataframes.

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

class PythonDataRecAgent(object):

    def __init__(self, client, system_prompt=None, exec_python_in_subprocess=False):
        self.client = client
        self.system_prompt = system_prompt if system_prompt is not None else SYSTEM_PROMPT
        self.exec_python_in_subprocess = exec_python_in_subprocess

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

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

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