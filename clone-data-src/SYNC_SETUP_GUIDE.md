# Oracle to ClickHouse Daily Sync Setup Guide

## Overview

This guide explains how to set up automated daily syncing of data from Oracle `DPD_QC_INFO` table to ClickHouse `DPD_QC_INFO` table.

## Prerequisites

- Linux server with Python 3.7+
- Oracle database access (User: weboutput, Password: weboutputpwd)
- ClickHouse database access
- Root access (for systemd setup) or sudo for cron setup

## Installation

### 1. Install Dependencies

```bash
# Navigate to the script directory
cd /path/to/clone-data-src

# Option 1: Using setup script with systemd (recommended, requires root)
sudo bash setup_daily_sync.sh systemd

# Option 2: Using setup script with cron
bash setup_daily_sync.sh cron

# Option 3: Manual setup
python3 -m venv venv
source venv/bin/activate
pip install oracledb pandas clickhouse-connect
```

## Configuration

### Environment Variables

Set these before running the sync script:

```bash
export CH_HOST=172.19.16.23
export CH_PORT=8123
export CH_USER=admin
export CH_PASSWORD=1fEQlaBivOpYXzw#
export CH_DB=QC_DATA
```

### Systemd Setup (Recommended)

**Automatic Setup (Requires Root):**

```bash
sudo bash setup_daily_sync.sh systemd
```

This creates:

- `/etc/systemd/system/oracle-clickhouse-sync.service` - The service unit
- `/etc/systemd/system/oracle-clickhouse-sync.timer` - Timer runs daily at 2:00 AM

**Manual Setup:**

1. Create service file:

```bash
sudo nano /etc/systemd/system/oracle-clickhouse-sync.service
```

Add the following:

```ini
[Unit]
Description=Oracle to ClickHouse Daily Sync
After=network.target

[Service]
Type=oneshot
User=root
WorkingDirectory=/path/to/clone-data-src
Environment="CH_HOST=172.19.16.23"
Environment="CH_PORT=8123"
Environment="CH_USER=admin"
Environment="CH_PASSWORD=1fEQlaBivOpYXzw#"
Environment="CH_DB=QC_DATA"
ExecStart=/path/to/venv/bin/python /path/to/sync_oracle_to_clickhouse.py
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

2. Create timer file:

```bash
sudo nano /etc/systemd/system/oracle-clickhouse-sync.timer
```

Add:

```ini
[Unit]
Description=Oracle to ClickHouse Daily Sync Timer
Requires=oracle-clickhouse-sync.service

[Timer]
OnCalendar=daily
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

3. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable oracle-clickhouse-sync.timer
sudo systemctl start oracle-clickhouse-sync.timer
```

### Cron Setup

**Automatic Setup:**

```bash
bash setup_daily_sync.sh cron
```

**Manual Setup:**

1. Edit crontab:

```bash
crontab -e
```

2. Add this line (runs daily at 2:00 AM):

```
0 2 * * * /path/to/clone-data-src/run_sync.sh
```

Or in a specific timezone:

```
0 2 * * * TZ=/etc/timezone /path/to/clone-data-src/run_sync.sh
```

## Monitoring

### Systemd

```bash
# Check timer schedule
sudo systemctl list-timers oracle-clickhouse-sync

# View service status
sudo systemctl status oracle-clickhouse-sync

# View recent logs (last 50 lines)
sudo journalctl -u oracle-clickhouse-sync -n 50

# Follow logs in real-time
sudo journalctl -u oracle-clickhouse-sync -f

# View logs with timestamps
sudo journalctl -u oracle-clickhouse-sync --no-pager
```

### Cron

```bash
# View log file
tail -f /path/to/clone-data-src/logs/sync.log

# View all logs for a date
grep "2026-02-" /path/to/clone-data-src/logs/sync.log

