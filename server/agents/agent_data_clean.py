# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import pandas as pd

from agents.agent_utils import extract_json_objects, generate_data_summary, extract_code_from_gpt_response, field_name_to_ts_variable_name, infer_ts_datatype
import py_sandbox
import traceback

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to generate or clean the raw input into a *csv block* (or tsv if that's the original format). 
The output csv format should be readable into a python pandas dataframe directly.

Create [OUTPUT] based on [RAW DATA] provided. The output should have two components:

1. a csv codeblock that represents the cleaned data, as follows:

```csv
.....
```

2. a json object that explains the mode and cleaning rationale (wrap in a json block):

```json
{
    "mode": ..., // one of "data generation" or "data cleaning" based on the provided task
    "reason": ... // explain the cleaning reason here
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
* clean up columns with messy information
    - if a column is number but some cells has annotations like "*" "?" or brackets, clean them up.
    - you don't need to convert format of the cell.
* if the user asks about generating synthetic data:
    - NEVER generate data that has implicit bias as noted above, if that happens, return a dummy data consisting of dummy columns with 'a, b, c' and numbers.
    - NEVER generate data contain people's names, use "A" , "B", "C"... instead. 
    - If the user doesn't indicate how many rows to be generated, plan in generating a dataset with 10-20 rows depending on the content.
'''

EXAMPLE = '''
[RAW DATA]

Dates	Samplei	Pollster	Sponsor	Result	Net result
Polls ending today
President: general election, 2024Icon indicating this set of polls has an average.
AVG.
Sept. 22-26
1,735	LV	
Outward Intelligence
Harris	51%	45%	Trump	More	Harris	+6
Sept. 22-26
1,735	LV	
Outward Intelligence
Harris	53%	47%	Trump	 	Harris	+6
Sept. 25, 2024
Joe Biden ApprovalIcon indicating this set of polls has an average.
AVG.
Sept. 23-25
1,005	LV	
Echelon Insights
Approve	43%	55%	Disapprove	 	Disapprove	+12
Sept. 23-25
1,524	LV	
Big Village
Approve	46%	52%	Disapprove	 	Disapprove	+6
Sept. 23-25
1,663	RV	
Big Village
Approve	46%	51%	Disapprove	 	Disapprove	+5
Sept. 23-25
2,021	A	
Big Village
Approve	44%	50%	Disapprove	 	Disapprove	+6

[OUTPUT]

'''

class DataCleanAgent(object):

    def __init__(self, client, model):
        self.model = model
        self.client = client

    def run(self, raw_data):
        """derive a new concept based on the raw input data
        """
   
        user_query = f"[DATA]\n\n{raw_data}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.chat.completions.create(
            model=self.model, messages = messages, temperature=0.7, max_tokens=1200,
            top_p=0.95, n=1, frequency_penalty=0, presence_penalty=0, stop=None)

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