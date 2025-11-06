# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from data_formulator.agents.agent_utils import extract_json_objects
from data_formulator.agents.web_utils import download_html_content

import logging
import re
import json
import traceback

logger = logging.getLogger(__name__)


def parse_table_sections(text):
    """Parse [TABLE_START] to [TABLE_END] sections and extract metadata and content."""
    tables = []
    
    # Split by [TABLE_START] and process each section
    sections = text.strip().split('[TABLE_START]')

    print(sections)
    
    for i, section in enumerate(sections[1:], 1):  # Skip first empty section
        
        # Find the end of this table section
        if '[TABLE_END]' not in section:
            continue
            
        table_section = section.split('[TABLE_END]')[0]

        metadata_index = table_section.find('[METADATA]')
        content_index = table_section.find('[CONTENT]')
        
        # Extract metadata between [METADATA] and ```
        if metadata_index != -1 and content_index != -1:
            metadata_block = table_section[metadata_index + len('[METADATA]'):content_index]
            metadata_json = extract_json_objects(metadata_block)[0]
            
        # Extract content between [CONTENT] and end
        if content_index != -1:
            content_block = table_section[content_index + len('[CONTENT]'):].strip()
            
            # Create table object
            table = {
                "name": metadata_json.get('name', 'unknown'),
                "context": metadata_json.get('context', ''),
                "content": {
                    "type": metadata_json.get('type', 'csv'),
                    "value": content_block
                }
            }
            
            tables.append(table)
    
    return tables


SYSTEM_PROMPT = '''You are a data scientist to help user to generate, extract data from image, or clean a text input into a structured csv table. 

If there are multiple tables in the raw data, you should extract them all.
Each table can either be a csv block or a url (url of an image that you think contains data).
- csv block: a string of csv content (if the content is already available from the input)
- image url: link to an image that contains data

Based on the raw data provided by the user, extract tables: 
- each extracted table should be wrapped in a section, its metadata is a json object describes its name and type in [METADATA] section.
- if the table is a csv block, it should be wrapped in [CONTENT] tags. Do not wrap it in any other tags, just write plain csv content in the [CONTENT].
- if the table is an image url, [CONTENT] should be the url.
- when there are multiple tables, generate one table at a time.

Output only extract tables, no other text should be included. Format:

[TABLE_START]

[METADATA]

```json
{
    "name": "...", // suggest a descriptive, meaningful but short name for this dataset, no more than 3 words, if there are duplicate names, add a suffix -1, -2, etc. (e.g., "sales-2024", "customer-survey", "weather-forecast")
    "type": "csv" | "image_url",
    "context": "..." // a short paragraph describing the context of the table -- what is the table about? Any additional information that helps the user understand the table. (no more than 50 words)
}
```

[CONTENT]

... // the csv block or image url, directly output the content, no other text should be included and don't wrap it in any other tags.

[TABLE_END]

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.

**Multiple tables:**
- if the raw data contains multiple tables, based on the user's instruction to decide which table to extract.
- if the user doesn't specify which tables to extract, extract all tables.
- if there are multiple tables yet they can be too large, only extract up to 200 rows for each table.

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

**Instructions for creating image url:**
- based on the context provided in the prompt and raw input material, decide which url in the raw data may cotain the data we would like to extract (like an image contains structured data).

**Instructions for generating synthetic data:**
- NEVER generate data that has implicit bias as noted above, if that happens, neutralize the data.
- If the user doesn't indicate how many rows to be generated, plan in generating a dataset with 20-30 rows depending on the content.

**IMPORTANT:**
- when the user provide an image and ask to extract data, you should extract data from the image into a csv block.
- get all tables that contain structured data from the raw data, including the csv blocks and image urls.
'''


EXAMPLE = '''
Rank	NOC	Gold	Silver	Bronze	Total
1	 South Korea	5	1	1	7
2	 France*	0	1	1	2
 United States	0	1	1	2
4	 China	0	1	0	1
 Germany	0	1	0	1
6	 Mexico	0	0	1	1
 Turkey	0	0	1	1
Totals (7 entries)	5	5	5	15
'''

class DataCleanAgentStream(object):

    def __init__(self, client):
        self.client = client

    def stream(self, prompt, artifacts=[], dialog=[]):
        """derive a new concept based on the raw input data
        Args:
            prompt (str): the prompt to the agent
            artifacts (list): the artifacts to the agent of format 
            [{"type": "image_url", "content": ...}, {"type": "web_url", "content": ...}, ...]
            dialog (list): the dialog history
        Returns:
            generator: the result of the agent
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
            'text': f'''{prompt}'''
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
        stream = self.client.get_completion(messages = messages, stream=True)

        accumulated_content = ""
        
        for part in stream:
            if hasattr(part, 'choices') and len(part.choices) > 0:
                delta = part.choices[0].delta
                if hasattr(delta, 'content') and delta.content:
                    accumulated_content += delta.content
                    
                    # Stream each character for real-time display as JSON
                    yield delta.content
        
        # Parse the final content the same way as the non-streaming version
        logger.info("\n=== Python Data Clean Agent Stream ===>\n")
        logger.info(accumulated_content + "\n")

        # Parse table sections from the accumulated content
        tables = parse_table_sections(accumulated_content)

        if len(tables) > 0:
            # Use the same format as non-streaming version - return the parsed data directly
            result = {
                'status': 'ok', 
                'content': tables, 
            }
        else:
            result = {'status': 'other error', 'content': 'unable to extract tables from response'}

        result['dialog'] = [*messages, {"role": "assistant", "content": accumulated_content}]
        result['agent'] = 'DataCleanAgentStream'
        
        # add a newline to the beginning of the result to separate it from the previous result     
        yield '\n' + json.dumps(result) + '\n'