# Check cron job execution (depends on system)
sudo grep CRON /var/log/syslog  # Debian/Ubuntu
sudo grep CRON /var/log/messages  # RHEL/CentOS
```

## Manual Execution

### Using Systemd

```bash
# Manually trigger the sync
sudo systemctl start oracle-clickhouse-sync

# Check status
sudo systemctl status oracle-clickhouse-sync
```

### Using Cron/Direct

```bash
cd /path/to/clone-data-src
source venv/bin/activate
python sync_oracle_to_clickhouse.py
```

## Testing

```bash
# Navigate to script directory
cd /path/to/clone-data-src

# Activate virtual environment
source venv/bin/activate

# Run script directly
python sync_oracle_to_clickhouse.py

# Or with custom environment variables
CH_HOST=172.19.16.23 CH_PORT=8123 CH_USER=admin CH_PASSWORD=password python sync_oracle_to_clickhouse.py
```

## Troubleshooting

### Oracle Connection Issues

```bash
# Test Oracle connectivity
python3 << EOF
import oracledb
try:
    conn = oracledb.connect(user="weboutput", password="weboutputpwd", dsn="172.25.9.40:1521/HOYAV3")
    print("✓ Oracle connection successful")
    conn.close()
except Exception as e:
    print(f"✗ Oracle connection failed: {e}")
EOF
```

### ClickHouse Connection Issues

```bash
# Test ClickHouse connectivity
python3 << EOF
from clickhouse_connect import get_client
try:
    client = get_client(host="172.19.16.23", port=8123, username="admin", password="password")
    result = client.query("SELECT 1")
    print("✓ ClickHouse connection successful")
except Exception as e:
    print(f"✗ ClickHouse connection failed: {e}")
EOF
```

### Check Logs

```bash
# For systemd
sudo journalctl -u oracle-clickhouse-sync -n 100 --no-pager

# For cron
tail -100 /path/to/clone-data-src/logs/sync*.log
```

### View ClickHouse Table

```bash
# SSH into ClickHouse server or use client
clickhouse-client --host 172.19.16.23 --user admin --password

# Then:
SELECT COUNT(*) FROM QC_DATA.DPD_QC_INFO;
DESCRIBE TABLE QC_DATA.DPD_QC_INFO;
SELECT * FROM QC_DATA.DPD_QC_INFO LIMIT 10;
```

## Stopping the Sync

### Systemd

```bash
# Stop timer
sudo systemctl stop oracle-clickhouse-sync.timer

# Disable timer (so it doesn't start on reboot)
sudo systemctl disable oracle-clickhouse-sync.timer

# Remove service and timer files
sudo rm /etc/systemd/system/oracle-clickhouse-sync.{service,timer}
sudo systemctl daemon-reload
```

### Cron

```bash
# Remove cron job
crontab -e
# Delete the line with oracle sync
```

## Performance Optimization

### Increase Batch Size

Edit `sync_oracle_to_clickhouse.py` in `fetch_data_from_table()`:

```python
# Change from 100 to higher number for faster sync
limit: int = 100000  # Get more records per run
```

### Adjust ClickHouse Table Settings

For better write performance:

```sql
ALTER TABLE QC_DATA.DPD_QC_INFO
MODIFY SETTING
    parts_to_delay_insert = 1000,
    parts_to_throw_insert = 2000;
```

## Security Recommendations

1. **Store passwords securely** - Use environment variables or .env files (add to .gitignore)
2. **Restrict file permissions** - Set appropriate permissions on scripts
3. **Use database users with minimal required privileges**
4. **Enable audit logging** on both Oracle and ClickHouse
5. **Monitor resource usage** - Check disk space and memory on sync server

## Additional Resources

- [Oracle Database Documentation](https://docs.oracle.com/)
- [ClickHouse Documentation](https://clickhouse.com/docs/)
- [Python oracledb Documentation](https://python-oracledb.readthedocs.io/)
- [Python clickhouse-connect Documentation](https://clickhouse.com/docs/en/integrations/language-clients/python)
