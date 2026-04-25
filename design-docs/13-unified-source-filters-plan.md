# Unified Source Filters Plan

> Status: planning document
> Last updated: 2026-04-25

## Goal

Define one frontend filter contract for all external data sources while allowing each loader to compile that contract into its own query language.

The frontend should not emit PostgreSQL-specific, MySQL-specific, MongoDB-specific, or BI-platform-specific filter syntax. It should send a stable `source_filters` payload describing user intent:

```json
[
  {"column": "name", "operator": "ILIKE", "value": "acct"},
  {"column": "amount", "operator": "GTE", "value": 100},
  {"column": "created_at", "operator": "BETWEEN", "value": ["2026-01-01", "2026-12-31"]}
]
```

Each loader decides how to execute those filters safely and efficiently.

## Current State

Implemented in the current branch:

- `ConnectorTablePreview` already sends `import_options.source_filters` for preview and import.
- `SupersetLoader` already has its own `source_filters` compiler because BI datasets require platform-specific handling.
- `PostgreSQLDataLoader` and `MySQLDataLoader` now read `source_filters` and compile them with a shared SQL helper.
- Legacy `conditions` remain supported as fallback for PostgreSQL and MySQL.

Not implemented yet:

- A formal capability flag telling the frontend whether a loader supports `source_filters`.
- BigQuery and Athena filter compilation.
- MSSQL filter compilation.
- Kusto, MongoDB, and file-based filter compilation.
- A clear user-facing behavior for connectors that do not support source-side filters.

## Source Filter Contract

`source_filters` is a list of objects:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `column` | string | yes | Source column/field name |
| `operator` | string | yes | Source-neutral operator |
| `value` | any | operator-dependent | Single value, list, or range |
| `applies_to` | list | optional | Used by grouped BI imports to target specific datasets |

Supported operators:

| Operator | Meaning |
|---|---|
| `EQ` | equals |
| `NEQ` | not equals |
| `GT` | greater than |
| `GTE` | greater than or equal |
| `LT` | less than |
| `LTE` | less than or equal |
| `LIKE` | pattern match |
| `ILIKE` | case-insensitive contains |
| `IN` | value in list |
| `NOT_IN` | value not in list |
| `IS_NULL` | value is null |
| `IS_NOT_NULL` | value is not null |
| `BETWEEN` | value between `[min, max]` |

Important semantic note:

- In the current UI, text "contains" emits `ILIKE`. SQL compilers should treat `ILIKE` as contains semantics, usually `%value%`, not exact match.

## Capability Model

Add an optional loader capability method:

```python
class ExternalDataLoader:
    @staticmethod
    def capabilities() -> dict[str, bool]:
        return {
            "source_filters": False,
        }
```

Loaders that support source-side filtering return:

```python
{"source_filters": True}
```

The connector status/catalog response can include capabilities so the frontend can decide whether to show filter UI:

```json
{
  "capabilities": {
    "source_filters": true
  }
}
```

Suggested frontend behavior:

- If `source_filters` is `true`, show smart filter controls.
- If `false`, hide filter controls or show a disabled hint.
- Do not show editable filter controls for connectors that silently ignore filters.

## Compiler Strategy

The base class should define the contract and provide reusable helpers, but not force every loader into SQL.

Recommended structure:

```text
source_filters
  -> SQL helper for SQL-like loaders
  -> KQL compiler for Kusto
  -> Mongo query compiler for MongoDB
  -> Arrow/file strategy for file loaders
  -> platform-specific compiler for BI loaders
```

### SQL Helper

The shared SQL helper should cover common SQL-like databases:

```python
build_source_filter_where_clause_inline(
    source_filters,
    quote_char='"',
    dialect="postgres",
)
```

Responsibilities:

- Validate/escape identifiers.
- Escape literal values.
- Map source-neutral operators to SQL operators.
- Handle dialect differences.
- Preserve the existing legacy `conditions` fallback where needed.

Dialect notes:

| Dialect | Identifier Quote | `ILIKE` Strategy |
---|---|---|
| PostgreSQL | `"` | `"col" ILIKE '%value%'` |
| MySQL | `` ` `` | `LOWER(`col`) LIKE LOWER('%value%')` |
| BigQuery | `` ` `` | `LOWER(`col`) LIKE LOWER('%value%')` |
| Athena | `"` or none | `LOWER("col") LIKE LOWER('%value%')` |
| MSSQL | `[]` | `LOWER([col]) LIKE LOWER('%value%')` |

## Loader Roadmap

### Phase 1: PostgreSQL and MySQL

Status: implemented in current branch.

PostgreSQL:

- Uses `metadata._source_name = database.schema.table` for lazy catalog leaves.
- Supports cross-database fetch by connecting to the selected database.
- Compiles `source_filters` into PostgreSQL SQL.
- Keeps legacy `conditions` fallback.

MySQL:

- Compiles `source_filters` into MySQL SQL.
- Converts `ILIKE` to `LOWER(col) LIKE LOWER('%value%')`.
- Keeps legacy `conditions` fallback.

Validation:

- Static unit tests cover source filter compilation.
- Static unit tests cover PostgreSQL source table resolution and catalog behavior.

### Phase 2: BigQuery and Athena

Recommended next implementation.

Why they fit this phase:

- Both are SQL-like.
- Their existing fetch code already builds `SELECT ... FROM ... LIMIT ...`.
- Filter support can be added by inserting `WHERE` before `ORDER BY` and `LIMIT`.

BigQuery considerations:

