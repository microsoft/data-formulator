# PostgreSQL Data Loader Tests (workspace/datalake)

Tests for `PostgreSQLDataLoader` using a Docker PostgreSQL instance and the **workspace/datalake** design.

## Prerequisites

- Docker
- Python deps: `connectorx`, `pyarrow`, etc. (project env)

## Quick start

From repo root:

```bash
# Option A: start all test databases at once
./tests/run_test_dbs.sh start

# Option B: start only PostgreSQL
./tests/run_test_dbs.sh start postgres
# or: docker compose -f docker-compose.test.yml up -d postgres

# Run tests
pytest tests/backend/integration/test_postgres/ -v

# Tear down
./tests/run_test_dbs.sh stop
```

## Env vars

- `PG_HOST` (default localhost)
- `PG_PORT` (default 5433)
- `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` (default testdb)

## Test coverage

- `list_tables`, `list_tables(table_filter=...)`
- `fetch_data_as_arrow` from table, size limit
- `ingest_to_workspace` from table
- Workspace metadata, `read_parquet`, `get_parquet_schema`
- Static: `list_params`, `auth_instructions`
