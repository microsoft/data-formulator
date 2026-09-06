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

- `inspect_source_data(table_names)` returns schema, statistics, and sample rows
  for analysis input tables. Prefer it for basic inspection.
- `execute_python_script(code)` runs general-purpose sandboxed Python for data
  inspection, statistics, transformations, and assumption checks. Use `print()`
  to surface output. Each call has a fresh namespace, so combine related work in
  one script.

The initial context already includes samples and statistics. When that evidence
is sufficient, proceed without an extra inspection call.

Python runs in the workspace data directory. Use exact paths from context and
assign any resulting DataFrame to the requested output variable. pandas, numpy,
duckdb, sklearn, scipy, math, datetime, json, statistics, collections, re,
random, itertools, functools, operator, and time are available. File writes,
network access, and unlisted libraries are forbidden.

Prefer pandas for ordinary work. Use DuckDB for large aggregations, joins,
filters, or window functions. Quote SQL identifiers containing spaces,
punctuation, or non-ASCII characters with double quotes, for example
`"customer name"`, and escape SQL string literals by doubling single quotes.