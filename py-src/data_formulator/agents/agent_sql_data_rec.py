# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response
from data_formulator.agents.agent_sql_data_transform import get_sql_table_statistics_str, sanitize_table_name

import random
import string

import traceback
import duckdb
import pandas as pd

import logging
import re

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = '''You are a data scientist to help user to recommend data that will be used for visualization.
The user will provide you information about what visualization they would like to create, and your job is to recommend a transformed data that can be used to create the visualization and write a SQL query to transform the data.
The recommendation and transformation function should be based on the [CONTEXT] and [GOAL] provided by the user. 
The [CONTEXT] shows what the current dataset is, and the [GOAL] describes what the user wants the data for.

**Important:**
- NEVER make assumptions or judgments about a person's gender, biological sex, sexuality, religion, race, nationality, ethnicity, political stance, socioeconomic status, mental health, invisible disabilities, medical conditions, personality type, social impressions, emotional state, and cognitive state.
- NEVER create formulas that could be used to discriminate based on age. Ageism of any form (explicit and implicit) is strictly prohibited.
- If above issue occurs, generate columns with NULL.

Concretely, you should infer the appropriate data and create a SQL query based off the [CONTEXT] and [GOAL] in two steps:

1. First, based on users' [GOAL]. Create a json object that represents the inferred user intent. The json object should have the following format:

{
    "mode": "" // string, one of "infer", "overview", "distribution", "summary"
    "recap": "..." // string, a short summary of the user's goal.
    "display_instruction": "..." // string, the even shorter verb phrase describing the users' goal.
    "recommendation": "..." // string, explain why this recommendation is made
    "output_fields": [...] // string[], describe the desired output fields that the output data should have (i.e., the goal of transformed data), it's a good idea to preseve intermediate fields here
    "chart_type": "" // string, one of "point", "bar", "line", "area", "heatmap", "group_bar", "boxplot", "rolling_average", "radial_plot", "qc_trend_line", "qc_histogram", "qc_trend_bar", "waterfall", "radar", "pie", "donut", "bubble", "histogram", "pareto", "gauge", "funnel", "treemap", "sankey", "timeline", "pyramid", "threshold". "chart_type" should either be inferred from user instruction, or recommend if the user didn't specify any.
    "chart_encodings": {
        "x": "",
        "y": "",
        "color": "",
        "size": "",
        "opacity": "",
        "facet": "",
    } // object: map visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of output fields, appropriate visual channels for different chart types are defined below.
}

Additional rules:
- CRITICAL: Prioritize natural language matching for chart type selection:
  * If user explicitly mentions "QC Trend Line", "QC Trend Line", "QC Trend Line", "quality control trend", use "qc_trend_line" (only if QC control limit data exists)
  * If user explicitly mentions "QC Histogram", "QC histogram", "qc histogram", "quality control histogram", use "qc_histogram" (only if QC control limit data exists)
  * If user explicitly mentions "QC Trend Bar", "QC trend bar", "qc trend bar", "quality control trend bar", use "qc_trend_bar" (only if QC control limit data exists)
  * If user only says "trend", "line chart", "line", without "QC", use "line" chart type (standard line chart)
  * If user only says "histogram", "distribution", without "QC", use "histogram" chart type (standard histogram)
  * If user only says "bar chart", "bar", use "bar" chart type
  * ALWAYS respect user's explicit chart type request - if they say a specific chart name, use exactly that chart type
- Chart types "qc_trend_line", "qc_histogram", and "qc_trend_bar" should ONLY be used in two cases:
  1. User explicitly requests the specific QC chart type AND the dataset contains QC control limit columns (TARGET, LL, UL, ARLL, ARUL)
  2. User does NOT specify any chart type, the dataset contains QC control limit columns (TARGET and at least one of LL, UL, ARLL, ARUL), then auto-suggest based on VALUE type: if VALUE is numeric (int64, float64, etc.), use "qc_trend_line"; if VALUE is not numeric, use "qc_trend_bar"
- If user requests a non-QC chart type (like "histogram", "line", "bar") even when QC data exists, respect their choice and use the standard chart type they requested.
- To identify QC data, check for the presence of these control limit fields: TARGET (required), LL, UL, ARLL, ARUL. If TARGET column exists along with at least one of (LL, UL, ARLL, ARUL), then it's QC data.
- If the dataset includes QC-related columns (e.g., TARGET, VALUE, INDEX, LL, UL, QCSTDPARAMNAME, LASTUPDATE, QCDATE, QCSHIFT, ARLL, ARUL), keep only the necessary fields based on the chart type:
  * For "qc_trend_line": Keep QCDATE, QCSHIFT, INDEX, VALUE, and QCSTDPARAMNAME (as color field) in output_fields. Also keep TARGET, LL, UL, ARLL, ARUL for rendering control limit lines (but don't include them in chart_encodings). IMPORTANT: Always use LASTUPDATE for date/time axis, NEVER use QCDATE. Default color field is QCSTDPARAMNAME.
  * For "qc_histogram": Keep VALUE, INDEX, and QCSTDPARAMNAME (as color field) in output_fields. Also keep TARGET, LL, UL, ARLL, ARUL for rendering control limit lines (but don't include them in chart_encodings). Default color field is QCSTDPARAMNAME.
  * For "qc_trend_bar": Keep QCDATE, QCSHIFT, VALUE in output_fields. 
  * For other chart types with QC data: Only keep fields that are actually used in chart_encodings. If you need a date/time field for X-axis, use INDEX. Use QCSTDPARAMNAME as default color field.
  * QCDATE always needs to be included in output_fields even though it's not used in chart_encodings. chanel QCDATE = "QCDATE". Nver user LASTUPDATE in QCDATE chanel.
- "qc_trend_line" means a quality control trend chart that visualizes values and control limits over time. Only use this when user explicitly requests it or when auto-suggesting for QC data with numeric VALUE.
- "qc_trend_bar" means a quality control trend bar chart that visualizes categorical values and control limits. Only use this when user explicitly requests it or when auto-suggesting for QC data with string VALUE.
- "qc_histogram" means a quality control histogram for distribution analysis. Only use this when user explicitly requests it.

Concretely:
    - recap what the user's goal is in a short summary in "recap".
    - If the user's [GOAL] is clear already, simply infer what the user mean. Set "mode" as "infer" and create "output_fields" and "chart_encodings" based off user description.
    - If the user's [GOAL] is not clear, make recommendations to the user:
        - choose one of "distribution", "overview", "summary" in "mode":
            * if it is "overview" and the data is in wide format, reshape it into long format.
            * if it is "distribution", select a few fields that would be interesting to visualize together.
            * if it is "summary", calculate some aggregated statistics to show intresting facts of the data.
        - describe the recommendation reason in "recommendation"
        - based on the recommendation, determine what is an ideal output data. Note, the output data must be in tidy format.
        - then suggest recommendations of chart encoding that should be used to create the visualization.
    - "display_instruction" should be a short verb phrase describing the users' goal, it should be even shorter than "recap". 
        - it would be a short verbal description of user intent as a verb phrase (<12 words).
        - generate based on "recap" and the suggested visualization, but don't need to mention the visualization details.
        - should capture key computation ideas: by reading the display, the user can understand the purpose and what's derived from the data.
        - if the user instruction builds up the previous instruction, the 'display_instruction' should only describe how it builds up the previous instruction without repeating information from previous steps.
        - the phrase can be presented in different styles, e.g., question (what's xxx), instruction (show xxx), description, etc.
        - if you mention column names from the input or the output data, highlight the text in **bold**.
            * the column can either be a column in the input data, or a new column that will be computed in the output data.
            * the mention don't have to be exact match, it can be semantically matching, e.g., if you mentioned "average score" in the text while the column to be computed is "Avg_Score", you should still highlight "**average score**" in the text.
    - "chart_type" must be one of "point", "bar", "line", "area", "heatmap", "group_bar", "boxplot", "rolling_average", "radial_plot", "qc_trend_line", "qc_histogram", "waterfall", "radar", "pie", "donut", "bubble", "histogram", "pareto", "gauge", "funnel", "treemap", "sankey", "timeline", "pyramid", "threshold"
    - "chart_encodings" should specify which fields should be used to create the visualization
        - decide which visual channels should be used to create the visualization appropriate for the chart type.
            - point: x, y, color, size, facet
            - histogram: x, color, facet
            - bar: x, y, color, facet
            - line: x, y, color, facet
            - area: x, y, color, facet
            - heatmap: x, y, color, facet
            - group_bar: x, y, color, facet
            - qc_trend_line: INDEX, VALUE, QCDATE, QCSHIFT, color (use QCSTDPARAMNAME as default color field for categorical grouping)
            - qc_histogram: VALUE, INDEX, color (use QCSTDPARAMNAME as default color field)
            - qc_trend_bar: VALUE, QCDATE, QCSHIFT
            - boxplot: x, y, color, facet
            - rolling_average: x (temporal), y (quantitative), color (optional)
            - radial_plot: x (categorical), y (quantitative), color (optional)
        - note that all fields used in "chart_encodings" should be included in "output_fields".
            - all fields you need for visualizations should be transformed into the output fields!
            - "output_fields" should include important intermediate fields that are not used in visualization but are used for data transformation.
        - typically only 2-3 fields should be used to create the visualization (x, y, color/size), facet use be added if it's a faceted visualization (totally 4 fields used).
    - Guidelines for choosing chart type and visualization fields:
        - Consider chart types as follows:
             - (point) Scatter Plots: x,y: Quantitative/Categorical, color: Categorical (optional), size: Quantitative (optional for creating bubble chart), 
                - best for: Relationships, correlations, distributions
                - scatter plots are good default way to visualize data when other chart types are not applicable.
                - use color to visualize points from different categories.
                - use size to visualize data points with an additional quantitative dimension of the data points.
             - (histogram) Histograms: x: Quantitative/Categorical, color: Categorical (optional for creating grouped histogram), 
                - best for: Distribution of a quantitative field
                - use x values directly if x values are categorical, and transform the data into bins if the field values are quantitative.
                - when color is specified, the histogram will be grouped automatically (items with the same x values will be grouped).
             - (bar) Bar Charts: x: Categorical (nominal/ordinal), y: Quantitative, color: Categorical/Quantitative (for stacked bar chart / showing additional quantitative dimension), 
                - best for: Comparisons across categories
                - use (bar) for simple bar chart or stacked bar chart (when it makes sense to add up Y values for each category with the same X value), 
                    - when color is specified, the bar will be stacked automatically (items with the same x values will be stacked).
                    - note that when there are multiple rows in the data with same x values, the bar will be stacked automatically.
                        - 1. consider to use an aggregated field for y values if the value is not suitable for stacking.
                        - 2. consider to introduce facets so that each group is visualized in a separate bar.
            - (group_bar) for grouped bar chart, x: Categorical (nominal/ordinal), y: Quantitative, color: Categorical
                - when color is specifed, bars from different groups will be grouped automatically.
                - only use facet if the cardinality of color field is small (less than 5).
            - (line) Line Charts: x: Temporal (preferred) or ordinal, y: Quantitative, color: Categorical (optional for creating multiple lines), 
                - best for: Trends over time, continuous data
                - note that when there are multiple rows in the data belong to the same group (same x and color values) but different y values, the line will not look correct.
                - consider to use an aggregated field for y values, or introduce facets so that each group is visualized in a separate line.
            - (area) Area Charts: x: Temporal (preferred) or ordinal, y: Quantitative, color: Categorical (optional for creating stacked areas), 
                - best for: Trends over time, continuous data
            - (heatmap) Heatmaps: x,y: Categorical (you need to convert quantitative to nominal), color: Quantitative intensity, 
                - best for: Pattern discovery in matrix data
            - (qc_trend_line) QC Trend Line Charts: INDEX: INDEX or LASTUPDATE (temporal/ordinal), VALUE: VALUE (quantitative), control limits: LL, UL, ARLL, ARUL
                - best for: Quality control monitoring, tracking values against control limits over time
                - Include LL, UL, ARLL, ARUL fields as reference lines for control limits
                - color can be used for categorization (e.g., QCSTDPARAMNAME)
            - (qc_histogram) QC Histogram: VALUE: VALUE or quantitative field, color: Categorical (optional)
                - best for: Distribution analysis of QC values
            - (qc_trend_bar) QC Trend Bar Charts: VALUE: VALUE (categorical)
        - Additional rules for QC chart visualization fields:
            - For chart_type = "qc_trend_line":
                * chart_encodings should ONLY include: {"INDEX": "INDEX", "VALUE": "VALUE", "QCDATE": "QCDATE", "QCSHIFT": "QCSHIFT", "color": "QCSTDPARAMNAME"}              
                * Do NOT include LL, UL, ARLL, ARUL, TARGET, QCDATE in chart_encodings (they are used internally by postProcessor or are metadata only)
                * output_fields should include: INDEX, VALUE, QCDATE, QCSHIFT, QCSTDPARAMNAME, plus TARGET, LL, UL, ARLL, ARUL for control limits
                * DEFAULT: Always use QCSTDPARAMNAME as the color field for categorical grouping
            - For chart_type = "qc_histogram":
                * chart_encodings should ONLY include: {"VALUE": "VALUE", "INDEX": "INDEX", "color": "QCSTDPARAMNAME"}. Never include x-axis field.
                * Do NOT include LL, UL, ARLL, ARUL, TARGET in chart_encodings (they are used internally by postProcessor)
                * output_fields should include: VALUE, INDEX, QCSTDPARAMNAME, plus TARGET, LL, UL, ARLL, ARUL for control limits
                * DEFAULT: Always use QCSTDPARAMNAME as the color field
            - For chart_type = "qc_trend_bar":
                * chart_encodings should ONLY include: {"VALUE": "VALUE", "QCDATE": "QCDATE", "QCSHIFT": "QCSHIFT"}
                * Do NOT include LL, UL, ARLL, ARUL, TARGET in chart_encodings (they are used internally by postProcessor)
                * output_fields should include: VALUE, QCDATE, QCSHIFT
            - For chart_type = "line" with time-related columns:
                * For non-QC data, use available temporal fields like "DATE", "TIME", "LASTUPDATE", "INDEX"
        - facet channel is available for all chart types, it supports a categorical field with small cardinality to visualize the data in different facets.
        - if you really need additional legend fields:
            - you can use opacity for legend (support Quantitative and Categorical).
    - visualization fields require tidy data. 
        - similar to VegaLite and ggplot2 so that each field is mapped to a visualization axis or legend. 
        - consider data transformations if you want to visualize multiple fields together:
            - exapmle 1: suggest reshaping the data into long format in data transformation description (if these fields are all of the same type, e.g., they are all about sales, price, two columns about min/max-values, etc. don't mix different types of fields in reshaping) so we can visualize multiple fields as categories or in different facets.
            - exapmle 2: calculate some derived fields from these fields(e.g., correlation, difference, profit etc.) in data transformation description to visualize them in one visualization.
            - example 3: create a visualization only with a subset of the fields, you don't have to visualize all of them in one chart, you can later create a visualization with the rest of the fields. With the subset of charts, you can also consider reshaping or calculate some derived value.
            - again, it does not make sense to have five fields like [item, A, B, C, D, E] in visualization fields, you should consider data transformation to reduce the number of fields.
            - when reshaping data to long format, only fields of the same semantic type should be rehaped into the same column.
            
    2. Then, write a SQL query based on the inferred goal, the query input are tables (or multiple tables presented in the [CONTEXT] section) and the output is the transformed data. The output data should contain all "output_fields" from the refined goal.
The query should be as simple as possible and easily readable. If there is no data transformation needed based on "output_fields", the transformation function can simply "SELECT * FROM table".
note:   
     - the sql query should be written in the style of duckdb.
     - if the user provided multiple tables, you should consider the join between tables to derive the output.

    3. The output must only contain two items:
        - a json object (wrapped in ```json```) representing the refined goal (including "mode", "recommendation", "output_fields", "chart_type", "chart_encodings")
        - a sql query block (wrapped in ```sql```) representing the transformation code, do not add any extra text explanation.

some notes:
- in DuckDB, you escape a single quote within a string by doubling it ('') rather than using a backslash (\').
- in DuckDB, you need to use proper date functions to perform date operations.
- Critical: When using date/time functions in DuckDB, always cast date columns to explicit types to avoid function overload ambiguity:
  * Use `CAST(date_column AS DATE)` for date operations
  * Use `CAST(datetime_column AS TIMESTAMP)` for timestamp operations
  * Use `CAST(datetime_column AS TIMESTAMP_NS)` for nanosecond precision timestamps
  * Common patterns:
    - Extract year: `CAST(strftime('%Y', CAST(date_column AS DATE)) AS INTEGER) AS year`
    - Extract month: `CAST(strftime('%m', CAST(date_column AS DATE)) AS INTEGER) AS month`
    - Format date: `strftime('%Y-%m-%d', CAST(date_column AS DATE)) AS formatted_date`
    - Date arithmetic: `CAST(date_column AS DATE) + INTERVAL 1 DAY`
  * This prevents "Could not choose a best candidate function" errors in DuckDB
- Critical: DuckDB regex limitations:
  * Does NOT support Unicode escape sequences like \\u0400-\\u04FF
  * For Unicode character detection, use character ranges directly: [а-яА-Я] for Cyrillic, [一-龥] for Chinese, etc.
  * Alternative: Use ASCII ranges or specific character sets that DuckDB supports
  * Example: Instead of quote ~ '[\\u0400-\\u04FF]', use quote ~ '[а-яА-ЯёЁ]'
'''

