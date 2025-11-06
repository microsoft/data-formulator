# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import random
import sys
import os
import mimetypes
from functools import lru_cache
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')

import flask
from flask import Flask, request, send_from_directory, session
from flask import stream_with_context, Response

import webbrowser
import threading
import numpy as np
import datetime
import time

import logging

import json
from pathlib import Path

from dotenv import load_dotenv
import secrets
import base64
APP_ROOT = Path(Path(__file__).parent).absolute()

import os

# blueprints
from data_formulator.tables_routes import tables_bp
from data_formulator.agent_routes import agent_bp
from data_formulator.db_manager import db_manager
from data_formulator.example_datasets_config import EXAMPLE_DATASETS

import queue
from typing import Dict, Any

app = Flask(__name__, static_url_path='', static_folder=os.path.join(APP_ROOT, "dist"))
app.secret_key = secrets.token_hex(16)  # Generate a random secret key for sessions
app.json.sort_keys = False

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.int64):
            return int(obj)
        if isinstance(obj, (bytes, bytearray)):
            return base64.b64encode(obj).decode('ascii')
        return super().default(obj)

app.json_encoder = CustomJSONEncoder

# Load env files early
load_dotenv(os.path.join(APP_ROOT, "..", "..", 'api-keys.env'))
load_dotenv(os.path.join(APP_ROOT, 'api-keys.env'))
load_dotenv(os.path.join(APP_ROOT, '.env'))

# Add this line to store args at app level
app.config['CLI_ARGS'] = {
    'exec_python_in_subprocess': os.environ.get('EXEC_PYTHON_IN_SUBPROCESS', 'false').lower() == 'true',
    'disable_display_keys': os.environ.get('DISABLE_DISPLAY_KEYS', 'false').lower() == 'true',
    'disable_database': os.environ.get('DISABLE_DATABASE', 'false').lower() == 'true',
    'disable_file_upload': os.environ.get('DISABLE_FILE_UPLOAD', 'false').lower() == 'true',
    'project_front_page': os.environ.get('PROJECT_FRONT_PAGE', 'false').lower() == 'true'
}

# register blueprints
# Only register tables blueprint if database is not disabled
if not app.config['CLI_ARGS']['disable_database']:
    app.register_blueprint(tables_bp)
app.register_blueprint(agent_bp)

# Get logger for this module (logging config moved to run_app function)
logger = logging.getLogger(__name__)

