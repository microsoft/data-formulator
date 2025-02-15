# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json
import pandas as pd

from data_formulator.agents.agent_utils import generate_data_summary, extract_code_from_gpt_response
import data_formulator.py_sandbox as py_sandbox

import logging

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to join multiple tables based on user description.
Your job is to write a python function that will be applied to join input tables, based on input data summaries, and join instruction.
Complete a python function based off [TEMPLATE], and [CONTEXT], [GOAL] provided for each task.
The function's input arguments are pandas DataFrames: `df_0`, `df_1`, ..., `df_n`, representing the input tables respectively.
The number of input dataframes will match the number of tables described in the context.
The output of the function should be a single pandas DataFrame representing the joined table.
The function should be as simple as possible and easily readable, focusing on performing the join operation as described in the [GOAL].
Assume pandas library is already imported as `pd`.

[TEMPLATE]

```python
def join_tables(df_0, df_1, ...): # add more df_i based on number of tables in context
    # complete code here to join df_0, df_1, ...
    return joined_df
```
For example:

[CONTEXT]

Here are our datasets, here are their field summaries and samples:

table_0 (employee_info) fields:
employee_id -- type: int64, values: 1, 2, 3, ..., 98, 99, 100
employee_name -- type: object, values: Alice, Bob, Charlie, ..., Yara, Zoe

table_0 (employee_info) sample:

|employee_id|employee_name|
0|1|Alice|
1|2|Bob|
2|3|Charlie|
3|4|David|
4|5|Eve|
......

table_1 (salary_info) fields:
emp_id -- type: int64, values: 1, 2, 3, ..., 98, 99, 100
salary -- type: int64, values: 50000, 60000, 70000, ..., 140000, 150000

table_1 (salary_info) sample:

|emp_id|salary|
0|1|50000|
1|2|60000|
2|3|70000|
3|4|80000|
4|5|90000|
......

[GOAL]

Join employee_info table and salary_info table based on employee_id and emp_id

[OUTPUT]
```python
def join_tables(df_0, df_1):
    joined_df = pd.merge(df_0, df_1, left_on='employee_id', right_on='emp_id', how='inner')
    return joined_df
```
[CONTEXT]

Here are our datasets, here are their field summaries and samples:

table_0 (customer_orders) fields:
order_id -- type: int64, values: 101, 102, 103, ..., 198, 199, 200
customer_name -- type: object, values: Customer A, Customer B, Customer C, ..., Customer X, Customer Y

table_0 (customer_orders) sample:

|order_id|customer_name|
0|101|Customer A|
1|102|Customer B|
2|103|Customer C|
3|104|Customer D|
4|105|Customer E|
......

table_1 (order_details) fields:
order_number -- type: int64, values: 101, 102, 103, ..., 198, 199, 200
item_name -- type: object, values: Product 1, Product 2, Product 3, ..., Product X, Product Y
quantity -- type: int64, values: 1, 2, 3, ..., 10, 15, 20

table_1 (order_details) sample:

|order_number|item_name|quantity|
0|101|Product 1|2|
1|102|Product 2|1|
2|103|Product 3|3|
3|104|Product 4|2|
4|105|Product 5|1|
......

[GOAL]

Perform a left join of customer_orders with order_details on order_id and order_number

[OUTPUT]
```python
def join_tables(df_0, df_1):
    joined_df = pd.merge(df_0, df_1, left_on='order_id', right_on='order_number', how='left')
    return joined_df
```
[CONTEXT]

Here are our datasets, here are their field summaries and samples:

table_0 (region_info) fields:
region_id -- type: int64, values: 1, 2, 3, 4
region_name -- type: object, values: North, South, East, West

table_0 (region_info) sample:

|region_id|region_name|
0|1|North|
1|2|South|
2|3|East|
3|4|West|
......

table_1 (customer_info) fields:
customer_id -- type: int64, values: 1001, 1002, ..., 1100
region_id -- type: int64, values: 1, 2, 3, 4
customer_name -- type: object, values: Customer A, Customer B, ..., Customer Z

table_1 (customer_info) sample:

|customer_id|region_id|customer_name|
0|1001|1|Customer A|
1|1002|2|Customer B|
2|1003|3|Customer C|
3|1004|4|Customer D|
4|1005|1|Customer E|
......

table_2 (order_info) fields:
order_id -- type: int64, values: 2001, 2002, ..., 2100
customer_id -- type: int64, values: 1001, 1002, ..., 1100
order_date -- type: object, values: 2023-01-15, 2023-02-20, ...

table_2 (order_info) sample:

|order_id|customer_id|order_date|
0|2001|1001|2023-01-15|
1|2002|1002|2023-02-20|
2|2003|1003|2023-03-25|
3|2004|1004|2023-04-30|
4|2005|1005|2023-05-05|
......

[GOAL]

Join region_info, customer_info, and order_info tables to get a comprehensive view of orders with customer and region details.

[OUTPUT]

def join_tables(df_0, df_1, df_2):
    joined_df = pd.merge(df_0, df_1, on='region_id', how='inner')
    joined_df = pd.merge(joined_df, df_2, on='customer_id', how='inner')
    return joined_df


'''

class TableJoinAgent(object):

    def __init__(self, client):
        self.client = client

    def process_gpt_result(self, input_tables, response, messages):
        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        candidates = []
        for choice in response.choices:

            logger.info("\n===  Table Join Agent ===>\n")
            logger.info(choice.message.content + "\n")

            code_blocks = extract_code_from_gpt_response(choice.message.content + "\n", "python")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]
                try:
                    result = py_sandbox.run_join_tables_in_sandbox2020(code_str, [t['rows'] for t in input_tables])

                    if result['status'] == 'ok':
                        new_data = json.loads(result['content'])
                        result['content'] = new_data
                    else:
                        logger.info(result['content'])
                    result['code'] = code_str
                except Exception as e:
                    logger.warning('other error:')
                    logger.warning(str(e)[-1000:])
                    result = {'status': 'other error', 'content': str(e)[-1000:]} # limit error message size
            else:
                result = {'status': 'other error', 'content': 'unable to extract code from response'}

            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'TableJoinAgent'
            candidates.append(result)

        return candidates

    def run(self, input_tables, description):
        """Joins tables based on the provided description."""

        if not isinstance(input_tables, list) or len(input_tables) < 2:
            raise ValueError("TableJoinAgent expects at least two input tables in a list.")

        data_summary = generate_data_summary(input_tables, include_data_samples=True)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{description}\n\n[OUTPUT]\n"

        logger.info(user_query)

        messages = [{"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_query}]

        ###### the part that calls open_ai
        response = self.client.get_completion(messages=messages)

        return self.process_gpt_result(input_tables, response, messages)
    
    def followup(self, input_tables, dialog, new_instruction: str, n=1):
        """Follows up on a previous table join operation with a new instruction."""

        messages = [*dialog, {"role": "user",
                            "content": new_instruction + '\nupdate the join function accordingly'}]

        ##### the part that calls open_ai
        response = self.client.get_completion(messages=messages)

        return self.process_gpt_result(input_tables, response, messages)