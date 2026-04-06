# MongoDB Data Loader Tests (workspace/datalake)

Tests for `MongoDBDataLoader` using a Docker MongoDB instance and the **workspace/datalake** design.

## Prerequisites

- Docker
- Python deps: `pymongo`, `pyarrow`, `pandas`, etc. (project env)

## Quick start

From repo root:

```bash
# Option A: start all test databases at once
./tests/run_test_dbs.sh start

# Option B: start only MongoDB
./tests/run_test_dbs.sh start mongodb
# or: docker compose -f docker-compose.test.yml up -d mongodb

# Run tests
pytest tests/backend/integration/test_mongodb/ -v

# Tear down
./tests/run_test_dbs.sh stop
```

## Env vars

- `MONGO_HOST` (default localhost)
- `MONGO_PORT` (default 27018)
- `MONGO_USERNAME` / `MONGO_PASSWORD` / `MONGO_DATABASE` (testuser/testpass/testdb)

## Test coverage

- `list_tables`, filter, specific collection, row_count
- `fetch_data_as_arrow` from collection, size limit
- `ingest_to_workspace` from collection; nested docs and arrays flattened
- Table name sanitization; workspace metadata; `read_parquet`, `get_parquet_schema`
- Connection close, context manager
- `_flatten_document`, `_convert_special_types`
- Static: `list_params`, `auth_instructions`
