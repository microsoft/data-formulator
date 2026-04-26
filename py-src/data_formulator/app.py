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

# Load env files early so FLASK_SECRET_KEY is available before app setup.
load_dotenv(os.path.join(APP_ROOT, "..", "..", '.env'))
load_dotenv(os.path.join(APP_ROOT, '.env'))

# Create Flask app (lightweight, no heavy imports yet)
app = Flask(__name__, static_url_path='', static_folder=os.path.join(APP_ROOT, "dist"))
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(16)
app.json.sort_keys = False
app.json.ensure_ascii = False
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500 MB
app.config['PERMANENT_SESSION_LIFETIME'] = 60 * 60 * 24 * 365
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Server-side session via flask-session (filesystem / cachelib backend).
# Stores SSO tokens + service tokens without hitting the 4 KB cookie limit.
_data_home = os.environ.get(
    'DATA_FORMULATOR_HOME',
    str(Path.home() / '.data-formulator'),
)
_session_dir = os.path.join(_data_home, 'sessions')
os.makedirs(_session_dir, exist_ok=True)

app.config['SESSION_TYPE'] = 'cachelib'
app.config['SESSION_PERMANENT'] = True
app.config['SESSION_USE_SIGNER'] = True
app.config['SESSION_KEY_PREFIX'] = 'df_session:'
app.config['SESSION_CLEANUP_N_REQUESTS'] = 100

try:
    from cachelib import FileSystemCache
    app.config['SESSION_CACHELIB'] = FileSystemCache(
        cache_dir=_session_dir, threshold=500,
    )
    from flask_session import Session
    Session(app)
except ImportError:
    logging.getLogger(__name__).warning(
        "flask-session not installed; falling back to cookie sessions "
        "(TokenStore features will be limited)"
    )

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.int64):
            return int(obj)
        if isinstance(obj, (bytes, bytearray)):
            return base64.b64encode(obj).decode('ascii')
        return super().default(obj)

app.json_encoder = CustomJSONEncoder

# Default config from env (can be overridden by CLI args)
# DISABLE_DATABASE=true is a convenience preset for multi-user anonymous deployments.
# It bundles: ephemeral workspace + no data connectors + no custom models + hide keys.
_disable_database = os.environ.get('DISABLE_DATABASE', 'false').lower() == 'true'
_default_ws_backend = os.environ.get('WORKSPACE_BACKEND', 'local')
if _disable_database and _default_ws_backend == 'local':
    _default_ws_backend = 'ephemeral'
