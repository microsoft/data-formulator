---
name: analysis
description: Execute sandboxed Python and inspect analysis tables.
always_on: false
tools:
  - execute_python_script
  - inspect_source_data
actions: []
---

# Analysis

Follow the workspace Data Access Paths when inputs need loading. Python reads
actual workspace paths, not external reference IDs or connector addresses.

- `inspect_source_data(table_names)` returns schema, statistics, and sample rows
  for analysis input tables. Prefer it for basic inspection.
- `execute_python_script(code)` runs general-purpose sandboxed Python for data
  inspection, statistics, transformations, and assumption checks. Use `print()`
  to surface output. The namespace persists within an inspection cycle; do not
  depend on it across actions or runs. Visualization code must be standalone.

The initial context already includes samples and statistics. When that evidence
is sufficient, proceed without an extra inspection call.

Follow the workspace data boundaries below. Use data tools for registered tables
and file tools for durable documents or exports; computation alone does not create a workspace artifact.

Python runs in the workspace root directory. Use exact paths from context and
assign any resulting DataFrame to the requested output variable. pandas, numpy,
duckdb, sklearn, scipy, math, datetime, json, statistics, collections, re,
random, itertools, functools, operator, and time are available. File writes,
network access, and unlisted libraries are forbidden.

Prefer pandas for ordinary work. Use DuckDB for large aggregations, joins,
filters, or window functions. Quote SQL identifiers containing spaces,
punctuation, or non-ASCII characters with double quotes, for example
`"customer name"`, and escape SQL string literals by doubling single quotes.