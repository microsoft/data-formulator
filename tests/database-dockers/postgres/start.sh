#!/usr/bin/env bash
# Start PostgreSQL test DB + DF backend. Run `npx vite` yourself for frontend.
#
# Usage:
#   ./tests/database-dockers/postgres/start.sh         # start PostgreSQL + DF backend
#   ./tests/database-dockers/postgres/start.sh stop    # tear down PostgreSQL container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
CONTAINER_NAME="df-test-postgres"

info() { echo -e "\033[0;32m[✓]\033[0m $1"; }

# --- Stop mode ---
if [ "${1:-}" = "stop" ]; then
    info "Stopping PostgreSQL..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    info "Done"
    exit 0
fi

# --- Env ---
export PG_HOST=localhost PG_PORT="${PG_PORT:-5433}"
export PG_USER=postgres PG_PASSWORD=postgres PG_DATABASE=testdb

# --- Start PostgreSQL ---
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    info "PostgreSQL already running"
else
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    info "Starting PostgreSQL..."
    docker compose -f "$COMPOSE_FILE" up -d --build --wait
    info "PostgreSQL ready (port $PG_PORT)"
fi

# --- Start DF backend ---
echo ""
info "PostgreSQL:  localhost:$PG_PORT  (postgres / postgres)"
info "DF backend:  http://localhost:5567"
info "Run 'npx vite' in another terminal for frontend on http://localhost:5173"
echo ""

cd "$REPO_ROOT"
exec uv run data_formulator --port 5567 --dev