- Use backtick identifiers.
- Fully qualified table names already use BigQuery backticks.
- Use `LOWER(col) LIKE LOWER('%value%')` for `ILIKE`.
- Watch nested/repeated fields; initial support should target top-level scalar columns only.

Athena considerations:

- Athena uses Presto/Trino SQL.
- Use double-quoted identifiers for column names.
- Use `LOWER(col) LIKE LOWER('%value%')` for `ILIKE`.
- Keep table name validation separate from column filtering.

Tests:

- Static query construction tests for `EQ`, `GTE`, `BETWEEN`, `IS_NULL`, and `ILIKE`.
- Verify `WHERE` appears before `ORDER BY` and `LIMIT`.

### Phase 3: MSSQL

Implement separately from BigQuery/Athena.

Why separate:

- SQL Server uses `TOP` instead of `LIMIT`.
- Existing code wraps the base query as:

```sql
SELECT TOP n * FROM (<base_query>) AS limited
```

Filter placement must be correct:

```sql
SELECT TOP n *
FROM (
  SELECT ...
  FROM [schema].[table]
  WHERE ...
  ORDER BY ...
) AS limited
```

Additional considerations:

- Identifier quoting should use SQL Server bracket syntax (`[column]`).
- `ILIKE` should compile to `LOWER([column]) LIKE LOWER('%value%')`.
- Cross-database catalog references may need full `[db].[schema].[table]` handling.

### Phase 4: Kusto

Do not use the SQL helper.

Kusto should implement a KQL compiler:

| Source Operator | KQL Idea |
|---|---|
| `EQ` | `column == value` |
| `NEQ` | `column != value` |
| `GT/GTE/LT/LTE` | numeric/date comparisons |
| `ILIKE` | `column contains value` or `tolower(column) contains tolower(value)` |
| `IN` | `column in (...)` |
| `BETWEEN` | `column between (min .. max)` |
| `IS_NULL` | `isnull(column)` |

Kusto implementation should be tested independently because KQL syntax and escaping are different from SQL.

### Phase 5: MongoDB

Do not use the SQL helper.

MongoDB should compile `source_filters` into Mongo query documents:

| Source Operator | Mongo Query |
|---|---|
| `EQ` | `{field: value}` |
| `NEQ` | `{field: {$ne: value}}` |
| `GT/GTE/LT/LTE` | `$gt/$gte/$lt/$lte` |
| `IN/NOT_IN` | `$in/$nin` |
| `ILIKE` | case-insensitive regex |
| `BETWEEN` | `$gte` + `$lte` |
| `IS_NULL` | `{field: null}` or explicit missing/null policy |

Open decision:

- Whether `IS_NULL` should match missing fields, explicit nulls, or both.

### Phase 6: File-Based Loaders

Includes:

- `S3DataLoader`
- `AzureBlobDataLoader`
- `LocalFolderDataLoader`

Do not rush this into the SQL helper.

Possible approaches:

1. **No source-side filtering initially**
   - Declare `source_filters: false`.
   - Hide filter UI for file connectors.

2. **In-memory filtering after read**
   - Simple but can be expensive for large files.
   - Must still apply row limits carefully.

3. **Arrow Dataset pushdown**
   - Best long-term option for Parquet datasets.
   - Harder for CSV/JSON.

Recommendation:

- Start with capability `source_filters: false`.
- Later add file filtering only for Parquet/Arrow-friendly paths.

### BI Platforms: Superset, Metabase, etc.

Do not merge BI platform logic into the base SQL helper.

Reasons:

- BI tools may expose virtual datasets, dashboard-scoped filters, dataset IDs, and platform APIs.
- SQL generated by the BI platform may differ from the underlying database.
- Permissions and query context often belong to the platform, not only the database.

Recommended rule:

- The frontend still sends `source_filters`.
- Each BI loader compiles them according to platform semantics.
- Superset can keep its current platform-specific implementation.
- Metabase or future BI integrations should implement their own compiler.

## API Changes Needed

### Backend

Add capabilities to connector responses:

- `/api/connectors/connect`
- `/api/connectors/get-status`
- optionally `/api/connectors/get-catalog`

Example:

```json
{
  "status": "connected",
  "capabilities": {
    "source_filters": true
  }
}
```

### Frontend

Use capabilities to control filter UI:

- `ConnectorTablePreview.enableFilters` should come from connector capability, not always `true`.
- For grouped BI imports, preserve existing `applies_to` behavior.

## Testing Plan

Each loader that claims `source_filters: true` must have tests for:

- `EQ`
- `NEQ`
- `GT/GTE/LT/LTE`
- `BETWEEN`
- `IN/NOT_IN`
- `IS_NULL/IS_NOT_NULL`
- `ILIKE` contains semantics
- invalid identifier rejection
- escaped string literal values
- placement before `ORDER BY`/`LIMIT` or dialect equivalent

For non-SQL compilers:

- MongoDB query document shape.
- Kusto KQL string shape.
- BI platform-specific query payloads or clauses.

## Non-Goals

This plan does not try to:

- Make all data sources support filters immediately.
- Force BI platforms into SQL helper logic.
- Implement file filtering for arbitrary CSV/JSON files without a separate performance design.
- Replace all inline SQL with parameterized queries in one step.

## Recommended Next Steps

1. Finish validation for current PostgreSQL/MySQL implementation.
2. Add loader capability reporting.
3. Gate frontend filter UI using capabilities.
4. Implement BigQuery and Athena source filters.
5. Implement MSSQL separately.
6. Plan Kusto, MongoDB, and file loaders as independent follow-up work.
