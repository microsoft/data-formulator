# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import argparse
import sys
import os
import mimetypes
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')

import flask
from flask import Flask, request, send_from_directory
from flask import stream_with_context, Response

import webbrowser
import threading
import numpy as np
import time

import logging

import json
from pathlib import Path

from dotenv import load_dotenv
import secrets
import base64

APP_ROOT = Path(Path(__file__).parent).absolute()

# Create Flask app (lightweight, no heavy imports yet)
app = Flask(__name__, static_url_path='', static_folder=os.path.join(APP_ROOT, "dist"))
app.secret_key = secrets.token_hex(16)
app.json.sort_keys = False
app.json.ensure_ascii = False
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500 MB

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.int64):
            return int(obj)
        if isinstance(obj, (bytes, bytearray)):
            return base64.b64encode(obj).decode('ascii')
        return super().default(obj)

app.json_encoder = CustomJSONEncoder

# Load env files early.
load_dotenv(os.path.join(APP_ROOT, "..", "..", '.env'))
load_dotenv(os.path.join(APP_ROOT, '.env'))

# Default config from env (can be overridden by CLI args)
app.config['CLI_ARGS'] = {
    'sandbox': os.environ.get('SANDBOX', 'local'),
    'disable_display_keys': os.environ.get('DISABLE_DISPLAY_KEYS', 'false').lower() == 'true',
    'disable_database': os.environ.get('DISABLE_DATABASE', 'false').lower() == 'true',
    'disable_file_upload': os.environ.get('DISABLE_FILE_UPLOAD', 'false').lower() == 'true',
    'project_front_page': os.environ.get('PROJECT_FRONT_PAGE', 'false').lower() == 'true',
    'max_display_rows': int(os.environ.get('MAX_DISPLAY_ROWS', '10000')),
    'data_dir': os.environ.get('DATA_FORMULATOR_HOME', None),
    'dev': os.environ.get('DEV_MODE', 'false').lower() == 'true',
    'workspace_backend': os.environ.get('WORKSPACE_BACKEND', 'local'),
    'azure_blob_connection_string': os.environ.get('AZURE_BLOB_CONNECTION_STRING', None),
    'azure_blob_account_url': os.environ.get('AZURE_BLOB_ACCOUNT_URL', None),
    'azure_blob_container': os.environ.get('AZURE_BLOB_CONTAINER', 'data-formulator'),
    'available_languages': [
        lang.strip() for lang in os.environ.get('AVAILABLE_LANGUAGES', 'en,zh').split(',') if lang.strip()
    ],
}

# Get logger for this module (logging config moved to run_app function)
logger = logging.getLogger(__name__)

def configure_logging():
    """Configure logging for the Flask application."""
    log_level_str = os.getenv("LOG_LEVEL", "INFO").strip().upper()
    app_log_level = getattr(logging, log_level_str, logging.INFO)

    logging.basicConfig(
        level=logging.WARNING,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )

    logging.getLogger('data_formulator').setLevel(app_log_level)

    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('litellm').setLevel(logging.WARNING)
    logging.getLogger('openai').setLevel(logging.WARNING)

    app.logger.handlers = []
    for handler in logging.getLogger().handlers:
        app.logger.addHandler(handler)

    logging.getLogger('data_formulator').info(f"Log level: {log_level_str}")


_blueprints_registered = False

def _register_blueprints():
    """
    Import and register blueprints. This is where heavy imports happen.
    Called at module level (for gunicorn) and from run_app() (for CLI).
    Guarded to prevent double registration.
    """
    global _blueprints_registered
    if _blueprints_registered:
        return
    _blueprints_registered = True
    # Import tables routes (imports database connectors)
    print("  Loading data connectors...", flush=True)
    from data_formulator.tables_routes import tables_bp
    
    # Import agent routes (imports AI/ML libraries: litellm, sklearn, etc.)
    print("  Loading AI agents...", flush=True)
    from data_formulator.agent_routes import agent_bp
    
    # Import session routes
    from data_formulator.session_routes import session_bp

    # Import demo stream routes
    from data_formulator.demo_stream_routes import demo_stream_bp, limiter as demo_stream_limiter, start_iss_collector
    demo_stream_limiter.init_app(app)
    
    # Register blueprints
    app.register_blueprint(tables_bp)
    app.register_blueprint(agent_bp)
    app.register_blueprint(session_bp)
    app.register_blueprint(demo_stream_bp)
    
    # Start background ISS position collector
    start_iss_collector()


# Register blueprints at module level so WSGI servers (gunicorn) pick up all routes.
# The guard inside _register_blueprints() prevents double registration when run via CLI.
_register_blueprints()


@app.route('/api/example-datasets')
def get_sample_datasets():
    from data_formulator.example_datasets_config import EXAMPLE_DATASETS
    return flask.jsonify(EXAMPLE_DATASETS)


@app.route("/", defaults={"path": ""})
def index_alt(path):
    logger.info(app.static_folder)
    return send_from_directory(app.static_folder, "index.html")

@app.errorhandler(413)
def request_entity_too_large(e):
    return flask.jsonify({"status": "error", "message": "File too large. Maximum upload size is 500 MB."}), 413

@app.errorhandler(404)
def page_not_found(e):
    logger.info(app.static_folder)
    return send_from_directory(app.static_folder, "index.html")


