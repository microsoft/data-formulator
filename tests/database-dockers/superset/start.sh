#!/usr/bin/env bash
# Start Superset + DF backend for plugin dev. Run `npx vite` yourself for frontend.
#
# Usage:
#   ./tests/superset/start.sh         # start Superset + DF backend
#   ./tests/superset/start.sh stop    # tear down Superset container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

info() { echo -e "\033[0;32m[✓]\033[0m $1"; }
warn() { echo -e "\033[1;33m[!]\033[0m $1"; }

# --- Stop mode ---
if [ "${1:-}" = "stop" ]; then
    info "Stopping Superset..."
    docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
    info "Done"
    exit 0
fi

# --- Load env ---
set -a
[ -f "$SCRIPT_DIR/.env.superset" ] && source "$SCRIPT_DIR/.env.superset"
[ -f "$REPO_ROOT/.env" ] && source "$REPO_ROOT/.env"
export PLG_SUPERSET_URL="${PLG_SUPERSET_URL:-http://localhost:8088}"
set +a

# --- Start Superset ---
if docker ps --format '{{.Names}}' | grep -q "^df-test-superset$"; then
    info "Superset already running"
else
    # Remove stopped container if it exists (avoids port/name conflicts)
    docker rm -f df-test-superset 2>/dev/null || true
    info "Starting Superset (first run takes ~2 min)..."
    docker compose -f "$COMPOSE_FILE" up -d --force-recreate
    info "Waiting for Superset..."
    until curl -sf http://localhost:8088/health > /dev/null 2>&1; do sleep 3; done
    info "Superset ready (SSO bridge enabled at /df-sso-bridge/)"
fi

# --- Start DF backend ---
echo ""
info "Superset:    http://localhost:8088  (admin / admin)"
info "DF backend:  http://localhost:5567"
info "Run 'npx vite' in another terminal for frontend on http://localhost:5173"
echo ""

cd "$REPO_ROOT"
if command -v uv &> /dev/null; then
    exec uv run data_formulator --port 5567 --dev
else
    exec python -m data_formulator --port 5567 --dev
fi
