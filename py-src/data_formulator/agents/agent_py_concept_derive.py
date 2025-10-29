# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import time
import json

from data_formulator.agents.agent_utils import generate_data_summary, extract_code_from_gpt_response
import data_formulator.py_sandbox as py_sandbox

import traceback

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to derive new column based on existing columns in a dataset.
Your job is to write a python function based on input data summary, instruction and output column name.
Complete a python function based off the [CONTEXT], [TEMPLATE] and [GOAL] provided, the function's input arguments is a dataframe, and the new column derived from the dataframe is returned.
The function should be as simple as possible. 

Allowed imports, if you need any of them, import yourself, otherwise, do not import (other libraries will be blocked):
- pandas (import pandas as pd is always included)
- numpy
- math
- datetime
- json
- statistics
- random
- collections
- re
- itertools
- functools
- operator

[TEMPLATE]

```python
import pandas as pd
import re
import datetime

def derive_new_column(df):
    # complete code here
    return col
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

{
    "input_fields": ["Date"],
    "output_field": "month",
    "description": "extract month from Date"
}

[OUTPUT]

```python
import re  
import datetime  
  
def derive_new_column(df):  
    df['month'] = df['Date'].apply(lambda x: datetime.datetime.strptime(x, '%m/%d/%Y').month)  
    return df['month']  
```
'''


class PyConceptDeriveAgent(object):

    def __init__(self, client, exec_python_in_subprocess=False):
        self.client = client
        self.exec_python_in_subprocess = exec_python_in_subprocess

    def run(self, input_table, input_fields, output_field, description):
        """derive a new concept based on input table, input fields, and output field name, (and description)
        """
        
        data_summary = generate_data_summary([input_table], include_data_samples=True)

        objective = {
            "input_fields": input_fields,
            "output_field": output_field,
            "description": description
        }
        
        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{objective}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        time_start = time.time()
        ###### the part that calls open_ai
        response = self.client.get_completion(messages = messages)
        time_end = time.time()
        logger.info(f"time taken to get response: {time_end - time_start} seconds")

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Python Data Derive Agent ===>\n")
            logger.info(choice.message.content + "\n")

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]
                try:
                    result =  py_sandbox.run_derive_concept(code_str, output_field, input_table['rows'], self.exec_python_in_subprocess)

                    if result['status'] == 'ok':
                        result['content'] = {
                            'rows': json.loads(result['content'].to_json(orient='records')),
                        }
                    else:
                        print(result['content'])
                    result['code'] = code_str
                except Exception as e:
                    print('other error:')
                    error_message = traceback.format_exc()
                    print(error_message)
                    result = {'status': 'other error', 'content': error_message}
            else:
                result = {'status': 'other error', 'content': 'unable to extract code from response'}

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'PyConceptDeriveAgent'
            candidates.append(result)

        time_end = time.time()
        logger.info(f"time taken to get candidates: {time_end - time_start} seconds")

        return candidates