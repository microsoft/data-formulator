# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, generate_data_summary, extract_code_from_gpt_response, extract_and_log_user_prompt
from data_formulator.agents.qc_chart_config import get_compact_qc_chart_info, get_full_qc_chart_rules
import data_formulator.py_sandbox as py_sandbox
import pandas as pd

import logging

# Replace/update the logger configuration
logger = logging.getLogger(__name__)

SYSTEM_PROMPT = '''You are a data scientist to help user to transform data that will be used for visualization.
The user will provide you information about what data would be needed, and your job is to create a python function based on the input data summary, transformation instruction and expected fields.
The users' instruction includes "chart_type" and "chart_encodings" that describe the visualization they want, and natural language instructions "goal" that describe what data is needed.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with np.nan.

Concretely, you should first refine users' goal and then create a python function in the output section based off the [CONTEXT] and [GOAL]:

    1. First, refine users' [GOAL]. The main objective in this step is to check if "chart_type" and "chart_encodings" provided by the user are sufficient to achieve their "goal". Concretely:
        - based on the user's "goal" and "chart_type" and "chart_encodings", elaborate the goal into a "detailed_instruction".
        - "display_instruction" is a short verb phrase describing the users' goal. 
            - it would be a short verbal description of user intent as a verb phrase (<12 words).
            - generate it based on detailed_instruction and the suggested chart_type and chart_encodings, but don't need to mention the chart details.
            - should capture key computation ideas: by reading the display, the user can understand the purpose and what's derived from the data.
            - if the user specification follows up the previous instruction, the 'display_instruction' should only describe how it builds up the previous instruction without repeating information from previous steps.
            - the phrase can be presented in different styles, e.g., question (what's xxx), instruction (show xxx), description, etc.
            - if you mention column names from the input or the output data, highlight the text in **bold**.
                * the column can either be a column in the input data, or a new column that will be computed in the output data.
                * the mention don't have to be exact match, it can be semantically matching, e.g., if you mentioned "average score" in the text while the column to be computed is "Avg_Score", you should still highlight "**average score**" in the text.
        - determine "output_fields", the desired fields that the output data should have to achieve the user's goal, it's a good idea to include intermediate fields here.
        - **CRITICAL: "output_fields" MUST ALWAYS start with "INDEX"**
            - INDEX is a 1-based row sequence number that MUST be included in ALL transformations
            - "output_fields" should be: ["INDEX", "other_field1", "other_field2", ...]
            - This applies to ALL data types: normal data, QC data, any transformation
            - INDEX is NOT an optional field - it is REQUIRED
        - then decide "chart_encodings", which maps visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of "output_fields" that will be visualized, 
            - the "chart_encodings" should be created to support the user's "chart_type".
            - first, determine whether the user has provided sufficient fields in "chart_encodings" that are needed to achieve their goal:
                - if the user's "chart_encodings" are sufficient, simply copy it.
                - if the user didn't provide sufficient fields in "chart_encodings", add missing fields in "chart_encodings" (ordered them based on whether the field will be used in x,y axes or legends);
                    - "chart_encodings" should only include fields that will be visualized (do not include other intermediate fields from "output_fields")  
                    - Note: INDEX should be in output_fields but do NOT include it in chart_encodings (it's a row identifier, not a visualization field)
                    - when adding new fields to "chart_encodings", be efficient and add only a minimal number of fields that are needed to achive the user's goal.
                    - **EXCEPTION FOR QC CHARTS**: For QC charts (qc_trend_line, qc_histogram, qc_trend_bar), there are FIXED channel requirements that MUST be followed (see QC_CHART_REQUIREMENTS section below). These have 3-5 channels each, and ALL required channels MUST be included.
                    - for non-QC charts: the total number of fields in "chart_encodings" should be no more than 3-4 for x,y,color,facet.
                - if the user's "chart_encodings" is sufficient but can be optimized, you can reorder encodings to visualize the data more effectively.
            - sometimes, user may provide instruction to update visualizations fields they provided. You should leverage the user's goal to resolve the conflict and decide the final "chart_encodings"
                - e.g., they may mention "use B metric instead" while A metric is in provided fields, in this case, you should update "chart_encodings" to update A metric with B metric.
        - guide on statistical analysis:
            - when the user asks for forecasting or regression analysis, you should consider the following:
                - the output should be a long format table where actual x, y pairs and predicted x, y pairs are included in the X, Y columns, they are differentiated with a third column "is_predicted" that is a boolean field.
                - i.e., if the user ask for forecasting based on two columns T and Y, the output should be three columns: T, Y, is_predicted, where
                    - T, Y columns contain BOTH original values from the data and predicted values from the data.
                    - is_predicted is a boolean field to indicate whether the x, y pairs are original values from the data or predicted / regression values from the data.
                - the recommended chart should be line chart (time series) or scatter plot (quantitative x, y)
                - if the user asks for forecasting, it's good to include predicted x, y pairs for both x in the original data and future x values (i.e., combine regression and forecasting results)
                    - in this case, is_predicted should be of three values 'original', 'regression', 'forecasting'
        - when the user asks for clustering:
            - the output should be a long format table where actual x, y pairs with a third column "cluster_id" that indicates the cluster id of the data point.
            - the recommended chart should be scatter plot (quantitative x, y)
        
        - **QC_CHART_REQUIREMENTS** (CRITICAL - MUST FOLLOW EXACTLY):
            - If chart_type is "qc_trend_line", you MUST:
              * Include in output_fields: INDEX, VALUE, QCDATE, QCSHIFT, QCSTDPARAMNAME, TARGET, LL, UL, ARLL, ARUL, SLIPNO, ITEMNAME
              * Include in chart_encodings EXACTLY: {"INDEX": "INDEX", "VALUE": "VALUE", "QCDATE": "QCDATE", "QCSHIFT": "QCSHIFT", "color": "QCSTDPARAMNAME"}
              * DO NOT omit QCDATE or QCSHIFT - these are REQUIRED channels for QC trend line
              * Do NOT use "x" or "y" channels - use INDEX, VALUE, QCDATE, QCSHIFT instead
            
            - If chart_type is "qc_histogram", you MUST:
              * Include in output_fields: INDEX, VALUE, QCSTDPARAMNAME, TARGET, LL, UL, ARLL, ARUL, SLIPNO, ITEMNAME
              * Include in chart_encodings EXACTLY: {"VALUE": "VALUE", "INDEX": "INDEX", "color": "QCSTDPARAMNAME"}
              * Do NOT use "x" or "y" channels
            
            - If chart_type is "qc_trend_bar", you MUST:
              * Include in output_fields: INDEX, VALUE, QCDATE, QCSHIFT, SLIPNO, ITEMNAME, TARGET (if available)
              * Include in chart_encodings EXACTLY: {"VALUE": "VALUE", "QCDATE": "QCDATE", "QCSHIFT": "QCSHIFT"}
              * Do NOT include "color" or use "x", "y" channels
    
    Prepare the result in the following json format:

```
{
    "detailed_instruction": "..." // string, elaborate user instruction with details if the user
    "display_instruction": "..." // string, the short verb phrase describing the users' goal.
    "output_fields": ["INDEX", ...] // string[], MUST start with "INDEX" which is the 1-based row number. Then describe the desired output fields that the output data should have based on the user's goal, it's a good idea to preserve intermediate fields here (i.e., the goal of transformed data)

    "chart_encodings": {
        "x": "",
        "y": "",
        "color": "",
        "size": "",
        "opacity": "",
        "facet": "",
        ... // other visualization channels user used
    } // object: map visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of "output_fields" that will be visualized.
    "reason": "..." // string, explain why this refinement is made
}
```

    2. Then, write a python function based on the refined goal, the function input is a dataframe "df" (or multiple dataframes based on tables presented in the [CONTEXT] section) and the output is the transformed dataframe "transformed_df". "transformed_df" should contain all "output_fields" from the refined goal.
The python function must follow the template provided in [TEMPLATE], do not import any other libraries or modify function name. The function should be as simple as possible and easily readable.
If there is no data transformation needed based on "output_fields", the transformation function can simply "return df".

[TEMPLATE]

```python
import pandas as pd
import collections
import numpy as np
from sklearn import ... # import necessary libraries from sklearn if needed

def transform_data(df1, df2, ...): 
    # complete the template here
    return transformed_df
```

note: 
- if the user provided one table, then it should be `def transform_data(df1)`, if the user provided multiple tables, then it should be `def transform_data(df1, df2, ...)` and you should consider the join between tables to derive the output.
- **VERY IMPORTANT** the number of arguments in the function must match the number of tables provided, and the order of arguments must match the order of tables provided.
- try to use intuitive table names to refer to the input dataframes, for example, if the user provided two tables city and weather, you can use `transform_data(df_city, df_weather)` to refer to the two dataframes, as long as the number and order of the arguments match the number and order of the tables provided.
- datetime objects handling:
    - if the output field is year, convert it to number, if it is year-month / year-month-day, convert it to string object (e.g., "2020-01" / "2020-01-01").
    - if the output is time only: convert hour to number if it's just the hour (e.g., 10), but convert hour:min or h:m:s to string object (e.g., "10:30", "10:30:45")
    - never return datetime object directly, convert it to either number (if it only contains year) or string so it's readable.
- **CRITICAL: INDEX field requirement and recalculation for GROUP BY**:
    - The transformed_df MUST always include an "INDEX" column containing row sequence numbers (starting from 1).
    - Add INDEX column in the transformation function using: `transformed_df.insert(0, 'INDEX', range(1, len(transformed_df) + 1))`
    - This applies to ALL transformations, regardless of data type (normal data, QC data, etc.).
    - Do NOT create INDEX in the output_fields JSON only - MUST be added in the actual python code.
    - **CRITICAL - GROUP BY / AGGREGATION CASE:**
      * When operations change the row count (groupby, aggregation with sum/count/mean, drop_duplicates, etc.), the transformed_df will have DIFFERENT number of rows
      * INDEX must be recalculated AFTER these operations, NOT carried from the input data
      * Example: If user asks "Group by QCDATE and calculate the total VALUE for each group":
        - Input might be 1000 rows
        - After groupby and aggregation, output might be 30 rows (one per unique QCDATE)
        - After aggregation, use: `transformed_df['INDEX'] = range(1, len(transformed_df) + 1)` OR use the insert method AFTER groupby
      * Pattern: Do groupby/aggregation first, THEN add INDEX field to the result
        ```python
        # Do NOT include INDEX in groupby keys
        result = df.groupby('QCDATE')['VALUE'].sum().reset_index()
        # Then add INDEX after aggregation
        result.insert(0, 'INDEX', range(1, len(result) + 1))
        ```
      * Do NOT group by the original INDEX - only group by the columns that make logical sense

    3. The output must only contain a json object representing the refined goal and a python code block representing the transformation code, do not add any extra text explanation.
'''

