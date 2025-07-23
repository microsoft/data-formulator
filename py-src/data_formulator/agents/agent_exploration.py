# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
import base64

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary

logger = logging.getLogger(__name__)

INITIAL_PROMPT = '''
You are a data exploration expert to suggest a visualization to help the user to get started exploring their data.
The user will provide you in [CONTEXT] section:
* The dataset (name, description, fields)
* A data analysis question
* (optional) previous explorations from the user (if any)

Your task is to analyze the dataset and the question, and suggest a visualization to help the user to get started exploring their data.
- The visualization should be a non-trivial visualization build on top of the input data. 
- It should answer the question in a way that is not obvious from the input data.
- Consider chart types as follows:
    - (bar) Bar Charts: X: Categorical (nominal/ordinal), Y: Quantitative, Color: Categorical (optional for group or stacked bar chart), Best for: Comparisons across categories
        - use (bar) for simple bar chart or stacked bar chart, 
        - use (group_bar) for grouped bar chart.
    - (point) Scatter Plots: X,Y: Quantitative/Categorical, Color: Quantitative/Categorical (optional), Size: Quantitative (optional for creating bubble chart), Best for: Relationships, correlations, distributions
    - (line) Line Charts: X: Temporal (preferred) or ordinal, Y: Quantitative, Color: Categorical (optional for creating multiple lines), Best for: Trends over time, continuous data
    - (area) Area Charts: X: Temporal (preferred) or ordinal, Y: Quantitative, Color: Categorical (optional for creating stacked areas), Best for: Trends over time, continuous data
    - (heatmap) Heatmaps: X,Y: Categorical (convert quantitative to nominal), Color: Quantitative intensity, Best for: Pattern discovery in matrix data
- Introduce additional fields for legends (color, size, facet, etc.) for all the above chart types to enrich the visualization if applicable.
- After pikcing the chart type, consider which fields will be used for the visualization. Recommend to use 2-3 fields to visualize, maybe 4 if you consider faceted visualization.
- The visualization fields must be in **tidy format** with respect to the chart type to create the visualization, so it does not make sense to have too many or too few fields. 
  It should follow guidelines like VegaLite and ggplot2 so that each field is mapped to a visualization axis or legend. 
- Consider data transformations if you want to visualize multiple fields together.
  - exapmle 1: suggest reshaping the data into long format in data transformation description 
        - for example, if you want to visualize sales from regions stored in 5 columns, suggest reshaping the data into long format into 2 columns: region, value.
        - for example, if you want to visualize max_val, min_val of some value, suggest reshaping the data into long format into 2 columns: value, type (the type column should contain values of "max" or "min").
        - note: only reshape data to long format for fields of the same type, e.g., they are all about sales, price, etc. don't mix different types of fields (e.g., put sales and price in one column) in reshaping.
  - exapmle 2: calculate some derived fields from these fields(e.g., correlation, difference, profit etc.) in data transformation description to visualize them in one visualization.
  - example 3: create a visualization only with a subset of the fields, you don't have to visualize all of them in one chart, you can later create a visualization with the rest of the fields. With the subset of charts, you can also consider reshaping or calculate some derived value.
  - again, it does not make sense to have five fields like [item, A, B, C, D, E] in one visualization, you should consider data transformation to reduce the number of fields.
- Describe the data transformation necessary to achieve these visualizations in data_transformation_goal field. It's very common that we need to do some data transformation to achieve the visualization, so think carefully.

You should follow the following format:

```json
{{
    "reasoning": "...", // Explain the decision - why continue or present. If continuing, include context about the broader analytical strategy and why the next step is important.
    "action": {{
        "description": "...", // Clear description of what the next step explores - MUST build on previous insights
        "data_transformation_goal": "...", // Describe the data transformation needed to create the visualization
        "expected_output_fields": ["field1", "field2", ...], // fields expected to be in the transformed data
        "visualization_type": "bar|point|line|area|heatmap|group_bar", // Recommended chart type 
        "visualization_fields": ["field1", "field2", ...], // 2-3 fields to visualize (maybe 4 if you consider faceted visualization), it should be a subset of expected_output_fields, the first two fields should always be x and y axes.
    }} 
}}
```
'''

