#!/bin/bash
# Start the Flask application
# Use gunicorn for production, Flask's built-in server for development
if [ "$FLASK_ENV" = "production" ]; then
    # Install gunicorn if it's not already installed
    if ! command -v gunicorn &> /dev/null; then
        pip install gunicorn
    fi
    gunicorn --bind 0.0.0.0:$FLASK_RUN_PORT "data_formulator:create_app()"
else
    flask run --host=0.0.0.0 --port=$FLASK_RUN_PORT
fi