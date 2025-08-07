# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = '''You are a data exploration expert who suggests interesting questions to help users explore their datasets.

Given a dataset (or a thread of datasets that have been explored), your task is to suggest 4 exploration questions that users can follow to gain insights from their data.

Guidelines for question suggestions:
1. Suggest interesting analytical questions that are not obvious that can uncover nontrivial insights
2. Use a diverse language style to display the questions (can be questions, statements etc)
3. If there are multiple datasets in a thread, consider relationships between them
4. DIVERSITY: the questions should be diverse in difficulty (easy / medium / hard) and the four questions should cover different aspects of the data analysis to expand the user's horizon
    - simple questions should be short -- single sentence explorative questions
    - medium questions can be 1-2 sentences explorative questions
    - hard questions should introduce some new analysis concept but still make it concise
5. CONCISENESS: the questions should be concise and to the point
6. NEW QUESTION: the question should be a new question based on the thread of exploration:
    - either a followup question, or a new question that is related to the thread
    - do not repeat questions that have already been explored in the thread
    - do not suggest questions that are not related to the thread (e.g. questions that are completely unrelated to the exploration direction in the thread)
7. VISUALIZABILITY: the question should be visualizable with a chart
8. FORMATTING: for each question, include a goal version that provides the high-level goal of the question that can be used as a subtitle for a chart. The goal should all be a short single sentence.

Examples questions:
```json
[
    {"text": "Compare income distribution between California and Texas over groups.", 
    "goal": "Compare income distribution between California and Texas over groups", "difficulty": "easy"},
    {"text": "Which states showed the most volatile income distribution changes between 2000-2016? Calculate the standard deviation of income group percentages for each state.", 
    "goal": "Volatile income distribution changes between 2000-2016", "difficulty": "easy"},
    {"text": "Identify states that experienced a 'middle class squeeze' - where middle income groups decreased while both low and high income groups increased.", 
    "goal": "Identify states with 'middle class squeeze'", "difficulty": "hard"},
    {"text": "Calculate the Gini coefficient equivalent for each state in 2016 using income group data. Show the 10 states with highest and lowest income inequality.", 
    "goal": "Show the 10 states with highest and lowest income inequality", "difficulty": "hard"}
]
```
Output format:
```json
{
    "exploration_questions": [
        {"text": ..., "goal": ..., "difficulty": ...},
        ...
    ],
    "reasoning": "Brief explanation of the reasoning behind the questions"
}
```
'''

class InteractiveExploreAgent(object):

    def __init__(self, client):
        self.client = client

    def run(self, input_tables, exploration_thread=None, current_chart=None):
        """
        Suggest exploration questions for a dataset or exploration thread.
        
        Args:
            input_tables: List of dataset objects with name, rows, description
            exploration_thread: Optional list of tables from previous exploration steps for context
            current_chart: Optional chart object from previous exploration steps for context (it should be an image in data:image/png format)
        Returns:
            List of candidate results with suggested exploration questions
        """
        
        # Generate data summary
        data_summary = generate_data_summary(input_tables, include_data_samples=False)
        
        # Build context including exploration thread if available
        context = f"[DATASET]\n\n{data_summary}"
        
        if exploration_thread:
            thread_summary = "Tables in this exploration thread:\n"
            for i, table in enumerate(exploration_thread, 1):
                table_name = table.get('name', f'Table {i}')
                data_summary = generate_data_summary([{'name': table_name, 'rows': table.get('rows', [])}], 
                                                     include_data_samples=False,
                                                     field_sample_size=5)
                table_description = table.get('description', 'No description available')
                thread_summary += f"{i}. {table_name}: {table_description} \n\n{data_summary}\n\n"
            context += f"\n\n[EXPLORATION THREAD]\n\n{thread_summary}"

        if current_chart:
            context += f"\n\n[CURRENT CHART]\n\n{current_chart}"

        logger.info(f"Interactive explore agent input: {context}")
        
        try:
            if current_chart:
                messages = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": [
                        {"type": "text", "text": context},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{current_chart}"}}
                    ]}
                ]
            else:
                messages = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": context}
                ]
            # Get completion from client
            response = self.client.get_completion(messages=messages)
        except Exception as e:
            # if the model doesn't accept image, just use the text context
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": context}
            ]
            # Get completion from client
            response = self.client.get_completion(messages=messages)
        
        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Interactive Explore Result ===>\n")
            logger.info(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            logger.info(f"Extracted JSON blocks: {json_blocks}")
            
            if len(json_blocks) > 0:
                result = {'status': 'ok', 'content': json_blocks[0]}
            else:
                try:
                    json_block = json.loads(choice.message.content + "\n")
                    result = {'status': 'ok', 'content': json_block}
                except:
                    result = {'status': 'other error', 'content': 'unable to extract exploration questions from response'}
            
            # Add dialog and agent info
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'InteractiveExploreAgent'

            candidates.append(result)

        return candidates 