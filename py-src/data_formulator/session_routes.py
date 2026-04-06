# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Session save / load routes.

Delegates all storage operations to the workspace object, which handles
both local filesystem and Azure Blob backends transparently.
"""

import io
import json
import logging
from datetime import datetime

from flask import Blueprint, request, jsonify, send_file, current_app

from data_formulator.security.auth import get_identity_id
from data_formulator.workspace_factory import get_workspace

logger = logging.getLogger(__name__)


def _disk_persistence_enabled() -> bool:
    """Return True unless --disable-database was passed (no disk persistence)."""
    try:
        return not current_app.config.get('CLI_ARGS', {}).get('disable_database', False)
    except RuntimeError:
        return True

session_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")

# Fields that must never be persisted (contain secrets / ephemeral info)
_SENSITIVE_FIELDS = frozenset([
    "models",
    "selectedModelId",
    "testedModels",
    "dataLoaderConnectParams",
    "identity",
    "agentRules",
    "serverConfig",
])


def _strip_sensitive(state: dict) -> dict:
    """Return a copy of *state* with sensitive / ephemeral fields removed."""
    return {k: v for k, v in state.items() if k not in _SENSITIVE_FIELDS}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@session_bp.route("/save", methods=["POST"])
def save_session():
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Session save is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    name: str = data.get("name", "").strip()
    state: dict = data.get("state")

    if not name:
        return jsonify(status="error", message="Session name is required"), 400
    if state is None:
        return jsonify(status="error", message="State payload is required"), 400

    identity_id = get_identity_id()
    ws = get_workspace(identity_id)
    clean_state = _strip_sensitive(state)
    saved_at = ws.save_session(name, clean_state)

    return jsonify(status="ok", name=name, saved_at=saved_at)


@session_bp.route("/list", methods=["GET"])
def list_sessions():
    if not _disk_persistence_enabled():
        return jsonify(status="ok", sessions=[])

    identity_id = get_identity_id()
    ws = get_workspace(identity_id)
    return jsonify(status="ok", sessions=ws.list_sessions())


@session_bp.route("/load", methods=["POST"])
def load_session():
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Session load is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    name: str = data.get("name", "").strip()
    if not name:
        return jsonify(status="error", message="Session name is required"), 400

    identity_id = get_identity_id()
    ws = get_workspace(identity_id)
    state = ws.load_session(name)

    if state is None:
        return jsonify(status="error", message=f"Session '{name}' not found"), 404

    return jsonify(status="ok", name=name, state=state)


@session_bp.route("/delete", methods=["POST"])
def delete_session():
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Session delete is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    name: str = data.get("name", "").strip()
    if not name:
        return jsonify(status="error", message="Session name is required"), 400

    identity_id = get_identity_id()
    ws = get_workspace(identity_id)

    if not ws.delete_session(name):
        return jsonify(status="error", message=f"Session '{name}' not found"), 404

    return jsonify(status="ok", name=name)


@session_bp.route("/export", methods=["POST"])
def export_session():
    data = request.get_json(force=True)
    state: dict = data.get("state")
    if state is None:
        return jsonify(status="error", message="State payload is required"), 400

    identity_id = get_identity_id()
    ws = get_workspace(identity_id)
    clean_state = _strip_sensitive(state)
    buf = ws.export_session_zip(clean_state)

    filename = f"df_session_{datetime.now().strftime('%Y%m%d_%H%M%S')}.dfsession"
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=filename)


@session_bp.route("/import", methods=["POST"])
def import_session():
    if "file" not in request.files:
        return jsonify(status="error", message="No file uploaded"), 400

    file = request.files["file"]
    try:
        identity_id = get_identity_id()
        ws = get_workspace(identity_id)
        state = ws.import_session_zip(io.BytesIO(file.read()))
        return jsonify(status="ok", state=state)
    except ValueError as e:
        return jsonify(status="error", message=str(e)), 400
    except Exception as e:
        logger.error(f"Error importing session: {e}")
        return jsonify(status="error", message=str(e)), 400
