# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import pandas as pd

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary, extract_code_from_gpt_response, field_name_to_ts_variable_name, infer_ts_datatype

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to generate or clean the raw input into a *csv block* (or tsv if that's the original format). 
The output csv format should be readable into a python pandas dataframe directly.

Create [OUTPUT] based on [RAW DATA] provided. The output should have two components:

1. a csv codeblock that represents the cleaned data, as follows:

```csv
.....
```

2. a json object that explains the mode, cleaning rationale, and suggests a descriptive name for the dataset (wrap in a json block):

```json
{
    "mode": ..., // one of "data generation" or "data cleaning" based on the provided task
    "reason": ..., // explain the cleaning reason here
    "suggested_name": ... // suggest a descriptive, meaningful name for this dataset (e.g., "sales_data_2024", "customer_survey_results", "weather_forecast_data")
}
```

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, just copy the original data and return in the block

The cleaning process must follow instructions below:
* the output should be a structured csv table: 
    - if the raw data is unstructured, structure it into a csv table. If the table is in other formats, transform it into a csv table.
    - if the raw data contain other informations other than the table, remove surrounding texts that does not belong to the table. 
    - if the raw data contains multiple levels of header, make it a flat table. It's ok to combine multiple levels of headers to form the new header to not lose information.
    - if the table has footer or summary row, remove them, since they would not be compatible with the csv table format.
    - the csv table should have the same number of cells for each line, according to the title. If there are some rows with missing values, patch them with empty cells.
    - if the raw data has some rows that do not belong to the table, also remove them (e.g., subtitles in between rows) 
    - if the header row misses some columns, add their corresponding column names. E.g., when the header doesn't have an index column, but every row has an index value, add the missing column header.
* clean up messy column names:
    - if the column name contains special characters like "*", "?", "#", "." remove them.
* clean up columns with messy information
    - if a column is number but some cells has annotations like "*" "?" or brackets, clean them up.
    - if a column is number but has units like ($, %, s), convert them to number (make sure unit conversion is correct when multiple units exist like minute and second) and include unit in the header.
    - you don't need to convert format of the cell.
* if the user asks about generating synthetic data:
    - NEVER generate data that has implicit bias as noted above, if that happens, return a dummy data consisting of dummy columns with 'a, b, c' and numbers.
    - NEVER generate data contain people's names, use "A" , "B", "C"... instead. 
    - If the user doesn't indicate how many rows to be generated, plan in generating a dataset with 10-20 rows depending on the content.
'''



EXAMPLE = '''
[RAW DATA]

Rank	NOC	Gold	Silver	Bronze	Total
1	 South Korea	5	1	1	7
2	 France*	0	1	1	2
 United States	0	1	1	2
4	 China	0	1	0	1
 Germany	0	1	0	1
6	 Mexico	0	0	1	1
 Turkey	0	0	1	1
Totals (7 entries)	5	5	5	15

[OUTPUT]

'''

class DataCleanAgent(object):

    def __init__(self, client):
        self.client = client

    def run(self, prompt, artifacts=None, dialog=None):
        """derive a new concept based on the raw input data
        """
   
        # Handle both single image (string) and multiple images (list)
        if isinstance(artifacts, str):
            # Single image - convert to list for consistent processing
            image_urls = [artifacts]
        elif isinstance(artifacts, list):
            # Multiple images
            image_urls = artifacts
        else:
            # Fallback to empty list
            image_urls = []

        # Build content array with text and images
        content = [{'type': 'text', 'text': '''[RAW_DATA]\n\n'''}]
        
        # Add all images
        for image_url in image_urls:
            content.append({
                'type': 'image_url',
                'image_url': {
                    "url": image_url,
                    "detail": "high"
                }
            })
        
        # Add closing text
        content.append({
            'type': 'text',
            'text': f'''[INSTRUCTION]\n\n{prompt}\n\n[OUTPUT]\n'''
        })

        user_prompt = {
            'role': 'user',
            'content': content
        }

        logger.info(user_prompt)

        system_message = {
            'role': 'system',
            'content': [ {'type': 'text', 'text': SYSTEM_PROMPT}]
        }

        messages = [
            system_message, 
            *[message for message in dialog if message['role'] != 'system'],
            user_prompt
        ]
        
        ###### the part that calls open_ai
        response = self.client.get_completion(messages = messages)

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Python Data Clean Agent ===>\n")
            logger.info(choice.message.content + "\n")

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "csv")
            reason_blocks = extract_json_objects(choice.message.content + "\n")

            if len(code_blocks) > 0:
                result = {
                    'status': 'ok', 
                    'content': code_blocks[-1], 
                    'info': reason_blocks[-1] if len(reason_blocks) > 0 else {"reason": "no reason presented", "mode": "data cleaning"}
                }
            else:
                result = {'status': 'other error', 'content': 'unable to extract code from response'}

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataCleanAgent'
            candidates.append(result)

        return candidates