# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary, extract_code_from_gpt_response
import data_formulator.py_sandbox as py_sandbox

import traceback

import logging

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = '''You are a data scientist to help user to transform data that will be used for visualization.
The user will provide you information about what data would be needed, and your job is to create a python function based on the input data summary, transformation instruction and expected fields.
The users' instruction includes "expected fields" that the user want for visualization, and natural langauge instructions "goal" that describe what data is needed.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with np.nan.

Concretely, you should first refine users' goal and then create a python function in the [OUTPUT] section based off the [CONTEXT] and [GOAL]:

    1. First, refine users' [GOAL]. The main objective in this step is to check if "visualization_fields" provided by the user are sufficient to achieve their "goal". Concretely:
        (1) based on the user's "goal", elaborate the goal into a "detailed_instruction".
        (2) determine "output_fields", the desired fields that the output data should have to achieve the user's goal, it's a good idea to include intermediate fields here.
        (2) now, determine whether the user has provided sufficient fields in "visualization_fields" that are needed to achieve their goal:
            - if the user's "visualization_fields" are sufficient, simply copy it.
            - if the user didn't provide sufficient fields in "visualization_fields", add missing fields in "visualization_fields" (ordered them based on whether the field will be used in x,y axes or legends);
                - "visualization_fields" should only include fields that will be visualized (do not include other intermediate fields from "output_fields")  
                - when adding new fields to "visualization_fields", be efficient and add only a minimal number of fields that are needed to achive the user's goal. generally, the total number of fields in "visualization_fields" should be no more than 3 for x,y,legend.

    Prepare the result in the following json format:

```
{
    "detailed_instruction": "..." // string, elaborate user instruction with details if the user
    "output_fields": [...] // string[], describe the desired output fields that the output data should have based on the user's goal, it's a good idea to preserve intermediate fields here (i.e., the goal of transformed data)
    "visualization_fields": [] // string[]: a subset of fields from "output_fields" that will be visualized, ordered based on if the field will be used in x,y axes or legends, do not include other intermediate fields from "output_fields".
    "reason": "..." // string, explain why this refinement is made
}
```

    2. Then, write a python function based on the refined goal, the function input is a dataframe "df" and the output is the transformed dataframe "transformed_df". "transformed_df" should contain all "output_fields" from the refined goal.
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

    3. The [OUTPUT] must only contain a json object representing the refined goal (including "detailed_instruction", "output_fields", "visualization_fields" and "reason") and a python code block representing the transformation code, do not add any extra text explanation.
'''

EXAMPLE='''

For example:

[CONTEXT]

Here are our datasets, here are their field summaries and samples:

table_0 (us_covid_cases) fields:
	Date -- type: object, values: 1/1/2021, 1/1/2022, 1/1/2023, ..., 9/8/2022, 9/9/2020, 9/9/2021, 9/9/2022
	Cases -- type: int64, values: -23999, -14195, -6940, ..., 1018935, 1032159, 1178403, 1433977

table_0 (us_covid_cases) sample:
```
|Date|Cases
0|1/21/2020|1
1|1/22/2020|0
2|1/23/2020|0
3|1/24/2020|1
4|1/25/2020|1
......
```

[GOAL]

{
    "instruction": "calculate 7-day moving average",
    "visualization_fields": ["Date", "7-day average cases"]
}

[OUTPUT]

{  
    "detailed_instruction": "Calculate the 7-day moving average of COVID-19 cases over time.",  
    "output_fields": ["Date", "Cases", "7-day average cases"],  
    "visualization_fields": ["Date", "7-day average cases"],  
    "reason": "To calculate the 7-day moving average, the 'Cases' field is required, but it is not needed for visualization. The provided fields are sufficient to achieve the goal."  
}  

```python
import pandas as pd  
import collections  
import numpy as np  
  
def transform_data(df):  
    # Convert Date column to datetime  
    df['Date'] = pd.to_datetime(df['Date'])  
      
    # Sort the dataframe by Date  
    df = df.sort_values('Date')  
      
    # Calculate the 7-day moving average of cases  
    df['7-day average cases'] = df['Cases'].rolling(window=7).mean()  
      
    # Select the output fields  
    transformed_df = df[['Date', 'Cases', '7-day average cases']]  
      
    return transformed_df  
```

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
    "visualization_fields": []
}

[OUTPUT]

{  
    "detailed_instruction": "Create a scatter plot to compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis. Color the points by which city is warmer.",  
    "output_fields": ["Date", "Seattle Temperature", "Atlanta Temperature", "Warmer City"],  
    "visualization_fields": ["Seattle Temperature", "Atlanta Temperature", "Warmer City"],  
    "reason": "To compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis, and color points by which city is warmer, separate temperature fields for Seattle and Atlanta are required. Additionally, a new field 'Warmer City' is needed to indicate which city is warmer."  
}  

```python
import pandas as pd  
import collections  
import numpy as np  
  
def transform_data(df):  
    # Pivot the dataframe to have separate columns for Seattle and Atlanta temperatures  
    df_pivot = df.pivot(index='Date', columns='City', values='Temperature').reset_index()  
    df_pivot.columns = ['Date', 'Atlanta Temperature', 'Seattle Temperature']  
      
    # Determine which city is warmer for each date  
    df_pivot['Warmer City'] = df_pivot.apply(lambda row: 'Atlanta' if row['Atlanta Temperature'] > row['Seattle Temperature'] else 'Seattle', axis=1)  
      
    # Select the output fields  
    transformed_df = df_pivot[['Date', 'Seattle Temperature', 'Atlanta Temperature', 'Warmer City']]  
      
    return transformed_df 
```
'''

