# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary
from data_formulator.agents.agent_sql_data_transform import  sanitize_table_name, get_sql_table_statistics_str

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a journalist to help the user generate a short blog post based off the data and visualization provided by the user.
The user will provide you:
- the input data summary (the data analysis is based off) 
- and a list of visualizations (and their corresponding data) that the user wants to include in the report.
- the report style they want the report to be written in.
Your job is to generate a short blog post based off the data and visualizations provided by the user. It should be a few paragraphs long, and be easy to read.

Note:
- You should not make any assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- If that happens, highlight the the data may include biases, and suggest the user to be careful when interpreting the data.

The report should have two components:
1. A short title of the report
2. Description of findings based on the charts and data.
    - connect findings between different charts into a coherent story, write in a way that is easy to read and understand.
    - include the image as part of the blog. Use a placeholder [IMAGE(chart_id)] to include the chart that will be replaced later.
    - for each chart, write a bit about the what is the chart trying to answer and its findings (use its data as supporting evidence)
    - descriptions should all be concise only show 2-3 most important findings for the chart.
3. conclude the blog with a summary of the findings and follows up questions.

Writing style rules:
- The report should be easy to read and understand, the total reading time should be 1 minute for the user, use no more than 200 words.
- The report should be concise and to the point.
- The output should be in markdown format:
    - title should be in `# <title>`
    - the content should just be paragraphs without subsection headers
    - put image reference [IMAGE(chart_id)] in its own line among the texts at appropriate places (replace the chart_id with the actual chart_id, keep the format of [IMAGE(...)]).
    - be flexible about using markdown syntax like bullet points, italics, bold, code blocks, tables, etc. to make the report more readable.
    - the summary should be in a paragraph start with "**In summary**".
- Note that the reader won't be able to see sample data or code, and the report should be self-contained (referring to the charts).
- The user may provide you a desired writing style, that means the overall language should follow the style (not that the post should still be within 1min reading time).
    - "blog post": "blog post", -- a blogpost that is published on a blog platform
    - "social post": "social post", -- a social post that is published on a social media platform (should be shorter than a blog post)
    - "executive summary": "executive summary", -- a summary of the report for executives, with more formal language and more details, and more bullet points
    - "short note": "short note", -- a short note that is published on a social media platform, with no more than 300 characters in total, and there should be no more than 3 short sentences.

The report should be lightweight, and respect facts in the data. Do not make up any facts or make judgements about the data.
The report should be based off the data and visualizations provided by the user, do not make up any facts or make judgements about the data.
Output markdown directly, do not need to include any other text.
'''

class ReportGenAgent(object):

    def __init__(self, client, conn):
        self.client = client
        self.conn = conn

    def get_data_summary(self, input_tables):
        if self.conn:
            data_summary = ""
            for table in input_tables:
                table_name = sanitize_table_name(table['name'])
                table_summary_str = get_sql_table_statistics_str(self.conn, table_name)
                data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"
        else:
            data_summary = generate_data_summary(input_tables)
        return data_summary

    def stream(self, input_tables, charts=[], style="blog post"):
        """derive a new concept based on the raw input data
        Args:
            - input_tables (list): the input tables to the agent
            - charts (list): the charts to the agent of format 
            [
                { 
                    "chart_id": ..., // the id of the chart 
                    "code": ..., // the code that derived this table
                    "chart_data": { "name": ..., "rows": ... }, 
                    "chart_url": ... // base64 encoded image
                }
            ]
            - style (str): the style of the report, can be "blog post" or "social post" or "executive summary" or "short note"
        Returns:
            generator: the result of the agent
        """

        data_summary = self.get_data_summary(input_tables)

        content = []

        content.append({
            'type': 'text',
            'text': f'''{data_summary}'''
        })

        for chart in charts:
            chart_data = chart['chart_data']
            chart_data_summary = self.get_data_summary([chart_data])
            if chart['chart_url']:
                content += [
                    {
                        'type': 'text',
                        'text': f''' [CHART] - chart_id: {chart['chart_id']} \n\n - data summary:\n\n{chart_data_summary} \n\n - code:\n\n{chart['code']}'''
                    },
                    {
                        'type': 'image_url',
                        'image_url': {
                            "url": chart['chart_url'],
                            "detail": "high"
                        }
                    }
                ]

        user_prompt = {
            'role': 'user',
            'content': content + [{'type': 'text', 'text': 'Now based off the data and visualizations provided by the user, generate a report in markdown. The style of the report should be ' + style + '.'}]
        }

        system_message = {
            'role': 'system',
            'content': [ {'type': 'text', 'text': SYSTEM_PROMPT}]
        }

        messages = [
            system_message, 
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