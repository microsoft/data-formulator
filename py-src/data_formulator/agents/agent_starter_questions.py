# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.agent_utils import extract_json_objects
from data_formulator.agents.agent_language import inject_language_instruction

import logging

logger = logging.getLogger(__name__)

_AGENT_ID = "starter_questions"


SYSTEM_PROMPT = '''You are a data analyst helping a user get started exploring a freshly loaded dataset.
You are given a summary of the available tables (their names, columns, and a few sample rows) and one designated "primary_table".
Propose a small number of short, concrete starter questions the user could ask to explore the data.

Guidelines:
- Center the questions on the primary_table (about its own columns / trends / comparisons / distributions / top-N).
- If other tables are present and share a plausible key with the primary table, you MAY include ONE cross-table question that relates the primary table to another table.
- Each question must be answerable by charting or analyzing the provided data (do not invent columns that are not present).
- Keep each question short and natural — under 12 words, phrased as a request (e.g. "Compare sales across regions").
- Make the questions diverse and prefer referencing specific column names so they feel tailored.
- Do NOT include a generic "show high-level trends" question — that one is already provided separately.

Return ONLY a json object of the following form:

{
    "questions": ["<question 1>", "<question 2>"]
}

Example:

[INPUT]

{
    "primary_table": "sales",
    "tables": [
        {
            "name": "sales",
            "columns": ["date", "region", "product", "revenue", "units"],
            "sample_rows": [
                {"date": "2023-01-01", "region": "West", "product": "A", "revenue": 1200, "units": 30},
                {"date": "2023-01-02", "region": "East", "product": "B", "revenue": 800, "units": 20}
            ]
        }
    ]
}

[OUTPUT]

{
    "questions": ["Compare revenue across regions", "Which products sell the most units?"]
}
'''


class StarterQuestionsAgent(object):

    def __init__(self, client, language_instruction: str = ""):
        self.client = client
        self.language_instruction = language_instruction

    def run(self, tables, primary_table=None, n=2):
        """Generate a short list of starter exploration questions.

        ``tables`` is a list of dicts with ``name``, optional ``description``
        and either ``columns`` and/or ``sample_rows``. ``primary_table`` is
        the name of the table the questions should center on. Returns a list
        of question strings (best effort, may be empty on failure).
        """

        input_obj = {"primary_table": primary_table, "tables": tables, "num_questions": n}

        user_query = f"[INPUT]\n\n{json.dumps(input_obj, ensure_ascii=False, default=str)}\n\n[OUTPUT]"

        logger.info("[StarterQuestionsAgent] run start")

        system_prompt = inject_language_instruction(
            SYSTEM_PROMPT, self.language_instruction,
        )

        messages = [{"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_query}]

        response = self.client.get_completion(
            messages=messages,
            reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model),
        )

        for choice in response.choices:
            logger.debug("\n=== Starter questions agent ===>\n")
            logger.debug(choice.message.content + "\n")

            content = choice.message.content or ""

            questions = []
            json_blocks = extract_json_objects(content + "\n")
            candidate = None
            if len(json_blocks) > 0:
                candidate = json_blocks[0]
            else:
                try:
                    candidate = json.loads(content + "\n")
                except (json.JSONDecodeError, ValueError, TypeError):
                    candidate = None

            if isinstance(candidate, dict):
                raw = candidate.get("questions", [])
                if isinstance(raw, list):
                    questions = [str(q).strip() for q in raw if str(q).strip()]
            elif isinstance(candidate, list):
                questions = [str(q).strip() for q in candidate if str(q).strip()]

            return questions[:n]

        return []
