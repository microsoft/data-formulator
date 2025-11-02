# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
import base64

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary
from data_formulator.agents.agent_sql_data_transform import get_sql_table_statistics_str, sanitize_table_name

logger = logging.getLogger(__name__)

FOLLOWUP_PROMPT = '''
You are a data exploration expert to suggest a follow-up analysis to help the user explore their data.
The user will provide you:
* in [CONTEXT] section, the input data the user is working with (every step is directly computed based on this input data).
* in [COMPLETED STEPS] section, the results of all completed analysis steps, it includes the code, data, and visualization (if provided).
* in [NEXT STEPS] section, the remaining analysis steps to be completed.

Your task is to interpret the current results, and decide:
- [present] to present findings to the user.
- [continue] to continue exploring:
    - to continue following remaining analysis steps in [NEXT STEPS] section.
    - to update the remaining analysis steps based on completed steps and original plans.

Guidelines:

[present] mode:

- You should stop present findings to the user if any of the following conditions are met:
    - There is no more remaining steps in [NEXT STEPS] section.
    - There are still some steps remaining in [NEXT STEPS] section but the current results are interesting enough to stop and present findings.
    - Current results are very ambiguous and deviate from the original plans.
    - The analysis is tunnel vision and not exploring the data in a comprehensive way.
- If you decide to present findings, you should format as follows:
    - set status to "present" and provide a breif summary of what you have explored in bullet points in 'summary' (very concise, no more than 3 bullet points, no more than 20 words).
    - if the question and the context mismatch or has confusion, set status to "warning" and explain very briefly why stop and what you need from the user in 'instruction' (make it very concise and polite with 'it looks like...').
- Output format (don't include any other text):

```json
{
    "status": "present|warning", // Decision on whether to present findings or warning 
    "summary": "...", // a string, a concise summary of the findings and insights (or why stop) in bullet points based on all analysis steps.
}
```

[continue] mode:

- Otherwise, you should continue exploring. First, you should decide whether you should follow the original plan or update it based on the current result.
    - Simply follow the original plan if the results are on the right track, and next steps look reasonable.
    - Otherwise, suggest new followup steps, especially when:
        - the previous result data doesn't answer the last question well
        - the visualization has some obvious problems, e.g., wrong axes, wrong labels, wrong data, etc.
        - the original plan dive too narrow into a specific area that seems unncessary with latest result.
        - there are some interesting questions that worth exploring but not included in the original plan.
- Guidelines for updating the plan:
    - Each step should be brief and concise.
    - The question should surface new insights, potentially requires a new computation or data transformation.
        - don't just switch field combinations in input tables or just project table with different fields (too trivial).
    - The question should be answerable with ONE visualization (e.g., bar|line|scatter|heatmap).
    - The instruction should hint which fields should be used for visualization.
        - note that these fields should be lead to long format data table.
        - e.g., if you want to visualize min max temperature trends over time, it should be a long format data table with columns: date, temperature, type where type is either 'min' or 'max' (instead of a wide format data table with columns: date, min_temperature, max_temperature).
    - Ideas for new steps (but not limited to these):
        - change a metric (e.g., count -> percentage if they make difference)
        - used a new derived field to group data in a different way (e.g., convert score -> grade, price -> price_bin, date -> month or year)
        - use different grouping methods to show trends in different levels (e.g., visualize sum of sales amount by region, group by more granular or more general categories, etc.)
        - filter the data to focus on the most interesting part:
            - show extreme values (e.g., top 10 customers, top 20 products by some metrics, etc.)
            - show items with certain properties (e.g., items with certain price range, countries in different regions, etc.)
            - filter items based on metrics (e.g., items with certain sales amount, etc.)
        - introduce new properties to categorize items (e.g., add indicators of "is_profitable", etc.)
        - show trends comparing difference between between two groups:
            - two groups that are often compared together (e.g., two competitors, two countries of interest, etc.)
            - the same item across different time periods (e.g., a product's sales amount at start and end of the period, etc.)
            - two time point that display unique trends (e.g., before and after a major event, etc.)
        - compute and visualize the difference.
        - use window functions to calculate rolling averages, moving averages, etc.
        - calculate rankings based on metrics and show rank changes over time
    - avoid transformations that cannot be calculated programmatically based on the input data, e.g., looking up zipcode, get continent
- Output format (don't include any other text):
    - output a json object with the following fields:
        - "status": "continue"
        - "next_steps": [] // list of steps to continue exploring, each step should be a string describing the analysis to be done.
            - the steps should either be copied from the original plan or be generated based on the current result.
            - if you choose to update the plan, the number of steps MUST STILL BE THE SAME as the original plan.

```json
{
    "status": "continue",
    "next_steps": [...], 
}
```
'''