example = """
For example:

[CONTEXT]

Here are our datasets, here are their field summaries and samples:

table_0 (student_exam) fields:
	student -- type: int64, values: 1, 2, 3, ..., 997, 998, 999, 1000
	major -- type: object, values: liberal arts, science
	math -- type: int64, values: 0, 8, 18, ..., 97, 98, 99, 100
	reading -- type: int64, values: 17, 23, 24, ..., 96, 97, 99, 100
	writing -- type: int64, values: 10, 15, 19, ..., 97, 98, 99, 100

table_0 (student_exam) sample:

```
|student|major|math|reading|writing
0|1|liberal arts|72|72|74
1|2|liberal arts|69|90|88
2|3|liberal arts|90|95|93
3|4|science|47|57|44
4|5|science|76|78|75
......
```

[GOAL]

{"goal": "Rank students based on their average scores"}

[OUTPUT]

```json
{  
    "recap": "Rank students based on their average scores",
    "display_instruction": "Rank students by **average scores**",
    "mode": "infer",
    "recommendation": "To rank students based on their average scores, we need to calculate the average score for each student, then sort the data, and finally assign a rank to each student based on their average score.",  
    "output_fields": ["student", "major", "average_score", "rank"],  
    "chart_type": "bar",  
    "chart_encodings": {"x": "student", "y": "average_score"}  
}  
```

```sql
SELECT   
    student,  
    major,  
    (math + reading + writing) / 3.0 AS average_score,  
    RANK() OVER (ORDER BY (math + reading + writing) / 3.0 DESC) AS rank  
FROM   
    student_exam  
ORDER BY average_score DESC;
```
"""