FOLLOWUP_PROMPT = '''
You are a data exploration expert to suggest a follow-up analysis to help the user explore their data.
The user will provide you:
* the context of data exploration (including input tables they are working with and their analysis questions) in [CONTEXT] section
* the current result of the exploration (transformed data and visualization) in [CURRENT RESULT] section

Your task is to analyze the current result and decide the next step.
You should follow the following format:

**Your Task:**
1. First, interpret what the transformed data and visualization reveal, refer to the context to understand the user's question and the current result.
2a. If the visualization is broken, propose a follow-up action to fix the issue.
   - Common issues to address:
      - data transformation problems: missing or incorrect aggregations, wrong field names, inappropriate grouping, incorrect data types, etc.
      - visualization problems: chart type not suitable, incorrect field mappings, too many/few data points
      - analysis focus problems: step description too vague, trying to do too much, missing intermediate calculations
2b. If the visualization is appropriate, decide whether it's time to stop exploring and present findings to the user.
   - Have we completed at least 2-3 analysis steps? or been stuck for a few steps?
   - Do we have interesting insights to show the user?
2c. Otherwise, let's continue exploring the question with a new visualization. 
    - The new visualization should be a non-trivial visualization build on top of the current one. 
      IMPORTANT: Create a new visualization that should leverage new data transformations (example below) to reveal new insights. (don't just switch field combinations in input tables or just project table with different visualization fields)
      If there is no new data transformation you can think of, set status to "present" and explain why.
    - the new visualization don't have to be exactly following the orignal user's question, but an extension of the question that involves new data transformations to reveal new insights.
    - Consider:
        - change a metric (e.g., count -> percentage in a heatmap)
        - add a new dimension, especially derived one (e.g., convert score -> grade, price -> price_bin, date -> month or year)
        - use different grouping and/or aggregation (e.g., visualize sum of sales amount by region, group by more granular or more general categories, etc.)
        - add a new color/facet with new categorical fields (e.g., add product_category as facet) to create small multiples
        - filter the data to focus on the most interesting part (e.g., top 10 customers, top 20 products etc.)
        - calculate trend of difference of values between two groups (e.g., different between two regions over time, each category's  difference between two time periods, etc.)
        - use window functions to calculate rolling averages, moving averages, etc.
        - calculate rankings based on metrics and show rank changes over time
    - in reasoning, explain which of the above transformations you leverage and why (or new ones you think of)
    - avoid transformations that cannot be calculated programmatically based on the input data, e.g., looking up zipcode, get continent
    - for the follow-up visualization, consider the following guidelines:
        - Consider chart types as follows:
            - (bar) Bar Charts: X: Categorical (nominal/ordinal), Y: Quantitative, Color: Categorical (optional for group or stacked bar chart), Best for: Comparisons across categories
                - use (bar) for simple bar chart or stacked bar chart, 
                - use (group_bar) for grouped bar chart.
            - (point) Scatter Plots: X,Y: Quantitative/Categorical, Color: Quantitative/Categorical (optional), Size: Quantitative (optional for creating bubble chart), Best for: Relationships, correlations, distributions
            - (line) Line Charts: X: Temporal (preferred) or ordinal, Y: Quantitative, Color: Categorical (optional for creating multiple lines), Best for: Trends over time, continuous data
            - (area) Area Charts: X: Temporal (preferred) or ordinal, Y: Quantitative, Color: Categorical (optional for creating stacked areas), Best for: Trends over time, continuous data
            - (heatmap) Heatmaps: X,Y: Categorical (convert quantitative to nominal), Color: Quantitative intensity, Best for: Pattern discovery in matrix data
        - Introduce additional fields for legends (color, size, facet, etc.) for all the above chart types to enrich the visualization if applicable.
        - After pikcing the chart type, consider which fields will be used for the visualization. Recommend to use 2-3 fields to visualize, maybe 4 if you consider faceted visualization.
        - The visualization fields must be in **tidy format** with respect to the chart type to create the visualization, so it does not make sense to have too many or too few fields. 
            It should follow guidelines like VegaLite and ggplot2 so that each field is mapped to a visualization axis or legend. 
        - You need to use following transformations if you want to visualize multiple fields together.
            - exapmle 1: suggest reshaping the data into long format in data transformation description (if these fields are all of the same type, e.g., they are all about sales, price, two columns about min/max-values, etc. don't mix different types of fields in reshaping) so we can visualize multiple fields as categories or in different facets.
            - exapmle 2: calculate some derived fields from these fields(e.g., correlation, difference, profit etc.) in data transformation description to visualize them in one visualization.
            - example 3: create a visualization only with a subset of the fields, you don't have to visualize all of them in one chart, you can later create a visualization with the rest of the fields. With the subset of charts, you can also consider reshaping or calculate some derived value.
            - again, it does not make sense to have five fields like [item, A, B, C, D, E] in one visualization, you should consider data transformation to reduce the number of fields.

Create a follow-up decision with this format:

```json
{{
    "assessment": "...", // Assess the current result, describe what you see and what you think about it, is there any issues? how well does it answer the question?
    "status": "continue|present", // Decision on whether to continue analysis (followup or retry) or present findings  
    "reasoning": "...", // Explain the decision - why continue or present. If continuing, include context about the broader analytical strategy and why the next step is important.
    "action": {{
        "description": "...", // Clear description of what the next step explores - MUST build on previous insights
        "data_transformation_goal": "...", // Describe the data transformation needed to create the visualization
        "expected_output_fields": ["field1", "field2", ...], // fields expected to be in the transformed data
        "visualization_type": "bar|point|line|area|heatmap|group_bar", // Recommended chart type 
        "visualization_fields": ["field1", "field2", ...], // 2-3 (maybe 4 if using facet) fields to visualize, it should be a subset of expected_output_fields, the first two fields should always be x and y axes.
    }} 
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
            
    def initial(self, input_tables, question, previous_explorations=[]):
        """
        Suggest a visualization to help the user to get started exploring their data.
        """

        data_summary = generate_data_summary(input_tables)

        messages = [
            {"role": "system", "content": INITIAL_PROMPT},
            {"role": "user", "content": [
                {"type": "text", "text": f"""[CONTEXT]\n\n{data_summary}\n\n[QUESTION]\n\n{question}\n\n[PREVIOUS EXPLORATIONS]\n\n{previous_explorations}\n\n[OUTPUT]\n\n"""},
            ]}
        ]
        
        response = self.client.get_completion(messages)

        return self.process_gpt_response(messages, response)

    def followup(self, transformed_data, visualization: str, dialog=[]):
        """
        Interpret analysis results and decide whether to continue exploration or present findings
        
        Args:
            context: the context of the exploration, including the input tables and the user's previous exploration question
            transformed_data: the output data of the previous exploration step ({'name': 'table_name', 'rows': [...], 'description': 'table description'})
            visualization: the visualization image of the previous exploration step (as base64 string or file path)
            
        Returns:
            the followup analysis based on the previous results
        """
        
        # Generate data summary
        if 'name' not in transformed_data:
            transformed_data['name'] = 'table_0'
        data_summary = generate_data_summary([transformed_data])

        # Prepare messages for the completion call
        messages = [
            {"role": "system", "content": FOLLOWUP_PROMPT},
            *[r for r in dialog if r['role'] != 'system'],
            {"role": "user", "content": [
                {"type": "text", "text": f"""[CURRENT RESULT]\n\n**data summary**:\n\n{data_summary}\n\n**visualization**: reference to the visualization image\n\n[OUTPUT]\n\n"""},
                self.get_chart_message(visualization)
            ]}
        ]
        
        response = self.client.get_completion(messages)
        
        return self.process_gpt_response(messages, response)