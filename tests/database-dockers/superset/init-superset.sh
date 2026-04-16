#!/usr/bin/env bash
# This script is mounted into the container but is NOT used as the entrypoint.
# The actual init sequence is in docker-compose.yml command.
# This file is kept as a reference if you need to customize init further.

echo "[init-superset] Initialization is handled by docker-compose command."
echo "[init-superset] Admin credentials: admin / admin"
echo "[init-superset] Test datasets: df_test_sales, df_test_employees, df_test_weather"