@app.route('/api/app-config', methods=['GET'])
def get_app_config():
    """Provide frontend configuration settings from CLI arguments"""
    args = app.config['CLI_ARGS']
    
    config = {
        "SANDBOX": args['sandbox'],
        "DISABLE_DISPLAY_KEYS": args['disable_display_keys'],
        "DISABLE_DATABASE": args['disable_database'],
        "DISABLE_FILE_UPLOAD": args['disable_file_upload'],
        "PROJECT_FRONT_PAGE": args['project_front_page'],
        "MAX_DISPLAY_ROWS": args['max_display_rows'],
        "DEV_MODE": args.get('dev', False),
        "WORKSPACE_BACKEND": args.get('workspace_backend', 'local'),
        "AVAILABLE_LANGUAGES": args.get('available_languages', ['en', 'zh']),
    }

    if not args['disable_database']:
        workspace_backend = args.get('workspace_backend', 'local')
        if workspace_backend != 'azure_blob':
            from data_formulator.datalake.workspace import get_data_formulator_home
            config["DATA_FORMULATOR_HOME"] = str(get_data_formulator_home())

    return flask.jsonify(config)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Data Formulator")
    parser.add_argument("-p", "--port", type=int, default=5567, help="The port number you want to use")
    parser.add_argument("--host", type=str, default=os.environ.get('HOST', '127.0.0.1'),
        help="Network interface to bind to (default: 127.0.0.1). "
             "Use 0.0.0.0 to accept connections from other machines.")
    parser.add_argument("--sandbox", type=str, default=os.environ.get('SANDBOX', 'local'),
        choices=['local', 'docker'],
        help="Python code execution backend: 'local' (default, isolated subprocess with audit hooks), "
             "'docker' (maximum isolation, requires Docker)")
    parser.add_argument("--disable-display-keys", action='store_true', default=False,
        help="Whether disable displaying keys in the frontend UI, recommended to turn on if you host the app not just for yourself.")
    parser.add_argument("--disable-database", action='store_true', default=False,
        help="Disable server-side data persistence. Data loaders and table routes remain available but data is not saved to disk. "
             "The frontend forces local-only mode (storeOnServer=false) so all table data lives in the browser.")
    parser.add_argument("--disable-file-upload", action='store_true', default=False,
        help="Disable file upload functionality. This prevents the app from uploading files to the server.")
    parser.add_argument("--project-front-page", action='store_true', default=False,
        help="Project the front page as the main page instead of the app.")
    parser.add_argument("--max-display-rows", type=int,
        default=int(os.environ.get('MAX_DISPLAY_ROWS', '10000')),
        help="Maximum number of rows to send to the frontend for display (default: 10000)")
    parser.add_argument("--data-dir", type=str, default=None,
        help="Data Formulator home directory for workspaces and sessions (default: ~/.data_formulator)")
    parser.add_argument("--dev", action='store_true', default=False,
        help="Launch the app in development mode (prevents the app from opening the browser automatically)")
    parser.add_argument("--workspace-backend", type=str,
        default=os.environ.get('WORKSPACE_BACKEND', 'local'),
        choices=['local', 'azure_blob'],
        help="Workspace storage backend: 'local' (default, filesystem) or 'azure_blob' (Azure Blob Storage)")
    parser.add_argument("--azure-blob-connection-string", type=str,
        default=os.environ.get('AZURE_BLOB_CONNECTION_STRING'),
        help="Azure Blob Storage connection string (mutually exclusive with --azure-blob-account-url)")
    parser.add_argument("--azure-blob-account-url", type=str,
        default=os.environ.get('AZURE_BLOB_ACCOUNT_URL'),
        help="Azure Blob Storage account URL for Entra ID auth, e.g. https://<account>.blob.core.windows.net "
             "(uses DefaultAzureCredential; mutually exclusive with --azure-blob-connection-string)")
    parser.add_argument("--azure-blob-container", type=str,
        default=os.environ.get('AZURE_BLOB_CONTAINER', 'data-formulator'),
        help="Azure Blob Storage container name (default: data-formulator)")
    return parser.parse_args()


def run_app():
    print("Starting Data Formulator...", flush=True)
    
    configure_logging()
    args = parse_args()
    
    # Override config from CLI args
    app.config['CLI_ARGS'] = {
        'sandbox': args.sandbox,
        'disable_display_keys': args.disable_display_keys,
        'disable_database': args.disable_database,
        'disable_file_upload': args.disable_file_upload,
        'project_front_page': args.project_front_page,
        'max_display_rows': args.max_display_rows,
        'data_dir': args.data_dir,
        'dev': args.dev,
        'workspace_backend': args.workspace_backend,
        'azure_blob_connection_string': args.azure_blob_connection_string,
        'azure_blob_account_url': args.azure_blob_account_url,
        'azure_blob_container': args.azure_blob_container,
        'available_languages': [
            lang.strip() for lang in os.environ.get('AVAILABLE_LANGUAGES', 'en,zh').split(',') if lang.strip()
        ],
    }
    
    # Register blueprints (this is where heavy imports happen)
    _register_blueprints()

    url = "http://localhost:{0}".format(args.port)
    print(f"Ready! Open {url} in your browser.", flush=True)
    
    if not args.dev:
        threading.Timer(1.5, lambda: webbrowser.open(url, new=2)).start()

    debug_mode = args.dev
    app.run(host=args.host, port=args.port, debug=debug_mode, use_reloader=debug_mode)

if __name__ == '__main__':
    run_app()
