# Superset Plugin Test Setup

Spin up a local Apache Superset instance with sample data and connect it to Data Formulator's Superset plugin.

## Quick Start

```bash
# Start both Superset and DF (Superset takes ~2 min on first run)
./tests/superset/start.sh

# Or start them separately:
./tests/superset/start.sh superset   # start Superset only
./tests/superset/start.sh df         # start DF (assumes Superset is running)

# Check status
./tests/superset/start.sh status

# Stop
./tests/superset/start.sh stop
```

## What Gets Created

| Component | URL | Credentials |
|-----------|-----|-------------|
| Superset | http://localhost:8088 | `admin` / `admin` |
| Data Formulator | http://localhost:5567 | — |

### Sample Datasets

| Table | Rows | Description |
|-------|------|-------------|
| `df_test_sales` | 100 | Sales data with date, region, product, quantity, price |
| `df_test_employees` | 30 | Employee directory with department, hire date, salary |
| `df_test_weather` | 365 | Daily weather readings for 3 cities |

Plus Superset's built-in example datasets (if `load_examples` succeeds).

## Testing the Plugin

1. Start both services: `./tests/superset/start.sh`
2. Open http://localhost:5567 in your browser
3. Click **Add Data** (the upload button)
4. Under **Connect to Live Data**, you should see an **Apache Superset** card
5. Click it, then log in with `admin` / `admin`
6. Browse datasets and load one into Data Formulator

### Token-based Login (via Superset)

The test Docker mounts a custom `superset_config.py` that adds a `/df-sso-bridge/` endpoint. This lets you test the delegated login flow where DF obtains a JWT token by having the user log in directly on Superset:

1. Start both services: `./tests/superset/start.sh`
2. Log into Superset UI at http://localhost:8088 with `admin` / `admin` (creates a session)
3. Open http://localhost:5567 (or http://localhost:5173 for Vite dev)
4. In the Superset login panel, click the **Login via Superset** button
5. A popup opens → Superset sees the existing session → issues JWT tokens via `postMessage`
6. DF receives the tokens and you're logged in without entering credentials in DF

> **Note**: You must have an active Superset session (step 2) for the bridge to work. If you're not logged into Superset, the popup will redirect you to Superset's login page first.

## Manual Setup (without the script)

```bash
# 1. Start Superset
docker compose -f tests/superset/docker-compose.yml up -d

# 2. Wait for it to be healthy
docker logs -f df-test-superset

# 3. Start DF with the plugin env var
PLG_SUPERSET_URL=http://localhost:8088 python -m data_formulator
```

## Troubleshooting

- **Superset takes too long**: First startup downloads the image and runs migrations. Check `docker logs df-test-superset`.
- **Plugin tab not showing**: Verify `PLG_SUPERSET_URL` is set. Check `./tests/superset/start.sh status`.
- **Login fails**: Make sure Superset is healthy: `curl http://localhost:8088/health`.
- **Datasets not visible**: Log into Superset UI at http://localhost:8088 and check Data → Datasets. You may need to manually add the `df_test_*` tables if auto-registration failed.
- **Port conflict**: Edit `docker-compose.yml` to change the port mapping and update `.env.superset` accordingly.
