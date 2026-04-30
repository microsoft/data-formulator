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
  POST /api/sessions/update-meta — update display name (lightweight, no full state)
  POST /api/sessions/export      — export active workspace as zip
  POST /api/sessions/import      — import workspace from zip

Note: URL prefix kept as /api/sessions for frontend compatibility.
"""

import errno
import io
import logging
from datetime import datetime
from typing import NoReturn

from flask import Blueprint, request, send_file

from data_formulator.auth.identity import get_identity_id
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
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


def _raise_if_storage_full(exc: OSError) -> NoReturn:
    """Convert disk-full writes into a user-facing API error."""
    if exc.errno == errno.ENOSPC:
        raise AppError(
            ErrorCode.STORAGE_FULL,
            "Workspace storage is full. Free disk space and try again.",
            detail=f"{type(exc).__name__}: errno={exc.errno}",
            retry=True,
        ) from exc
    raise exc


# ---------------------------------------------------------------------------
# Routes — standard for local/azure, no-ops for ephemeral
# (ephemeral mode: workspace data is sent inline with every request via
#  _workspace_tables, materialized by get_workspace() in workspace_factory)
# ---------------------------------------------------------------------------

@session_bp.route("/save", methods=["POST"])
def save_session():
    """Auto-persist frontend state to the active workspace."""
    if _is_ephemeral():
        return json_ok({"message": "No-op in ephemeral mode"})

    data = request.get_json(force=True)
    state: dict = data.get("state")
    workspace_id: str = data.get("id", "").strip() or data.get("name", "").strip()

    if state is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "State payload is required")

    identity_id = get_identity_id()
    ws_id = workspace_id or get_active_workspace_id()
    if not ws_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "No active workspace")

    mgr = get_workspace_manager(identity_id)

    try:
        # Lazy creation: frontend generates the ID, first save triggers creation
        if not mgr.workspace_exists(ws_id):
            mgr.create_workspace(ws_id)

        mgr.save_session_state(ws_id, state)
    except OSError as exc:
        _raise_if_storage_full(exc)

    return json_ok({"id": ws_id, "saved_at": datetime.utcnow().isoformat()})


@session_bp.route("/list", methods=["GET"])
def list_sessions():
    """List all workspaces for the current user.

    Optional query param ``source_identity`` (e.g. ``browser:<uuid>``) lets an
    authenticated ``user:`` identity peek at an anonymous identity's workspace
    list — used by the migration dialog to check whether there is data to import.
    """
    if _is_ephemeral():
        return json_ok({"sessions": []})

    identity_id = get_identity_id()

    source = request.args.get("source_identity", "").strip()
    if source:
        if not identity_id.startswith("user:"):
            raise AppError(ErrorCode.ACCESS_DENIED, "source_identity requires authenticated user")
        if not source.startswith("browser:"):
            raise AppError(ErrorCode.INVALID_REQUEST, "source_identity must be a browser identity")
        identity_id = source

    mgr = get_workspace_manager(identity_id)
    workspaces = mgr.list_workspaces()

    sessions = []
    for w in workspaces:
        entry: dict = {
            "id": w["id"],
            "display_name": w.get("display_name", w["id"]),
            "saved_at": w.get("updated_at"),
        }
        if w.get("table_count") is not None:
            entry["table_count"] = w["table_count"]
        if w.get("chart_count") is not None:
            entry["chart_count"] = w["chart_count"]
        sessions.append(entry)
    return json_ok({"sessions": sessions})


@session_bp.route("/load", methods=["POST"])
def load_session():
    """Switch to a workspace (open it) and return its state."""
    if _is_ephemeral():
        return json_ok({"id": "", "state": {}, "message": "No-op in ephemeral mode"})

    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workspace id is required")

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if not mgr.workspace_exists(workspace_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, f"Workspace '{workspace_id}' not found")

    # Load session state
    state = mgr.load_session_state(workspace_id)
    if state is None:
        state = {}

    return json_ok({"id": workspace_id, "state": state})


@session_bp.route("/delete", methods=["POST"])
def delete_session():
    """Delete a workspace."""
    if _is_ephemeral():
        return json_ok({"id": (request.get_json(force=True).get("id") or "")})

    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workspace id is required")

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if not mgr.delete_workspace(workspace_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, f"Workspace '{workspace_id}' not found")

    return json_ok({"id": workspace_id})


@session_bp.route("/create", methods=["POST"])
def create_workspace_route():
    """Create a new workspace."""
    if _is_ephemeral():
        return json_ok({"message": "No-op in ephemeral mode (frontend owns workspace creation)"})

    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workspace id is required")

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if mgr.workspace_exists(workspace_id):
        raise AppError(ErrorCode.VALIDATION_ERROR, "Workspace already exists")

    mgr.create_workspace(workspace_id)

    return json_ok({"id": workspace_id})


@session_bp.route("/rename", methods=["POST"])
def rename_workspace_route():
    """Rename a workspace (change its folder ID)."""
    if _is_ephemeral():
        return json_ok({"message": "No-op in ephemeral mode (frontend owns workspace naming)"})

    data = request.get_json(force=True)
    old_id: str = (data.get("old_id") or data.get("old_name", "")).strip()
    new_id: str = (data.get("new_id") or data.get("new_name", "")).strip()
    if not old_id or not new_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "old_id and new_id are required")

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    try:
        mgr.rename_workspace(old_id, new_id)
    except ValueError:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Rename failed — workspace not found or name conflict")

    return json_ok({"old_id": old_id, "new_id": new_id})


@session_bp.route("/update-meta", methods=["POST"])
def update_workspace_meta():
    """Update workspace display name without writing full session state."""
    if _is_ephemeral():
        return json_ok({"message": "No-op in ephemeral mode"})

    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or "").strip()
    display_name: str = (data.get("display_name") or "").strip()
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workspace id is required")
    if not display_name:
        raise AppError(ErrorCode.INVALID_REQUEST, "display_name is required")

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if not mgr.workspace_exists(workspace_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Workspace not found")

    mgr.update_display_name(workspace_id, display_name)
    return json_ok({"id": workspace_id, "display_name": display_name})


@session_bp.route("/export", methods=["POST"])
def export_session():
    """Export the active workspace as a zip."""
    data = request.get_json(force=True)
    state: dict = data.get("state")
    if state is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "State payload is required")

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
        raise AppError(ErrorCode.INVALID_REQUEST, "No file uploaded")

    file = request.files["file"]
    try:
        identity_id = get_identity_id()
        ws = get_workspace(identity_id)
        state = ws.import_session_zip(io.BytesIO(file.read()))
        return json_ok({"state": state})
    except ValueError:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid session file")
    except Exception as e:
        logger.error("Error importing session", exc_info=e)
        raise AppError(ErrorCode.INTERNAL_ERROR, "Failed to import session")


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
        return json_ok({"moved": [], "message": "No-op in ephemeral mode"})

    target_id = get_identity_id()
    if not target_id.startswith("user:"):
        raise AppError(ErrorCode.ACCESS_DENIED, "Migration requires an authenticated user")

    data = request.get_json(force=True)
    source_id: str = (data.get("source_identity") or "").strip()
    if not source_id.startswith("browser:"):
        raise AppError(ErrorCode.INVALID_REQUEST, "source_identity must be a browser identity")

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
        return json_ok({"moved": moved})
    except Exception as e:
        logger.error("Workspace migration failed", exc_info=e)
        raise AppError(ErrorCode.INTERNAL_ERROR, "Workspace migration failed")


@session_bp.route("/cleanup-anonymous", methods=["POST"])
def cleanup_anonymous():
    """Delete all workspaces belonging to an anonymous browser identity.

    Body: ``{ "source_identity": "browser:<uuid>" }``

    Used by the "Start Fresh" migration option so the anonymous data
    does not linger and trigger another migration prompt later.
    """
    if _is_ephemeral():
        return json_ok({"deleted": 0, "message": "No-op in ephemeral mode"})

    target_id = get_identity_id()
    if not target_id.startswith("user:"):
        raise AppError(ErrorCode.ACCESS_DENIED, "Cleanup requires an authenticated user")

    data = request.get_json(force=True)
    source_id: str = (data.get("source_identity") or "").strip()
    if not source_id.startswith("browser:"):
        raise AppError(ErrorCode.INVALID_REQUEST, "source_identity must be a browser identity")

    try:
        source_mgr = get_workspace_manager(source_id)
        deleted = source_mgr.delete_all_workspaces()
        logger.info("Cleaned up %d anonymous workspace(s) for %s", deleted, source_id)
        return json_ok({"deleted": deleted})
    except Exception as e:
        # On Windows, files may be locked by other processes; treat as
        # best-effort — the identity type flip prevents future prompts.
        logger.warning("Anonymous cleanup partially failed (non-fatal)", exc_info=e)
        return json_ok({"deleted": 0, "warning": "Cleanup partially failed; some files may still exist"})
