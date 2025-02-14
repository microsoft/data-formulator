#!/bin/bash
set -e

# Create api-keys.env if it doesn't exist
if [ ! -f "$CONFIG_DIR/api-keys.env" ]; then
    touch "$CONFIG_DIR/api-keys.env"
fi

# Export environment variables from api-keys.env
if [ -f "$CONFIG_DIR/api-keys.env" ]; then
    export $(cat "$CONFIG_DIR/api-keys.env" | xargs)
fi

# Start data_formulator with specified port
exec python -m data_formulator --port $PORT
