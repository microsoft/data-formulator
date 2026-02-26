#!/bin/bash
# Quick test script for Oracle to ClickHouse sync

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
VENV_PATH="${VENV_PATH:-$SCRIPT_DIR/venv}"

echo "=== Oracle to ClickHouse Sync - Quick Test ==="
echo ""

# Check if virtual environment exists
if [ ! -d "$VENV_PATH" ]; then
    echo "Virtual environment not found. Creating..."
    python3 -m venv "$VENV_PATH"
fi

# Activate virtual environment
source "$VENV_PATH/bin/activate"

echo "Testing Oracle connection..."
python3 << 'EOF'
import sys
try:
    import oracledb
    
    conn = oracledb.connect(
        user="weboutput",
        password="weboutputpwd",
        dsn="172.25.9.40:1521/HOYAV3"
    )
    
    # Try to fetch 1 record
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM DPD_QC_INFO WHERE ROWNUM <= 1")
    result = cursor.fetchone()
    
    conn.close()
    
    if result:
        print("✓ Oracle connection successful - table DPD_QC_INFO found")
        sys.exit(0)
    else:
        print("✓ Oracle connection successful - table accessible")
        sys.exit(0)
        
except Exception as e:
    print(f"✗ Oracle connection failed: {e}")
    sys.exit(1)
EOF

ORACLE_STATUS=$?

echo "Testing ClickHouse connection..."
python3 << 'EOF'
import sys
import os
try:
    from clickhouse_connect import get_client
    
    ch_host = os.environ.get("CH_HOST", "172.19.16.23")
    ch_port = int(os.environ.get("CH_PORT", "8123"))
    ch_user = os.environ.get("CH_USER", "admin")
    ch_password = os.environ.get("CH_PASSWORD", "1fEQlaBivOpYXzw#")
    ch_db = os.environ.get("CH_DB", "QC_DATA")
    
    client = get_client(
        host=ch_host,
        port=ch_port,
        username=ch_user,
        password=ch_password,
        database=ch_db
    )
    
    # Test connection
    result = client.query("SELECT 1")
    print(f"✓ ClickHouse connection successful at {ch_host}:{ch_port}")
    sys.exit(0)
    
except Exception as e:
    print(f"✗ ClickHouse connection failed: {e}")
    sys.exit(1)
EOF

CLICKHOUSE_STATUS=$?

echo ""
echo "=== Test Summary ==="
if [ $ORACLE_STATUS -eq 0 ] && [ $CLICKHOUSE_STATUS -eq 0 ]; then
    echo "✓ Both connections successful - ready to run sync"
    echo ""
    echo "To run the sync manually:"
    echo "  cd $SCRIPT_DIR"
    echo "  source venv/bin/activate"
    echo "  python sync_oracle_to_clickhouse.py"
    exit 0
else
    echo "✗ Connection test failed - check configuration"
    exit 1
fi
