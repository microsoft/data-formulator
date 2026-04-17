#!/usr/bin/env bash
# Start MongoDB test DB + DF backend. Run `npx vite` yourself for frontend.
#
# Usage:
#   ./tests/database-dockers/mongodb/start.sh         # start MongoDB + DF backend
#   ./tests/database-dockers/mongodb/start.sh stop    # tear down MongoDB container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
CONTAINER_NAME="df-test-mongodb"

info() { echo -e "\033[0;32m[✓]\033[0m $1"; }

# --- Stop mode ---
if [ "${1:-}" = "stop" ]; then
    info "Stopping MongoDB..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    info "Done"
    exit 0
fi

# --- Env ---
export MONGO_HOST=localhost MONGO_PORT="${MONGO_PORT:-27018}"
export MONGO_USERNAME=testuser MONGO_PASSWORD=testpass MONGO_DATABASE=testdb

# --- Start MongoDB ---
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    info "MongoDB already running"
else
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    info "Starting MongoDB..."
    docker compose -f "$COMPOSE_FILE" up -d --build --wait
    info "MongoDB ready (port $MONGO_PORT)"
fi

# --- Start DF backend ---
echo ""
info "MongoDB:     localhost:$MONGO_PORT  (testuser / testpass)"
info "DF backend:  http://localhost:5567"
info "Run 'npx vite' in another terminal for frontend on http://localhost:5173"
echo ""

cd "$REPO_ROOT"
exec uv run data_formulator --port 5567 --dev
