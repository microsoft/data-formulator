# Plugin Tests (Data Loaders)

Data loader integration tests that require external services (Docker containers).
These are **not** included in the default `pytest` test paths — they must be run
explicitly.

## Quick start

```bash
# Start all test databases
./tests/database-dockers/run_test_dbs.sh start

# Run all plugin tests
./tests/database-dockers/run_test_dbs.sh test

# Run one loader
./tests/database-dockers/run_test_dbs.sh test mysql

# Or use docker compose directly in each folder
cd tests/database-dockers/mysql && docker compose up -d

# Tear down
./tests/database-dockers/run_test_dbs.sh stop
```

## Structure

Each subdirectory is self-contained with its own `docker-compose.yml`, Dockerfile,
init script, and test module. The `run_test_dbs.sh` script provides a convenience
wrapper to manage them all.

| Directory | Service | Default Port |
|-----------|---------|-------------|
| `mysql/` | MySQL 8.0 | 3307 |
| `postgres/` | PostgreSQL 16 | 5433 |
| `mongodb/` | MongoDB 7 | 27018 |
| `bigquery/` | BigQuery emulator | 9050 |
| `cosmosdb/` | Cosmos DB emulator | 8081 |
