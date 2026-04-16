# MySQL Data Loader Tests (workspace/datalake)

Tests for `MySQLDataLoader` using a Docker MySQL instance and the **workspace/datalake** design.

## Prerequisites

- Docker
- Python deps: `connectorx`, `pyarrow`, etc. (project env)

## Quick start

From repo root:

```bash
# Option A: start all test databases at once
./tests/database-dockers/run_test_dbs.sh start

# Option B: start only MySQL
./tests/database-dockers/run_test_dbs.sh start mysql
# or: cd tests/database-dockers/mysql && docker compose up -d

# Run tests
pytest tests/database-dockers/mysql/ -v

# Tear down
./tests/database-dockers/run_test_dbs.sh stop
```

## Env vars

- `MYSQL_HOST` (default localhost)
- `MYSQL_PORT` (default 3307)
- `MYSQL_USER` (default root) / `MYSQL_PASSWORD` (default mysql) / `MYSQL_DATABASE` (default testdb)

## Test coverage

- `list_tables`, `list_tables(table_filter=...)`
- `fetch_data_as_arrow` from table, size limit
- `ingest_to_workspace` from table
- Workspace metadata, `read_parquet`, `get_parquet_schema`
- Static: `list_params`, `auth_instructions`
