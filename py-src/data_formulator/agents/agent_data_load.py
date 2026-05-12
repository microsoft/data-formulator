# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary
from data_formulator.agents.agent_diagnostics import AgentDiagnostics
from data_formulator.agents.semantic_types import (
    generate_semantic_types_prompt,
)

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user infer data types based off the table provided by the user.
Given a dataset provided by the user, 
1. suggest a descriptive name for the table if the table name is a generic name like table-6, the suggested name should best capture meaning of the table but also very concise.
    - if the table already have a descriptive name provided in the bracket (...), use it; if the provided name is not descriptive, suggest a new name.
    - use Title Case with spaces, like naming a sheet in Excel or Tableau (e.g., "Income", "Seattle Weather", "US Trade Balance")
    - think like a data analyst: name the table by what it contains, not how it was made.
    - good names: "Monthly Sales", "Stock Prices", "Survey Responses", "US GDP Quarterly"
    - bad names: "data", "result", "table1", "d_weekly_fuel_prices", "raw-data-filtered"
    - aim for 2-4 words, no more than 24 characters. Be smart with abbreviations but keep it readable.
2. identify their type and semantic type
3. provide a very short summary of the dataset.

Types to consider include: string, number, date, datetime, time, duration

''' + generate_semantic_types_prompt() + '''

Enriched annotation fields (optional — provide when applicable):

- "intrinsic_domain": [min, max] — the known scale bounds of the measurement instrument.
    - Infer from data values and context: e.g., if a "rating" column has values 1-10, the domain is [1, 10]; if it's clearly a 5-star system, use [1, 5].
    - For Percentage: [0, 100] if values are whole-number percentages, [0, 1] if fractional.
    - For Correlation: always [-1, 1].
    - Do NOT provide for open-ended measures like Amount, Count, Quantity, Temperature, etc.
    - Only provide when the scale bounds are clear from the data or domain knowledge.
- "unit": a short unit string for physical/monetary quantities.
    - Temperature: "°C", "°F", "K"
    - Physical: "kg", "km", "mph", "m²", "L", etc.
    - Currency: "USD", "EUR", "¥", etc.
    - Duration: "ms", "s", "min", "hr"
    - Only provide when the unit is clear from column name, data values, or context.

Sort order:

- if the field is string type and is ordinal, provide the natural sort order of the fields here.
    - examples: English month name, week name, range, etc.
- when the natural sort order is alphabetical or there is not natural sort order, there is no need to generate sort_order, examples:
    - Name, State, City, etc.

Create a json object function based off the [DATA] provided.

output should be in the format of:

```json
{
    "suggested_table_name": ..., // the name of the table
    "fields": {
        "field1": {"type": ..., "semantic_type": ..., "sort_order": [...], "intrinsic_domain": [...], "unit": ...},
        // replace field1 field2 with actual field names
        // only include sort_order if the field is ordinal with inherent order
        // only include intrinsic_domain if the field has a known bounded scale
        // only include unit if the unit is clear from context
        "field2": {"type": ..., "semantic_type": ...},
        ...
    },
    "data_summary": ... // a short summary of the data (50-100 words), should capture the key characteristics of the data
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
    "suggested_table_name": "income",
    "fields": {
        "name": {"type": "string", "semantic_type": "State"},
        "region": {"type": "string", "semantic_type": "Region", "sort_order": ["northeast", "midwest", "south", "west", "other"]},
        "state_id": {"type": "number", "semantic_type": "ID"},
        "pct": {"type": "number", "semantic_type": "Percentage", "intrinsic_domain": [0, 1]},
        "total": {"type": "number", "semantic_type": "Count"},
        "group": {"type": "string", "semantic_type": "Range", "sort_order": ["<10000", "10000 to 14999", "15000 to 24999", "25000 to 34999", "35000 to 49999", "50000 to 74999", "75000 to 99999", "100000 to 149999", "150000 to 199999", "200000+"]}
    },
    "data_summary": "Income distribution across US states, with percentage and count by income bracket."
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

```json
{  
    "suggested_table_name": "weather",
    "fields": {  
        "Date": {  
            "type": "string",  
            "semantic_type": "Date"  
        },  
        "City": {  
            "type": "string",  
            "semantic_type": "City"  
        },  
        "Temperature": {  
            "type": "number",  
            "semantic_type": "Temperature",  
            "unit": "°F"  
        }  
    },  
    "data_summary": "Daily temperature data comparing Seattle and Atlanta throughout 2020, recording daily temperature measurements for each city from January to September."
}
```'''

class DataLoadAgent(object):

    def __init__(self, client, workspace, language_instruction="", model_info=None):
        self.client = client
        self.workspace = workspace
        self.language_instruction = language_instruction

        self.system_prompt = SYSTEM_PROMPT
        if language_instruction:
            self.system_prompt = self.system_prompt + "\n\n" + language_instruction

        self._diag = AgentDiagnostics(
            agent_name="DataLoadAgent",
            model_info=model_info or {},
            base_system_prompt=SYSTEM_PROMPT,
            language_instruction=language_instruction,
            assembled_system_prompt=self.system_prompt,
        )

    def run(self, input_data, n=1):

        # Always use the unified generate_data_summary approach
        # For virtual tables, workspace will find them; for in-memory tables, it uses rows
        data_summary = generate_data_summary(
            [input_data],
            workspace=self.workspace,
            include_data_samples=True,
            field_sample_size=15,
            row_sample_size=5,
            sample_char_limit=4000,
        )

        user_query = f"[DATA]\n\n{data_summary}\n\n[OUTPUT]"

        logger.debug(user_query)
        logger.info(f"[DataLoadAgent] run start")

        messages = [{"role":"system", "content": self.system_prompt},
                    {"role":"user","content": user_query}]
        
        response = self.client.get_completion(messages = messages)

        candidates = []
        for choice in response.choices:
            
            logger.debug("\n=== Data load result ===>\n")
            logger.debug(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            logger.debug(json_blocks)
            
            if len(json_blocks) > 0:
                result = {'status': 'ok', 'content': json_blocks[0]}
            else:
                try:
                    json_block = json.loads(choice.message.content + "\n")
                    result = {'status': 'ok', 'content': json_block}
                except (json.JSONDecodeError, ValueError, TypeError):
                    result = {'status': 'other error', 'content': 'unable to extract script from response', 'content_code': 'agent.unableExtractScript'}
            
            # individual dialog for the agent
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataLoadAgent'
            result['diagnostics'] = self._diag.for_json_only(
                messages,
                raw_content=choice.message.content,
                finish_reason=getattr(choice, 'finish_reason', None),
            )

            candidates.append(result)

        status = candidates[0].get('status', '?') if candidates else 'empty'
        logger.info(f"[DataLoadAgent] run done | status={status}")
        return candidates