EXAMPLE='''

For example:

[CONTEXT]

Here are our datasets, here are their field summaries and samples:

df1 (us_covid_cases) fields:
	Date -- type: object, values: 1/1/2021, 1/1/2022, 1/1/2023, ..., 9/8/2022, 9/9/2020, 9/9/2021, 9/9/2022
	Cases -- type: int64, values: -23999, -14195, -6940, ..., 1018935, 1032159, 1178403, 1433977

df1 (us_covid_cases) sample:
```
|Date|Cases
0|1/21/2020|1
1|1/22/2020|0
2|1/23/2020|0
3|1/24/2020|1
4|1/25/2020|1
......
```

[GOAL]

{
    "instruction": "calculate 7-day moving average",
    "chart_type": "line",
    "chart_encodings": {"x": "Date", "y": "7-day average cases"}
}

[OUTPUT]

{  
    "detailed_instruction": "Calculate the 7-day moving average of COVID-19 cases over time.",  
    "display_instruction": "Calculate 7-day moving average of COVID-19 cases",
    "output_fields": ["INDEX", "Date", "Cases", "7-day average cases"],  
    "chart_encodings": {"x": "Date", "y": "7-day average cases"},  
    "reason": "To calculate the 7-day moving average, the 'Cases' field is required, but it is not needed for visualization. The provided fields are sufficient to achieve the goal. INDEX is added as the first field to track row sequence."  
}  

```python
import pandas as pd  
import collections  
import numpy as np  
  
def transform_data(df):  
    # Convert Date column to datetime  
    df['Date'] = pd.to_datetime(df['Date'])  
      
    # Sort the dataframe by Date  
    df = df.sort_values('Date')  
      
    # Calculate the 7-day moving average of cases  
    df['7-day average cases'] = df['Cases'].rolling(window=7).mean()  
      
    # Select the output fields  
    transformed_df = df[['Date', 'Cases', '7-day average cases']]  
    
    # Add INDEX column (1-based row number) - REQUIRED for all transformations
    transformed_df.insert(0, 'INDEX', range(1, len(transformed_df) + 1))
      
    return transformed_df  
```

[CONTEXT]

Here are our datasets, here are their field summaries and samples:

df1 (weather_seattle_atlanta) fields:
	Date -- type: object, values: 1/1/2020, 1/10/2020, 1/11/2020, ..., 9/6/2020, 9/7/2020, 9/8/2020, 9/9/2020
	City -- type: object, values: Atlanta, Seattle
	Temperature -- type: int64, values: 30, 31, 32, ..., 83, 84, 85, 86

df1 (weather_seattle_atlanta) sample:
```
|Date|City|Temperature
0|1/1/2020|Seattle|51
1|1/1/2020|Atlanta|45
2|1/2/2020|Seattle|45
3|1/2/2020|Atlanta|47
4|1/3/2020|Seattle|48
......
```

[GOAL]

{
    "instruction": "create a scatter plot to with seattle and atlanta temperatures on x,y axes, color points by which city is warmer",
    "chart_type": "scatter",
    "chart_encodings": {"x": "Seattle Temperature", "y": "Atlanta Temperature", "color": "Warmer City"}
}

[OUTPUT]

{  
    "detailed_instruction": "Create a scatter plot to compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis. Color the points by which city is warmer.",  
    "output_fields": ["INDEX", "Date", "Seattle Temperature", "Atlanta Temperature", "Warmer City"],  
    "chart_encodings": {"x": "Seattle Temperature", "y": "Atlanta Temperature", "color": "Warmer City"},  
    "reason": "To compare Seattle and Atlanta temperatures with Seattle temperatures on the x-axis and Atlanta temperatures on the y-axis, and color points by which city is warmer, separate temperature fields for Seattle and Atlanta are required. Additionally, a new field 'Warmer City' is needed to indicate which city is warmer. INDEX is added as the first field to track row sequence."  
}  

```python
import pandas as pd  
import collections  
import numpy as np  
  
def transform_data(df):  
    # Pivot the dataframe to have separate columns for Seattle and Atlanta temperatures  
    df_pivot = df.pivot(index='Date', columns='City', values='Temperature').reset_index()  
    df_pivot.columns = ['Date', 'Atlanta Temperature', 'Seattle Temperature']  
      
    # Determine which city is warmer for each date  
    df_pivot['Warmer City'] = df_pivot.apply(lambda row: 'Atlanta' if row['Atlanta Temperature'] > row['Seattle Temperature'] else 'Seattle', axis=1)  
      
    # Select the output fields  
    transformed_df = df_pivot[['Date', 'Seattle Temperature', 'Atlanta Temperature', 'Warmer City']]  
    
    # Add INDEX column (1-based row number) - REQUIRED for all transformations
    transformed_df.insert(0, 'INDEX', range(1, len(transformed_df) + 1))
      
    return transformed_df 
```

---

**GROUP BY EXAMPLE** (Showing correct INDEX recalculation):

[CONTEXT]

df1 (qc_sample_data) fields:
    INDEX -- type: int64, values: 1, 2, 3, ..., 999, 1000
    QCDATE -- type: object, values: 2026-03-10, 2026-03-11, 2026-03-12, ...
    VALUE -- type: float64, values: 12.5, 13.2, 11.8, ..., 14.1

df1 (qc_sample_data) sample:
```
|INDEX|QCDATE|VALUE
0|1|2026-03-10|12.5
1|2|2026-03-10|13.2
2|3|2026-03-10|11.8
3|4|2026-03-11|14.1
4|5|2026-03-11|15.0
......
```

[GOAL]

{
    "instruction": "Group by QCDATE and calculate the total VALUE for each group, then visualize it using a bar chart",
    "chart_type": "bar",
    "chart_encodings": {"x": "QCDATE", "y": "TOTAL_VALUE"}
}

[OUTPUT]

{
    "detailed_instruction": "Group data by QCDATE and calculate the sum of VALUE for each date. The result will have one row per unique QCDATE with the aggregated total VALUE.",
    "display_instruction": "Calculate total **VALUE** per **QCDATE**",
    "output_fields": ["INDEX", "QCDATE", "TOTAL_VALUE"],
    "chart_encodings": {"x": "QCDATE", "y": "TOTAL_VALUE"},
    "reason": "To group by QCDATE and show total VALUE per date, we aggregate the data by using groupby. Since grouping reduces the row count from 1000 to ~30 rows (one per QCDATE), INDEX must be recalculated for the aggregated output. The new INDEX will be 1, 2, 3, ... for the grouped results."
}

```python
import pandas as pd
import collections
import numpy as np

def transform_data(df):
    # Group by QCDATE and sum the VALUE column
    # Do NOT include INDEX in the groupby - only group by QCDATE
    grouped_df = df.groupby('QCDATE')['VALUE'].sum().reset_index()
    grouped_df.columns = ['QCDATE', 'TOTAL_VALUE']
    
    # After grouping, the number of rows has changed (from 1000 to ~30)
    # So we must recalculate INDEX for the output
    # Add INDEX AFTER grouping/aggregation is complete
    grouped_df.insert(0, 'INDEX', range(1, len(grouped_df) + 1))
    
    return grouped_df
```

Key points:
- Do NOT include the original INDEX in the groupby() parameters
- Only group by the columns that define your groups (e.g., 'QCDATE')
- AFTER aggregation is complete, add the INDEX column with new sequence numbers
- The new INDEX will be 1, 2, 3... for the aggregated output rows (not the input rows)
'''