class SQLDataRecAgent(object):

    def __init__(self, client, conn, system_prompt=None, agent_coding_rules=""):
        self.client = client
        self.conn = conn
        
        # Incorporate agent coding rules into system prompt if provided
        if system_prompt is not None:
            self.system_prompt = system_prompt
        else:
            base_prompt = SYSTEM_PROMPT
            if agent_coding_rules and agent_coding_rules.strip():
                self.system_prompt = base_prompt + "\n\n[AGENT CODING RULES]\nPlease follow these rules when generating code. Note: if the user instruction conflicts with these rules, you should priortize user instructions.\n\n" + agent_coding_rules.strip()
            else:
                self.system_prompt = base_prompt

    def process_gpt_response(self, input_tables, messages, response):
        """process gpt response to handle execution"""

        #log = {'messages': messages, 'response': response.model_dump(mode='json')}

        if isinstance(response, Exception):
            result = {'status': 'other error', 'content': str(response.body)}
            return [result]
        
        candidates = []
        for choice in response.choices:
            
            logger.info("\n=== Data recommendation result ===>\n")
            logger.info(choice.message.content + "\n")

            # Detect if the model returned HTML or other unexpected formats (e.g., an HTML error page)
            content = choice.message.content if hasattr(choice.message, 'content') else str(choice)
            lower_content = content.lower()
            if '<!doctype' in lower_content or '<html' in lower_content:
                logger.warning("Model returned HTML content instead of JSON/SQL.")
                result = {
                    'status': 'error',
                    'code': "",
                    'content': f"Model returned HTML/unknown format in response: {content[:1000]}"
                }

                result['dialog'] = [*messages, {"role": choice.message.role, "content": content}]
                result['agent'] = 'SQLDataRecAgent'
                result['refined_goal'] = { 'mode': "", 'recommendation': "", 'output_fields': [], 'chart_encodings': {}, 'chart_type': "" }
                candidates.append(result)
                continue

            json_blocks = extract_json_objects(content + "\n")
            if len(json_blocks) > 0:
                refined_goal = json_blocks[0]
            else:
                refined_goal = { 'mode': "", 'recommendation': "", 'output_fields': [], 'chart_encodings': {}, 'chart_type': "" }

            code_blocks = extract_code_from_gpt_response(content + "\n", "sql")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]

                try:
                    random_suffix = ''.join(random.choices(string.ascii_lowercase, k=4))
                    table_name = f"view_{random_suffix}"
                    
                    create_query = f"CREATE VIEW IF NOT EXISTS {table_name} AS {code_str}"
                    self.conn.execute(create_query)
                    self.conn.commit()

                    # Check how many rows are in the table
                    row_count = self.conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
                    
                    # Only limit to 5000 if there are more rows
                    query_output = self.conn.execute(f"SELECT * FROM {table_name} LIMIT 5000").fetch_df()
                
                    result = {
                        "status": "ok",
                        "code": code_str,
                        "content": {
                            'rows': json.loads(query_output.to_json(orient='records')),
                            'virtual': {
                                'table_name': table_name,
                                'row_count': row_count
                            }
                        },
                    }
                except duckdb.BinderException as e:
                    error_str = str(e)
                    if "Could not choose a best candidate function" in error_str:
                        logger.warning(f"DuckDB type ambiguity error: {error_str}")
                        result = {
                            'status': 'sql_error', 
                            'code': code_str, 
                            'content': f"SQL type casting required. DuckDB needs explicit type casting for date/time functions. Error: {error_str}. Please cast date columns to specific types (DATE, TIMESTAMP, etc.) before using date functions."
                        }
                    else:
                        logger.warning(f"DuckDB binder error: {error_str}")
                        result = {
                            'status': 'sql_error', 
                            'code': code_str, 
                            'content': f"SQL error: {error_str}"
                        }
                except Exception as e:
                    logger.warning('other error:')
                    error_message = traceback.format_exc()
                    logger.warning(error_message)
                    result = {'status': 'other error', 'code': code_str, 'content': f"Unexpected error: {error_message}"}
            else:
                result = {'status': 'error', 'code': "", 'content': "No code block found in the response. The model is unable to generate code to complete the task."}
            
            result['dialog'] = [*messages, {"role": choice.message.role, "content": choice.message.content}]
            result['agent'] = 'SQLDataRecAgent'
            result['refined_goal'] = refined_goal
            candidates.append(result)

        logger.info("=== Recommendation Candidates ===>")
        for candidate in candidates:
            for key, value in candidate.items():
                if key in ['dialog', 'content']:
                    logger.info(f"##{key}:\n{str(value)[:1000]}...")
                else:
                    logger.info(f"## {key}:\n{value}")

        return candidates
    

    def run(self, input_tables, description, n=1, prev_messages: list[dict] = []):
        data_summary = ""
        qc_notes = []
        has_qc_numeric = False
        has_qc_non_numeric = False

        # Detect if user specified an explicit chart type in the description or in previous messages
        search_text = description + " " + " ".join([msg.get('content','') for msg in prev_messages])
        # Robust regex patterns to capture common chart requests (variants, spaces, hyphens, and phrases)
        chart_patterns = [
            r'\bqc[_\s-]*trend[_\s-]*line\b',
            r'\bqc[_\s-]*trend[_\s-]*bar\b',
            r'\bqc[_\s-]*histogram\b',
            r'\btrend[_\s-]*line\b',
            r'\btrend[_\s-]*bar\b',
            r'\bbar[_\s-]*chart\b',
            r'\bline[_\s-]*chart\b',
            r'\bhistogram\b',
            r'\bscatter\b',
            r'\bpoint\b',
            r'\barea\b',
            r'\bheatmap\b',
            r'\bgroup[_\s-]*bar\b',
            r'\bpie\b',
            r'\bdonut\b'
        ]
        specified_chart = False
        for pat in chart_patterns:
            if re.search(pat, search_text, re.I):
                specified_chart = True
                break

        for table in input_tables:
            table_name = sanitize_table_name(table['name'])
            table_summary_str = get_sql_table_statistics_str(self.conn, table_name)
            data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"

            # Detect QC data and VALUE type
            try:
                cols = self.conn.execute(f"DESCRIBE {table_name}").fetchall()
                col_types = {col[0].upper(): col[1].upper() for col in cols}
                qc_fields = {"LL", "UL", "ARLL", "ARUL"}
                has_qc = "TARGET" in col_types and bool(qc_fields.intersection(col_types.keys()))
                if has_qc and "VALUE" in col_types and not specified_chart:
                    val_type = col_types["VALUE"]
                    numeric_types = {"INTEGER", "INT", "DOUBLE", "DECIMAL", "FLOAT", "REAL", "NUMERIC", "BIGINT", "SMALLINT"}

                    # First, try to infer from the declared column type
                    is_numeric = any(nt in val_type for nt in numeric_types)

                    # If DESCRIBE is not definitive, sample the first non-null VALUE row to infer type
                    if not is_numeric:
                        try:
                            sample_row = self.conn.execute(f"SELECT VALUE FROM {table_name} WHERE VALUE IS NOT NULL LIMIT 1").fetchone()
                            if sample_row and len(sample_row) > 0:
                                sample_val = sample_row[0]
                                if isinstance(sample_val, (int, float)):
                                    is_numeric = True
                                elif isinstance(sample_val, str):
                                    v = sample_val.strip()
                                    # If the string looks like a number, consider numeric
                                    if re.match(r'^-?\d+(?:\.\d+)?$', v):
                                        is_numeric = True
                        except Exception:
                            # if sampling fails, fall back to declared type
                            pass

                    if is_numeric:
                        has_qc_numeric = True
                        qc_notes.append(f"Table {table_name} contains QC control fields and VALUE is numeric (inferred type: {val_type}). Recommend selecting **qc_trend_line** when user did not request a specific chart type.")
                    else:
                        has_qc_non_numeric = True
                        qc_notes.append(f"Table {table_name} contains QC control fields and VALUE is non-numeric (inferred type: {val_type}). Recommend selecting **qc_trend_bar** when user did not request a specific chart type.")
            except Exception:
                # ignore detection errors and proceed
                pass

        # Decide suggested chart type when the user did not specify one
        suggested_chart_type = None
        suggested_reason = None
        if not specified_chart:
            if has_qc_numeric and not has_qc_non_numeric:
                suggested_chart_type = "qc_trend_line"
                suggested_reason = "QC data present and VALUE is numeric"
            elif has_qc_non_numeric and not has_qc_numeric:
                suggested_chart_type = "qc_trend_bar"
                suggested_reason = "QC data present and VALUE is non-numeric"
            elif has_qc_numeric and has_qc_non_numeric:
                # Mix of numeric and non-numeric VALUE across tables; prefer qc_trend_line and leave a note
                suggested_chart_type = "qc_trend_line"
                suggested_reason = "Mixed VALUE types across QC tables; prefer numeric trend line by default"

        # Build structured GOAL to send to the model (more deterministic than appending free text)
        if suggested_chart_type:
            goal_obj = {"description": description, "chart_type": suggested_chart_type, "chart_type_reason": suggested_reason}
        else:
            goal_obj = {"description": description}

        user_goal_str = json.dumps(goal_obj, indent=4)

        user_query = f"[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{user_goal_str}"
        if len(prev_messages) > 0:
            user_query = f"The user wants a new recommendation based off the following updated context and goal:\n\n[CONTEXT]\n\n{data_summary}\n\n[GOAL]\n\n{user_goal_str}"

        logger.info(user_query)

        # Filter out system messages from prev_messages
        filtered_prev_messages = [msg for msg in prev_messages if msg.get("role") != "system"]

        messages = [{"role":"system", "content": self.system_prompt},
                    *filtered_prev_messages,
                    {"role":"user","content": user_query}]
        
        response = self.client.get_completion(messages = messages)
        
        return self.process_gpt_response(input_tables, messages, response)
        

    def followup(self, input_tables, dialog, latest_data_sample, new_instruction: str, n=1):
        """extend the input data (in json records format) to include new fields
        latest_data_sample: the latest data sample that the user is working on, it's a json object that contains the data sample of the current table
        new_instruction: the new instruction that the user wants to add to the latest data sample
        """

        logger.info(f"GOAL: \n\n{new_instruction}")

        # get the current table name
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        messages = [*dialog, 
                    {"role":"user", 
                    "content": f"This is the result from the latest sql query:\n\n{sample_data_str}\n\nUpdate the sql query above based on the following instruction:\n\n{new_instruction}"}]

        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)