def configure_logging():
    """Configure logging for the Flask application."""
    # Configure root logger for general application logging
    logging.basicConfig(
        level=logging.ERROR,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    
    # Suppress verbose logging from third-party libraries
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('litellm').setLevel(logging.WARNING)
    logging.getLogger('openai').setLevel(logging.WARNING)
    
    # Configure Flask app logger to use the same settings
    app.logger.handlers = []
    for handler in logging.getLogger().handlers:
        app.logger.addHandler(handler)


@app.route('/api/example-datasets')
def get_sample_datasets():
    return flask.jsonify(EXAMPLE_DATASETS)


@app.route("/", defaults={"path": ""})
def index_alt(path):
    logger.info(app.static_folder)
    return send_from_directory(app.static_folder, "index.html")

@app.errorhandler(404)
def page_not_found(e):
    # your processing here
    logger.info(app.static_folder)
    return send_from_directory(app.static_folder, "index.html") #'Hello 404!' #send_from_directory(app.static_folder, "index.html")

###### test functions ######

@app.route('/api/hello')
def hello():
    values = [
            {"a": "A", "b": 28}, {"a": "B", "b": 55}, {"a": "C", "b": 43},
            {"a": "D", "b": 91}, {"a": "E", "b": 81}, {"a": "F", "b": 53},
            {"a": "G", "b": 19}, {"a": "H", "b": 87}, {"a": "I", "b": 52}
        ]
    spec =  {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "description": "A simple bar chart with embedded data.",
        "data": { "values": values },
        "mark": "bar",
        "encoding": {
            "x": {"field": "a", "type": "nominal", "axis": {"labelAngle": 0}},
            "y": {"field": "b", "type": "quantitative"}
        }
    }
    return json.dumps(spec)

@app.route('/api/hello-stream')
def streamed_response():
    def generate():
        values = [
            {"a": "A", "b": 28}, {"a": "B", "b": 55}, {"a": "C", "b": 43},
            {"a": "D", "b": 91}, {"a": "E", "b": 81}, {"a": "F", "b": 53},
            {"a": "G", "b": 19}, {"a": "H", "b": 87}, {"a": "I", "b": 52}
        ]
        spec =  {
            "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
            "description": "A simple bar chart with embedded data.",
            "data": { "values": [] },
            "mark": "bar",
            "encoding": {
                "x": {"field": "a", "type": "nominal", "axis": {"labelAngle": 0}},
                "y": {"field": "b", "type": "quantitative"}
            }
        }
        for i in range(3):
            time.sleep(3)
            spec["data"]["values"] = values[i:]
            yield json.dumps(spec)
    return Response(stream_with_context(generate()))

@app.route('/api/get-session-id', methods=['GET', 'POST'])
def get_session_id():
    """Endpoint to get or confirm a session ID from the client"""
    # if it is a POST request, we expect a session_id in the body
    # if it is a GET request, we do not expect a session_id in the query params
    
    current_session_id = None
    if request.is_json:
        content = request.get_json()
        current_session_id = content.get("session_id", None)
    
    # Check if database is disabled
    database_disabled = app.config['CLI_ARGS']['disable_database']
    
    if database_disabled:
        # When database is disabled, don't use Flask sessions (cookies)
        # Just return the provided session_id or generate a new one
        if current_session_id is None:
            current_session_id = secrets.token_hex(16)
            logger.info(f"Generated session ID for disabled database: {current_session_id}")
        else:
            logger.info(f"Using provided session ID for disabled database: {current_session_id}")
        
        return flask.jsonify({
            "status": "ok",
            "session_id": current_session_id
        })
    else:
        # When database is enabled, use Flask sessions (cookies) as before
        if current_session_id is None:    
            if 'session_id' not in session:
                session['session_id'] = secrets.token_hex(16)
                session.permanent = True
                logger.info(f"Created new session: {session['session_id']}")
        else:
            # override the session_id
            session['session_id'] = current_session_id
            session.permanent = True 
        
        return flask.jsonify({
            "status": "ok",
            "session_id": session['session_id']
        })

@app.route('/api/app-config', methods=['GET'])
def get_app_config():
    """Provide frontend configuration settings from CLI arguments"""
    args = app.config['CLI_ARGS']
    
    # When database is disabled, don't try to access session
    session_id = None
    if not args['disable_database']:
        session_id = session.get('session_id', None)
    
    config = {
        "EXEC_PYTHON_IN_SUBPROCESS": args['exec_python_in_subprocess'],
        "DISABLE_DISPLAY_KEYS": args['disable_display_keys'],
        "DISABLE_DATABASE": args['disable_database'],
        "DISABLE_FILE_UPLOAD": args['disable_file_upload'],
        "PROJECT_FRONT_PAGE": args['project_front_page'],
        "SESSION_ID": session_id
    }
    return flask.jsonify(config)

@app.route('/api/tables/<path:path>', methods=['GET', 'POST'])
def database_disabled_fallback(path):
    """Fallback route for table endpoints when database is disabled"""
    if app.config['CLI_ARGS']['disable_database']:
        return flask.jsonify({
            "status": "error",
            "message": "Database functionality is disabled. Use --disable-database=false to enable table operations."
        }), 503
    else:
        # If database is not disabled but we're hitting this route, it means the tables blueprint wasn't registered
        return flask.jsonify({
            "status": "error", 
            "message": "Table routes are not available"
        }), 404


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Data Formulator")
    parser.add_argument("-p", "--port", type=int, default=5000, help="The port number you want to use")
    parser.add_argument("--exec-python-in-subprocess", action='store_true', default=False,
        help="Whether to execute python in subprocess, it makes the app more secure (reducing the chance for the model to access the local machine), but increases the time of response")
    parser.add_argument("--disable-display-keys", action='store_true', default=False,
        help="Whether disable displaying keys in the frontend UI, recommended to turn on if you host the app not just for yourself.")
    parser.add_argument("--disable-database", action='store_true', default=False,
        help="Disable database functionality and table routes. This prevents creation of local database files and disables table-related endpoints.")
    parser.add_argument("--disable-file-upload", action='store_true', default=False,
        help="Disable file upload functionality. This prevents the app from uploading files to the server.")
    parser.add_argument("--project-front-page", action='store_true', default=False,
        help="Project the front page as the main page instead of the app.")
    parser.add_argument("--dev", action='store_true', default=False,
        help="Launch the app in development mode (prevents the app from opening the browser automatically)")
    return parser.parse_args()


def run_app():
    # Configure logging only when actually running the app
    configure_logging()
    
    args = parse_args()
    # Add this line to make args available to routes
    # override the args from the env file
    app.config['CLI_ARGS'] = {
        'exec_python_in_subprocess': args.exec_python_in_subprocess,
        'disable_display_keys': args.disable_display_keys,
        'disable_database': args.disable_database,
        'disable_file_upload': args.disable_file_upload,
        'project_front_page': args.project_front_page
    }
    
    # Update database manager state
    db_manager._disabled = args.disable_database

    if not args.dev:
        url = "http://localhost:{0}".format(args.port)
        threading.Timer(2, lambda: webbrowser.open(url, new=2)).start()

    # Enable debug mode and auto-reload in development mode
    debug_mode = args.dev
    app.run(host='0.0.0.0', port=args.port, debug=debug_mode, use_reloader=debug_mode)

if __name__ == '__main__':
    #app.run(debug=True, host='127.0.0.1', port=5000)
    #use 0.0.0.0 for public
    run_app()
