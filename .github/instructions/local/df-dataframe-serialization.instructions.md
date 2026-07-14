---
description: "Require centralized DataFrame/Arrow-to-JSON serialization helpers for any DataFrame data reaching the frontend, API responses, or streaming events"
applyTo: "py-src/data_formulator/**/*.py"
lastReviewed: 2026-07-09
---

# DataFrame Serialization (Data Formulator)

Ported from `.cursor/rules/dataframe-serialization.mdc` (source file shipped with no frontmatter — scoped here to the whole backend package since callers span agents, routes, and datalake). Canonical source: [`docs/dev-guides/15-dataframe-serialization.md`](../../docs/dev-guides/15-dataframe-serialization.md).

All DataFrame-to-records conversion for API responses, streaming events, or frontend-visible data MUST use the centralized helpers in `data_formulator.datalake.parquet_utils`:

| Source type        | Helper                              |
| ------------------ | ----------------------------------- |
| `pd.DataFrame`     | `df_to_safe_records(df)`            |
| `pa.Table` (Arrow) | `get_sample_rows_from_arrow(table)` |

## Why

`pandas.DataFrame.to_json(orient='records')` defaults to `date_format='epoch'`, serializing datetimes as epoch milliseconds (e.g. `1773532800000`). The frontend renders these as plain comma-formatted numbers instead of dates. `df_to_safe_records` enforces `date_format='iso'` and `default_handler=str`.

## Anti-Patterns

| Anti-pattern                                                  | Correction                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `json.loads(df.to_json(orient='records'))` (no `date_format`) | Use `df_to_safe_records(df)`                                                  |
| `df.to_dict(orient='records')` for anything JSON-bound        | Returns raw `Timestamp` objects, not JSON-safe — use `df_to_safe_records(df)` |
| `df.to_json(orient='records', date_format='iso')` inline      | Works but should be unified — call the shared helper instead                  |

## Exceptions

Internal data processing that never reaches the frontend or JSON serialization (e.g. Kusto SDK metadata parsing, Vega-Lite spec construction) may use `to_dict(orient='records')` directly.

## Would Revise If

Revise if `parquet_utils.py` adds a new serialization entry point that isn't reflected in the table above, or if `docs/dev-guides/15-dataframe-serialization.md` is superseded without this file being updated in the same change.
