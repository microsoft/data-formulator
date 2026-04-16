#!/usr/bin/env bash
# Start BigQuery emulator + DF backend. Run `npx vite` yourself for frontend.
#
# Usage:
#   ./tests/database-dockers/bigquery/start.sh         # start BigQuery + DF backend
#   ./tests/database-dockers/bigquery/start.sh stop    # tear down BigQuery container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
CONTAINER_NAME="df-test-bigquery"

info() { echo -e "\033[0;32m[✓]\033[0m $1"; }

# --- Stop mode ---
if [ "${1:-}" = "stop" ]; then
    info "Stopping BigQuery emulator..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    info "Done"
    exit 0
fi

# --- Env ---
export BQ_PROJECT_ID=test-project
export BQ_HTTP_ENDPOINT="http://localhost:${BQ_PORT:-9050}"

# --- Start BigQuery ---
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    info "BigQuery emulator already running"
else
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    info "Starting BigQuery emulator..."
    docker compose -f "$COMPOSE_FILE" up -d --build --wait
    info "BigQuery emulator ready (port ${BQ_PORT:-9050})"
fi

# --- Start DF backend ---
echo ""
info "BigQuery:    $BQ_HTTP_ENDPOINT  (project: $BQ_PROJECT_ID)"
info "DF backend:  http://localhost:5567"
info "Run 'npx vite' in another terminal for frontend on http://localhost:5173"
echo ""

cd "$REPO_ROOT"
exec uv run data_formulator --port 5567 --dev
