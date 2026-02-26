#!/bin/bash
# Setup script for daily Oracle to ClickHouse sync on Linux

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SCRIPT_NAME="sync_oracle_to_clickhouse.py"
SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT_NAME"
LOG_DIR="$SCRIPT_DIR/logs"
VENV_PATH="${VENV_PATH:-$SCRIPT_DIR/venv}"
SERVICE_NAME="oracle-clickhouse-sync"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
TIMER_FILE="/etc/systemd/system/${SERVICE_NAME}.timer"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Oracle to ClickHouse Daily Sync Setup ===${NC}\n"

# Check if running as root for systemd setup
if [ "$1" == "systemd" ]; then
    if [ $EUID -ne 0 ]; then
        echo -e "${RED}Error: Setup with systemd requires root privileges. Use: sudo $0 systemd${NC}"
        exit 1
    fi
    SETUP_TYPE="systemd"
else
    SETUP_TYPE="cron"
fi

# Create logs directory
if [ ! -d "$LOG_DIR" ]; then
    mkdir -p "$LOG_DIR"
    echo -e "${GREEN}✓ Created logs directory: $LOG_DIR${NC}"
fi

# Check if Python dependencies are installed
echo -e "${YELLOW}Checking dependencies...${NC}"
if [ -d "$VENV_PATH" ]; then
    source "$VENV_PATH/bin/activate"
    echo -e "${GREEN}✓ Activated virtual environment${NC}"
else
    echo -e "${YELLOW}Virtual environment not found at $VENV_PATH${NC}"
    echo -e "${YELLOW}Creating virtual environment...${NC}"
    python3 -m venv "$VENV_PATH"
    source "$VENV_PATH/bin/activate"
fi

# Install required packages
echo -e "${YELLOW}Installing/updating required packages...${NC}"
pip install --upgrade pip
pip install oracledb pandas clickhouse-connect

echo -e "${GREEN}✓ Dependencies installed${NC}\n"

# Setup based on type
if [ "$SETUP_TYPE" == "systemd" ]; then
    echo -e "${YELLOW}Setting up systemd service and timer...${NC}\n"
    
    # Create systemd service file
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Oracle to ClickHouse Daily Sync
After=network.target

[Service]
Type=oneshot
User=root
WorkingDirectory=$SCRIPT_DIR
Environment="VENV_PATH=$VENV_PATH"
Environment="CH_HOST=${CH_HOST:-172.19.16.23}"
Environment="CH_PORT=${CH_PORT:-8123}"
Environment="CH_USER=${CH_USER:-admin}"
Environment="CH_PASSWORD=${CH_PASSWORD:-1fEQlaBivOpYXzw#}"
Environment="CH_DB=${CH_DB:-QC_DATA}"
ExecStart=$VENV_PATH/bin/python $SCRIPT_PATH
StandardOutput=journal
StandardError=journal
SyslogIdentifier=oracle-clickhouse-sync

[Install]
WantedBy=multi-user.target
EOF

    # Create systemd timer file (runs daily at 2 AM)
    cat > "$TIMER_FILE" << EOF
[Unit]
Description=Oracle to ClickHouse Daily Sync Timer
Requires=${SERVICE_NAME}.service

[Timer]
OnCalendar=daily
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

    # Set permissions
    chmod 644 "$SERVICE_FILE" "$TIMER_FILE"
    
    # Reload systemd daemon
    systemctl daemon-reload
    
    # Enable and start timer
    systemctl enable "$TIMER_FILE"
    systemctl start "$TIMER_FILE"
    
    echo -e "${GREEN}✓ Systemd service and timer created${NC}"
    echo -e "${GREEN}✓ Service file: $SERVICE_FILE${NC}"
    echo -e "${GREEN}✓ Timer file: $TIMER_FILE${NC}\n"
    
    # Display status
    echo -e "${YELLOW}Timer status:${NC}"
    systemctl status "$TIMER_FILE" --no-pager
    
    echo -e "\n${GREEN}To check timer schedule:${NC}"
    echo "  systemctl list-timers $SERVICE_NAME"
    
    echo -e "\n${GREEN}To view logs:${NC}"
    echo "  journalctl -u $SERVICE_NAME -n 50 -f"
    
    echo -e "\n${GREEN}To manually trigger sync:${NC}"
    echo "  systemctl start $SERVICE_NAME"

else
    # Setup cron job
    echo -e "${YELLOW}Setting up cron job...${NC}\n"
    
    # Create wrapper script
    WRAPPER_SCRIPT="$SCRIPT_DIR/run_sync.sh"
    cat > "$WRAPPER_SCRIPT" << EOF
#!/bin/bash
source $VENV_PATH/bin/activate
export CH_HOST=\${CH_HOST:-172.19.16.23}
export CH_PORT=\${CH_PORT:-8123}
export CH_USER=\${CH_USER:-admin}
export CH_PASSWORD=\${CH_PASSWORD:-1fEQlaBivOpYXzw#}
export CH_DB=\${CH_DB:-QC_DATA}
python $SCRIPT_PATH >> $LOG_DIR/sync.log 2>&1
EOF
    chmod +x "$WRAPPER_SCRIPT"
    
    # Add to crontab (runs daily at 2 AM)
    CRON_JOB="0 2 * * * $WRAPPER_SCRIPT"
    
    # Check if cron job already exists
    if crontab -l 2>/dev/null | grep -q "$SCRIPT_NAME"; then
        echo -e "${YELLOW}Cron job already exists, updating...${NC}"
        (crontab -l 2>/dev/null | grep -v "$SCRIPT_NAME"; echo "$CRON_JOB") | crontab -
    else
        (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    fi
    
    echo -e "${GREEN}✓ Cron job created${NC}"
    echo -e "${GREEN}✓ Wrapper script: $WRAPPER_SCRIPT${NC}"
    echo -e "${GREEN}✓ Log file: $LOG_DIR/sync.log${NC}\n"
    
    echo -e "${YELLOW}Current crontab:${NC}"
    crontab -l 2>/dev/null | grep "$SCRIPT_NAME" || echo "No cron job found"
    
    echo -e "\n${GREEN}To view logs in real-time:${NC}"
    echo "  tail -f $LOG_DIR/sync.log"
    
    echo -e "\n${GREEN}To manually trigger sync:${NC}"
    echo "  $WRAPPER_SCRIPT"
fi

echo -e "\n${GREEN}=== Setup completed successfully! ===${NC}\n"
echo -e "${YELLOW}Environment variables (can be set in shell or .env):${NC}"
echo "  CH_HOST=172.19.16.23"
echo "  CH_PORT=8123"
echo "  CH_USER=admin"
echo "  CH_PASSWORD=your_password"
echo "  CH_DB=QC_DATA"