class PythonDataTransformationAgent(object):

    def __init__(self, client, system_prompt=None, exec_python_in_subprocess=False, agent_coding_rules=""):
        self.client = client
        
        # Incorporate agent coding rules into system prompt if provided
        if system_prompt is not None:
            self.system_prompt = system_prompt
        else:
            base_prompt = SYSTEM_PROMPT
            if agent_coding_rules and agent_coding_rules.strip():
                self.system_prompt = base_prompt + "\n\n[AGENT CODING RULES]\nPlease follow these rules when generating code. Note: if the user instruction conflicts with these rules, you should priortize user instructions.\n\n" + agent_coding_rules.strip()
            else:
                self.system_prompt = base_prompt
                
        self.exec_python_in_subprocess = exec_python_in_subprocess

    def process_gpt_response(self, input_tables, messages, response):
        """process gpt response to handle execution"""

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': str(response.body)}
            return [result]
        
        candidates = []
        for choice in response.choices:
            logger.info("=== Data transformation result ===>")
            logger.info(choice.message.content + "\n")
            
            json_blocks = extract_json_objects(choice.message.content + "\n")
            if len(json_blocks) > 0:
                refined_goal = json_blocks[0]
            else:
                refined_goal = {'chart_encodings': {}, 'instruction': '', 'reason': ''}

            # ✅ ENFORCE INDEX REQUIREMENT: Always ensure INDEX is in output_fields
            if 'output_fields' in refined_goal and refined_goal['output_fields']:
                if 'INDEX' not in refined_goal['output_fields']:
                    logger.info("⚠️ INDEX not in output_fields, adding it automatically")
                    refined_goal['output_fields'].insert(0, 'INDEX')

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]

                # ✅ ENFORCE INDEX REQUIREMENT: Check if code adds INDEX column
                has_index_add = 'insert(0, \'INDEX\'' in code_str or 'insert(0, "INDEX"' in code_str
                if not has_index_add and 'return transformed_df' in code_str:
                    logger.info("⚠️ INDEX not added in code, auto-injecting INDEX addition")
                    # Auto-inject INDEX addition before return statement
                    code_str = code_str.replace(
                        'return transformed_df',
                        'transformed_df.insert(0, \'INDEX\', range(1, len(transformed_df) + 1))\n    return transformed_df'
                    )

                try:
                    result = py_sandbox.run_transform_in_sandbox2020(code_str, [pd.DataFrame.from_records(t['rows']) for t in input_tables], self.exec_python_in_subprocess)
                    result['code'] = code_str

                    if result['status'] == 'ok':
                        # parse the content
                        result_df = result['content']
                        result['content'] = {
                            'rows': json.loads(result_df.to_json(orient='records')),
                        }
                    else:
                        logger.info(result['content'])
                except Exception as e:
                    logger.warning('Error occurred during code execution:')
                    error_message = f"An error occurred during code execution. Error type: {type(e).__name__}"
                    logger.warning(error_message)
                    result = {'status': 'error', 'code': code_str, 'content': error_message}
            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task."}
            
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'PythonDataTransformationAgent'
            result['refined_goal'] = refined_goal
            candidates.append(result)

        logger.info("=== Transform Candidates ===>")
        for candidate in candidates:
            for key, value in candidate.items():
                if key in ['dialog', 'content']:
                    logger.info(f"##{key}:\n{str(value)[:1000]}...")
                else:
                    logger.info(f"## {key}:\n{value}")

        return candidates


    def run(self, input_tables, description, chart_type: str, chart_encodings: dict, prev_messages: list[dict] = [], n=1):

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

        goal = {
            "instruction": description,
            "chart_type": chart_type,
            "chart_encodings": chart_encodings,
        }

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{json.dumps(goal, indent=4)}"
        if len(prev_messages) > 0:
            user_query = f"The user wants a new transformation based off the following updated context and goal:\n\n[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}"

        logger.info(user_query)

        # Filter out system messages from prev_messages
        filtered_prev_messages = [msg for msg in prev_messages if msg.get("role") != "system"]

        messages = [{"role":"system", "content": self.system_prompt},
                    *filtered_prev_messages,
                    {"role":"user", "content": user_query}]
        
        # Log user prompt to ClickHouse
        #extract_and_log_user_prompt(messages, "PythonDataTransformAgent")
        
        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)
        

    def followup(self, input_tables, dialog, latest_data_sample, chart_type: str, chart_encodings: dict, new_instruction: str, n=1):
        """
        extend the input data (in json records format) to include new fields
        latest_data_sample: the latest data sample that the user is working on, it's a json object that contains the data sample of the current table
        chart_type: the chart type that the user wants to use
        chart_encodings: the chart encodings that the user wants to use
        new_instruction: the new instruction that the user wants to add to the latest data sample
        """

        goal = {
            "followup_instruction": new_instruction,
            "chart_type": chart_type,
            "chart_encodings": chart_encodings
        }

        logger.info(f"GOAL: \n\n{goal}")

        #logger.info(dialog)

        updated_dialog = [{"role":"system", "content": self.system_prompt}, *dialog[1:]]

        # get the current table name
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        messages = [*updated_dialog, 
                    {"role":"user", 
                    "content": f"This is the result from the latest python code:\n\n{sample_data_str}\n\nUpdate the code above based on the following instruction:\n\n{json.dumps(goal, indent=4)}"}]

        # Log user prompt to ClickHouse
        #extract_and_log_user_prompt(messages, "PythonDataTransformAgent")
        
        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)
