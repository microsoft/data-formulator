# Cosmos DB Emulator Test Environment

## Overview
Uses the [Azure Cosmos DB Linux Emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator) for local integration testing.

## Requirements
- Docker (x86_64 only — the emulator does not support ARM/Apple Silicon natively)
- On Apple Silicon Macs, use Rosetta translation via Docker Desktop or run in CI

## Quick Start

```bash
# Start the emulator, seed data, and run tests (all-in-one)
./tests/database-dockers/run_test_dbs.sh test cosmosdb

# Or step by step:
./tests/database-dockers/run_test_dbs.sh start cosmosdb
uv run pytest tests/database-dockers/cosmosdb/test_cosmosdb_loader.py -v

# Stop
./tests/database-dockers/run_test_dbs.sh stop cosmosdb
```

## Emulator Connection Details
| Parameter | Value |
|-----------|-------|
| Endpoint  | `https://localhost:8081` |
| Key       | `C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==` |
| Database  | `testdb` |

The emulator uses a self-signed certificate. The loader and tests automatically disable SSL verification for localhost endpoints.

## Test Data
The seed script creates the same datasets as other test databases:
- **products** (12 items) — with nested `specs` and array `tags` fields
- **customers** (10 items)
- **orders** (10 items)
- **app_settings** (4 items)

## Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `COSMOS_ENDPOINT` | `https://localhost:8081` | Emulator endpoint |
| `COSMOS_KEY` | *(emulator key)* | Account key |
| `COSMOS_DATABASE` | `testdb` | Database name |
| `COSMOS_PORT` | `8081` | Host port mapping |
