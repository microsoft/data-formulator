#!/bin/bash
set -e

# Create api-keys.env if it doesn't exist
if [ ! -f "$CONFIG_DIR/api-keys.env" ]; then
    touch "$CONFIG_DIR/api-keys.env"
fi

# Export environment variables from api-keys.env
if [ -f "$CONFIG_DIR/api-keys.env" ]; then
    export $(grep -v '^#' "$CONFIG_DIR/api-keys.env" | xargs)
fi

# Function to start the development server
start_dev() {
    echo "Starting Data Formulator in development mode..."
    # Add the project directory to PYTHONPATH
    export PYTHONPATH=$PYTHONPATH:/app/py-src
    
    # Create dist directory if it doesn't exist
    mkdir -p /app/py-src/data_formulator/dist
    
    # Create a simple index.html file that redirects to the Vite dev server
    cat > /app/py-src/data_formulator/dist/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="refresh" content="0;URL='http://localhost:5173'" />
</head>
<body>
    <p>Redirecting to development server...</p>
</body>
</html>
EOF
    
    # Start the backend server
    python -m data_formulator --port $PORT &
    
    # Start the frontend development server with host option for Docker
    yarn start --host 0.0.0.0
}

# Function to start the production server
start_prod() {
    echo "Starting Data Formulator in production mode..."
    # Add the project directory to PYTHONPATH
    export PYTHONPATH=$PYTHONPATH:/app/py-src
    exec python -m data_formulator --port $PORT
}

# Check environment and start appropriate server
if [ "$NODE_ENV" = "development" ]; then
    start_dev
else
    start_prod
fi
