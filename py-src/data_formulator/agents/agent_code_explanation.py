# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import pandas as pd
from data_formulator.agents.agent_utils import generate_data_summary, extract_code_from_gpt_response

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user explain code, 
so that a non-code can clearly understand what the code is doing, you are provided with a summary of the input data, and the transformation code.
You should generate a good itemized explanation of the code so that the reader can understand high-level steps of what the data transformation is doing.
Be very concise, and stay at a high-level. The reader doesn't understand code and does not want to learn exactly what the code is doing. They just want to learn what have been done from a logical level.

The focus is to explain how new fields are computed, don't generate explanation for low-level actions like "return", "load data" etc. 

Format the transformation explanation in markdown format: highlight constants, data fields, and important verbs. Be sure to be concise.


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

[CODE]

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

[EXPLANATION]

1. **Sort** the data in chronological order based on the `Date` column.
2. **Calculate** the `7-day rolling average` of `Cases`.
'''

class CodeExplanationAgent(object):

    def __init__(self, client, model):
        self.client = client
        self.model = model

    def run(self, input_tables, code):

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[CODE]\n\here is the transformation code: {code}\n\n[EXPLANATION]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model, messages = messages, temperature=0.7, max_tokens=1200,
            top_p=0.95, n=1, frequency_penalty=0, presence_penalty=0, stop=None)
        
        logger.info('\n=== explanation output ===>\n')
        logger.info(response.choices[0].message.content)
        
        return response.choices[0].message.content
