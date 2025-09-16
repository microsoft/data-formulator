# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
import base64

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary

logger = logging.getLogger(__name__)

FOLLOWUP_PROMPT = '''
You are a data exploration expert to suggest a follow-up analysis to help the user explore their data.
The user will provide you:
* in [CONTEXT] section, the input data the user is working with
* in [STEPS] section, the previous analysis results, it is a list of:
    - analysis question
    - the code, data, and visualization (if provided) generated to answer this question

Your task is to analyze the current result and decide the next step.
You should follow the following format:

**Your Task:**
1. First, interpret what the transformed data and visualization reveal, refer to the context to understand the user's question and the current result.
2a. Decide whether it's time to stop exploring and present findings to the user.
    - Can you still suggest good followup questions that are not just incremntal minimal stuff on top of the current result?
    - Have we completed at least 2-3 analysis steps?
    - Do we have interesting insights to show the user?
    - be ready to wrap up when we have 4-5 analysis steps.
    - if you are ready to wrap up, set status to "present" and explain communicate a breif summary of what you have explored in bullet points in 'instruction' (very concise, no more than 3 bullet points).
    - if the question and the context mismatch, set status to "warning" and explain very briefly why stop and what you need from the user in 'instruction' (make it very concise and polite with 'it looks like...').
2b. Otherwise, let's continue exploring wiht a followup question.
    - Note that the new question should not lead to an easy incremental followup question. It needs to provide substantial new information.
    - The new followup question should be a non-trivial question build on top of the current one, it should create a distinct new data with new information (with data transformation). 
        - don't just switch field combinations in input tables or just project table with different fields
        - if there is no new data transformation you can think of, set status to "present" and explain why.
    - the question should be answer based with a data and a visualization (e.g., bar|line|scatter|heatmap that shows trends and insights).
        - provide hint in the instruction so that transformation result should be in a long format data table suitable for visualization
        - e.g., if you want to visualize min max temperature trends over time, it should be a long format data table with columns: date, temperature, type where type is either 'min' or 'max' (instead of a wide format data table with columns: date, min_temperature, max_temperature).
    - Consider:
        - change a metric (e.g., count -> percentage if they make difference)
        - use a different statistical model that is more suitable (e.g., linear model -> non-linear model)
        - use different data cleaning method to handle outliers if more appropriate (e.g., impute missing values vs remove outliers)
        - used a new derived field to group data in a different way (e.g., convert score -> grade, price -> price_bin, date -> month or year)
        - use different grouping methods to show trends in different levels (e.g., visualize sum of sales amount by region, group by more granular or more general categories, etc.)
        - filter the data to focus on the most interesting part 
            - show extreme values (e.g., top 10 customers, top 20 products etc.)
            - show items with certain properties (e.g., items with certain price range, countries in different regions, items with attributes, etc.)
            - filter items based on metrics (e.g., items with certain sales amount, etc.)
        - introduce new properties to categorize items (e.g., add indicators of "is_profitable", etc.)
        - calculate trend of difference of values between two groups 
            - two groups that are often compared together (e.g., two competitors, two countries)
            - the same item across different time periods (e.g., a product's sales amount at start and end of the period, etc.)
            - two time point that display unique trends (e.g., before and after a major event, etc.)
        - use window functions to calculate rolling averages, moving averages, etc.
        - calculate rankings based on metrics and show rank changes over time
    - in reasoning, explain which of the above transformations you leverage and why (or new ones you think of)
    - avoid transformations that cannot be calculated programmatically based on the input data, e.g., looking up zipcode, get continent

Create a follow-up decision with this format, don't add any other text:

```json
{{
    "recap": "...", // Recap what previous steps have explored in bullet points
    "assessment": "...", // Describe the lastest result, espeially data and visualization, describe what you see and what you think about it, is there any issues? how well does it answer the question?
    "status": "continue|present|warning", // Decision on whether to continue analysis, or present findings or warning 
    "reasoning": "...", // Explain the decision - why continue or present. If continuing, include context about the broader analytical strategy and why the next step is important.
    "instruction": "...", // if status is "continue", clear description of what the next step should explore - MUST build on previous insights; if status is "present", clear and concise summary of the findings and insights in bullet points based on all analysis steps.
}}
```
'''

class ExplorationAgent(object):

    def __init__(self, client):
        self.client = client

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
            # Assume it's a file path, convert to data URL
            with open(visualization, 'rb') as img_file:
                img_data = base64.b64encode(img_file.read()).decode()
                return {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{img_data}"}
                }
            
    def suggest_followup(self, input_tables, steps: list[dict]):
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
        
        data_summary = generate_data_summary(input_tables)

        # Prepare messages for the completion call
        messages = [
            {"role": "system", "content": FOLLOWUP_PROMPT},
            {"role": "user", "content": f"[CONTEXT]\n\n{data_summary}"},
            
        ]

        for i,step in enumerate(steps):
            code = step['code']
            if 'name' not in step['data']:
                step['data']['name'] = f'table-s-{i+1}'
            data = generate_data_summary([step['data']])

            if step['visualization']:
                chart_message = self.get_chart_message(step['visualization'])
                
                # Create content array with text and image
                content = [
                    {"type": "text", "text": f"[STEP {i+1}] \n\n**Question**: {step['question']}\n\n **Code**:\n```{code}``` \n\n**Transformed Data Sample**:\n{data}\n\n**Visualization**:"}
                ]
                content.append(chart_message)
            else:
                content = [
                    {"type": "text", "text": f"[STEP {i+1}] \n\n**Question**: {step['question']}\n\n **Code**:\n```{code}``` \n\n**Transformed Data Sample**:\n{data}"}
                ]
            
            messages.append({"role": "user", "content": content})

        response = self.client.get_completion(messages)

        
        return self.process_gpt_response(messages, response)