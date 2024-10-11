# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import generate_data_summary, extract_code_from_gpt_response
import data_formulator.py_sandbox as py_sandbox

import traceback

import logging

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = '''You are a data scientist to help user to transform data that will be used for visualization.
Your job is to create a python function based on the input data summary, transformation instruction and expected fields.
Create a python function based off the [CONTEXT] and [GOAL] provided, the function input is a dataframe "df" and the output is the transformed dataframe "transformed_df".
The python function must follow the template provided in [TEMPLATE], do not import any other libraries or modify function name.
The function should be as simple as possible. If there are fields in df that are not affected by transformation, also keep them in "transformed_df".

[TEMPLATE]

```python
import pandas as pd
import collections
import numpy as np

def transform_data(df):
    # complete the template here
    return transformed_df
```

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

description: calculate 7-day moving average
expectedFields: ["Date", "7-day average cases"]

[OUTPUT]

```python
import pandas as pd

def transform_data(df_0):
    # Convert Date field to datetime format
    df_0['Date'] = pd.to_datetime(df_0['Date'])

    # Sort the dataframe by Date column
    df_0 = df_0.sort_values('Date')

    # Calculate 7-day rolling average of Cases column
    df_0['7-day average cases'] = df_0['Cases'].rolling(window=7).mean()

    return df_0
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

description: transform the input data frames to include fields "Seattle Temp" and "Atlanta Temp"
expectedFields: ["Seattle Temp", "Atlanta Temp"]}

[OUTPUT]

```python
import pandas as pd

def transform_data(df_0):
    # Pivot the data to have the city names as columns
    pivoted_data = df_0.pivot_table(
        index='Date', columns='City',
        values='Temperature')

    # Rename the column names to 'Atlanta Temp' and 'Seattle Temp'
    pivoted_data = pivoted_data.rename(
        columns={
            'Atlanta': 'Atlanta Temp',
            'Seattle': 'Seattle Temp'})

    return pivoted_data
```
'''

class DataTransformationAgent(object):

    def __init__(self, client, model):
        self.client = client
        self.model = model

    def process_gpt_response(self, input_tables, messages, response):
        """process gpt response to handle execution"""

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Data transformation agent ===>\n")
            logger.info(choice.message.content + "\n")
            
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
                result = {'status': 'other error', 'content': 'unable to extract code from response'}
            
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataTransformationAgent'
            candidates.append(result)

        return candidates
    
    def try_enrich_output(self, input_tables, output_fields: list[str], candidates, log):

        response_message = log['response']['choices'][0]['message']
        prev_dialog = [*log['messages'], {"role": response_message['role'], 'content': response_message['content']}]

        return self.followup(input_tables, prev_dialog, output_fields, "include other fields", enrich_attempt=False)


    def run(self, input_tables, description, expected_fields: list[str], n=1, enrich_attempt=True):

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\ndescription: {description}\nexpectedFields: {str(expected_fields)}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model, messages = messages, temperature=0.7, max_tokens=1200,
            top_p=0.95, n=n, frequency_penalty=0, presence_penalty=0, stop=None)
        
        return self.process_gpt_response(input_tables, messages, response)

        #return self.try_enrich_output(input_tables, expected_fields, candidates, log)
        

    def followup(self, input_tables, dialog, output_fields: list[str], new_instruction: str, n=1, enrich_attempt=True):
        """extend the input data (in json records format) to include new fields"""
        output_fields_str = ", ".join([f"\"{name}\"" for name in output_fields])
        
        if len(output_fields) > 0:
            output_fields_instr = f"\n\nThe output data frame should include fields {output_fields_str}."
        else:
            output_fields_instr = ""

        messages = [*dialog, {"role":"user", 
                              "content": "Update the code above based on the following instruction:\n\n" + new_instruction + output_fields_instr}]

        ##### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=0.7, max_tokens=1200,
            top_p=0.95, n=n, frequency_penalty=0, presence_penalty=0, stop=None)
        
        logger.info(response)
        
        # if enrich_attempt:
        #     return self.try_enrich_output(input_tables, output_fields, candidates, log)
        # else:
        #     return candidates, log 
        
        return self.process_gpt_response(input_tables, messages, response)