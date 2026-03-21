# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import json

from data_formulator.agents.agent_utils import extract_json_objects, extract_code_from_gpt_response, extract_and_log_user_prompt
from data_formulator.agents.agent_sql_data_transform import get_sql_table_statistics_str, sanitize_table_name
from data_formulator.agents.prompt_guard_agent import PromptGuardAgent, extract_all_columns_from_input_tables
from data_formulator.agents.qc_chart_config import (
    get_full_qc_chart_rules, 
    get_compact_qc_chart_info,
    fix_qc_chart_encodings,
    validate_qc_chart_encodings
)

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

**CRITICAL INSTRUCTION FOR CHART TYPE HANDLING:**
- If the [GOAL] object contains a "chart_type" field with a value (e.g., "chart_type": "qc_trend_line"), you MUST use exactly that chart type in your response.
- Do NOT override or change the chart_type from [GOAL] - use it as-is in your output.
- If [GOAL] has "chart_type_source": "user_explicitly_requested", this means the user specifically asked for this chart type, so you MUST honor it.
- Only infer/suggest a chart_type if [GOAL] does NOT specify one.

1. First, based on users' [GOAL]. Create a json object that represents the inferred user intent. The json object should have the following format:

{
    "mode": "" // string, one of "infer", "overview", "distribution", "summary"
    "recap": "..." // string, a short summary of the user's goal.
    "display_instruction": "..." // string, the even shorter verb phrase describing the users' goal.
    "recommendation": "..." // string, explain why this recommendation is made
    "output_fields": ["INDEX", ...] // string[], Fields that will be in the output. This includes: (1) INDEX (if it exists in input, list it first), (2) Any NEW computed/transformed columns you create. output_fields describes the complete output including original + new columns.
    "chart_type": "" // string, one of "point", "bar", "line", "area", "heatmap", "group_bar", "boxplot", "rolling_average", "radial_plot", "linear_regression", "qc_trend_line", "qc_histogram", "qc_trend_bar", "waterfall", "radar", "pie", "donut", "bubble", "histogram", "pareto", "gauge", "funnel", "treemap", "sankey", "timeline", "pyramid", "threshold". "chart_type" should be inferred from user instruction only if explicitly mentioned; otherwise omit this field and let LLM infer from context.
    "chart_encodings": {
        "x": "",
        "y": "",
        "color": "",
        "size": "",
        "opacity": "",
        "facet": "",
    } // object: map visualization channels (x, y, color, size, opacity, facet, etc.) to a subset of output fields, appropriate visual channels for different chart types are defined below.
    
    **DEFAULT AXIS MAPPINGS (apply these if no other specification is clear):**
    - **RULE: Always check if the default column exists in the actual input data BEFORE using it**
    - If the chart has an "x" channel:
      * First, check if "INDEX" column exists in input data - if YES, use "INDEX"
      * If "INDEX" doesn't exist, look for similar ordinal/sequential columns (id, seq, num, order, etc.)
      * If no suitable column found, use the first column or leave x empty
    - If the chart has a "y" channel:
      * First, check if "VALUE" column exists in input data - if YES, use "VALUE"
      * If "VALUE" doesn't exist, look for numeric columns (amount, quantity, price, score, count, etc.)
      * If no numeric column found, use first available quantitative column or leave y empty
    - If the chart has a "color" channel:
      * First, check if "QCSTDPARAMNAME" column exists in input data - if YES, use "QCSTDPARAMNAME"
      * If "QCSTDPARAMNAME" doesn't exist, look for categorical columns (category, type, name, group, etc.)
      * If no categorical column found, use first available non-numeric column or leave color empty
}

