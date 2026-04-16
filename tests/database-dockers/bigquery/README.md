# BigQuery Data Loader Tests (workspace/datalake)

Tests for `BigQueryDataLoader` using the [BigQuery Emulator](https://github.com/goccy/bigquery-emulator) and the **workspace/datalake** design: ingest uses `ingest_to_workspace()` and stores parquet in a temp workspace; no DuckDB storage.

## Prerequisites

- Docker (for emulator)
- Python 3.9+
- `google-cloud-bigquery` installed

## Quick start

From repo root:

1. Start the emulator:

   ```bash
   # Option A: start all test databases at once
   ./tests/run_test_dbs.sh start

   # Option B: start only BigQuery
   ./tests/run_test_dbs.sh start bigquery
   # or: docker compose -f docker-compose.test.yml up -d bigquery
   ```

2. Run tests:

   ```bash
   pytest tests/backend/integration/test_bigquery/ -v
   ```

3. Tear down:

   ```bash
   ./tests/run_test_dbs.sh stop
   ```

## Commands (run_test_dbs.sh)

| Command | Description |
|--------|-------------|
| `start bigquery` | Build and start the BigQuery emulator container |
| `stop bigquery` | Stop the container |
| `test bigquery` | Start emulator and run the Python tests |
| `reset bigquery` | Stop, remove, and restart with fresh data |
| `status` | Show all container status |

## Environment variables

- `BQ_PROJECT_ID` – default `test-project`
- `BQ_HTTP_ENDPOINT` – default `http://localhost:9050`
- `BQ_HTTP_PORT` / `BQ_GRPC_PORT` – ports (defaults 9050, 9060)

## Test coverage

- `list_tables()` / filter / specific dataset
- `fetch_data_as_arrow()` from table, size limit, invalid table
- `ingest_to_workspace()` from table
- Table name sanitization, workspace metadata, `read_parquet` / `get_parquet_schema`
- Static: `list_params()`, `auth_instructions()`
