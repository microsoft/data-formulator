# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Workspace management routes.

For local / azure_blob backends:
  Standard workspace CRUD — list, create, delete, rename, save/load state.

For ephemeral backend:
  Workspace data is sent inline with every request via ``_workspace_tables``
  and materialized by ``get_workspace()`` in workspace_factory.
  Session routes (list, save, load, create, rename) return no-ops — the
  frontend manages all state in IndexedDB.

Routes:
  POST /api/sessions/save        — auto-persist state to active workspace
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

from flask import Blueprint, request, jsonify, send_file

from data_formulator.auth.identity import get_identity_id
from data_formulator.workspace_factory import (
    get_workspace,
    get_workspace_manager,
    get_active_workspace_id,
    _get_backend,
)

logger = logging.getLogger(__name__)

session_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")


def _is_ephemeral() -> bool:
    return _get_backend() == "ephemeral"


# ---------------------------------------------------------------------------
# Routes — standard for local/azure, no-ops for ephemeral
# (ephemeral mode: workspace data is sent inline with every request via
#  _workspace_tables, materialized by get_workspace() in workspace_factory)
# ---------------------------------------------------------------------------

@session_bp.route("/save", methods=["POST"])
def save_session():
    """Auto-persist frontend state to the active workspace."""
    if _is_ephemeral():
        return jsonify(status="ok", message="No-op in ephemeral mode")

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

    # Lazy creation: frontend generates the ID, first save triggers creation
    if not mgr.workspace_exists(ws_id):
        mgr.create_workspace(ws_id)

    mgr.save_session_state(ws_id, state)

    return jsonify(status="ok", id=ws_id, saved_at=datetime.utcnow().isoformat())


@session_bp.route("/list", methods=["GET"])
def list_sessions():
    """List all workspaces for the current user.

    Optional query param ``source_identity`` (e.g. ``browser:<uuid>``) lets an
    authenticated ``user:`` identity peek at an anonymous identity's workspace
    list — used by the migration dialog to check whether there is data to import.
    """
    if _is_ephemeral():
        return jsonify(status="ok", sessions=[])

    identity_id = get_identity_id()

    source = request.args.get("source_identity", "").strip()
    if source:
        if not identity_id.startswith("user:"):
            return jsonify(status="error", message="source_identity requires authenticated user"), 403
        if not source.startswith("browser:"):
            return jsonify(status="error", message="source_identity must be a browser identity"), 400
        identity_id = source

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
    if _is_ephemeral():
        return jsonify(status="ok", id="", state={}, message="No-op in ephemeral mode")

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
    if _is_ephemeral():
        return jsonify(status="ok", id=(request.get_json(force=True).get("id") or ""))

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
    if _is_ephemeral():
        return jsonify(status="ok", message="No-op in ephemeral mode (frontend owns workspace creation)")

    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        return jsonify(status="error", message="Workspace id is required"), 400

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if mgr.workspace_exists(workspace_id):
        return jsonify(status="error", message="Workspace already exists"), 409

    mgr.create_workspace(workspace_id)

    return jsonify(status="ok", id=workspace_id)


@session_bp.route("/rename", methods=["POST"])
def rename_workspace_route():
    """Rename a workspace (change its folder ID)."""
    if _is_ephemeral():
        return jsonify(status="ok", message="No-op in ephemeral mode (frontend owns workspace naming)")

    data = request.get_json(force=True)
    old_id: str = (data.get("old_id") or data.get("old_name", "")).strip()
    new_id: str = (data.get("new_id") or data.get("new_name", "")).strip()
    if not old_id or not new_id:
        return jsonify(status="error", message="old_id and new_id are required"), 400

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    try:
        mgr.rename_workspace(old_id, new_id)
    except ValueError:
        return jsonify(status="error", message="Rename failed — workspace not found or name conflict"), 400

    return jsonify(status="ok", old_id=old_id, new_id=new_id)


