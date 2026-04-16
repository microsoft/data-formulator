#!/usr/bin/env bash
# Start MySQL test DB + DF backend. Run `npx vite` yourself for frontend.
#
# Usage:
#   ./tests/database-dockers/mysql/start.sh         # start MySQL + DF backend
#   ./tests/database-dockers/mysql/start.sh stop    # tear down MySQL container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
CONTAINER_NAME="df-test-mysql"

info() { echo -e "\033[0;32m[✓]\033[0m $1"; }

# --- Stop mode ---
if [ "${1:-}" = "stop" ]; then
    info "Stopping MySQL..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    info "Done"
    exit 0
fi

# --- Env ---
export MYSQL_HOST=localhost MYSQL_PORT="${MYSQL_PORT:-3307}"
export MYSQL_USER=root MYSQL_PASSWORD=mysql MYSQL_DATABASE=testdb

# --- Start MySQL ---
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    info "MySQL already running"
else
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    info "Starting MySQL..."
    docker compose -f "$COMPOSE_FILE" up -d --build --wait
    info "MySQL ready (port $MYSQL_PORT)"
fi

# --- Start DF backend ---
echo ""
info "MySQL:       localhost:$MYSQL_PORT  (root / mysql)"
info "DF backend:  http://localhost:5567"
info "Run 'npx vite' in another terminal for frontend on http://localhost:5173"
echo ""

cd "$REPO_ROOT"
exec uv run data_formulator --port 5567 --dev
