# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
from data_formulator.agent_config import reasoning_effort_for
from data_formulator.agents.agent_utils import generate_data_summary, extract_json_objects, extract_code_from_gpt_response

import logging

logger = logging.getLogger(__name__)

_AGENT_ID = "code_explanation"


SYSTEM_PROMPT = r'''You are a data scientist helping a non-coder understand the math behind newly derived fields.

Strict scope — for each non-trivial derived field, output ONLY:
  1. the field name(s)
  2. a math formula (LaTeX) of how it is computed

Do NOT write any prose explanation, motivation, interpretation, or commentary.
Do NOT restate what the field "represents" or "measures".
Do NOT list parameters separately if the formula's variable names already make them self-evident
(only add a one-line parameter list if a symbol in the formula would otherwise be ambiguous).

Skip entirely (return nothing for these):
  - fields that are trivial aggregates or transforms (count, min, max, avg, sum, decade, year, normalized rename, etc.)
  - fields whose computation is obvious from the name alone
  - any field that has no real mathematical formula to show

If a group of fields share the same formula shape, combine them into one entry with `"field": "f1, f2, ..."`.

For statistical-analysis code (regression, clustering, hypothesis tests, etc.), emit a single entry
with `"field": "Statistical Analysis"` containing only the model's defining equation(s) in LaTeX —
no setup description.

LaTeX formatting:
  - Inline: `\( ... \)`
  - Block:  `\[ ... \]`
  - Escape underscores in identifiers as `\_`

If there are no fields worth showing a formula for, return an empty list.

Provide the result as a JSON block (start with ```json) in the [CONCEPTS EXPLANATION] section.

[CONCEPTS EXPLANATION]

```json
[
    {
        "field": "...",
        "explanation": "..."
    }
]

```
'''

EXAMPLE = '''
[CONTEXT]

Here are our datasets, here are their field summaries and samples:

table_0 (movies) fields:
	Title -- type: object, values: The Phantom, Twilight, Amores Perros, ..., The Producers: The Movie Musical, Pride and Prejudice, Doomsday, The Perez Family
	US_Gross -- type: float64, values: 0.0, 401.0, 1336.0, ..., 403706375.0, 533345358.0, 600788188.0, 760167650.0
	Worldwide_Gross -- type: float64, values: 0.0, 401.0, 423.0, ..., 937499905.0, 976457891.0, 1133027325.0, 1842879955.0
	US_DVD_Sales -- type: float64, values: nan, 140689412.0, nan, ..., nan, nan, 46260220.0, 124058348.0
	Production_Budget -- type: float64, values: 218.0, 1100.0, 23000.0, ..., 237000000.0, 250000000.0, 258000000.0, 300000000.0
	Release_Date -- type: object, values: Apr 01 1965, Apr 01 1975, Apr 01 1986, ..., Sep 30 1983, Sep 30 1994, Sep 30 2005, Sep 30 2006
	MPAA_Rating -- type: object, values: G, NC-17, Not Rated, Open, PG, PG-13, R
	Running_Time_min -- type: float64, values: nan, nan, nan, ..., nan, nan, nan, nan
	Distributor -- type: object, values: 20th Century Fox, 3D Entertainment, 8X Entertainment, ..., Women Make Movies, Yari Film Group Releasing, Yash Raj Films, Zeitgeist
	Source -- type: object, values: Based on Book/Short Story, Based on Comic/Graphic Novel, Based on Factual Book/Article, ..., Original Screenplay, Remake, Spin-Off, Traditional/Legend/Fairytale
	Major_Genre -- type: object, values: Action, Adventure, Black Comedy, ..., Musical, Romantic Comedy, Thriller/Suspense, Western
	Creative_Type -- type: object, values: Contemporary Fiction, Dramatization, Factual, ..., Kids Fiction, Multiple Creative Types, Science Fiction, Super Hero
	Director -- type: object, values: Abel Ferrara, Adam McKay, Adam Shankman, ..., Yimou Zhang, Zach Braff, Zack Snyder, Zak Penn
	Rotten_Tomatoes_Rating -- type: float64, values: 1.0, 2.0, 3.0, ..., nan, nan, nan, nan
	IMDB_Rating -- type: float64, values: 1.5, 2.5, 3.0, ..., nan, nan, nan, nan
	IMDB_Votes -- type: float64, values: 24578.0, nan, 18.0, ..., 364077.0, 387438.0, 411088.0, 519541.0

[CODE]

```python
import pandas as pd
import collections
import numpy as np

def transform_data(df_movies):
    # Calculate average rating (mean of Rotten Tomatoes and IMDB rating, normalized to 0-10)
    rt = df_movies['Rotten_Tomatoes_Rating'] / 10.0  # Rotten Tomatoes is out of 100
    imdb = df_movies['IMDB_Rating']
    avg_rating = pd.concat([rt, imdb], axis=1).mean(axis=1, skipna=True)
    
    # Normalize avg_rating
    norm_rating = (avg_rating - avg_rating.min()) / (avg_rating.max() - avg_rating.min())
    
    # Normalize Worldwide_Gross
    gross = df_movies['Worldwide_Gross']
    norm_gross = (gross - gross.min()) / (gross.max() - gross.min())
    
    # Calculate 'critical-commercial success' score
    score = norm_rating * norm_gross
    
    # Extract decade from Release_Date
    def extract_decade(date_str):
        if pd.isnull(date_str):
            return np.nan
        try:
            year = int(str(date_str)[-4:])
            return f"{year // 10 * 10}s"
        except:
            return np.nan
    
    decade = df_movies['Release_Date'].apply(extract_decade)
    
    transformed_df = pd.DataFrame({
        'Title': df_movies['Title'],
        'Major_Genre': df_movies['Major_Genre'],
        'Release_Date': df_movies['Release_Date'],
        'Decade': decade,
        'Avg_Rating': avg_rating,
        'Norm_Rating': norm_rating,
        'Worldwide_Gross': gross,
        'Norm_Gross': norm_gross,
        'Critical_Commercial_Score': score
    })
    return transformed_df
```

[CONCEPTS EXPLANATION]

```json
[
    {
        "field": "Norm_Rating, Norm_Gross",
        "explanation": "-BSLASH-[ -BSLASH-text{Normalized} = -BSLASH-frac{x - -BSLASH-min(x)}{-BSLASH-max(x) - -BSLASH-min(x)} -BSLASH-]"
    },
    {
        "field": "Critical_Commercial_Score",
        "explanation": "-BSLASH-[ -BSLASH-text{Critical-BSLASH-_Commercial-BSLASH-_Score} = -BSLASH-text{Norm-BSLASH-_Rating} -BSLASH-times -BSLASH-text{Norm-BSLASH-_Gross} -BSLASH-]"
    }
]
'''