@session_bp.route("/export", methods=["POST"])
def export_session():
    """Export the active workspace as a zip."""
    data = request.get_json(force=True)
    state: dict = data.get("state")
    if state is None:
        return jsonify(status="error", message="State payload is required"), 400

    identity_id = get_identity_id()
    ws = get_workspace(identity_id)

    from data_formulator.datalake.workspace_manager import _strip_sensitive
    clean_state = _strip_sensitive(state)
    buf = ws.export_session_zip(clean_state)

    filename = f"df_session_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=filename)


@session_bp.route("/import", methods=["POST"])
def import_session():
    """Import a workspace from a zip."""
    if "file" not in request.files:
        return jsonify(status="error", message="No file uploaded"), 400

    file = request.files["file"]
    try:
        identity_id = get_identity_id()
        ws = get_workspace(identity_id)
        state = ws.import_session_zip(io.BytesIO(file.read()))
        return jsonify(status="ok", state=state)
    except ValueError:
        return jsonify(status="error", message="Invalid session file"), 400
    except Exception as e:
        logger.error("Error importing session", exc_info=e)
        return jsonify(status="error", message="Failed to import session"), 400


@session_bp.route("/migrate", methods=["POST"])
def migrate_workspaces():
    """Move workspaces from an anonymous browser identity to the current user.

    Body: ``{ "source_identity": "browser:<uuid>" }``

    Only allowed when the current identity is ``user:*`` and the source is
    ``browser:*``.  New workspaces are moved; existing ones are merged
    (new data files + metadata entries added).  The anonymous source
    workspaces are deleted after a successful move.
    """
    if _is_ephemeral():
        return jsonify(status="ok", moved=[], message="No-op in ephemeral mode")

    target_id = get_identity_id()
    if not target_id.startswith("user:"):
        return jsonify(status="error", message="Migration requires an authenticated user"), 403

    data = request.get_json(force=True)
    source_id: str = (data.get("source_identity") or "").strip()
    if not source_id.startswith("browser:"):
        return jsonify(status="error", message="source_identity must be a browser identity"), 400

    try:
        source_mgr = get_workspace_manager(source_id)
        target_mgr = get_workspace_manager(target_id)
        moved = target_mgr.move_workspaces_from(source_mgr.root)
        # Best-effort cleanup: remove any leftover anonymous entries that were
        # not moved (e.g. stale non-workspace files or partial leftovers).
        try:
            source_mgr.delete_all_workspaces()
        except Exception as cleanup_err:
            logger.warning("Post-migrate cleanup failed (non-fatal): %s", cleanup_err)
        logger.info(
            "Migrated %d workspace(s) from %s to %s",
            len(moved), source_id, target_id,
        )
        return jsonify(status="ok", moved=moved)
    except Exception as e:
        logger.error("Workspace migration failed", exc_info=e)
        return jsonify(status="error", message="Workspace migration failed"), 500


@session_bp.route("/cleanup-anonymous", methods=["POST"])
def cleanup_anonymous():
    """Delete all workspaces belonging to an anonymous browser identity.

    Body: ``{ "source_identity": "browser:<uuid>" }``

    Used by the "Start Fresh" migration option so the anonymous data
    does not linger and trigger another migration prompt later.
    """
    if _is_ephemeral():
        return jsonify(status="ok", deleted=0, message="No-op in ephemeral mode")

    target_id = get_identity_id()
    if not target_id.startswith("user:"):
        return jsonify(status="error", message="Cleanup requires an authenticated user"), 403

    data = request.get_json(force=True)
    source_id: str = (data.get("source_identity") or "").strip()
    if not source_id.startswith("browser:"):
        return jsonify(status="error", message="source_identity must be a browser identity"), 400

    try:
        source_mgr = get_workspace_manager(source_id)
        deleted = source_mgr.delete_all_workspaces()
        logger.info("Cleaned up %d anonymous workspace(s) for %s", deleted, source_id)
        return jsonify(status="ok", deleted=deleted)
    except Exception as e:
        # On Windows, files may be locked by other processes; treat as
        # best-effort — the identity type flip prevents future prompts.
        logger.warning("Anonymous cleanup partially failed (non-fatal)", exc_info=e)
        return jsonify(status="ok", deleted=0, warning="Cleanup partially failed")