Additional rules:
- CRITICAL: Prioritize natural language matching for chart type selection:
  * If user explicitly mentions "QC Trend Line", "QC Trend Line", "QC Trend Line", "quality control trend", use "qc_trend_line" (only if QC control limit data exists)
  * If user explicitly mentions "QC Histogram", "QC histogram", "qc histogram", "quality control histogram", use "qc_histogram" (only if QC control limit data exists)
  * If user explicitly mentions "QC Trend Bar", "QC trend bar", "qc trend bar", "quality control trend bar", use "qc_trend_bar" (only if QC control limit data exists)
  * If user explicitly mentions "linear regression", "linear regress", "regression line", use "linear_regression" chart type (NOT qc_trend_line, even if QC data exists)
  * If user only says "trend", "line chart", "line", without "QC", use "line" chart type (standard line chart)
  * If user only says "histogram", "distribution", without "QC", use "histogram" chart type (standard histogram)
  * If user only says "bar chart", "bar", use "bar" chart type
  * ALWAYS respect user's explicit chart type request - if they say a specific chart name, use exactly that chart type
- Chart types "qc_trend_line", "qc_histogram", and "qc_trend_bar" should ONLY be used when:
  - User explicitly requests the specific QC chart type AND the dataset contains QC control limit columns (TARGET, LL, UL, ARLL, ARUL)
- **IMPORTANT: Always respect the user's explicit chart type request**, regardless of data characteristics. If user requests a chart type (e.g., "linear regression", "histogram", "line", "bar") and it's in the supported list, use exactly that chart type without questioning it.
- To identify QC data, check for the presence of these control limit fields: TARGET (required), LL, UL, ARLL, ARUL. If TARGET column exists along with at least one of (LL, UL, ARLL, ARUL), then it's QC data.
  * For "qc_trend_line": Output fields must include INDEX, QCDATE, QCSHIFT, VALUE, QCSTDPARAMNAME. Also include TARGET, LL, UL, ARLL, ARUL for rendering control limit lines (these are used by frontend to display limits, not in chart_encodings).
  * For "qc_histogram": Output fields must include INDEX, VALUE, QCSTDPARAMNAME. Also include TARGET, LL, UL, ARLL, ARUL.
  * For "qc_trend_bar": Output fields must include INDEX, QCDATE, QCSHIFT, VALUE. Also include TARGET.
  * For other chart types with QC data: Keep all fields used in chart_encodings. Use QCSTDPARAMNAME as default color field if needed.
  * **NOTE ON QCDATE vs LASTUPDATE**: QCDATE is the control date, LASTUPDATE is the record timestamp. Always include both if available. Use LASTUPDATE for temporal sorting/ordering when needed.
- "qc_trend_line" means a quality control trend chart that visualizes values and control limits over time. Only use this when user explicitly requests it.
- "qc_trend_bar" means a quality control trend bar chart that visualizes categorical values and control limits. Only use this when user explicitly requests it.
- "qc_histogram" means a quality control histogram for distribution analysis. Only use this when user explicitly requests it.

**IMPORTANT: Always Use Actual Column Names from Input Data:**
- When setting chart_encodings (x, y, color, etc.), ONLY use column names that actually exist in the input data
- Do NOT use placeholder or theoretical column names that don't exist
- If default columns (INDEX, VALUE, QCSTDPARAMNAME) don't exist:
  * Look for columns with similar semantics/names in the actual data
  * For x-axis: Look for columns like ID, id, INDEX, index, row_num, seq, sequence, order
  * For y-axis: Look for columns like VALUE, value, amount, quantity, price, score, count, measure
  * For color: Look for columns like QCSTDPARAMNAME, category, type, name, group, parameter
  * If no suitable column found, you can leave that channel empty in chart_encodings