app.config['CLI_ARGS'] = {
    'host': os.environ.get('HOST', '127.0.0.1'),
    'sandbox': os.environ.get('SANDBOX', 'local'),
    'disable_display_keys': _disable_database or os.environ.get('DISABLE_DISPLAY_KEYS', 'false').lower() == 'true',
    'disable_data_connectors': _disable_database or os.environ.get('DISABLE_DATA_CONNECTORS', 'false').lower() == 'true',
    'disable_custom_models': _disable_database or os.environ.get('DISABLE_CUSTOM_MODELS', 'false').lower() == 'true',
    'project_front_page': os.environ.get('PROJECT_FRONT_PAGE', 'false').lower() == 'true',
    'max_display_rows': int(os.environ.get('MAX_DISPLAY_ROWS', '10000')),
    'data_dir': os.environ.get('DATA_FORMULATOR_HOME', None),
    'dev': os.environ.get('DEV_MODE', 'false').lower() == 'true',
    'workspace_backend': _default_ws_backend,
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

    from data_formulator.security.log_sanitizer import SensitiveDataFilter

    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(SensitiveDataFilter())

    logging.basicConfig(
        level=logging.WARNING,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[handler],
    )

    logging.getLogger('data_formulator').setLevel(app_log_level)

    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('litellm').setLevel(logging.WARNING)
    logging.getLogger('openai').setLevel(logging.WARNING)

    app.logger.handlers = []
    for h in logging.getLogger().handlers:
        app.logger.addHandler(h)

    logging.getLogger('data_formulator').info(
        "Log level: %s (sanitize=%s)", log_level_str,
        os.getenv("LOG_SANITIZE", "true"),
    )


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

    # Register unified error handlers and request-id middleware
    from data_formulator.error_handler import register_error_handlers
    register_error_handlers(app)

    # Import tables routes (imports database connectors)
    print("  Loading data loader drivers...", flush=True)
    from data_formulator.routes.tables import tables_bp
    
    # Import agent routes (imports AI/ML libraries: litellm, sklearn, etc.)
    print("  Loading AI agents...", flush=True)
    from data_formulator.routes.agents import agent_bp
    
    # Import session routes
    from data_formulator.routes.sessions import session_bp

    # Import demo stream routes
    from data_formulator.routes.demo_stream import demo_stream_bp, limiter as demo_stream_limiter
    demo_stream_limiter.init_app(app)
    
    # Register blueprints
    app.register_blueprint(tables_bp)
    app.register_blueprint(agent_bp)
    app.register_blueprint(session_bp)
    app.register_blueprint(demo_stream_bp)

    # Initialise pluggable authentication (reads AUTH_PROVIDER env var)
    from data_formulator.auth.identity import init_auth, get_active_provider
    init_auth(app)

    # Register auth gateway blueprints for stateful providers (e.g. GitHub OAuth)
    provider = get_active_provider()
    if provider and provider.name == "github":
        from data_formulator.auth.gateways.github_gateway import github_bp
        app.register_blueprint(github_bp)

    # Register auth token management routes (always active)
    from data_formulator.auth.gateways.oidc_gateway import auth_tokens_bp
    app.register_blueprint(auth_tokens_bp)

    # Register backend OIDC gateway (auto-detected: active when OIDC_CLIENT_SECRET is set)
    from data_formulator.auth.providers.oidc import is_backend_oidc_mode
    if is_backend_oidc_mode():
        from data_formulator.auth.gateways.oidc_gateway import oidc_bp, oidc_callback_bp
        app.register_blueprint(oidc_bp)
        app.register_blueprint(oidc_callback_bp)

    # Register credential vault API (safe even when vault is not configured)
    from data_formulator.routes.credentials import credential_bp
    app.register_blueprint(credential_bp)

    # Register knowledge management API (rules, skills, experiences)
    from data_formulator.routes.knowledge import knowledge_bp
    app.register_blueprint(knowledge_bp)

    # Auto-register all installed data loaders as DataConnector instances
    if not app.config['CLI_ARGS'].get('disable_data_connectors'):
        print("  Loading data connectors...", flush=True)
        from data_formulator.data_connector import register_data_connectors
        register_data_connectors(app)
    else:
        print("  Data connectors disabled (DISABLE_DATA_CONNECTORS=true)", flush=True)


def _safety_checks():
    """Warn about dangerous configuration combinations at startup."""
    cli = app.config.get('CLI_ARGS', {})
    backend = cli.get('workspace_backend', 'local')
    sandbox = cli.get('sandbox', 'not_a_sandbox')
    multi_user = backend != 'local'

    if multi_user and sandbox == 'not_a_sandbox':
        logger.critical(
            "SECURITY WARNING: Multi-user mode with no sandbox is dangerous. "
            "LLM-generated code can read/write arbitrary files on the server. "
            "Set SANDBOX=docker or SANDBOX=local for production deployments."
        )


# Register blueprints at module level so WSGI servers (gunicorn) pick up all routes.
# The guard inside _register_blueprints() prevents double registration when run via CLI.
_register_blueprints()
_safety_checks()


@app.route('/api/example-datasets')
def get_sample_datasets():
    from data_formulator.example_datasets_config import EXAMPLE_DATASETS
    return flask.jsonify(EXAMPLE_DATASETS)


@app.route("/", defaults={"path": ""})
def index_alt(path):
    logger.info(app.static_folder)
    return send_from_directory(app.static_folder, "index.html")

@app.route('/api/auth/info', methods=['GET'])
def get_auth_info():
    """Return authentication configuration for the frontend.

    The response tells the frontend how to initiate login based on the
    active provider (OIDC PKCE, GitHub redirect, transparent, or none).
    """
    from data_formulator.auth.identity import get_active_provider
    provider = get_active_provider()
    if provider:
        return flask.jsonify(provider.get_auth_info())
    return flask.jsonify({"action": "none"})


@app.route('/api/app-config', methods=['GET'])
def get_app_config():
    """Provide frontend configuration settings from CLI arguments"""
    args = app.config['CLI_ARGS']
    
    workspace_backend = args.get('workspace_backend', 'local')
    config = {
        "SANDBOX": args['sandbox'],
        "DISABLE_DISPLAY_KEYS": args['disable_display_keys'],
        "DISABLE_DATA_CONNECTORS": args.get('disable_data_connectors', False),
        "DISABLE_CUSTOM_MODELS": args.get('disable_custom_models', False),
        "PROJECT_FRONT_PAGE": args['project_front_page'],
        "MAX_DISPLAY_ROWS": args['max_display_rows'],
        "DEV_MODE": args.get('dev', False),
        "WORKSPACE_BACKEND": workspace_backend,
        "AVAILABLE_LANGUAGES": args.get('available_languages', ['en', 'zh']),
    }

    from data_formulator.auth.identity import is_local_mode
    config["IS_LOCAL_MODE"] = is_local_mode()

    if workspace_backend == 'local':
        from data_formulator.datalake.workspace import get_data_formulator_home
        config["DATA_FORMULATOR_HOME"] = str(get_data_formulator_home())

    from data_formulator.auth.identity import get_active_provider
    provider = get_active_provider()
    if provider:
        config["AUTH_PROVIDER"] = provider.name
        config["AUTH_INFO"] = provider.get_auth_info()

    # Return the server-assigned identity so the frontend can use it.
    # For localhost mode this is the fixed local:<os_username> identity;
    # for anonymous mode the server echoes back the browser-provided UUID.
    identity = None
    try:
        from data_formulator.auth.identity import get_identity_id
        identity = get_identity_id()
        id_type, _, id_value = identity.partition(':')
        config["IDENTITY"] = {"type": id_type, "id": id_value}
    except Exception:
        pass  # No identity available (e.g. during startup)

    # Expose credential vault availability to the frontend
    from data_formulator.auth.vault import get_credential_vault
    config["CREDENTIAL_VAULT_ENABLED"] = get_credential_vault() is not None

    # Expose data connectors to the frontend
    from data_formulator.data_connector import _public_connector_id, _visible_connector_items
    visible_connectors = _visible_connector_items(identity)
    if visible_connectors:
        connectors_info: list[dict] = []
        for registry_key, src, _is_admin in visible_connectors:
            connectors_info.append(src.get_frontend_config())
            connectors_info[-1]["source_id"] = _public_connector_id(registry_key, src)
        config["CONNECTORS"] = connectors_info

    # Tell the frontend which connectors the current user has vault credentials for
    # so it can render "Connected" vs "Available" without N status calls.
    if identity:
        connected_ids: list[str] = []
        for registry_key, src, _is_admin in visible_connectors:
            if src.has_stored_credentials(identity) or src._get_loader(identity) is not None:
                connected_ids.append(_public_connector_id(registry_key, src))
        if connected_ids:
            config["CONNECTED_CONNECTORS"] = connected_ids

    # Expose disabled data sources (missing deps) so UI can show greyed-out entries
    from data_formulator.data_loader import DISABLED_LOADERS
    if DISABLED_LOADERS:
        config["DISABLED_SOURCES"] = {
            name: {"install_hint": hint}
            for name, hint in DISABLED_LOADERS.items()
        }

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
        help="Multi-user anonymous preset: enables ephemeral workspace, disables data connectors, "
             "disables custom LLM endpoints, and hides API keys. Equivalent to setting "
             "--workspace-backend=ephemeral --disable-data-connectors --disable-custom-models --disable-display-keys.")
    parser.add_argument("--disable-data-connectors", action='store_true', default=False,
        help="Disable external data connectors (MySQL, PostgreSQL, etc.). "
             "Recommended for multi-user anonymous deployments to prevent credential exposure.")
    parser.add_argument("--disable-custom-models", action='store_true', default=False,
        help="Prevent users from adding custom LLM endpoints via the UI. "
             "Only server-configured models will be available.")
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
        choices=['local', 'azure_blob', 'ephemeral'],
        help="Workspace storage backend: 'local' (default, filesystem), "
             "'azure_blob' (Azure Blob Storage), or 'ephemeral' (temp dirs, data does not survive restart)")
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
    
    # --disable-database is a convenience preset for multi-user anonymous deployments.
    # It bundles: ephemeral workspace + no data connectors + no custom models + hide keys.
    workspace_backend = args.workspace_backend
    if args.disable_database:
        if workspace_backend == 'local':
            workspace_backend = 'ephemeral'
        args.disable_data_connectors = True
        args.disable_custom_models = True
        args.disable_display_keys = True
        print("  Multi-user anonymous mode (--disable-database): "
              "ephemeral workspace, no connectors, no custom models, keys hidden", flush=True)

    # Override config from CLI args
    app.config['CLI_ARGS'] = {
        'host': args.host,
        'sandbox': args.sandbox,
        'disable_display_keys': args.disable_display_keys,
        'disable_data_connectors': args.disable_data_connectors,
        'disable_custom_models': args.disable_custom_models,
        'project_front_page': args.project_front_page,
        'max_display_rows': args.max_display_rows,
        'data_dir': args.data_dir,
        'dev': args.dev,
        'workspace_backend': workspace_backend,
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
