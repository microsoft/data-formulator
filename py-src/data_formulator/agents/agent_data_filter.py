# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import generate_data_summary, extract_code_from_gpt_response
import data_formulator.py_sandbox as py_sandbox

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to filter data based on user description.
Your job is to write a python function that will be applied to filter the input data, based on on input data summary, instruction and output column name.
Complete a python function based off [TEMPLATE], and [CONTEXT], [GOAL] provided for each task, 
    the function's input arguments include row (the row being tested whether to be filtered) and df (the full input dataset that will be helpful for computation), 
    and the output is a boolean result True/False deciding whether the row will be kept (True) or removed (False).
The function will be applied to every row of df to generate the filtered dataset later.
The function should be as simple as possible, return the filter_row function only. 

[TEMPLATE]

```python
import re
import datetime
import pandas as pd
import numpy

def filter_row(row, df):
    # complete code here, decide whether the given row satisfy the filter condition or not
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

include only summer months

[OUTPUT]

```python
import re  
import datetime  
import pandas as pd  
import numpy  
  

def filter_row(row, df):  
    date_str = row['Date']  
    date = datetime.datetime.strptime(date_str, '%m/%d/%Y')  
    if date.month in [6, 7, 8]:  
        return True  
    else:  
        return False  
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

Show only students whose total scores are among top 30% of all students

[OUTPUT]

```python
import re    
import datetime    
import pandas as pd    
import numpy    
    
  
def filter_row(row, df):    
    math = row['math']    
    reading = row['reading']    
    writing = row['writing']    
    total_score = math + reading + writing    
    if total_score >= df[['math', 'reading', 'writing']].sum(axis=1).quantile(q=0.7):    
        return True    
    else:    
        return False    
```
'''


class DataFilterAgent(object):

    def __init__(self, client, model):
        self.client = client
        self.model = model

    def process_gpt_result(self, input_table, response, messages):
        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== python data filter results ===>\n")
            logger.info(choice.message.content + "\n")

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]
                try:
                    result =  py_sandbox.run_filter_data_in_sandbox2020(code_str, input_table['rows'])

                    if result['status'] == 'ok':
                        new_data = json.loads(result['content'])
                        result['content'] = new_data
                    else:
                        logger.info(result['content'])
                    result['code'] = code_str
                except Exception as e:
                    logger.warning('other error:')
                    logger.warning(str(e)[-1000:])
            else:
                result = {'status': 'other error', 'content': 'unable to extract code from response'}

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataFilterAgent'
            candidates.append(result)

        return candidates

    def run(self, input_table, description):
        """derive a new concept based on input table, input fields, and output field name, (and description)
        """
        
        data_summary = generate_data_summary([input_table], include_data_samples=True)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model, messages = messages, temperature=0.7, max_tokens=1200,
            top_p=0.95, n=1, frequency_penalty=0, presence_penalty=0, stop=None)

        return self.process_gpt_result(input_table, response, messages)

    def followup(self, input_table, dialog, new_instruction: str, n=1):
        """extend the input data (in json records format) to include new fields"""

        messages = [*dialog, {"role":"user", 
                              "content": new_instruction + '\nupdate the filter function accordingly'}]

        ##### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=0.7, max_tokens=1200,
            top_p=0.95, n=n, frequency_penalty=0, presence_penalty=0, stop=None)

        return self.process_gpt_result(input_table, response, messages)