# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from data_formulator.agents.agent_utils import extract_json_objects
from data_formulator.agents.web_utils import download_html_content

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to generate, extract data from image or clean a text input into a structured csv table. 
The output should contain the rationale for the extraction and cleaning process. If there are multiple tables in the raw data, you should extract them all and return them as a list of csv blocks.
Each table can either be a csv block or a url (image url or file url of an image).
- csv block: a string of csv content (if the content is already available from the input)
- image url: link to an image that contains the table (if the data exists but cannot be directly obtained from raw input text, which will be converted to a csv block later)
- web url: link to a file, which can be a csv, tsv, txt, or a json file that contains the data (which will be converted to a csv block later), it should not be another html page.

Create [OUTPUT] based on [RAW DATA] provided. The output should be in the following formats:

a json object that explains tables in the raw data, cleaning rationale, and suggests a descriptive name for each dataset (wrap in a json block):

```json
{
    "tables": [
        {
            "name": ..., // suggest a descriptive, meaningful but short name for this dataset, no more than 3 words, if there are duplicate names, add a suffix -1, -2, etc. (e.g., "sales-2024", "customer-survey", "weather-forecast")
            "description": ..., // describe the table in a few sentences, including the table structure, the cleaning process, and the rationale for the cleaning.
            "reason": ..., // explain the extraction reason here, including the table structure, the cleaning process, and the rationale for the cleaning.
            "content": {
                "type": "csv" | "image_url" | "web_url",
                "value": ... // the csv block as a string or image url or web url
            }
        }
    ],
}
```

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, just copy the original data and return in the block

**Multiple tables:**
- if the raw data contains multiple tables, based on the user's instruction to decide which table to extract.
- if the user doesn't specify which tables to extract, extract all tables.
- if there are multiple tables yet they can be too large, only extract the first 200 rows for each table.

**Instructions for creating csv blocks:**
* the output should be a structured csv table: 
    - if the raw data is unstructured, structure it into a csv table. If the table is in other formats, transform it into a csv table.
    - if the raw data contain other informations other than the table (e.g., title, subtitle, footer, summary, etc.), remove surrounding texts that does not belong to the table, so that the table conforms to csv format. 
    - if the raw data contains multiple levels of header, make it a flat table. It's ok to combine multiple levels of headers to form the new header to not lose information.
    - the csv table should have the same number of cells for each line, according to the header. If there are some rows with missing values, patch them with empty values.
    - if the header row misses some columns, add their corresponding column names. E.g., when the header doesn't have an index column, but every row has an index value, add the missing column header.
* clean up messy column names:
    - if the column name contains special characters like "*", "?", "#", "." remove them.
* csv value format:
    - if a column is number but some cells has annotations like "*" "?" or brackets, clean them up.
    - if values of a column is all numbers but has units like ($, %, s), remove the unit in the value cells, convert them to number, note unit in the header of this column.
    - you don't need to convert format of the cell.

**Instructions for creating image url or web url:**
- based on the context provided in the prompt and raw input material, decide which url in the raw data may cotain the data we would like to extract. put the url of the data in the "image_url" field.
- similarly, if the raw data contains link to a website that directly contains the data (e.g., it points to a csv file), put the url of the data in the "web_url" field.

**Instructions for generating synthetic data:**
- NEVER generate data that has implicit bias as noted above, if that happens, neutralize the data.
- If the user doesn't indicate how many rows to be generated, plan in generating a dataset with 20-30 rows depending on the content.
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

    def run(self, prompt, artifacts=[], dialog=[]):
        """derive a new concept based on the raw input data
        Args:
            prompt (str): the prompt to the agent
            artifacts (list): the artifacts to the agent of format 
            [{"type": "image_url", "content": ...}, {"type": "web_url", "content": ...}, ...]
            dialog (list): the dialog history
        Returns:
            dict: the result of the agent
        """

        content = []

        for artifact in artifacts:
            if artifact['type'] == 'image_url':
                content.append({
                    'type': 'image_url',
                    'image_url': {
                        "url": artifact['content'],
                        "detail": "high"
                    }
                })
            elif artifact['type'] == 'web_url':
                try:
                    content.append({
                        'type': 'text',
                        'text': f"[HTML CONTENT]\n\n{download_html_content(artifact['content'])}"
                    })
                except Exception as e:
                    raise Exception('unable to download html from url ' + artifact['content'])
        
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

            data_blocks = extract_json_objects(choice.message.content + "\n")

            if len(data_blocks) > 0:
                data_block = data_blocks[-1]
                result = {
                    'status': 'ok', 
                    'content': data_block.get('tables', []), 
                }
            else:
                result = {'status': 'other error', 'content': 'unable to extract code from response'}

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'DataCleanAgent'
            candidates.append(result)

        return candidates