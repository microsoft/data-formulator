# Debug Guide for "invalid error value specified" Error

## Problem Summary

When deploying to a server, the API endpoint `POST /api/tables/data-loader/ingest-data-from-query` returns a 500 error with message "invalid error value specified" even though it works locally.

## Root Cause Analysis

The error "invalid error value specified" typically means:

1. An exception is being raised in the data loader
2. The error sanitization function cannot properly handle it
3. Flask receives an invalid status code value

## How to Debug

### 1. Check Backend Logs

```bash
# View docker logs with detailed output
docker logs -f df-backend --tail=100

# Or check specific error logs
docker logs df-backend 2>&1 | grep -A 5 -B 5 "invalid error value"
```

### 2. Key Log Messages to Look For

After the latest fix, you should see more detailed logs:

- `Data ingesting data from loader: QC_Data` - Shows loader type
- `Data loader initialized: QC_Data` - Confirms loader creation
- `Error traceback:` - Full Python traceback (if error occurs)
- `Full exception details:` - Detailed exception info

### 3. Common Issues in Docker Environment

#### Issue A: Environment Variables Missing

**Symptoms**: ClickHouse connection fails
**Solution**:

```bash
# Verify api-keys.env is loaded
docker exec df-backend env | grep CH_

# Should show:
# CH_HOST=172.19.16.23
# CH_PORT=8123
# CH_USER=admin
# CH_PASSWORD=...
# CH_DB=QC_DATA
```

#### Issue B: Redis Connection Problems

**Symptoms**: Session management failures
**Solution**:

```bash
# Check Redis connectivity from backend container
docker exec df-backend redis-cli -h redis ping

# Should return: PONG
```

#### Issue C: DuckDB Session Issues

**Symptoms**: "session_id not found" error
**Solution**:

```bash
# Verify session is being created correctly
docker logs df-backend | grep "session_id"
```

### 4. Testing the Endpoint Directly

#### From inside the container:

```bash
docker exec -it df-backend bash
curl -X POST http://localhost:8000/api/tables/data-loader/ingest-data-from-query \
  -H "Content-Type: application/json" \
  -d '{
    "data_loader_type": "QC_Data",
    "data_loader_params": {},
    "query": "SELECT * FROM QC_DATA.some_table LIMIT 1",
    "name_as": "test_table"
  }'
```

#### From the host machine:

```bash
curl -X POST http://localhost:8000/api/tables/data-loader/ingest-data-from-query \
  -H "Content-Type: application/json" \
  -d '{
    "data_loader_type": "QC_Data",
    "data_loader_params": {},
    "query": "SELECT * FROM QC_Data.some_table LIMIT 1",
    "name_as": "test_table"
  }'
```

### 5. Check ClickHouse Connectivity

```bash
# From backend container
docker exec df-backend python3 -c "
from clickhouse_connect import get_client
import os
client = get_client(
    host=os.environ.get('CH_HOST', '172.19.16.23'),
    port=int(os.environ.get('CH_PORT', '8123')),
    username=os.environ.get('CH_USER', 'admin'),
    password=os.environ.get('CH_PASSWORD'),
    database=os.environ.get('CH_DB', 'QC_DATA')
)
print('Connected to ClickHouse')
result = client.query_df('SELECT 1')
print(result)
"
```

## Recent Fixes Applied

1. **Better Error Handling in `sanitize_db_error_message()`**

   - Added try-catch for `int()` conversion failures
   - Added connection error patterns (Connection refused, timeout)
   - Added debug logging for full exception traceback

2. **Enhanced Logging in `ingest-data-from-query`**

   - Logs data loader type
   - Logs when loader is initialized
   - Logs successful ingestion
   - Logs full traceback on error

3. **Improved Docker Compose Setup**
   - Added explicit network definition
   - Added `PYTHONUNBUFFERED=1` for real-time log output
   - Added logging configuration for rotation
   - Better healthcheck messages

## What to Do After Deployment

1. **Rebuild Docker images**:

   ```bash
   docker-compose down
   docker-compose build --no-cache
   docker-compose up -d
   ```

2. **Check logs immediately after starting**:

   ```bash
   docker logs -f df-backend
   ```

3. **Test the problematic endpoint**:

   - Make the same request that was failing
   - Check logs for the actual error message

4. **Share the full error logs**:
   - Run: `docker logs df-backend 2>&1 | tail -100`
   - Look for lines with "Error ingesting" or "invalid error"
   - Share the full traceback

## Environment Variables Needed

Make sure `api-keys.env` or `.env` contains:

```
CH_HOST=172.19.16.23
CH_PORT=8123
CH_USER=admin
CH_PASSWORD=<your_password>
CH_DB=QC_DATA
```

## Additional Notes

- The error "invalid error value specified" usually comes from Flask receiving a non-integer HTTP status code
- With the new logging, you should see the actual exception message before that error
- Check server disk space and memory - sometimes resource exhaustion can cause cryptic errors
- Verify network connectivity between containers using: `docker network inspect df-network`
