# Backend Integration Tests

This directory contains backend integration tests.

Good candidates for this layer:

- Flask route tests
- table create / ingest / refresh flows
- real workspace and datalake interactions
- sandbox execution (local and Docker)

Data loader tests (MySQL, MongoDB, PostgreSQL, BigQuery) live in
`tests/plugin/` — see that directory's README for setup instructions.

## Running

```bash
# All integration tests
pytest tests/backend/integration/ -v

# Sandbox tests only
pytest tests/backend/integration/test_sandbox.py -v
```

# Start + run all loader tests in one shot
./tests/run_test_dbs.sh test

# Tear down
./tests/run_test_dbs.sh stop
```
