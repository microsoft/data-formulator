#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# Unified helper for the test-database Docker Compose stack.
#
# Usage:
#   ./tests/run_test_dbs.sh start          # start all databases
#   ./tests/run_test_dbs.sh start mysql     # start one service
#   ./tests/run_test_dbs.sh test            # start all + run all loader tests
#   ./tests/run_test_dbs.sh test mysql      # start mysql + run mysql tests
#   ./tests/run_test_dbs.sh stop            # stop all
#   ./tests/run_test_dbs.sh status          # show container status

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.test.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# Map service names to test directories and env vars
declare -A TEST_DIRS=(
    [mysql]="tests/plugin/test_mysql tests/plugin/test_mysql_datalake.py"
    [postgres]="tests/plugin/test_postgres"
    [mongodb]="tests/plugin/test_mongodb"
    [bigquery]="tests/plugin/test_bigquery"
)

set_env() {
    export MYSQL_HOST=localhost MYSQL_PORT="${MYSQL_PORT:-3307}" MYSQL_USER=root MYSQL_PASSWORD=mysql MYSQL_DATABASE=testdb
    export PG_HOST=localhost PG_PORT="${PG_PORT:-5433}" PG_USER=postgres PG_PASSWORD=postgres PG_DATABASE=testdb
    export MONGO_HOST=localhost MONGO_PORT="${MONGO_PORT:-27018}" MONGO_USERNAME=testuser MONGO_PASSWORD=testpass MONGO_DATABASE=testdb
    export BQ_PROJECT_ID=test-project BQ_HTTP_ENDPOINT="http://localhost:${BQ_PORT:-9050}"
}

do_start() {
    local svc="${1:-}"
    if [[ -n "$svc" ]]; then
        compose up -d --build --wait "$svc"
        info "$svc is ready"
    else
        compose up -d --build --wait
        info "All test databases are ready"
    fi
}

do_stop() {
    local svc="${1:-}"
    if [[ -n "$svc" ]]; then
        compose stop "$svc"
    else
        compose down
    fi
    info "Stopped"
}

do_status() {
    compose ps -a
}

do_test() {
    local svc="${1:-}"
    set_env

    if [[ -n "$svc" ]]; then
        do_start "$svc"
        local dirs="${TEST_DIRS[$svc]}"
        if [[ -z "$dirs" ]]; then
            err "Unknown service: $svc (known: ${!TEST_DIRS[*]})"
            exit 1
        fi
        info "Running $svc loader tests..."
        cd "$REPO_ROOT" && python -m pytest $dirs -v
    else
        do_start
        info "Running all data-loader tests..."
        local all_dirs=""
        for d in "${TEST_DIRS[@]}"; do all_dirs="$all_dirs $d"; done
        cd "$REPO_ROOT" && python -m pytest $all_dirs -v
    fi
}

do_reset() {
    local svc="${1:-}"
    if [[ -n "$svc" ]]; then
        compose rm -fsv "$svc"
        do_start "$svc"
    else
        compose down -v --rmi local
        do_start
    fi
}

show_help() {
    cat <<EOF
Unified test-database manager for Data Formulator

Usage: $0 <command> [service]

Commands:
  start [service]   Start test databases (all or one: mysql|postgres|mongodb|bigquery)
  stop  [service]   Stop test databases
  test  [service]   Start databases and run pytest
  status            Show container status
  reset [service]   Destroy and recreate containers
  help              Show this help

Examples:
  $0 start                   # start all four databases
  $0 test mysql              # start MySQL, run MySQL loader tests
  $0 test                    # start all, run all loader tests
  $0 stop                    # tear everything down
EOF
}

case "${1:-help}" in
    start)  do_start "${2:-}" ;;
    stop)   do_stop "${2:-}" ;;
    test)   do_test "${2:-}" ;;
    status) do_status ;;
    reset)  do_reset "${2:-}" ;;
    help|--help|-h) show_help ;;
    *)      err "Unknown command: $1"; show_help; exit 1 ;;
esac
