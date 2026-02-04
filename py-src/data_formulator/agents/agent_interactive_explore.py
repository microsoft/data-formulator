# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import logging
import pandas as pd

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary
from data_formulator.agents.agent_sql_data_transform import generate_sql_data_summary, create_duckdb_conn_with_parquet_views

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = '''You are a data exploration expert who suggests interesting questions to help users explore their datasets.

This prompt contains the following sections:
- [DATASETS] section: available datasets the user is working with.
- [EXPLORATION THREAD] section (optional): sequence of datasets that have been explored in the order they were created, and what questions are asked to create them. These tables are all created from tables in the [DATASETS] section.
- [CURRENT DATA] section (optional): latest data sample the user is viewing, and the visualization they are looking at at the moment.
- [START QUESTION] section (optional): start question from previous exploration steps for context

Your task is to suggest 4 exploration questions (unless the user explicitly asks for the number of questions), that users can follow to gain insights from their data.
When the exploration context is provided, make your suggestion based on the context as well as the original datasets; otherwise leverage the original datasets to suggest questions.

Guidelines for question suggestions:
1. Suggest interesting analytical questions that can uncover new insights from the data.
2. Use a diverse language style to display the questions (can be questions, statements etc).
3. If there are multiple datasets in a thread, consider relationships between them.
4. CONCISENESS: the questions should be concise and to the point
5. QUESTION: the question should be a new question based on the exploration thread:
    - if no exploration thread is provided, start with a high-level overview question that directly visualizes the data to give the user a sense of the data.
    - either a followup question, or a new question that is related to the exploration thread
        - if the current data is rich, you can ask a followup question to further explore the dataset;
        - if the current data is already specialized to answer the previous question, you can ask a new question that is related to the thread but not related to the previous question in the thread, leverage earlier exploration data to ask questions that can expand the exploration horizon
    - do not repeat questions that have already been explored in the thread
    - do not suggest questions that are not related to the thread (e.g. questions that are completely unrelated to the exploration direction in the thread)
    - do not naively follow up if the question is already too low-level when previous iterations have already come into a small subset of the data (suggest new related areas related to the metric / attributes etc)
    - leverage other datasets in the [DATASETS] section to suggest questions that are related to the exploration thread.
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

This prompt contains the following sections:
- [DATASETS] section: available datasets the user is working with.
- [EXPLORATION THREAD] section (optional): sequence of datasets that have been explored in the order they were created, and what questions are asked to create them. These tables are all created from tables in the [DATASETS] section.
- [CURRENT DATA] section (optional): latest data sample the user is viewing, and the visualization they are looking at at the moment.
- [START QUESTION] section (optional): start question from previous exploration steps for context

Given a dataset (or a thread of datasets that have been explored), your task is to suggest 4 exploration questions (unless the user explicitly asks for the number of questions), that users can follow to gain insights from their data.
When the exploration context is provided, make your suggestion based on the context as well as the original datasets; otherwise leverage the original datasets to suggest questions.

Guidelines for question suggestions:
1. Suggest a list of question_groups of interesting analytical questions that can uncover new insights from the data.
2. Use a diverse language style to display the questions (can be questions, statements etc)
3. If there are multiple datasets in a thread, consider relationships between them
4. CONCISENESS: the questions should be concise and to the point
5. QUESTION GROUP GENERATION: 
    - different questions groups should cover different aspects of the data analysis for user to choose from.
    - each question_group is a sequence of 'questions' that builds on top of each other to answer the user's goal.
    - each question group should have a difficulty level (easy / medium / hard),
        - simple questions should be short -- single sentence exploratory questions
        - medium questions can be 1-2 sentences exploratory questions
        - hard questions should introduce some new analysis concept but still make it concise
    - if suitable, include a group of questions that are related to statistical analysis: forecasting, regression, or clustering.
6. QUESTIONS WITHIN A QUESTION GROUP:
    - if the user doesn't provide an exploration thread, start with a high-level overview question that directly visualizes the data to give the user a sense of the data.
    - raise new questions that are related to the user's goal, do not repeat questions that have already been explored in the context provided to you.
    - if the user provides a start question, suggested questions should be related to the start question.
    - the questions should progressively dive deeper into the data, building on top of the previous question.
        - start of the question should provide an overview of the data in the direction going to be explored.
        - followup questions should refine the previous question, introducing refined analysis to deep dive into the data (e.g., updated computation, filtering, different grouping, etc.)
        - don't jump too far from the previous question so that readers can understand the flow of the questions.
    - every question should be answerable with a visualization.
7. FORMATTING: 
    - include "questions" in the question group:
        - each question group should have 2-4 questions (or as directed by the user).
    - For each question group, include a 'goal' that summarizes the goal of the question group. 
        - The goal should all be a short single sentence (<12 words).
        - Meaning of the 'goal' should be clear that the user won't misunderstand the actual question descibed in 'text'.
        - It should capture the key computation and exploration direction of the question (do not omit any information that may lead to ambiguity), but also keep it concise.
        - include the **bold** keywords for the attributes / metrics that are important to the question, especially when the goal mentions fields / metrics in the original dataset (don't have to be exact match)
    - include 'difficulty' to indicate the difficulty of the question, it should be one of 'easy', 'medium', 'hard'

Output should be a list of json objects in the following format, each line should be a json object representing a question group, starting with 'data: ':

Format:

data: {"questions": [...], "goal": ..., "difficulty": ...} 
data: {"questions": [...], "goal": ..., "difficulty": ...} 
... // more question groups
'''

class InteractiveExploreAgent(object):

    def __init__(self, client, workspace, agent_exploration_rules=""):
        self.client = client
        self.agent_exploration_rules = agent_exploration_rules
        self.workspace = workspace  # when set (SQL/datalake mode), use parquet tables for summary

    def get_data_summary(self, input_tables, table_name_prefix="Table"):

        # Datalake mode: create temporary DuckDB conn with parquet views, then get summary
        with create_duckdb_conn_with_parquet_views(self.workspace, input_tables) as conn:
            data_summary = generate_sql_data_summary(conn, input_tables, table_name_prefix=table_name_prefix)
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
        context = f"[DATASETS] These are the datasets the user is working with:\n\n{data_summary}"
        
        if exploration_thread:
            thread_summary = self.get_data_summary(
                [{
                    'name': table.get('name', f'Table {i}'), 
                    'rows': table.get('rows', []), 
                    'attached_metadata': table.get('description', ''),
                } for i, table in enumerate(exploration_thread, 1)],
                table_name_prefix="Thread Table"
            )
            context += f"\n\n[EXPLORATION THREAD] These are the sequence of tables the user created in this exploration thread, in the order they were created, and what questions are asked to create them:\n\n{thread_summary}"

        if current_data_sample:
            context += f"\n\n[CURRENT DATA SAMPLE] This is the current data sample the user is viewing, and the visualization they are looking at at the moment is shown below:\n\n{pd.DataFrame(current_data_sample).head(10).to_string()}"

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