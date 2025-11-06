# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
import pandas as pd

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary
from data_formulator.agents.agent_sql_data_transform import get_sql_table_statistics_str, sanitize_table_name

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = '''You are a data exploration expert who suggests interesting questions to help users explore their datasets.

Given a dataset (or a thread of datasets that have been explored), your task is to suggest 4 exploration questions (unless the user explicitly asks for the number of questions), that users can follow to gain insights from their data.
* the user may provide you current explorations they have done, including:
    - a thread of exploration questions they have explored
    - the latest data sample they are viewing
    - the current chart they are viewing
* when the exploration context is provided, make your suggestion based on the context as well as the original dataset; otherwise leverage the original dataset to suggest questions.

Guidelines for question suggestions:
1. Suggest interesting analytical questions that are not obvious that can uncover nontrivial insights
2. Use a diverse language style to display the questions (can be questions, statements etc)
3. If there are multiple datasets in a thread, consider relationships between them
4. CONCISENESS: the questions should be concise and to the point
5. QUESTION: the question should be a new question based on the thread of exploration:
    - either a followup question, or a new question that is related to the thread
        - if the current data is rich, you can ask a followup question to further explore the dataset;
        - if the current data is already specialized to answer the previous question, you can ask a new question that is related to the thread but not related to the previous question in the thread, leverage earlier exploration data to ask questions that can expand the exploration horizon
    - do not repeat questions that have already been explored in the thread
    - do not suggest questions that are not related to the thread (e.g. questions that are completely unrelated to the exploration direction in the thread)
    - do not naively follow up if the question is already too low-level when previous iterations have already come into a small subset of the data (suggest new related areas related to the metric / attributes etc)
6. DIVERSITY: the questions should be diverse in difficulty (easy / medium / hard) and the four questions should cover different aspects of the data analysis to expand the user's horizon
    - simple questions should be short -- single sentence exploratory questions
    - medium questions can be 1-2 sentences exploratory questions
    - hard questions should introduce some new analysis concept but still make it concise
    - you should include both types of questions:
        - questions that deepdive from the provided data to further refine the exploration (zoom-in).
        - questions that branch out from the provided data to explore new related directions (zoom-out).
    - if suitable, suggest a question about statistical analysis: forecasting, regression, or clustering.
7. VISUALIZATION: each question should be visualizable with a chart.
8. FORMATTING: for each question, include a 'goal' that concisely summarizes the essence of the question. 
    - The goal should all be a short single sentence (<10 words).
    - It should capture the key computation and exploration direction of the question (do not omit any information that may lead to ambiguity), but also keep it concise.
    - Meaning of the 'goal' should be clear that the user won't misunderstand the actual question descibed in 'text'.
    - include the **bold** keywords for the attributes / metrics that are important to the question, especially when the goal mentions fields / metrics in the original dataset (don't have to be exact match)
    - include 'difficulty' to indicate the difficulty of the question, it should be one of 'easy', 'medium', 'hard'
    - include a 'tag' to describe the type of the question.
    
Output should be a list of json objects in the following format, each line should be a json object representing a question, starting with 'data:':

Format:

data: {"type": "question", "text": ..., "goal": ..., "difficulty": ..., "tag": ...} 
data: {"type": "question", "text": ..., "goal": ..., "difficulty": ..., "tag": ...} 
... // more questions
'''

SYSTEM_PROMPT_AGENT = '''You are a data exploration expert to help users explore their datasets.

Given a dataset (or a thread of datasets that have been explored), your task is to suggest 4 exploration questions (unless the user explicitly asks for the number of questions), that users can follow to gain insights from their data.
* the user may provide you current explorations they have done, including:
    - a thread of exploration questions they have explored
    - the latest data sample they are viewing
    - the current chart they are viewing
* when the exploration context is provided, make your suggestion based on the context as well as the original dataset; otherwise leverage the original dataset to suggest questions.

Guidelines for question suggestions:
1. Suggest a list of question_groups of interesting analytical questions that are not obvious that can uncover nontrivial insights, including both breadth and depth questions.
    
2. Use a diverse language style to display the questions (can be questions, statements etc)
3. If there are multiple datasets in a thread, consider relationships between them
4. CONCISENESS: the questions should be concise and to the point
5. QUESTION GROUP GENERATION: 
    - different questions groups should cover different aspects of the data analysis for user to choose from.
    - each question_group should include both 'breadth_questions' and 'depth_questions':
        - breadth_questions: a group of questions that are all relatively simple that helps the user understand the data in a broad sense.
        - depth_questions: a sequence of questions that build on top of each other to answer a specific aspect of the user's goal.
    - you have a budget of generating 4 questions in total (or as directed by the user).
        - allocate 2-3 questions to 'breadth_questions' and 2-3 questions to 'depth_questions' based on the user's goal and the data.
        - each question group should slightly lean towards 'breadth' or 'depth' exploration, but not too much.
        - the more focused area can have more questions than the other area.
    - each question group should have a difficulty level (easy / medium / hard),
        - simple questions should be short -- single sentence exploratory questions
        - medium questions can be 1-2 sentences exploratory questions
        - hard questions should introduce some new analysis concept but still make it concise
    - if suitable, include a group of questions that are related to statistical analysis: forecasting, regression, or clustering.
6. QUESTIONS WITHIN A QUESTION GROUP:
    - all questions should be a new question based on the thread of exploration the user provided, do not repeat questions that have already been explored in the thread
    - if the user provides a start question, suggested questions should be related to the start question.
    - when suggesting 'breadth_questions' in a question_group, they should be a group of questions:
        - they are related to the user's goal, they should each explore a different aspect of the user's goal in parallel.
        - questions should consider different fields, metrics and statistical methods.
        - each question within the group should be distinct from each other that they will lead to different insights and visualizations
    - when suggesting 'depth_questions' in a question_group, they should be a sequence of questions:
        - start of the question should provide an overview of the data in the direction going to be explored, and it will be refined in the subsequent questions.
        - they progressively dive deeper into the data, building on top of the previous question.
        - each question should be related to the previous question, introducing refined analysis (e.g., updated computation, filtering, different grouping, etc.)
    - every question should be answerable with a visualization.
7. FORMATTING: 
    - include "breadth_questions" and "depth_questions" in the question group:
        - each question group should have 2-3 questions (or as directed by the user).
    - For each question group, include a 'goal' that summarizes the goal of the question group. 
        - The goal should all be a short single sentence (<12 words).
        - Meaning of the 'goal' should be clear that the user won't misunderstand the actual question descibed in 'text'.
        - It should capture the key computation and exploration direction of the question (do not omit any information that may lead to ambiguity), but also keep it concise.
        - include the **bold** keywords for the attributes / metrics that are important to the question, especially when the goal mentions fields / metrics in the original dataset (don't have to be exact match)
    - include 'difficulty' to indicate the difficulty of the question, it should be one of 'easy', 'medium', 'hard'
    - a 'focus' field to indicate whether the overall question group leans more on 'breadth' or 'depth' exploration.

Output should be a list of json objects in the following format, each line should be a json object representing a question group, starting with 'data: ':

Format:

data: {"breadth_questions": [...], "depth_questions": [...], "goal": ..., "difficulty": ..., "focus": "..."} 
data: {"breadth_questions": [...], "depth_questions": [...], "goal": ..., "difficulty": ..., "focus": "..."} 
... // more question groups
'''