def completion_response_wrapper(client, model, messages, n):
    ### wrapper for completion response, especially handling errors
    try:
        response = client.chat.completions.create(
                model=model, messages=messages, temperature=0.7, max_tokens=1200,
                top_p=0.95, n=n, frequency_penalty=0, presence_penalty=0, stop=None)
    except Exception as e:
        response = e

    return response


class DataTransformationAgentV2(object):

    def __init__(self, client, model, system_prompt=None):
        self.client = client
        self.model = model
        self.system_prompt = system_prompt if system_prompt is not None else SYSTEM_PROMPT

    def process_gpt_response(self, input_tables, messages, response):
        """process gpt response to handle execution"""

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}
        #logger.info("=== prompt_filter_results ===>")
        #logger.info(response.prompt_filter_results)

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': response.body}
            return [result]
        
        candidates = []
        for choice in response.choices:
            # logger.info("\n=== Data transformation result ===>\n")
            # logger.info(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            if len(json_blocks) > 0:
                refined_goal = json_blocks[0]
            else:
                refined_goal = {'visualization_fields': [], 'instruction': '', 'reason': ''}

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
            result['agent'] = 'DataTransformationAgent'
            result['refined_goal'] = refined_goal
            candidates.append(result)

        return candidates


    def run(self, input_tables, description, expected_fields: list[str], n=1):

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

        goal = {
            "instruction": description,
            "visualization_fields": expected_fields
        }

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{json.dumps(goal, indent=4)}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": self.system_prompt},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        # response = self.client.chat.completions.create(
        #     model=self.model, messages = messages, temperature=0.7, max_tokens=1200,
        #     top_p=0.95, n=n, frequency_penalty=0, presence_penalty=0, stop=None)

        response = completion_response_wrapper(self.client, self.model, messages, n)

        return self.process_gpt_response(input_tables, messages, response)
        

    def followup(self, input_tables, dialog, output_fields: list[str], new_instruction: str, n=1):
        """extend the input data (in json records format) to include new fields"""

        goal = {
            "followup_instruction": new_instruction,
            "visualization_fields": output_fields
        }

        logger.info(f"GOAL: \n\n{goal}")

        #logger.info(dialog)

        updated_dialog = [{"role":"system", "content": self.system_prompt}, *dialog[1:]]

        messages = [*updated_dialog, {"role":"user", 
                              "content": f"Update the code above based on the following instruction:\n\n{json.dumps(goal, indent=4)}"}]

        response = completion_response_wrapper(self.client, self.model, messages, n)

        return self.process_gpt_response(input_tables, messages, response)