- Example: If input data has columns [id, product_name, sales_amount, date], and we need x="INDEX" and y="VALUE":
  * Use x="id" (not "INDEX"), y="sales_amount" (not "VALUE") - these are the actual column names

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
    - "chart_type" must be one of "point", "bar", "line", "area", "heatmap", "group_bar", "boxplot", "rolling_average", "radial_plot", "linear_regression", "qc_trend_line", "qc_histogram", "qc_trend_bar", "waterfall", "radar", "pie", "donut", "bubble", "histogram", "pareto", "gauge", "funnel", "treemap", "sankey", "timeline", "pyramid", "threshold"
    - "chart_encodings" should specify which fields should be used to create the visualization
        - **DEFAULT FIELD MAPPING RULES (when column choice is not explicitly requested):**
          * **CRITICAL: Always verify that the default column actually exists in the input data!**
          * If chart has "x" channel:
            - Priority 1: Use "INDEX" if it exists in the actual input columns
            - Priority 2: If no INDEX, use any ordinal/sequence/ID column
            - Priority 3: Use first column if no INDEX-like column found
          * If chart has "y" channel:
            - Priority 1: Use "VALUE" if it exists in the actual input columns
            - Priority 2: If no VALUE, use first numeric/quantitative column
            - Priority 3: Leave y empty if no quantitative column available
          * If chart has "color" channel:
            - Priority 1: Use "QCSTDPARAMNAME" if it exists in the actual input columns
            - Priority 2: If no QCSTDPARAMNAME, use first categorical/text column
            - Priority 3: Leave color empty if no suitable column available
        - decide which visual channels should be used to create the visualization appropriate for the chart type.
            - IMPORTANT: Standard charts use "x" and "y" channels. QC charts use DIFFERENT channel names - see below.
            - **CRITICAL: For all default mappings below, FIRST verify that the column (INDEX, VALUE, QCSTDPARAMNAME, etc.) actually exists in the input data. If not, use actual column names from the input data instead.**
            - Standard charts with DEFAULT mappings (verify columns exist first!):
                - point: x="INDEX" (default), y="VALUE" (default), color="QCSTDPARAMNAME" (default), size, facet
                - histogram: x="INDEX" (default), color="QCSTDPARAMNAME" (default), facet
                - bar: x="INDEX" (default), y="VALUE" (default), color="QCSTDPARAMNAME" (default), facet
                - line: x="INDEX" (default), y="VALUE" (default), color="QCSTDPARAMNAME" (default), facet
                - linear_regression: x="INDEX" (default), y="VALUE" (default), color="QCSTDPARAMNAME" (default)
                - area: x="INDEX" (default), y="VALUE" (default), color="QCSTDPARAMNAME" (default), facet
                - heatmap: x="INDEX" (default), y="VALUE" (default), color="QCSTDPARAMNAME" (default), facet
                - group_bar: x="INDEX" (default), y="VALUE" (default), color="QCSTDPARAMNAME" (default), facet
                - boxplot: x="INDEX" (default), y="VALUE" (default), color="QCSTDPARAMNAME" (default), facet
                - rolling_average: x="INDEX" (default), y="VALUE" (default), color (optional)
                - radial_plot: x="INDEX" (default), y="VALUE" (default), color (optional)
            - ⚠️ QC CHARTS (CRITICAL - DO NOT USE x, y):
                - **IMPORTANT: For QC charts, VERIFY that columns (INDEX, VALUE, QCDATE, QCSHIFT, QCSTDPARAMNAME, TARGET, LL, UL, ARLL, ARUL) exist in the actual input data. If any required column is missing, use available alternatives or note that data is incomplete for this chart type.**
                - qc_trend_line: ONLY use [INDEX, VALUE, QCDATE, QCSHIFT, color] - NEVER use x, y
                  * INDEX = x-axis (position/sequence)
                  * VALUE = y-axis (quantitative data)
                  * QCDATE & QCSHIFT = metadata for shift markers
                  * color = QCSTDPARAMNAME (default)
                - qc_histogram: ONLY use [VALUE, INDEX, color] - NEVER use x, y
                  * VALUE = data distribution
                  * INDEX = secondary field
                  * color = QCSTDPARAMNAME (default)
                - qc_trend_bar: ONLY use [VALUE, QCDATE, QCSHIFT] - NEVER use x, y, color
        - note that all fields used in "chart_encodings" should be included in "output_fields".
            - all fields you need for visualizations should be transformed into the output fields!
            - "output_fields" should include important intermediate fields that are not used in visualization but are used for data transformation.
        - typically only 2-3 fields should be used to create the visualization (x, y, color/size), facet use be added if it's a faceted visualization (totally 4 fields used).
    - Guidelines for choosing chart type and visualization fields:
        - Consider chart types as follows:
             - (point) Scatter Plots: x (DEFAULT: INDEX), y (DEFAULT: VALUE), color (DEFAULT: QCSTDPARAMNAME), size, facet
                - best for: Relationships, correlations, distributions
                - scatter plots are good default way to visualize data when other chart types are not applicable.
                - **Default mappings: x="INDEX", y="VALUE", color="QCSTDPARAMNAME" (if exists)**
                - use color to visualize points from different categories.
                - use size to visualize data points with an additional quantitative dimension of the data points.
             - (histogram) Histograms: x (DEFAULT: INDEX), color (DEFAULT: QCSTDPARAMNAME), facet
                - best for: Distribution of a quantitative field
                - **Default mappings: x="INDEX", color="QCSTDPARAMNAME" (if exists)**
                - use x values directly if x values are categorical, and transform the data into bins if the field values are quantitative.
                - when color is specified, the histogram will be grouped automatically (items with the same x values will be grouped).
             - (bar) Bar Charts: x (DEFAULT: INDEX), y (DEFAULT: VALUE), color (DEFAULT: QCSTDPARAMNAME), facet
                - best for: Comparisons across categories
                - **Default mappings: x="INDEX", y="VALUE", color="QCSTDPARAMNAME" (if exists)**
                - use (bar) for simple bar chart or stacked bar chart (when it makes sense to add up Y values for each category with the same X value), 
                    - when color is specified, the bar will be stacked automatically (items with the same x values will be stacked).
                    - note that when there are multiple rows in the data with same x values, the bar will be stacked automatically.
                        - 1. consider to use an aggregated field for y values if the value is not suitable for stacking.
                        - 2. consider to introduce facets so that each group is visualized in a separate bar.
            - (group_bar) Grouped Bar Chart: x (DEFAULT: INDEX), y (DEFAULT: VALUE), color (DEFAULT: QCSTDPARAMNAME), facet
                - best for: Comparing grouped categories
                - **Default mappings: x="INDEX", y="VALUE", color="QCSTDPARAMNAME" (if exists)**
                - when color is specified, bars from different groups will be grouped automatically.
                - only use facet if the cardinality of color field is small (less than 5).
            - (line) Line Charts: x (DEFAULT: INDEX), y (DEFAULT: VALUE), color (DEFAULT: QCSTDPARAMNAME), facet
                - best for: Trends over time, continuous data
                - **Default mappings: x="INDEX", y="VALUE", color="QCSTDPARAMNAME" (if exists)**
                - note that when there are multiple rows in the data belong to the same group (same x and color values) but different y values, the line will not look correct.
                - consider to use an aggregated field for y values, or introduce facets so that each group is visualized in a separate line.
            - (linear_regression) Linear Regression Charts: x: Quantitative (DEFAULT: INDEX), y: Quantitative (DEFAULT: VALUE), color: Categorical (DEFAULT: QCSTDPARAMNAME, optional)
                - best for: Showing correlation, trend lines, and linear relationships between two quantitative variables
                - **Default mappings: x="INDEX", y="VALUE", color="QCSTDPARAMNAME" (if exists)**
                - the frontend will automatically add regression line overlay and scatter points
            - (area) Area Charts: x (DEFAULT: INDEX), y (DEFAULT: VALUE), color (DEFAULT: QCSTDPARAMNAME), facet
                - best for: Trends over time, continuous data
                - **Default mappings: x="INDEX", y="VALUE", color="QCSTDPARAMNAME" (if exists)**
            - (heatmap) Heatmaps: x (DEFAULT: INDEX), y (DEFAULT: VALUE), color (DEFAULT: QCSTDPARAMNAME)
                - best for: Pattern discovery in matrix data
                - **Default mappings: x="INDEX", y="VALUE", color="QCSTDPARAMNAME" (if exists)**
                - note: you may need to convert quantitative values to categorical/nominal for x or y depending on data
            - QC Charts (qc_trend_line, qc_histogram, qc_trend_bar): See QC_CHART_SPECIFICATIONS section below.
        - Additional rules for QC chart visualization fields:
            Please refer to the QC_CHART_SPECIFICATIONS section (embedded below) for detailed rules on output_fields and chart_encodings for each QC chart type. The rules are FIXED and cannot be modified.
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
            
    2. Then, write a SQL query based on the inferred goal. The query input are tables (or multiple tables presented in the [CONTEXT] section) and the output is the transformed data.

