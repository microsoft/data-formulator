# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
import sys
import pandas as pd

APP_ROOT = os.path.abspath('..')
sys.path.append(os.path.abspath(APP_ROOT))

from data_formulator.agents.agent_utils import generate_data_summary, field_name_to_ts_variable_name, extract_code_from_gpt_response, infer_ts_datatype

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to derive new column based on existing columns in a dataset.
Your job is to write a typescript function based on input data summary, instruction and output column name.
Complete a typescript function based off the [CONTEXT], [TEMPLATE] and [GOAL] provided, the function's input arguments are values from input columns, and the output is a value for the output column.
The function only operates on primitive types and it will be used by a map() function later to generate the new column.
The function should be as simple as possible. 

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

[TEMPLATE]

```typescript
(date : string) => {
    // complete code here
    return month
}
```

[OUTPUT]

```typescript
(date: string) => {
    const month = new Date(date).getMonth() + 1;
    return month;
}
```

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

[TEMPLATE]

```typescript
//extract month from Date
(date : string) => {
    // complete code here
    return month
}
```

[OUTPUT]

```typescript
//extract month from Date
(date: string) => {
    const month = new Date(date).getMonth() + 1;
    return month;
}
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

[TEMPLATE]

```typescript
//Derive average grade from writing
(writing: number, reading: number, math: number) => {
    // complete code here
    return averageGrade
}
```

[OUTPUT]

```typescript
//Derive average grade from writing, reading, math, grade should be A, B, C, D, F
(writing: number, reading: number, math: number): string => {
  const average = (writing + reading + math) / 3;
  if (average >= 90) {
    return "A";
  } else if (average >= 80) {
    return "B";
  } else if (average >= 70) {
    return "C";
  } else if (average >= 60) {
    return "D";
  } else {
    return "F";
  }
}
```
'''

class ConceptDeriveAgent(object):

    def __init__(self, client):
        self.client = client

    def run(self, input_table, input_fields, output_field, description, n=1):
        """derive a new concept based on input table, input fields, and output field name, (and description)
        """
        
        data_summary = generate_data_summary([input_table], include_data_samples=True)

        input_fields_info = [{"name": name, "type": infer_ts_datatype(pd.DataFrame(input_table['rows']), name)} for name in input_fields]
        
        arg_string = ", ".join([f"{field_name_to_ts_variable_name(field['name'])} : {field['type']}" for field in input_fields_info])
        code_template = f"```typescript\n//{description}\n({arg_string}) => {{\n    // complete code here\n    return {field_name_to_ts_variable_name(output_field)}\n}}\n```"

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}\n\n[TEMPLATE]\n\n{code_template}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.get_completion(messages = messages)

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== cocept derive result ===>\n")
            logger.info(choice.message.content + "\n")

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "typescript")

            if len(code_blocks) > 0:
                result = {'status': 'ok', 'code': code_blocks[-1]}
            else:
                result = {'status': 'other error', 'content': 'unable to extract code from response'}
            
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'ConceptDeriveAgent'

            candidates.append(result)

        return candidates