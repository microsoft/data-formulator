# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary
from data_formulator.agents.agent_sql_data_transform import  sanitize_table_name, get_sql_table_statistics_str

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user infer data types based off the table provided by the user.
Given a dataset provided by the user, 
1. suggest a descriptive name for the table if the table name is a generic name like table-6, the suggested name should best capture meaning of the table but also very concise.
    - if the table already have a descriptive name provided in the bracket (...), use it; if the provided name is not descriptive, suggest a new name.
    - format table name using '-' when it contains multiple words (e.g., "income", "weather-seattle-atlanta")
    - the suggested table name should be similar to variable names that are very descriptive and concise, no more than 3 words.
    - the suggested name should best be within 12 characters, be smart with abbreviations (yet still descriptive and follow common practices), when in doubt, use less words but less abbreviation.
2. identify their type and semantic type
3. provide a very short summary of the dataset.

Types to consider include: string, number, date
Semantic types to consider include: Location, Decade, Year, Month, YearMonth, Day, Date, Time, DateTime, TimeRange, Range, Duration, Name, Percentage, String, Number


Sort order:

- if the field is string type and is ordinal, provide the natural sort order of the fields here.
    - examples: English month name, week name, range, etc.
- when the natural sort order is alphabetical or there is not natural sort order, there is no need to generate sort_order, examples:
    - Name, State, City, etc.

Special cases: 
* sometimes, column name is year like "2020", "2021" but its content is not actually year (e.g., sales), in these cases, the semantic type of the column would not be Year!

Create a json object function based off the [DATA] provided.

output should be in the format of:

```json
{
    "suggested_table_name": ..., // the name of the table
    "fields": {
        "field1": {"type": ..., "semantic_type": ..., "sort_order": [...]}, // replace field1 field2 with actual field names, if the field is string type and is ordinal, provide the natural sort order of the fields here 
        "field2": {"type": ..., "semantic_type": ...}, // no need to provide sort_order if there is no inherent order of the field values
        ...
    },
    "data summary": ... // a short summary of the data
}
```
'''

EXAMPLES = '''
[DATA]

Here are our datasets, here are their field summaries and samples:

table_0 (table_0) fields:
	name -- type: object, values: Alabama, Alaska, Arizona, Arkansas, California, Colorado, Connecticut, Delaware, District of Columbia, Florida, ..., South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming
	region -- type: object, values: midwest, northeast, other, south, west
	state_id -- type: int64, values: 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, ..., 47, 48, 49, 50, 51, 53, 54, 55, 56, 72
	pct -- type: float64, values: 0.006, 0.008, 0.02, 0.021, 0.022, 0.024, 0.025, 0.026000000000000002, 0.027, 0.028, ..., 0.192, 0.193, 0.194, 0.196, 0.197, 0.199, 0.2, 0.201, 0.213, 0.289
	total -- type: int64, values: 222679, 250875, 256563, 268015, 291468, 326086, 337245, 405504, 410347, 449296, ..., 3522934, 3721358, 3815532, 4551497, 4763457, 4945140, 7168502, 7214163, 8965352, 12581722
	group -- type: object, values: 10000 to 14999, 100000 to 149999, 15000 to 24999, 150000 to 199999, 200000+, 25000 to 34999, 35000 to 49999, 50000 to 74999, 75000 to 99999, <10000

table_0 (table_0) sample:

```
|name|region|state_id|pct|total|group
0|Alabama|south|1|0.10200000000000001|1837292|<10000
1|Alabama|south|1|0.07200000000000001|1837292|10000 to 14999
2|Alabama|south|1|0.13|1837292|15000 to 24999
3|Alabama|south|1|0.115|1837292|25000 to 34999
4|Alabama|south|1|0.14300000000000002|1837292|35000 to 49999
......
```

[OUTPUT]

```json
{
    "fields": {
        "suggested_table_name": "income_json",
        "name": {"type": "string", "semantic_type": "Location", "sort_order": null},
        "region": {"type": "string", "semantic_type": "String", "sort_order": ["northeast", "midwest", "south", "west", "other"]},
        "state_id": {"type": "number", "semantic_type": "Number", "sort_order": null},
        "pct": {"type": "number", "semantic_type": "Percentage", "sort_order": null},
        "total": {"type": "number", "semantic_type": "Number", "sort_order": null},
        "group": {"type": "string", "semantic_type": "Range", "sort_order": ["<10000", "10000 to 14999", "15000 to 24999", "25000 to 34999", "35000 to 49999", "50000 to 74999", "75000 to 99999", "100000 to 149999", "150000 to 199999", "200000+"]}
    },
    "data summary": "The dataset contains information about income distribution across different states in the USA. It includes fields for state names, regions, state IDs, percentage of total income, total income, and income groups.",
}
```

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

```
{  
    "suggested_table_name": "weather_seattle_atlanta",
    "fields": {  
        "Date": {  
            "type": "string",  
            "semantic_type": "Date",  
            "sort_order": null  
        },  
        "City": {  
            "type": "string",  
            "semantic_type": "Location",  
            "sort_order": null  
        },  
        "Temperature": {  
            "type": "number",  
            "semantic_type": "Number",  
            "sort_order": null  
        }  
    },  
    "data_summary": "This dataset contains weather information for the cities of Seattle and Atlanta. The fields include the date, city name, and temperature readings. The 'Date' field represents dates in a string format, the 'City' field represents city names, and the 'Temperature' field represents temperature values in integer format.",
}```'''

class DataLoadAgent(object):

    def __init__(self, client, conn):
        self.client = client
        self.conn = conn

    def run(self, input_data, n=1):

        if input_data['virtual']:
            table_name = sanitize_table_name(input_data['name'])
            table_summary_str = get_sql_table_statistics_str(self.conn, table_name, row_sample_size=5, field_sample_size=30)
            data_summary = f"[TABLE {table_name}]\n\n{table_summary_str}"
        else:
            data_summary = generate_data_summary([input_data], include_data_samples=True, field_sample_size=30)

        user_query = f"[DATA]\n\n{data_summary}\n\n[OUTPUT]"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        response = self.client.get_completion(messages = messages)

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Data load result ===>\n")
            logger.info(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            logger.info(json_blocks)
            
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