class InteractiveExploreAgent(object):

    def __init__(self, client, agent_exploration_rules="", db_conn=None):
        self.client = client
        self.agent_exploration_rules = agent_exploration_rules
        self.db_conn = db_conn

    def get_data_summary(self, input_tables):
        if self.db_conn:
            data_summary = ""
            for table in input_tables:
                table_name = sanitize_table_name(table['name'])
                table_summary_str = get_sql_table_statistics_str(self.db_conn, table_name)
                data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"
        else:
            data_summary = generate_data_summary(input_tables, include_data_samples=False)
        return data_summary

    def run(self, input_tables, start_question=None, exploration_thread=None, 
                  current_data_sample=None, current_chart=None, mode='interactive'):
        """
        Suggest exploration questions for a dataset or exploration thread.
        
        Args:
            input_tables: List of dataset objects with name, rows, description
            start_question: Optional start question from previous exploration steps for context
            exploration_thread: Optional list of tables from previous exploration steps for context
            current_data_sample: Optional data sample from previous exploration steps for context (it should be a json object)
            current_chart: Optional chart object from previous exploration steps for context (it should be an image in data:image/png format)
            mode: Optional mode of exploration question: 'interactive' or 'agent'
        Returns:
            List of candidate results with suggested exploration questions
        """
        
        # Generate data summary
        data_summary = self.get_data_summary(input_tables)
        
        # Build context including exploration thread if available
        context = f"[DATASET]\n\n{data_summary}"
        
        if exploration_thread:
            thread_summary = "Tables in this exploration thread:\n"
            for i, table in enumerate(exploration_thread, 1):
                table_name = table.get('name', f'Table {i}')
                data_summary = self.get_data_summary([{'name': table_name, 'rows': table.get('rows', [])}])
                table_description = table.get('description', 'No description available')
                thread_summary += f"{i}. {table_name}: {table_description} \n\n{data_summary}\n\n"
            context += f"\n\n[EXPLORATION THREAD]\n\n{thread_summary}"

        if current_data_sample:
            context += f"\n\n[CURRENT DATA SAMPLE]\n\n{pd.DataFrame(current_data_sample).head(10).to_string()}"

        if start_question:
            context += f"\n\n[START QUESTION]\n\n{start_question}"

        base_system_prompt = SYSTEM_PROMPT_AGENT if mode == 'agent' else SYSTEM_PROMPT
        
        # Incorporate agent exploration rules into system prompt if provided
        if self.agent_exploration_rules and self.agent_exploration_rules.strip():
            system_prompt = base_system_prompt + "\n\n[AGENT EXPLORATION RULES]\n\n" + self.agent_exploration_rules.strip() + "\n\nPlease follow the above agent exploration rules when suggesting questions."
        else:
            system_prompt = base_system_prompt

        logger.info(f"Interactive explore agent input: {context}")
        
        try:
            if current_chart:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": [
                        {"type": "text", "text": context},
                        {"type": "image_url", "image_url": {"url": current_chart, "detail": "high"}}
                    ]}
                ]
            else:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": context}
                ]
            # Get completion from client
            stream = self.client.get_completion(messages=messages, stream=True)
        except Exception as e:
            # if the model doesn't accept image, just use the text context
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": context}
            ]
            # Get completion from client
            stream = self.client.get_completion(messages=messages, stream=True)

        accumulated_content = ""
        
        for part in stream:
            if hasattr(part, 'choices') and len(part.choices) > 0:
                delta = part.choices[0].delta
                if hasattr(delta, 'content') and delta.content:
                    accumulated_content += delta.content
                    
                    # Stream each character for real-time display as JSON
                    yield delta.content