---
name: analysis
description: Execute sandboxed Python over analysis tables and files.
always_on: false
tools:
  - execute_python_script
actions: []
---

# Analysis

Python reads actual workspace paths, not external reference IDs or connector addresses.
Only `compute_ready: true` load outcomes are local computation inputs; follow
the workspace policy to materialize a working dataset from a virtual outcome.

- `read_file` of a table's `session://tables/<name>` returns schema, statistics, sample
  rows, and its `data_file`, the path code reads; `search` finds rows by their text (for example a code by its label). Prefer them for
  basic inspection and look-ups.
- `execute_python_script(code)` runs general-purpose sandboxed Python for data
  inspection, statistics, transformations, and assumption checks. Use `print()`
  to surface output. The namespace persists within an inspection cycle; do not
  depend on it across actions or runs. Visualization code must be standalone.

The initial context already includes samples and statistics. When that evidence
is sufficient, proceed without an extra inspection call.

Use `visualize` for chart-specific transformations; use `execute_python_script`
for inspection, statistical tests, and independent verification.

Follow the workspace data boundaries below. Use data tools for registered tables
and file tools for durable documents or exports; computation alone does not create a workspace artifact.

Python runs at the workspace root (workspace paths below). Use exact paths from
context, a table's `data_file` as written for its rows, and assign any resulting
DataFrame to the requested output variable. pandas, numpy, duckdb, sklearn, scipy,
math, datetime, json, statistics, collections, re, random, itertools, functools,
operator, and time are available. Code writes only to `scratch/`; unlisted
libraries are forbidden. Network access depends on the deployment
(local macOS allows internet but never local services); when it is unavailable,
acquire remote data with the data-loading tools instead.

Prefer pandas for ordinary work. Use DuckDB for large aggregations, joins,
filters, or window functions. Quote SQL identifiers containing spaces,
punctuation, or non-ASCII characters with double quotes, for example
`"customer name"`, and escape SQL string literals by doubling single quotes.
Name computed columns with `AS`, and double-quote names that are SQL keywords
(`first`, `last`, `order`, `group`, `default`): `min(year) AS "first"`.