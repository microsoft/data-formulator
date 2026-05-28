# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Chart creation guide and shared prompt fragments.

This module is the canonical source of truth for the prompt fragments
that describe how the agent should write code, choose chart types,
annotate semantic types, run statistical analyses, and use DuckDB.

The individual ``SHARED_*`` fragments are imported by ``DataRecAgent``
and ``DataTransformationAgent`` (which weave them into their system
prompts) and are also composed into ``CHART_CREATION_GUIDE``, the
single block injected lazily on the first ``visualize`` tool call.
"""


SHARED_ENVIRONMENT = '''**About the execution environment:**
- You can use BOTH DuckDB SQL and pandas operations in the same script
- The script will run in the workspace data directory (all data files are in the current directory)
- Each table in [CONTEXT] has a **file path** (e.g., `student_exam.parquet`, `sales.csv`). Use EXACTLY that path to load data:
    - `.parquet`: `pd.read_parquet('file.parquet')` or DuckDB `read_parquet('file.parquet')`
    - `.csv`: `pd.read_csv('file.csv')` or DuckDB `read_csv_auto('file.csv')`
    - `.json`: `pd.read_json('file.json')`
    - `.xlsx`/`.xls`: `pd.read_excel('file.xlsx')`
    - `.txt`: `pd.read_csv('file.txt', sep='\\t')`
- **IMPORTANT:** Use the exact filename from the context — do NOT change the file extension or assume all files are parquet.
- **Allowed libraries:** pandas, numpy, duckdb, math, datetime, json, statistics, collections, re, sklearn, scipy, random, itertools, functools, operator, time
- **Not allowed:** matplotlib, plotly, seaborn, requests, subprocess, os, sys, io, or any other library not listed above.
- File system access (open, write) and network access are also forbidden.

**When to use DuckDB vs pandas:**
- **Prefer plain pandas** for most tasks — it's simpler and more readable.
- Only use DuckDB when the dataset is very large and you need efficient SQL aggregations, filtering, joins, or window functions.
- You can combine both: DuckDB for initial loading/filtering on large files, then pandas for complex operations.

**Code structure:** standalone script (no function wrapper), imports at top. **CRITICAL:** The final result DataFrame MUST be assigned to the exact variable name you specified in `"output_variable"` in the JSON spec — the system uses this name to extract the result. For example, if your output_variable is `sales_by_region`, the script must contain `sales_by_region = ...`.'''


SHARED_SEMANTIC_TYPE_REFERENCE = '''**[SEMANTIC TYPE REFERENCE]**

Choose the most specific type that fits. Only annotate fields used in chart encodings.

| Category | Types |
|---|---|
| Temporal | DateTime, Date, Time, Timestamp, Year, Quarter, Month, Week, Day, Hour, YearMonth, YearQuarter, YearWeek, Decade, Duration |
| Monetary measures | Amount, Price |
| Physical measures | Quantity, Temperature |
| Proportion | Percentage |
| Signed/diverging | Profit, PercentageChange, Sentiment, Correlation |
| Generic measures | Count, Number |
| Discrete numeric | Rank, Score |
| Identifier | ID |
| Geographic | Latitude, Longitude, Country, State, City, Region, Address, ZipCode |
| Entity names | Category, Name |
| Coded categorical | Status, Boolean, Direction |
| Binned ranges | Range |
| Fallback | Unknown |

Key guidelines:
- Use **Amount** for summed monetary totals, **Price** for per-unit prices, **Profit** for values that can be negative.
- Use **Temperature** (not Quantity) for temperature — it has special diverging behavior.
- Use **Year** (not Number) for columns like "year" with values 2020, 2021.'''


SHARED_CHART_REFERENCE = '''**[CHART TYPE REFERENCE]**

The `chart_type` value in the `visualize` action MUST be one of the names listed
in the first column below (exact spelling, including capitalization). When a row
lists multiple names, pick whichever fits the "when to use" hint best.

| chart_type | encodings | config | when to use |
|---|---|---|---|
| Scatter Plot | x, y, color, size, facet | opacity (0.1–1.0) | Relationships between two quantitative fields |
| Regression | x, y, color, size, facet | regressionMethod ("linear","log","exp","pow","quad","poly"), polyOrder (2–10) | Trend line over scatter; one line per color group |
| Bar Chart / Lollipop Chart / Waterfall Chart | x, y, color, facet | — | Bar: default categorical comparison. Lollipop: cleaner for ranked lists / sparse categories. Waterfall: cumulative gain/loss, each bar starts where the previous ended |
| Grouped Bar Chart | x, y, group, facet | — | Side-by-side bars across a second categorical dimension |
| Histogram / Density Plot | x, color, facet | — | Distribution of one quantitative field. Histogram: discrete bins, auto-binned. Density Plot: smooth KDE curve |
| Boxplot | x, y, color, facet | — | Distribution summary (median/quartiles/outliers) by category |
| Ranged Dot Plot | x, y, color, facet | — | Min–max range or two-point comparison per category |
| Line Chart | x, y, color, strokeDash, facet | interpolate ("linear","monotone","step") | Trends over an ordered (usually temporal) x-axis |
| Area Chart | x, y, color, facet | — | Magnitude over ordered x; auto-stacks when color is set |
| Pie Chart | size, color, facet | innerRadius (0–100; 0=pie, >0=donut) | Part-of-whole with ≤7 categories. Wedge value goes on **size**, not **theta** |
| Radar Chart | x, y, color, facet | — | Multi-metric profile/comparison; x = metric name, y = value, color = entity (long-form data) |
| Heatmap | x, y, color, facet | colorScheme ("viridis","blues","reds","oranges","greens","blueorange","redblue") | Matrix / 2D density; color encodes the quantitative cell value |
| Bar Table | x, y, color, facet | — | Ranked horizontal table with inline bars; one row per category. y = category, x = value |
| KPI Card | metric, value, goal | — | "Big number" dashboard tile(s); one row per tile. `value` must be pre-aggregated; `goal` is optional |
| Candlestick Chart | x, open, high, low, close, facet | — | OHLC financial data |
| World Map | longitude, latitude, color, size | projection ("mercator","equalEarth","naturalEarth1","orthographic"), projectionCenter ([lon,lat]) | Geographic points/regions on a world projection |
| US Map | longitude, latitude, color, size | — (fixed albersUsa) | US-only points/regions (albersUsa projection) |

**Critical chart rules:**
- **Scatter Plot**: use config opacity (0.1–1.0) for dense data instead of encoding opacity.
- **Regression**: trend line is automatic — do NOT compute regression coefficients/predictions in Python. Use `color` to get separate trend lines per group.
- **Bar Chart**: x=categorical, y=quantitative (vertical bars). Swap x↔y for horizontal bars. Same-x rows are auto-stacked when `color` is set.
- **Grouped Bar Chart**: use the `group` channel (not `color`) for side-by-side bars.
- **Histogram**: do NOT pre-bin in Python — pass the raw quantitative field on `x` and the chart bins automatically. Pre-aggregating gives wrong bin widths.
- **Line Chart**: use `strokeDash` to differentiate line styles (e.g. actual vs forecast).
- **Pie Chart**: use the `size` channel (not `theta`) for wedge values. Avoid when >7–8 categories.
- **Radar Chart**: data must be long-form — one row per (entity, metric, value). If your data is wide-form (one column per metric), melt it first in the Python step.
- **Bar Table**: y is the category column to rank; x is the quantitative value driving bar length. Don't sort in Python — the template sorts.
- **KPI Card**: channels are `metric`, `value`, `goal` (not x/y). One DataFrame row = one tile. The `value` column must already contain the final number to display (aggregate upstream in the Python step).
- **Candlestick Chart**: requires `open`, `high`, `low`, `close` columns.
- **World Map / US Map**: channel names are `longitude` / `latitude`, not `x` / `y`.
- **facet**: available for nearly all chart types; use a low-cardinality categorical field.
- All fields in `encodings` must also appear in `output_fields`. Typically use 2–3 channels (x, y, color/size).'''


SHARED_STATISTICAL_ANALYSIS = '''**Statistical analysis guide:**
- **Regression**: use chart_type "Regression" — the trend line is automatic, do NOT compute regression values in Python code. Configure method via `{"regressionMethod": "linear"}` (options: "linear", "log", "exp", "pow", "quad", "poly"; for poly add `{"polyOrder": 3}`).
- **Forecasting**: compute predicted future values in Python. Use Line Chart with strokeDash to distinguish actual vs forecast, and color for series grouping.
- **Clustering**: compute cluster assignments in Python. Output [x, y, cluster_id]. Use Scatter Plot with color → cluster_id.'''


SHARED_DUCKDB_NOTES = '''**DuckDB notes:**
- Escape single quotes with '' (not \\')
- No Unicode escapes (\\u0400); use character ranges directly: [а-яА-Я]
- Cast date columns explicitly: `CAST(col AS DATE)`, `CAST(col AS TIMESTAMP)`
- For complex datetime operations, load data first then use pandas datetime functions
- Critical identifier quoting rule:
  * If a table/column name contains non-ASCII characters (e.g., Chinese, Japanese, Korean, Cyrillic, etc.), spaces, or punctuation,
    you MUST wrap it in double quotes, e.g. SELECT "金额" FROM "客户表".
  * Never output placeholder identifiers like your_table_name, your_column, your_condition.'''


CHART_CREATION_GUIDE = f"""\
## Chart Creation Guide

The following reference material applies when you call the `visualize` tool.

### A. Code Execution Rules

{SHARED_ENVIRONMENT}

{SHARED_DUCKDB_NOTES}

**Datetime handling:**
- `date` columns contain date-only values (YYYY-MM-DD). `datetime` columns contain date+time (ISO 8601).
- `time` columns contain time-only values (HH:mm:ss). `duration` columns are time intervals.
- Year → number. Year-month / year-month-day → string ("2020-01" / "2020-01-01").
- Hour alone → number. Hour:min or h:m:s → string. Never return raw datetime objects.

### B. Chart Type Reference

{SHARED_CHART_REFERENCE}

### C. Semantic Type Reference

{SHARED_SEMANTIC_TYPE_REFERENCE}

### D. Statistical Analysis Guide

{SHARED_STATISTICAL_ANALYSIS}
"""
