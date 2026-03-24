# Backend Tests

This directory contains backend Python tests, organized by responsibility.
Try to keep future additions within the appropriate layer instead of mixing concerns.

## Directory Layout

```text
tests/backend/
  README.md
  unit/
    README.md
    test_unicode_table_name_sanitization.py
  integration/
    README.md
  contract/
    README.md
  fixtures/
    README.md
```

## Directory Responsibilities

- `tests/backend/unit`
  - pure function tests
  - name sanitization
  - utility helpers
  - no Flask app or external service dependency

- `tests/backend/integration`
  - Flask routes
  - workspace / datalake behavior
  - table import, refresh, and metadata read/write flows
  - may use temp directories, temp files, and monkeypatching

- `tests/backend/contract`
  - API boundary contract tests
  - focused on stable input/output fields and compatibility guarantees
  - for example, a Chinese table name should not degrade into an empty placeholder

- `tests/backend/fixtures`
  - test data files
  - sample JSON / CSV / parquet files
  - shared fixture documentation

## Recommended Expansion Order

1. Use `unit` tests to lock down sanitization behavior first.
2. Add `contract` tests for route-level input/output guarantees next.
3. Add `integration` tests for full import flows last.

## Current Scope

This first round is focused on:

- Chinese table names
- Chinese column names
- non-ASCII identifiers
- fallback behavior when sanitization would otherwise produce an empty name
