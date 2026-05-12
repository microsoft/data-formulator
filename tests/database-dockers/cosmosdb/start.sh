#!/usr/bin/env bash
# Start Cosmos DB emulator + seed data + DF backend. Run `npx vite` yourself for frontend.
#
# Usage:
#   ./tests/database-dockers/cosmosdb/start.sh         # start Cosmos DB + DF backend
#   ./tests/database-dockers/cosmosdb/start.sh stop    # tear down Cosmos DB container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
CONTAINER_NAME="df-test-cosmosdb"

info() { echo -e "\033[0;32m[✓]\033[0m $1"; }
warn() { echo -e "\033[1;33m[!]\033[0m $1"; }

# --- Stop mode ---
if [ "${1:-}" = "stop" ]; then
    info "Stopping Cosmos DB emulator..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    info "Done"
    exit 0
fi

# --- Env ---
export COSMOS_ENDPOINT="https://localhost:${COSMOS_PORT:-8081}"
export COSMOS_KEY="C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="
export COSMOS_DATABASE=testdb

# --- Start Cosmos DB ---
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    info "Cosmos DB emulator already running"
else
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
    info "Starting Cosmos DB emulator (first run takes ~60s)..."
    docker compose -f "$COMPOSE_FILE" up -d --wait
    info "Cosmos DB emulator ready"
fi

# --- Seed test data ---
info "Seeding test data..."
cd "$REPO_ROOT" && uv run python "$SCRIPT_DIR/seed_data.py" \
    --endpoint "$COSMOS_ENDPOINT" --key "$COSMOS_KEY"
info "Test data seeded"

# --- Start DF backend ---
echo ""
info "Cosmos DB:   $COSMOS_ENDPOINT  (emulator key)"
info "DF backend:  http://localhost:5567"
info "Run 'npx vite' in another terminal for frontend on http://localhost:5173"
echo ""

cd "$REPO_ROOT"
exec uv run data_formulator --port 5567 --dev
