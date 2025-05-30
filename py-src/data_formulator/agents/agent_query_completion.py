# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects
import re
import logging


logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help with data queries. 
The user will provide you with a description of the data source and tables available in the [DATA SOURCE] section and a query in the [USER INPUTS] section. 
You will need to help the user complete the query and provide reasoning for the query you generated in the [OUTPUT] section.

Input format:
* The data source description is a json object with the following fields:
    * `data_source`: the name of the data source
    * `tables`: a list of tables in the data source, which maps the table name to the list of columns available in the table.
* The user input is a natural language description of the query or a partial query you need to complete.

Steps:
* Based on data source description and user input, you should first decide on what language should be used to query the data. 
* Then, describe the logic for the query you generated in a json object in a block ```json``` with the following fields:
    * `language`: the language of the query you generated
    * `tables`: the names of the tables you will use in the query
    * `logic`: the reasoning behind why you chose the tables and the logic for the query you generated
* Finally, generate the complete query in the language specified in a code block ```{language}```.

Output format:
* The output should be in the following format, no other text should be included:

[REASONING]
```json
{
    "language": {language},
    "tables": {tables},
    "logic": {logic}
}
```

[QUERY]
```{language}   
{query}
```
'''

class QueryCompletionAgent(object):

    def __init__(self, client):
        self.client = client

    def run(self, data_source_metadata, query):

        user_query = f"[DATA SOURCE]\n\n{json.dumps(data_source_metadata, indent=2)}\n\n[USER INPUTS]\n\n{query}\n\n[REASONING]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.get_completion(messages = messages)
        response_content = '[REASONING]\n' + response.choices[0].message.content
        
        logger.info(f"=== query completion output ===>\n{response_content}\n")

        reasoning = extract_json_objects(response_content.split("[REASONING]")[1].split("[QUERY]")[0].strip())[0]
        output_query = response_content.split("[QUERY]")[1].strip()
        
        # Extract the query by removing the language markers
        language_pattern = r"```(\w+)\s+(.*?)```"
        match = re.search(language_pattern, output_query, re.DOTALL)
        if match:
            output_query = match.group(2).strip()

        return reasoning, output_query
