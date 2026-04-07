# Plugin Tests (Data Loaders)

Data loader integration tests that require external services (Docker containers).
These are **not** included in the default `pytest` test paths — they must be run
explicitly.

## Quick start

```bash
# Start all test databases
./tests/run_test_dbs.sh start

# Run all plugin tests
pytest tests/plugin/ -v

# Run one loader
./tests/run_test_dbs.sh test mysql

# Tear down
./tests/run_test_dbs.sh stop
```

## Structure

Each `test_<db>/` directory contains a Dockerfile, init script, and test module.
All services are managed by `docker-compose.test.yml` at the repo root.

| Directory | Service | Default Port |
|-----------|---------|-------------|
| `test_mysql/` | MySQL 8.0 | 3307 |
| `test_postgres/` | PostgreSQL 16 | 5433 |
| `test_mongodb/` | MongoDB 7 | 27018 |
| `test_bigquery/` | BigQuery emulator | 9050 |
| `test_mysql_datalake.py` | MySQL (standalone) | 3306 |