class ExplorationAgent(object):

    def __init__(self, client, agent_exploration_rules="", db_conn=None):
        self.agent_exploration_rules = agent_exploration_rules
        self.client = client
        self.db_conn = db_conn

    def process_gpt_response(self, messages, response):
        """Process GPT response to extract exploration plan"""

        if isinstance(response, Exception):
            return [{'status': 'other error', 'content': str(response.body)}]
        
        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Exploration Planning Result ===>\n")
            logger.info(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            if not json_blocks:
                result = {
                    'status': 'error', 
                    'content': "No valid JSON found in response"
                }
            else:
                exploration_plan = json_blocks[0]
                result = {
                    "status": "ok",
                    "content": exploration_plan,
                }
            
            result['dialog'] = [*messages[1:], {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'ExplorationAgent'
            candidates.append(result)

        return candidates
    
    def get_chart_message(self, visualization):
        if not visualization:
            return {"type": "text", "text": "The visualization is not available."}
        if visualization.startswith('data:'):
            # Base64 data URL
            return {
                "type": "image_url",
                "image_url": {"url": visualization}
            }
        elif visualization.startswith('http'):
            # HTTP URL
            return {
                "type": "image_url", 
                "image_url": {"url": visualization}
            }
        else:
            return {"type": "text", "text": "The visualization is not available."}

    def get_data_summary(self, input_tables):
        if self.db_conn:
            data_summary = ""
            for table in input_tables:
                table_name = sanitize_table_name(table['name'])
                table_summary_str = get_sql_table_statistics_str(self.db_conn, table_name)
                data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"
        else:
            data_summary = generate_data_summary(input_tables)
        return data_summary
            
    def suggest_followup(self, input_tables, completed_steps: list[dict], next_steps: list[str]):
        """
        Interpret analysis results and decide whether to continue exploration or present findings
        
        Args:
            input_tables: the input tables the user is working with
            steps: the previous analysis results, it is a list of:
                - analysis question
                - the code, data, and visualization generated to answer this question
            
        Returns:
            the followup analysis based on the previous results
        """
        
        data_summary = self.get_data_summary(input_tables)

        # Prepare messages for the completion call
        messages = [
            {"role": "system", "content": FOLLOWUP_PROMPT + "\n\n[AGENT EXPLORATION RULES]\n" + self.agent_exploration_rules + "\n\nPlease follow the above agent exploration rules when suggesting followup steps."},
            {"role": "user", "content": f"[CONTEXT]\n\n{data_summary}"},
        ]

        for i,step in enumerate(completed_steps):
            code = step['code']
            if 'name' not in step['data'] or step['data']['name'] is None:
                step['data']['name'] = f'table-s-{i+1}'
            data = self.get_data_summary([step['data']])

            if step['visualization']:
                chart_message = self.get_chart_message(step['visualization'])
                
                # Create content array with text and image
                content = [
                    {"type": "text", "text": f"[COMPLETED STEP {i+1}] \n\n**Question**: {step['question']}\n\n **Code**:\n```{code}``` \n\n**Transformed Data Sample**:\n{data}\n\n**Visualization**:"}
                ]
                content.append(chart_message)
            else:
                content = [
                    {"type": "text", "text": f"[COMPLETED STEP {i+1}] \n\n**Question**: {step['question']}\n\n **Code**:\n```{code}``` \n\n**Transformed Data Sample**:\n{data}"}
                ]
            
            messages.append({"role": "user", "content": content})
        
        messages.append({"role": "user", "content": f"[NEXT STEPS]\n\n{json.dumps(next_steps, indent=4)}"})

        response = self.client.get_completion(messages)
        
        return self.process_gpt_response(messages, response)