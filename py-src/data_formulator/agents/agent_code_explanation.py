# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
from data_formulator.agents.agent_utils import generate_data_summary, extract_json_objects, extract_code_from_gpt_response

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = r'''You are a data scientist to help user explain code, 
so that a non-code can clearly understand what the code is doing, you are provided with a summary of the input data, and the transformation code.

Your goal:
1. You should generate a good itemized explanation of the code so that the reader can understand high-level steps of what the data transformation is doing.
    - Be very concise, and stay at a high-level. The reader doesn't understand code and does not want to learn exactly what the code is doing. They just want to learn what have been done from a logical level.
    - The explanation should be a markdown string that is a list of bullet points (with new lines), highlight constants, data fields, and important verbs.
2. Generate a list of explanations for new fields (fields not from the input data) that introduce metrics/concepts that are not obvious from the code.
    - provide a declarative definition that explains the new field, use a mathematical notation if applicable.
    - only include new fields explanation of new metrics that are involved in computation (e.g., ROI, commerical_success_score)
    - *DO NOT* explain trivial new fields like "Decade" or "Avg_Rating", "US_Sales" that are self-explanatory.
        - Avoid explaining fields that are simple aggregate of fields in the original data (min_score, avg_value, count, etc.)
    - When a field involves mathematical computation, you can use LaTeX math notation in the explanation. Format mathematical expressions using:
        - Inline math: `\( ... \)` for formulas within text
        - Block math: `\[ ... \]` for standalone formulas
        - Examples: `\( \frac{\text{Revenue}}{\text{Cost}} \)` for ratios, `\[ \text{Score} = \text{Rating} \times \text{Worldwide\_Gross} \]` for formulas
        - note: when using underscores as part of the text, you need to escape them with a backslash, e.g., `\_`
    - Note: don't use math notation for fields whose computation is trivial (use plain english), it will likely be confusing to the reader. 
      Only use math notation for fields that can not be easilyexplained in plain english. Use it sparingly.
3. If there are multiple fields that have the similar computation, you can explain them together in one explanation.
    - in "field", you can provide a list of fields in format of "field1, field2, ..."
    - in "explanation", you can provide a single explanation for the computation of the fields.
    - for example, if you have fields like "Norm_Rating", "Norm_Gross", "Critical_Commercial_Score", you can explain Norm_Rating, Norm_Gross together in one explanation and explain Critical_Commercial_Score in another explanation.
4. If the code is about statistical analysis, you should explain the statistical analysis in the explanation as a concept named "Statistical Analysis" in the [CONCEPTS EXPLANATION] section.
    - explain how you model the data, which fields are used, how data processing is done, and what models are used.
    - suggest some other modeling approaches that can be used to analyze the data in the explanation as well.
    
The focus is to explain how new fields are computed, don't generate explanation for low-level actions like "return", "load data" etc. 

Provide the result in the following two sections:
    - first section is the code explanation that should be a markdown block explaining the code, in the [CODE EXPLANATION] section.
        - remember to highlight constants, data fields, and important verbs in the code explanation.
    - second section is the concepts explanation that should be a json block (start with ```json) in the [CONCEPTS EXPLANATION] section.

[CODE EXPLANATION]

...(explanation of the code)

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

table_0 (movies) sample:

```
|Title|US_Gross|Worldwide_Gross|US_DVD_Sales|Production_Budget|Release_Date|MPAA_Rating|Running_Time_min|Distributor|Source|Major_Genre|Creative_Type|Director|Rotten_Tomatoes_Rating|IMDB_Rating|IMDB_Votes
0|The Land Girls|146083|146083||8000000|Jun 12 1998|R||Gramercy||||||6.1|1071.0
1|First Love, Last Rites|10876|10876||300000|Aug 07 1998|R||Strand||Drama||||6.9|207.0
2|I Married a Strange Person|203134|203134||250000|Aug 28 1998|||Lionsgate||Comedy||||6.8|865.0
3|Let's Talk About Sex|373615|373615||300000|Sep 11 1998|||Fine Line||Comedy|||13.0||
4|Slam|1009819|1087521||1000000|Oct 09 1998|R||Trimark|Original Screenplay|Drama|Contemporary Fiction||62.0|3.4|165.0
......
```

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

[CODE EXPLANATION]

1. **Average Rating** is calculated by averaging the **Rotten_Tomatoes_Rating** (normalized to a 0-10 scale) and **IMDB_Rating**, handling missing values.
2. **Normalized Rating** is derived by scaling the **Average Rating** to a range between 0 and 1 using min-max normalization.
3. **Worldwide Gross** is normalized by scaling the values of **Worldwide_Gross** to a range between 0 and 1 using min-max normalization.
4. **Critical-Commercial Success Score** is computed as the product of **Normalized Rating** and **Normalized Worldwide Gross**, representing a combination of critical acclaim and commercial success.
5. **Decade** is extracted from the **Release_Date** by identifying the year and grouping it into its respective decade (e.g., '1990s', '2000s').
6. The resulting dataset includes original fields (**Title**, **Major_Genre**, **Release_Date**) and newly computed fields (**Decade**, **Avg_Rating**, **Norm_Rating**, **Norm_Gross**, **Critical_Commercial_Score**).

[CONCEPTS EXPLANATION]

```json
[  
    {  
        "field": "Norm_Rating",  
        "explanation": "The normalized rating scales **Avg_Rating** between 0 and 1 using min-max normalization. Formula: -BSLASH-(-BSLASH-text{Norm-BSLASH-_Rating} = -BSLASH-frac{-BSLASH-text{Avg-BSLASH-_Rating} - -BSLASH-text{Min}(-BSLASH-text{Avg-BSLASH-_Rating})}{-BSLASH-text{Max}(-BSLASH-text{Avg-BSLASH-_Rating}) - -BSLASH-text{Min}(-BSLASH-text{Avg-BSLASH-_Rating})} -BSLASH-)"  
    },  
    {  
        "field": "Norm_Gross",  
        "explanation": "The normalized worldwide gross scales **Worldwide_Gross** between 0 and 1 using min-max normalization. Formula: -BSLASH-(-BSLASH-text{Norm-BSLASH-_Gross} = -BSLASH-frac{-BSLASH-text{Worldwide-BSLASH-_Gross} - -BSLASH-text{Min}(-BSLASH-text{Worldwide-BSLASH-_Gross})}{-BSLASH-text{Max}(-BSLASH-text{Worldwide-BSLASH-_Gross}) - -BSLASH-text{Min}(-BSLASH-text{Worldwide-BSLASH-_Gross})} -BSLASH-)"  
    },  
    {  
        "field": "Critical_Commercial_Score",  
        "explanation": "The critical-commercial success score combines **Norm_Rating** and **Norm_Gross** to represent a movie's critical acclaim and commercial performance. Formula: -BSLASH-(-BSLASH-text{Critical-BSLASH-_Commercial-BSLASH-_Score} = -BSLASH-text{Norm-BSLASH-_Rating} -BSLASH-times -BSLASH-text{Norm-BSLASH-_Gross} -BSLASH-)"  
    }  
]  
'''

