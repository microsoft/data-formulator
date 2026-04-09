# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Workspace management routes.

Workspace = session. Each workspace is a named folder containing data files,
metadata (workspace.yaml), and auto-persisted frontend state (session_state.json).

Routes:
  POST /api/sessions/save       — auto-persist state to active workspace
  GET  /api/sessions/list        — list all workspaces
  POST /api/sessions/load        — switch to a workspace (open it)
  POST /api/sessions/delete      — delete a workspace
  POST /api/sessions/create      — create a new workspace
  POST /api/sessions/rename      — rename a workspace
  POST /api/sessions/export      — export active workspace as zip
  POST /api/sessions/import      — import workspace from zip

Note: URL prefix kept as /api/sessions for frontend compatibility.
"""

import io
import logging
from datetime import datetime

from flask import Blueprint, request, jsonify, send_file, current_app

from data_formulator.security.auth import get_identity_id
from data_formulator.workspace_factory import (
    get_workspace,
    get_workspace_manager,
    get_active_workspace_id,
)

logger = logging.getLogger(__name__)


def _disk_persistence_enabled() -> bool:
    """Return True unless --disable-database was passed (no disk persistence)."""
    try:
        return not current_app.config.get('CLI_ARGS', {}).get('disable_database', False)
    except RuntimeError:
        return True

session_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@session_bp.route("/save", methods=["POST"])
def save_session():
    """Auto-persist frontend state to the active workspace."""
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Session save is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    state: dict = data.get("state")
    workspace_id: str = data.get("id", "").strip() or data.get("name", "").strip()

    if state is None:
        return jsonify(status="error", message="State payload is required"), 400

    identity_id = get_identity_id()
    ws_id = workspace_id or get_active_workspace_id()
    if not ws_id:
        return jsonify(status="error", message="No active workspace"), 400

    mgr = get_workspace_manager(identity_id)

    if not mgr.workspace_exists(ws_id):
        return jsonify(status="error", message=f"Workspace '{ws_id}' not found"), 404

    mgr.save_session_state(ws_id, state)

    return jsonify(status="ok", id=ws_id, saved_at=datetime.utcnow().isoformat())


@session_bp.route("/list", methods=["GET"])
def list_sessions():
    """List all workspaces for the current user."""
    if not _disk_persistence_enabled():
        return jsonify(status="ok", sessions=[])

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)
    workspaces = mgr.list_workspaces()

    sessions = [
        {"id": w["id"], "display_name": w.get("display_name", w["id"]), "saved_at": w.get("updated_at")}
        for w in workspaces
    ]
    return jsonify(status="ok", sessions=sessions)


@session_bp.route("/load", methods=["POST"])
def load_session():
    """Switch to a workspace (open it) and return its state."""
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Session load is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        return jsonify(status="error", message="Workspace id is required"), 400

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if not mgr.workspace_exists(workspace_id):
        return jsonify(status="error", message=f"Workspace '{workspace_id}' not found"), 404

    # Load session state
    state = mgr.load_session_state(workspace_id)
    if state is None:
        state = {}

    return jsonify(status="ok", id=workspace_id, state=state)


@session_bp.route("/delete", methods=["POST"])
def delete_session():
    """Delete a workspace."""
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Session delete is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        return jsonify(status="error", message="Workspace id is required"), 400

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if not mgr.delete_workspace(workspace_id):
        return jsonify(status="error", message=f"Workspace '{workspace_id}' not found"), 404

    return jsonify(status="ok", id=workspace_id)


@session_bp.route("/create", methods=["POST"])
def create_workspace_route():
    """Create a new workspace."""
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Workspace creation is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        return jsonify(status="error", message="Workspace id is required"), 400

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    try:
        mgr.create_workspace(workspace_id)
    except ValueError as e:
        return jsonify(status="error", message=str(e)), 409

    return jsonify(status="ok", id=workspace_id)


@session_bp.route("/rename", methods=["POST"])
def rename_workspace_route():
    """Rename a workspace (change its folder ID)."""
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Workspace rename is disabled"), 403

    data = request.get_json(force=True)
    old_id: str = (data.get("old_id") or data.get("old_name", "")).strip()
    new_id: str = (data.get("new_id") or data.get("new_name", "")).strip()
    if not old_id or not new_id:
        return jsonify(status="error", message="old_id and new_id are required"), 400

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    try:
        mgr.rename_workspace(old_id, new_id)
    except ValueError as e:
        return jsonify(status="error", message=str(e)), 400

    return jsonify(status="ok", old_id=old_id, new_id=new_id)


@session_bp.route("/export", methods=["POST"])
def export_session():
    """Export the active workspace as a .dfsession zip."""
    data = request.get_json(force=True)
    state: dict = data.get("state")
    if state is None:
        return jsonify(status="error", message="State payload is required"), 400

    identity_id = get_identity_id()
    ws = get_workspace(identity_id)

    from data_formulator.datalake.workspace_manager import _strip_sensitive
    clean_state = _strip_sensitive(state)
    buf = ws.export_session_zip(clean_state)

    filename = f"df_session_{datetime.now().strftime('%Y%m%d_%H%M%S')}.dfsession"
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=filename)


@session_bp.route("/import", methods=["POST"])
def import_session():
    """Import a workspace from a .dfsession zip."""
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
