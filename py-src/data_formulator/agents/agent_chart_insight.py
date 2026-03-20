# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

from data_formulator.agents.agent_utils import generate_data_summary, extract_json_objects

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = r'''You are a data analyst helping users understand their visualizations.
You are given a chart image along with metadata about the chart type, data fields used, and a summary of the underlying data (including schema, value ranges, and sample rows).

Use both the chart image and the data summary to produce:

1. **title**: A short, descriptive title for the chart (5-10 words). It should summarize what the chart is about — the subject, the dimensions compared, and the scope. Do not include the chart type in the title. Write it in title case.

2. **takeaways**: A list of 1-3 key findings or insights from the chart. Each takeaway should be one sentence. Highlight notable patterns, trends, outliers, or comparisons visible in the chart. Be specific — reference actual values, categories, or trends from the data when possible.

Respond with a JSON object in exactly this format (no markdown fences):

{"title": "...", "takeaways": ["...", "..."]}
'''


class ChartInsightAgent(object):

    def __init__(self, client, workspace=None, language_instruction=""):
        self.client = client
        self.workspace = workspace
        self.language_instruction = language_instruction

    def run(self, chart_image_base64, chart_type, field_names, input_tables=None, n=1):
        """
        Generate insight for a chart.
        
        Args:
            chart_image_base64: Base64-encoded PNG data URL of the chart
            chart_type: The type of chart (e.g., "Bar Chart", "Scatter Plot")
            field_names: List of field names used in the chart encodings
            input_tables: Optional list of input table dicts for data context
            n: Number of candidates to generate
        """

        # Build context about the chart
        context_parts = [f"Chart type: {chart_type}"]
        context_parts.append(f"Fields used: {', '.join(field_names)}")

        if input_tables and self.workspace:
            data_summary = generate_data_summary(
                input_tables, workspace=self.workspace,
                include_data_samples=True, row_sample_size=3
            )
            context_parts.append(f"\nData summary:\n{data_summary}")

        context = "\n".join(context_parts)

        # Build the message with image
        user_content = [
            {
                "type": "text",
                "text": f"[CHART METADATA]\n{context}\n\n[CHART IMAGE]\nHere is the chart to analyze:"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{chart_image_base64}",
                    "detail": "high"
                }
            }
        ]

        system_prompt = SYSTEM_PROMPT
        if self.language_instruction:
            system_prompt = system_prompt + "\n\n" + self.language_instruction

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ]

        logger.debug(f"ChartInsightAgent: analyzing {chart_type} chart with fields {field_names}")
        logger.info(f"[ChartInsightAgent] run start | chart_type={chart_type}")

        response = self.client.get_completion(messages=messages)

        candidates = []
        for choice in response.choices:
            logger.debug("\n=== Chart insight result ===>\n")
            logger.debug(choice.message.content + "\n")

            response_content = choice.message.content
            title = ""
            takeaways = []

            # Parse JSON response
            json_blocks = extract_json_objects(response_content + "\n")
            for parsed in json_blocks:
                title = parsed.get('title', '')
                takeaways = parsed.get('takeaways', [])
                if isinstance(takeaways, str):
                    takeaways = [takeaways]
                if title or takeaways:
                    break

            if title or takeaways:
                result = {
                    'status': 'ok',
                    'title': title,
                    'takeaways': takeaways,
                }
            else:
                logger.error(f"unable to parse insight from response: {response_content}")
                result = {
                    'status': 'other error',
                    'content': 'unable to generate chart insight'
                }

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'ChartInsightAgent'

            candidates.append(result)

        status = candidates[0].get('status', '?') if candidates else 'empty'
        logger.info(f"[ChartInsightAgent] run done | status={status}")
        return candidates
