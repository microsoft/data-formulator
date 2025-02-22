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

# Function to start the development server
start_dev() {
    echo "Starting Data Formulator in development mode..."
    # Start the backend server
    python -m data_formulator --port $PORT &
    # Start the frontend development server
    yarn start
}

# Function to start the production server
start_prod() {
    echo "Starting Data Formulator in production mode..."
    exec python -m data_formulator --port $PORT
}

# Check environment and start appropriate server
if [ "$NODE_ENV" = "development" ]; then
    start_dev
else
    start_prod
fi
