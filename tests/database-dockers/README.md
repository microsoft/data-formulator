# Data Loader Docker Tests

Data loader integration tests require external services such as MySQL,
PostgreSQL, MongoDB, BigQuery emulator, Cosmos DB emulator, and Superset. These
tests are not included in the default pytest paths; run them explicitly.

Each service subdirectory remains self-contained with its own
`docker-compose.yml`, Dockerfile, setup files, and test module. The unified
compose entry point below is optional and additive.

## Quick Start

For Windows and PowerShell, use the helper script:

```powershell
# Start common lightweight services
.\tests\database-dockers\test-dbs.ps1 start core

# Start all services
.\tests\database-dockers\test-dbs.ps1 start all

# Run one database test suite
.\tests\database-dockers\test-dbs.ps1 test mongodb

# Run all database test suites
.\tests\database-dockers\test-dbs.ps1 test all

# Stop common lightweight services
.\tests\database-dockers\test-dbs.ps1 stop core
```

If your terminal is `cmd.exe` or Anaconda Prompt instead of PowerShell, call the
script through `powershell.exe`. Running a `.ps1` file directly from `cmd.exe`
may open the Windows "choose an app" dialog.

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -File ".\tests\database-dockers\test-dbs.ps1" test mongodb
```

macOS and Linux users can continue using each service's existing compose file or
`start.sh` script:

```bash
cd tests/database-dockers/mysql
docker compose up -d --build --wait
```

## Service Groups

| Target | Services |
| --- | --- |
| `core` | MySQL, PostgreSQL, MongoDB, BigQuery emulator |
| `heavy` | Cosmos DB emulator, Superset |
| `all` | Every service |
| `mysql` | MySQL only |
| `postgres` | PostgreSQL only |
| `mongodb` | MongoDB only |
| `bigquery` | BigQuery emulator only |
| `cosmosdb` | Cosmos DB emulator only |
| `superset` | Superset only |

`core` is the recommended default. `heavy` includes services that take longer
to pull, boot, or initialize.

## Helper Commands

Run from the repository root:

```powershell
# Start just one service
.\tests\database-dockers\test-dbs.ps1 start postgres

# Rebuild images while starting
.\tests\database-dockers\test-dbs.ps1 start core -Build

# Show status
.\tests\database-dockers\test-dbs.ps1 status

# Follow logs for one service
.\tests\database-dockers\test-dbs.ps1 logs postgres

# Seed Cosmos DB manually
.\tests\database-dockers\test-dbs.ps1 seed-cosmos
```

Cosmos DB needs seeded test data after it starts. The helper does this
automatically for `start cosmosdb`, `start heavy`, `start all`, and matching
`test` commands.

## Run Tests

The helper starts the requested services and runs the matching pytest folder:

```powershell
# Start MongoDB if needed, then run MongoDB loader tests
.\tests\database-dockers\test-dbs.ps1 test mongodb

# Start core services, then run core loader tests
.\tests\database-dockers\test-dbs.ps1 test core

# Start all services, then run all loader tests
.\tests\database-dockers\test-dbs.ps1 test all

# Pass extra pytest args after PowerShell's stop-parsing token
.\tests\database-dockers\test-dbs.ps1 test postgres --% -k utf8
```

If services are already running, you can also run pytest directly:

```powershell
python -m pytest tests/database-dockers/postgres -q
python -m pytest tests/database-dockers/postgres/test_postgresql_loader.py::TestPostgreSQLDataLoaderStatic::test_connect_forces_utf8_client_encoding -q
```

## Direct Docker Compose Usage

The unified compose file can be used directly from any shell:

```bash
# Core services
docker compose -f tests/database-dockers/docker-compose.test.yml --profile core up -d --build --wait

# Heavy services
docker compose -f tests/database-dockers/docker-compose.test.yml --profile heavy up -d --wait

# All services
docker compose -f tests/database-dockers/docker-compose.test.yml --profile core --profile heavy up -d --build --wait

# Stop core services
docker compose -f tests/database-dockers/docker-compose.test.yml stop mysql postgres mongodb bigquery
```

## Structure

| Directory | Service | Default Port |
| --- | --- | --- |
| `mysql/` | MySQL 8.0 | `3307` |
| `postgres/` | PostgreSQL 16 | `5433` |
| `mongodb/` | MongoDB 7 | `27018` |
| `bigquery/` | BigQuery emulator HTTP / gRPC | `9050` / `9060` |
| `cosmosdb/` | Cosmos DB emulator | `8081` |
| `superset/` | Superset | `8088` |

## Files

- `docker-compose.test.yml` - unified compose file for all test services.
- `test-dbs.ps1` - PowerShell helper for start/stop/status/logs/test.
- `<service>/docker-compose.yml` - original per-service compose files.
- `<service>/start.sh` - original per-service shell helpers where available.

## Port Overrides

If a port is already in use, override the corresponding environment variable
before starting the services:

```powershell
$env:PG_PORT = "15433"
.\tests\database-dockers\test-dbs.ps1 start postgres
```

## Notes

- The unified setup uses separate containers, not one large container. That
  keeps logs, health checks, ports, and service lifecycles independent.
- Existing per-service compose files and shell scripts are still supported.
- If a container with the same `df-test-*` name is already running from a
  per-service compose file, stop that container before starting the unified
  compose entry point.
