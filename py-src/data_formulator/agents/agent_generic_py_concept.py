# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import generate_data_summary, extract_code_from_gpt_response
import data_formulator.py_sandbox as py_sandbox

import traceback

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to derive new column based on existing columns in a dataset.
Your job is to write a python function based on input data summary, instruction and output column name.
Complete a python function based off [TEMPLATE] and [CONTEXT], [GOAL] provided by the user, the function's input arguments is row (the current row) and df (the input data frame, it only has fields provided in [CONTEXT]), and the output is a value for the new column for the output column.
The function only operates on primitive types and it will be used with a map() function later to generate the new column for each row.
The function should be as simple as possible. 

[TEMPLATE]

```python
import re
import datetime

def derive(row, df):
    # complete code here
    return new_value
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

extract month from Date

[OUTPUT]

```python
import re  
import datetime  
  
def derive(row, df):  
    month = datetime.datetime.strptime(row['Date'], '%m/%d/%Y').month  
    return month  
```

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

Derive average grade from writing, reading, math, grade should be A, B, C, D, F

[OUTPUT]

```python
import re  
import datetime  
  
# Derive average grade from writing, reading, math, grade should be A, B, C, D, F  
def derive(row, df):  
    avg_score = (row['writing'] + row['reading'] + row['math']) / 3  
    if avg_score >= 90:  
        grade = 'A'  
    elif avg_score >= 80:  
        grade = 'B'  
    elif avg_score >= 70:  
        grade = 'C'  
    elif avg_score >= 60:  
        grade = 'D'  
    else:  
        grade = 'F'  
    return grade  
```

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

Rank students based on their average scores

[OUTPUT]

import re    
import datetime    
    
# Rank students based on their average scores  
def derive(row, df):    
    avg_score = (row['writing'] + row['reading'] + row['math']) / 3  
    rank = df.apply(lambda x: (x['writing'] + x['reading'] + x['math']) / 3, axis=1).rank(method='min', ascending=False).iloc[row.name]  
    return rank  
'''


class GenericPyConceptDeriveAgent(object):

    def __init__(self, client, model_version):
        self.client = client
        self.model_version = model_version

    def process_gpt_response(self, input_table, output_field, response, messages):
        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Generic Python Data Derive Agent ===>\n")
            logger.info(choice.message.content + "\n")

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]
                try:

                    exec_str = f'''
df = pd.DataFrame.from_records(table_rows)
app_func = lambda r: derive(r, df)
df["{output_field}"] = df.apply(app_func, axis = 1)
output = json.dumps(df.to_dict("records"))
#print(output)
'''

                    result = py_sandbox.run_data_process_in_sandbox(code_str, input_table['rows'], exec_str)

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
            result['agent'] = 'GenericPyConceptDeriveAgent'
            candidates.append(result)

        return candidates

    def run(self, input_table, output_field, description):
        """derive a new concept based on input table, input fields, and output field name, (and description)
        """
        
        data_summary = generate_data_summary([input_table], include_data_samples=True)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model_version, 
            messages = messages, temperature=0.7, max_tokens=1200,
            top_p=0.95, n=1, frequency_penalty=0, presence_penalty=0, stop=None)

        return self.process_gpt_response(input_table, output_field, response, messages)

    def followup(self, input_table, dialog, output_field: str, new_instruction: str, n=1):
        """extend the input data (in json records format) to include new fields"""

        messages = [*dialog, {"role":"user", 
                              "content": new_instruction + '\n update the function accordingly'}]

        ##### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=0.7, max_tokens=1200,
            top_p=0.95, n=n, frequency_penalty=0, presence_penalty=0, stop=None)

        candidates = self.process_gpt_response(input_table, output_field, response, messages)

        return candidates