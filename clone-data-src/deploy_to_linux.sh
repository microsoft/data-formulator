#!/bin/bash
# Quick Deploy Script - Copy to Linux and run
# Usage: bash deploy_to_linux.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Oracle → ClickHouse Sync - Quick Deploy  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}\n"

# Get deployment parameters
read -p "Enter Linux server address (user@host): " SERVER_ADDRESS
read -p "Enter deployment path on server (e.g., /opt/data-sync): " DEPLOY_PATH

if [ -z "$SERVER_ADDRESS" ] || [ -z "$DEPLOY_PATH" ]; then
    echo -e "${RED}Error: Missing required parameters${NC}"
    exit 1
fi

echo -e "\n${YELLOW}Deployment plan:${NC}"
echo "  From: $(pwd)/clone-data-src"
echo "  To: $SERVER_ADDRESS:$DEPLOY_PATH"
echo "  Files:"
echo "    - sync_oracle_to_clickhouse.py"
echo "    - setup_daily_sync.sh"
echo "    - test_sync_connection.sh"

read -p "Continue? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Step 1: Create directory on server
echo -e "\n${YELLOW}Step 1: Creating directory on server...${NC}"
ssh "$SERVER_ADDRESS" "mkdir -p $DEPLOY_PATH && chmod 755 $DEPLOY_PATH" || {
    echo -e "${RED}✗ Failed to create directory${NC}"
    exit 1
}
echo -e "${GREEN}✓ Directory created${NC}"

# Step 2: Copy Python script
echo -e "\n${YELLOW}Step 2: Copying Python sync script...${NC}"
scp sync_oracle_to_clickhouse.py "$SERVER_ADDRESS:$DEPLOY_PATH/" || {
    echo -e "${RED}✗ Failed to copy sync script${NC}"
    exit 1
}
echo -e "${GREEN}✓ Sync script copied${NC}"

# Step 3: Copy setup scripts
echo -e "\n${YELLOW}Step 3: Copying setup and test scripts...${NC}"
scp setup_daily_sync.sh "$SERVER_ADDRESS:$DEPLOY_PATH/" || {
    echo -e "${RED}✗ Failed to copy setup script${NC}"
    exit 1
}
scp test_sync_connection.sh "$SERVER_ADDRESS:$DEPLOY_PATH/" || {
    echo -e "${RED}✗ Failed to copy test script${NC}"
    exit 1
}
echo -e "${GREEN}✓ Setup scripts copied${NC}"

# Step 4: Make scripts executable
echo -e "\n${YELLOW}Step 4: Setting execute permissions...${NC}"
ssh "$SERVER_ADDRESS" "chmod +x $DEPLOY_PATH/*.sh" || {
    echo -e "${RED}✗ Failed to set permissions${NC}"
    exit 1
}
echo -e "${GREEN}✓ Permissions set${NC}"

# Step 5: Test connection
echo -e "\n${YELLOW}Step 5: Testing connections...${NC}"
ssh "$SERVER_ADDRESS" "cd $DEPLOY_PATH && bash test_sync_connection.sh" || {
    echo -e "${YELLOW}⚠ Connection test failed - check configuration${NC}"
}

# Step 6: Setup automation
echo -e "\n${YELLOW}Step 6: Setting up automation...${NC}"
read -p "Setup method? (1=systemd [recommended], 2=cron): " setup_method

if [ "$setup_method" = "1" ]; then
    echo -e "${YELLOW}Setting up systemd (requires root)...${NC}"
    ssh "$SERVER_ADDRESS" "cd $DEPLOY_PATH && sudo bash setup_daily_sync.sh systemd" || {
        echo -e "${YELLOW}⚠ Systemd setup may require additional configuration${NC}"
    }
elif [ "$setup_method" = "2" ]; then
    echo -e "${YELLOW}Setting up cron...${NC}"
    ssh "$SERVER_ADDRESS" "cd $DEPLOY_PATH && bash setup_daily_sync.sh cron" || {
        echo -e "${YELLOW}⚠ Cron setup failed${NC}"
    }
fi

echo -e "\n${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        Deployment Completed! ✓            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}\n"

echo -e "${YELLOW}Next steps on server:${NC}"
echo -e "  1. SSH to server: ${BLUE}ssh $SERVER_ADDRESS${NC}"
echo -e "  2. Go to deploy path: ${BLUE}cd $DEPLOY_PATH${NC}"
echo -e "  3. View logs: ${BLUE}tail -f logs/sync*.log${NC}"
echo -e "  4. Manual run: ${BLUE}python3 sync_oracle_to_clickhouse.py${NC}"

echo -e "\n${YELLOW}Check status:${NC}"
if [ "$setup_method" = "1" ]; then
    echo -e "  ${BLUE}sudo systemctl list-timers oracle-clickhouse-sync${NC}"
    echo -e "  ${BLUE}sudo journalctl -u oracle-clickhouse-sync -f${NC}"
else
    echo -e "  ${BLUE}crontab -l | grep sync${NC}"
fi