class CodeExplanationAgent(object):

    def __init__(self, client):
        self.client = client

    def run(self, input_tables, code, n=1):

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[CODE]\n\nhere is the transformation code: {code}\n\n[EXPLANATION]\n"

        logger.info(user_query)

        messages = [{"role":"system", "content": SYSTEM_PROMPT},
                    {"role":"user","content": user_query}]
        
        response = self.client.get_completion(messages = messages)

        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Code explanation result ===>\n")
            logger.info(choice.message.content + "\n")
            
            # Inline parsing of both sections
            response_content = choice.message.content
            code_explanation = ""
            concepts = []
            
            # Find CODE EXPLANATION section
            code_start = response_content.find('[CODE EXPLANATION]')
            if code_start != -1:
                code_start += len('[CODE EXPLANATION]')
                # Find the end of code explanation (either CONCEPTS EXPLANATION or end of content)
                concepts_start = response_content.find('[CONCEPTS EXPLANATION]', code_start)
                if concepts_start != -1:
                    code_explanation = response_content[code_start:concepts_start].strip()
                else:
                    code_explanation = response_content[code_start:].strip()

            # Find CONCEPTS EXPLANATION section
            concepts_start = response_content.find('[CONCEPTS EXPLANATION]')
            if concepts_start != -1:
                concepts_start += len('[CONCEPTS EXPLANATION]')
                # Extract JSON from the concepts section
                concepts_content = response_content[concepts_start:].strip()
                try:
                    # Escape backslashes by doubling them
                    raw_json_blocks = extract_code_from_gpt_response(concepts_content, "json")
                    json_blocks = [json.loads(block) for block in raw_json_blocks]
                except Exception as e:
                    json_blocks = []

                if json_blocks:
                    concepts = json_blocks[0]
            
            # Build result
            if code_explanation or concepts != []:
                result = {
                    'status': 'ok', 
                    'concepts': concepts,
                    'code': code_explanation
                }
            else:
                logger.error(f"unable to extract JSON from response: {response_content}")
                result = {'status': 'other error', 'content': 'unable to create code and concepts explanation'}
            
            # individual dialog for the agent
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'CodeExplanationAgent'

            candidates.append(result)

        return candidates
