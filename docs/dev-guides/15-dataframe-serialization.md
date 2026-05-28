# 15 — DataFrame Serialization Convention

## Problem

pandas `DataFrame.to_json(orient='records')` defaults to `date_format='epoch'`,
which serializes `datetime64` columns as **epoch milliseconds** (e.g.
`1773532800000`).  When the frontend receives these numbers, `formatCellValue`
treats them as plain integers and displays `1,773,532,800,000` instead of a
formatted date.

`DataFrame.to_dict(orient='records')` is even worse — it returns Python
`pd.Timestamp` objects that are not JSON-serializable at all and rely on
whatever `json.dumps` fallback happens to be in scope.

## Solution

A single utility function in `data_formulator.datalake.parquet_utils`:

```python
def df_to_safe_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return json.loads(
        df.to_json(orient="records", date_format="iso", default_handler=str)
    )
```

For Arrow tables, the existing `get_sample_rows_from_arrow(table)` already
handles this correctly via `make_json_safe`.

## When to Use

| Scenario | Function |
|---|---|
| Agent result rows (`content["rows"]`) | `df_to_safe_records(query_output)` |
| Table sample rows (`sample_rows`) | `df_to_safe_records(sample_df)` |
| Data loader metadata previews | `df_to_safe_records(df.head(5))` |
| File parse results (Excel/CSV) | `df_to_safe_records(df)` |
| Arrow table samples | `get_sample_rows_from_arrow(table)` |

## Exceptions

The following uses of `to_dict(orient='records')` are exempt because they never
reach JSON serialization or the frontend:

- **Kusto SDK metadata** — `.show tables details` results iterated in Python only
- **Vega-Lite spec construction** — `create_vl_plots.py` builds inline data for
  Vega specs; Vega handles temporal formatting itself

## New Module Checklist

When writing a new Agent, DataLoader, or route that returns DataFrame rows:

1. Import: `from data_formulator.datalake.parquet_utils import df_to_safe_records`
2. Convert: `rows = df_to_safe_records(df)` (not `to_json` / `to_dict`)
3. Test: verify datetime columns appear as ISO strings in the response