class CodeExplanationAgent(object):

    def __init__(self, client, workspace, language_instruction=""):
        self.client = client
        self.workspace = workspace
        self.language_instruction = language_instruction

    def run(self, input_tables, code, n=1):

        data_summary = generate_data_summary(
            input_tables,
            workspace=self.workspace,
            include_data_samples=True,
        )

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[CODE]\n\nhere is the transformation code: {code}\n\n[EXPLANATION]\n"

        logger.debug(user_query)
        logger.info(f"[CodeExplanationAgent] run start")

        system_prompt = SYSTEM_PROMPT
        if self.language_instruction:
            system_prompt = system_prompt + "\n\n" + self.language_instruction

        messages = [{"role":"system", "content": system_prompt},
                    {"role":"user","content": user_query}]
        
        response = self.client.get_completion(messages = messages, reasoning_effort=reasoning_effort_for(_AGENT_ID, self.client.model))

        candidates = []
        for choice in response.choices:
            
            logger.debug("\n=== Code explanation result ===>\n")
            logger.debug(choice.message.content + "\n")
            
            # Inline parsing of concepts section
            response_content = choice.message.content
            concepts = []

            # Find CONCEPTS EXPLANATION section
            concepts_start = response_content.find('[CONCEPTS EXPLANATION]')
            if concepts_start != -1:
                concepts_start += len('[CONCEPTS EXPLANATION]')
                # Extract JSON from the concepts section
                concepts_content = response_content[concepts_start:].strip()
                try:
                    raw_json_blocks = extract_code_from_gpt_response(concepts_content, "json")
                    json_blocks = [json.loads(block) for block in raw_json_blocks]
                except Exception as e:
                    json_blocks = []

                if json_blocks:
                    concepts = json_blocks[0]
            
            # Build result
            if concepts:
                result = {
                    'status': 'ok', 
                    'concepts': concepts,
                }
            else:
                # No non-trivial concepts found — that's ok, return empty list
                result = {'status': 'ok', 'concepts': []}
            
            # individual dialog for the agent
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'CodeExplanationAgent'

            candidates.append(result)

        status = candidates[0].get('status', '?') if candidates else 'empty'
        logger.info(f"[CodeExplanationAgent] run done | status={status}")
        return candidates
