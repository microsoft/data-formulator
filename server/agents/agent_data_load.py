# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from agents.agent_utils import extract_json_objects, generate_data_summary

SYSTEM_PROMPT = '''You are a data scientist to help user infer data types based off the table provided by the user.
Given a dataset provided by the user, identify their type and semantic type, and provide a very short summary of the dataset.

Types to consider include: string, number, date
Semantic types to consider include: Location, Year, Month, Day, Date, Time, DateTime, Duration, Name, Percentage, String, Number

Create a json object function based off the [DATA] provided.

[DATA]

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

[OUTPUT]

{
    "fields": {
        "Date": {"type": "date", "semantic_type": "Date"},
        "Cases": {"type": "number", "semantic_type": "Number"}
    },
    "data summary": "US covid 19 data from 2020 to 2022"
}

[DATA]

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

[OUTPUT]

{
    "fields": {
        "Date": {"type": "date", "semantic_type": "Date"},
        "City": {"type": "string", "semantic_type": "Location"},
        "Temperature": {"type": "number", "semantic_type": "Number"}
    },
    "data summary": "Seattle and Atlanta temperature in 2020"
}
'''

class DataLoadAgent(object):

    def __init__(self, client, model):
        self.client = client
        self.model = model

    def run(self, input_data, n=1):

        data_summary = generate_data_summary([input_data], include_data_samples=True)

        user_query = f"[DATA]\n\n{data_summary}\n\n[OUTPUT]"

        print(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=0.2, max_tokens=2400,
            top_p=0.95, n=n, frequency_penalty=0, presence_penalty=0, stop=None)

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        candidates = []
        for choice in response.choices:
            
            print(">>> Data load agent <<<\n")
            print(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            print(json_blocks)
            
            if len(json_blocks) > 0:
                result = {'status': 'ok', 'content': json_blocks[0]}
            else:
                try:
                    json_block = json.loads(choice.message.content + "\n")
                    result = {'status': 'ok', 'content': json_block}
                except:
                    result = {'status': 'other error', 'content': 'unable to extract VegaLite script from response'}
            
            # individual dialog for the agent
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataLoadAgent'

            candidates.append(result)

        return candidates