**CRITICAL RULE FOR SQL QUERIES:**
- You can ADD new computed/transformed columns (like averages, ranks, etc.), but NEVER REMOVE original columns
- The input data typically already has an INDEX column - if it does, just use it directly with `SELECT *, computed_field_1, ... FROM table_name`
- Do NOT create a new INDEX column (don't use ROW_NUMBER() AS INDEX unless explicitly asked by user)
- Think of "output_fields" as the COMPUTED FIELDS TO ADD, not as the complete list of fields to keep
- If no transformation is needed, use `SELECT * FROM table` to keep all columns
- The user wants to see their complete original data PLUS any helpful new columns you generate

Example:
- Input table has columns: [INDEX, student, major, math, reading, writing]
- If user asks to "rank students", your output should have: [INDEX, student, major, math, reading, writing, rank] (ALL original + computed columns)
- NOT just [student, rank] (which removes original columns)
- Do NOT create a new INDEX by using ROW_NUMBER() - the existing INDEX column is already there

The query should be as simple as possible and easily readable.
note:
     - the sql query should be written in the style of duckdb.
     - if the user provided multiple tables, you should consider the join between tables to derive the output.

    3. The output must only contain two items:
        - a json object (wrapped in ```json```) representing the refined goal (including "mode", "recommendation", "output_fields", "chart_type", "chart_encodings")
        - a sql query block (wrapped in ```sql```) representing the transformation code, do not add any extra text explanation.

    **IMPORTANT: INDEX Column Handling**
    - "output_fields" should include "INDEX" but it typically already exists in the input data
    - Do NOT create a new INDEX column - if INDEX already exists in the input table, just use it directly
    - Only create ROW_NUMBER() AS INDEX if the input table genuinely does NOT have an INDEX column
    - **EXCEPTION - GROUP BY / AGGREGATION CASE (CRITICAL):**
      * When the user requests operations that change the row count (GROUP BY, aggregation like SUM/COUNT/AVG, DISTINCT, etc.), the number of output rows WILL DIFFER from input rows
      * In these cases, you MUST recalculate INDEX for the output using: `ROW_NUMBER() OVER (ORDER BY <sort_key>) AS INDEX`
      * The sort_key should make logical sense (e.g., ORDER BY the grouped column, or ORDER BY an aggregated measure)
      * Example: If user asks "Group by QCDATE and calculate the total VALUE for each group":
        - Input might have 1000 rows with many QCDATE values
        - Output will have only ~30 rows (one per unique QCDATE)
        - Use: `ROW_NUMBER() OVER (ORDER BY QCDATE) AS INDEX` (NOT GROUP BY INDEX)
      * Common patterns requiring INDEX recalculation:
        - GROUP BY with aggregations (SUM, COUNT, AVG, MIN, MAX)
        - DISTINCT (removes duplicate rows)
        - ORDER BY without GROUP BY (if reordering changes logical sequence)
        - Window functions that partition/reduce row count
      * Do NOT include the original INDEX in GROUP BY clause - only GROUP BY the grouping columns you want
    - INDEX should NOT be included in chart_encodings (it's a row identifier, not a visualization field)

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

**QC_CHART_SPECIFICATIONS:**

Refer to QC chart definitions embedded below. These channel and field specifications are FIXED and CANNOT be modified:
- qc_trend_line: Channels=[INDEX, VALUE, QCDATE, QCSHIFT, color] | Default color=QCSTDPARAMNAME | Include control limits (TARGET, LL, UL, ARLL, ARUL) in output_fields
- qc_histogram: Channels=[VALUE, INDEX, color] | Default color=QCSTDPARAMNAME | Include control limits (TARGET, LL, UL, ARLL, ARUL) in output_fields
- qc_trend_bar: Channels=[VALUE, QCDATE, QCSHIFT] | No color field | Include TARGET in output_fields

For detailed field mapping rules for each QC chart type, refer to the QC_CHART_SPECIFICATIONS embedded within SYSTEM_PROMPT implementation.
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

---

**GROUP BY EXAMPLE** (Showing correct INDEX recalculation):

[CONTEXT]

table_0 (qc_sample_data) fields:
    INDEX -- type: int64, values: 1, 2, 3, ..., 999, 1000 (original row numbers)
    QCDATE -- type: object, values: 2026-03-10, 2026-03-11, 2026-03-12, ...
    VALUE -- type: float64, values: 12.5, 13.2, 11.8, ..., 14.1

table_0 (qc_sample_data) sample:
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

{"goal": "Group by QCDATE and calculate the total VALUE for each group, then visualize it using a bar chart"}

[OUTPUT]

❌ WRONG: Including original INDEX in GROUP BY (would return 1000 rows - each original row):
```sql
SELECT INDEX, QCDATE, SUM(VALUE) AS TOTAL_VALUE
FROM qc_sample_data
GROUP BY INDEX, QCDATE  -- WRONG! This defeats the purpose of GROUP BY
```

✅ CORRECT: Recalculate INDEX for the output (returns ~30 rows - one per QCDATE):
```json
{
    "recap": "Group by QCDATE and calculate total VALUE for each date",
    "display_instruction": "Calculate total **VALUE** per **QCDATE**",
    "mode": "infer",
    "recommendation": "To group by QCDATE and show total VALUE per date, we aggregate the data by date. Since grouping reduces the row count from 1000 to ~30 rows, a new INDEX must be calculated for the output.",
    "output_fields": ["INDEX", "QCDATE", "TOTAL_VALUE"],
    "chart_type": "bar",
    "chart_encodings": {"x": "QCDATE", "y": "TOTAL_VALUE"}
}
```

```sql
SELECT
    ROW_NUMBER() OVER (ORDER BY QCDATE) AS INDEX,
    QCDATE,
    SUM(VALUE) AS TOTAL_VALUE
FROM qc_sample_data
GROUP BY QCDATE
ORDER BY QCDATE;
```

Key points:
- Do NOT include original INDEX in the GROUP BY clause
- Use ROW_NUMBER() OVER (ORDER BY <sort_column>) AS INDEX to create new sequence numbers for the aggregated result
- The ROW_NUMBER() produces 1, 2, 3... for the output rows (not the input rows)
"""

class SQLDataRecAgent(object):

    def __init__(self, client, conn, system_prompt=None, agent_coding_rules=""):
        self.client = client
        self.conn = conn
        self.guard = PromptGuardAgent(client=client)
        
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

            # ✅ ENFORCE INDEX REQUIREMENT: Always ensure INDEX is in output_fields
            if 'output_fields' in refined_goal and refined_goal['output_fields']:
                if 'INDEX' not in refined_goal['output_fields']:
                    logger.info("⚠️ INDEX not in output_fields, adding it automatically")
                    refined_goal['output_fields'].insert(0, 'INDEX')

            # ⚠️ VALIDATION & AUTO-FIX for QC charts
            chart_type = refined_goal.get('chart_type', '')
            chart_encodings = refined_goal.get('chart_encodings', {})
            
            if chart_type and chart_type.startswith('qc_'):
                # Try to auto-fix common LLM mistakes (x, y instead of INDEX, VALUE, etc.)
                fixed_encodings = fix_qc_chart_encodings(chart_type, chart_encodings)
                if fixed_encodings != chart_encodings:
                    refined_goal['chart_encodings'] = fixed_encodings
                    chart_encodings = fixed_encodings
                    logger.info(f"✅ Auto-corrected QC chart encodings: {fixed_encodings}")
                
                # Validate the (possibly corrected) encodings
                is_valid, errors = validate_qc_chart_encodings(chart_type, chart_encodings)
                if not is_valid:
                    for error in errors:
                        logger.warning(f"❌ {error}")
                    # Log but continue - frontend may handle it
                    refined_goal['_qc_validation_errors'] = errors

            code_blocks = extract_code_from_gpt_response(content + "\n", "sql")

            if len(code_blocks) > 0:
                code_str = code_blocks[-1]

                # ✅ INDEX HANDLING: Use existing INDEX column, don't create new ones
                # Note: Since input data typically already has INDEX column,
                # we should NOT auto-inject ROW_NUMBER() unless explicitly needed
                # The SQL from LLM should already include existing INDEX via SELECT *

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
    

    def run(self, input_tables, description, n=1, prev_messages: list[dict] = [], prompt_source: str = "user"):
        # 🛡️ Guard: Validate prompt before processing
        # Skip guard validation for agent-generated prompts
        if prompt_source == "user":
            # Extract columns from input_tables for QC data validation
            data_columns = extract_all_columns_from_input_tables(input_tables)
            guard_result = self.guard.validate(description, data_columns=data_columns)
            if not guard_result["ok"]:
                logger.info(f"🚫 Prompt blocked by guard: {guard_result['reason']}")
                return [{
                    "status": "blocked",
                    "code": "",
                    "content": guard_result["user_message"],
                    "agent": "SQLDataRecAgent",
                    "refined_goal": {
                        "mode": "",
                        "recommendation": guard_result["reason"],
                        "output_fields": [],
                        "chart_encodings": {},
                        "chart_type": ""
                    },
                    "guard": guard_result,
                    "dialog": [*prev_messages, {"role": "user", "content": description}],
                }]
        else:
            logger.info(f"✅ Skipping guard validation for agent-generated prompt: '{description[:50]}...'")
        
        data_summary = ""
        qc_notes = []

        # Detect if user specified an explicit chart type in the description or in previous messages
        search_text = description + " " + " ".join([msg.get('content','') for msg in prev_messages])
        logger.info(f"🔍 Searching for explicit chart type in text: '{search_text[:100]}'...")
        # Robust regex patterns to capture common chart requests (variants, spaces, hyphens, and phrases)
        # Patterns ordered by specificity (most specific first) to avoid false matches
        chart_patterns = [
            (r'\bqc[_\s-]*trend[_\s-]*line\b', 'qc_trend_line'),
            (r'\bqc[_\s-]*trend[_\s-]*bar\b', 'qc_trend_bar'),
            (r'\bqc[_\s-]*histogram\b', 'qc_histogram'),
            (r'\btrend[_\s-]*line\b', 'line'),
            (r'\btrend[_\s-]*bar\b', 'bar'),
            (r'\bbar[_\s-]*chart\b', 'bar'),
            (r'\bline[_\s-]*chart\b', 'line'),
            (r'\bhistogram\b', 'histogram'),
            (r'\bscatter[_\s-]*plot\b', 'point'),
            (r'\bscatter\b', 'point'),
            (r'\bpoint\b', 'point'),
            (r'\barea[_\s-]*chart\b', 'area'),
            (r'\barea\b', 'area'),
            (r'\bheat[_\s-]*map\b', 'heatmap'),
            (r'\bgroup[_\s-]*bar\b', 'group_bar'),
            (r'\bstacked[_\s-]*bar\b', 'stacked_bar'),
            (r'\bpie[\s-]*chart\b', 'pie'),
            (r'\bpie\b', 'pie'),
            (r'\bdonut[\s-]*chart\b', 'donut'),
            (r'\bdonut\b', 'donut'),
            (r'\bbubble[\s-]*plot\b', 'bubble'),
            (r'\bbubble[\s-]*chart\b', 'bubble'),
            (r'\bbubble\b', 'bubble'),
            (r'\bradar[\s-]*chart\b', 'radar'),
            (r'\bradar\b', 'radar'),
            (r'\bwaterfall[\s-]*chart\b', 'waterfall'),
            (r'\bwaterfall\b', 'waterfall'),
            (r'\bfunnel[\s-]*chart\b', 'funnel'),
            (r'\bfunnel\b', 'funnel'),
            (r'\bsankey[\s-]*diagram\b', 'sankey'),
            (r'\bsankey\b', 'sankey'),
            (r'\btree[\s-]*map\b', 'tree'),
            (r'\btreemap\b', 'tree'),
            (r'\btree\b', 'tree'),
            (r'\bnetwork[\s-]*diagram\b', 'network'),
            (r'\bnetwork[\s-]*graph\b', 'network'),
            (r'\bnetwork\b', 'network'),
            (r'\bboxplot\b', 'boxplot'),
            (r'\bviolin[\s-]*plot\b', 'violin'),
            (r'\bviolins\b', 'violin'),
            (r'\brectangle[\s-]*tree\b', 'rect_tree'),
            (r'\brect[\s-]*tree\b', 'rect_tree'),
            (r'\bsunburst\b', 'sunburst'),
            (r'\brolling[_\s-]*average\b', 'rolling_average'),
            (r'\blinear[_\s-]*regression\b', 'linear_regression'),
            (r'\bradial[_\s-]*plot\b', 'radial_plot'),
            (r'\bpareto[\s-]*chart\b', 'pareto'),
            (r'\bpareto\b', 'pareto'),
            (r'\bgauge[\s-]*chart\b', 'gauge'),
            (r'\bgauge\b', 'gauge'),
            (r'\btimeline[\s-]*chart\b', 'timeline'),
            (r'\btimeline\b', 'timeline'),
            (r'\bpyramid[\s-]*chart\b', 'pyramid'),
            (r'\bpyramid\b', 'pyramid'),
            (r'\bthreshold[\s-]*chart\b', 'threshold'),
            (r'\bthreshold\b', 'threshold')
        ]
        specified_chart = False
        extracted_chart_type = None
        for pat, chart_type in chart_patterns:
            if re.search(pat, search_text, re.I):
                specified_chart = True
                extracted_chart_type = chart_type
                logger.info(f"📊 ✅ Explicitly detected chart type request: '{chart_type}' (matched pattern: {pat})")
                break

        for table in input_tables:
            table_name = sanitize_table_name(table['name'])
            table_summary_str = get_sql_table_statistics_str(self.conn, table_name)
            data_summary += f"[TABLE {table_name}]\n\n{table_summary_str}\n\n"


        # Build structured GOAL to send to the model
        # ⚠️ RULE: Only include chart_type if user explicitly requested it
        # Do NOT auto-suggest chart types based on data characteristics
        if extracted_chart_type:
            goal_obj = {"description": description, "chart_type": extracted_chart_type, "chart_type_source": "user_explicitly_requested"}
            logger.info(f"✅ User explicitly requested chart type '{extracted_chart_type}' - this MUST be honored in output")
        else:
            goal_obj = {"description": description}
            logger.info("ℹ️ No explicit chart type specified - LLM will infer from description")

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
        
        logger.info("Messages sent to LLM:" + json.dumps(messages))
        
        # Log user prompt to ClickHouse
        #extract_and_log_user_prompt(messages, "SQLDataRecAgent")
        
        response = self.client.get_completion(messages = messages)
        
        return self.process_gpt_response(input_tables, messages, response)
        

    def followup(self, input_tables, dialog, latest_data_sample, new_instruction: str, n=1):
        """extend the input data (in json records format) to include new fields
        latest_data_sample: the latest data sample that the user is working on, it's a json object that contains the data sample of the current table
        new_instruction: the new instruction that the user wants to add to the latest data sample
        """
        # Note: Guard validation already ran in run() method for the initial prompt
        # Followup refinements don't need re-validation - guard is a one-time check

        logger.info(f"GOAL: \n\n{new_instruction}")

        # get the current table name
        sample_data_str = pd.DataFrame(latest_data_sample).head(10).to_string() + '\n......'

        messages = [*dialog, 
                    {"role":"user", 
                    "content": f"This is the result from the latest sql query:\n\n{sample_data_str}\n\nUpdate the sql query above based on the following instruction:\n\n{new_instruction}"}]

        # Log user prompt to ClickHouse
        #extract_and_log_user_prompt(messages, "SQLDataRecAgent")
        
        response = self.client.get_completion(messages = messages)

        return self.process_gpt_response(input_tables, messages, response)