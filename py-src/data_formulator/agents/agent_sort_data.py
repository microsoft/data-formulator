# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
from data_formulator.agents.agent_utils import extract_json_objects

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to sort data.
The user will provide list of items in the form of a json object, and your goal is to sort the data in its natural order based on your knowledge.
Create an output json object with sorted data based off the [INPUT].

For example:

[INPUT]

{
    "name": "grades",
    "values": [">=60","10", "20", "30", "40", "50"]
}

[OUTPUT]

{
    "name": "grades",
    "sorted_values": ["10", "20", "30", "40", "50", ">=60"],
    "reason": "sort scores in ascending order"
}

[INPUT]

{
    "name": "month",
    "values": [ "April", "August", "December", "February", "January", "July", "June", "March", "May", "November", "October", "September" ]
}

[OUTPUT]

{
    "name": "month",
    "sorted_values": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    "reason": "sort months by their natural order"
}

[INPUT]

{
    "name": "month",
    "values": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
}

[OUTPUT]

{
    "name": "month",
    "sorted_values": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    "reason": "the input list is already ordered months naturally"
}
'''



class SortDataAgent(object):

    def __init__(self, client):
        self.client = client

    def run(self, name, values, n=1):

        input_obj = {
            'name': name,
            'value': values
        }

        user_query = f"[INPUT]\n\n{json.dumps(input_obj)}\n\n[OUTPUT]"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        ###### the part that calls open_ai
        response = self.client.get_completion(messages = messages)

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Sort data agent ===>\n")
            logger.info(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            
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
            result['agent'] = 'SortDataAgent'

            candidates.append(result)

        return candidates