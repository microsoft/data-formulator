# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Workspace management routes.

All backends expose the same workspace CRUD API. The ephemeral backend selects
a TTL-managed local WorkspaceManager in ``workspace_factory``.

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
import json
import io
import logging
from datetime import datetime
from typing import NoReturn

from flask import Blueprint, request, send_file

from data_formulator.auth.identity import get_identity_id, is_local_mode
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.workspace_factory import (
    get_workspace,
    get_workspace_manager,
    get_active_workspace_id,
)

logger = logging.getLogger(__name__)

session_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")


@session_bp.before_request
def protect_shared_sessions():
    if request.endpoint in {"sessions.load_session", "sessions.list_sessions", "sessions.fork_shared_session"}:
        return
    body = request.get_json(silent=True) or request.form
    identifiers = [get_active_workspace_id(), body.get("id"), body.get("name"), body.get("workspace_id")]
    if any(isinstance(value, str) and value.startswith(("shared-", "scheduled-private-")) for value in identifiers):
        raise AppError(ErrorCode.ACCESS_DENIED, "Shared sessions are read-only. Fork this session first.")


def shared_session(workspace_id: str) -> dict | None:
    from data_formulator.workflows.scheduler import schedule_store
    return schedule_store().publication(workspace_id)


def scheduled_checkpoint(manager, workspace_id: str, identity_id: str) -> dict | None:
    from data_formulator.routes.workflows import run_path
    from data_formulator.workflows.agent import public_run
    try:
        workspace = manager.open_workspace(workspace_id, identity_id)
        path = run_path(workspace, workspace_id.removeprefix("scheduled-"))
        return public_run(json.loads(path.read_text())) if path.exists() else None
    except (OSError, ValueError, AppError):
        logger.warning("Scheduled checkpoint unavailable for %s", workspace_id)
        return None


@session_bp.route("/fork", methods=["POST"])
def fork_shared_session():
    from uuid import uuid4
    import pyarrow as pa

    identity = get_identity_id()
    snapshot = shared_session((request.get_json() or {}).get("id", ""))
    if snapshot is None:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Shared session not found.")
    workspace_id = "session_" + uuid4().hex
    manager = get_workspace_manager(identity)
    manager.create_workspace(workspace_id)
    workspace = manager.open_workspace(workspace_id, identity)
    try:
        for artifact in snapshot.get("scheduledArtifacts", []):
            if artifact["kind"] == "chart":
                workspace.add_parquet_from_arrow(pa.Table.from_pylist(artifact["rows"]), artifact["tableId"])
        snapshot["activeWorkspace"].update(id=workspace_id, readOnly=False)
        snapshot["activeWorkspace"]["scheduledRun"]["forked"] = True
        manager.save_session_state(workspace_id, snapshot)
    except Exception:
        manager.delete_workspace(workspace_id)
        raise
    return json_ok({"id": workspace_id})


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
# Routes
# ---------------------------------------------------------------------------

@session_bp.route("/save", methods=["POST"])
def save_session():
    """Auto-persist frontend state to the active workspace."""
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
            if getattr(mgr, "workspace_was_evicted", lambda _workspace_id: False)(ws_id):
                raise AppError(
                    "WORKSPACE_EXPIRED",
                    "This temporary workspace has expired.",
                )
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
            "created_at": w.get("created_at") or w.get("updated_at"),
            "saved_at": w.get("updated_at"),
        }
        if w.get("table_count") is not None:
            entry["table_count"] = w["table_count"]
        if w.get("chart_count") is not None:
            entry["chart_count"] = w["chart_count"]
        entry["source_ids"] = w.get("source_ids", [])
        if w.get("scheduled_run"):
            entry["scheduled_run"] = w["scheduled_run"]
        sessions.append(entry)
    if not source:
        from data_formulator.workflows.scheduler import schedule_store
        from data_formulator.routes.configurations import can_configure
        store = schedule_store()
        for item in store.publications():
            sessions.append({"id": item["id"], "display_name": item["display_name"], "created_at": item["published_at"],
                             "saved_at": item["published_at"], "read_only": True, "shared": True,
                             "scheduled_run": item["scheduled_run"]})
        if can_configure():
            for schedule in store.list("admin"):
                for occurrence in store.history(schedule["id"]):
                    if occurrence["status"] == "skipped":
                        continue
                    sessions.append({"id": "scheduled-private-" + occurrence["id"], "display_name": schedule["config"]["name"],
                                     "created_at": occurrence["scheduled_for"], "saved_at": occurrence["scheduled_for"], "read_only": True,
                                     "scheduled_run": {"scheduleId": schedule["id"], "scheduleName": schedule["config"]["name"],
                                                       "scheduledFor": occurrence["scheduled_for"]}})
    sessions.sort(key=lambda item: item.get("saved_at") or "", reverse=True)
    return json_ok({"sessions": sessions})


@session_bp.route("/load", methods=["POST"])
def load_session():
    """Switch to a workspace (open it) and return its state."""
    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workspace id is required")

    identity_id = get_identity_id()
    if workspace_id.startswith("shared-"):
        snapshot = shared_session(workspace_id)
        if snapshot is None:
            raise AppError(ErrorCode.TABLE_NOT_FOUND, "Shared session not found.")
        return json_ok({"id": workspace_id, "state": snapshot, "read_only": True})
    if workspace_id.startswith("scheduled-private-"):
        from data_formulator.routes.configurations import can_configure
        from data_formulator.workflows.scheduler import schedule_store, execution_identity
        if not can_configure():
            raise AppError(ErrorCode.ACCESS_DENIED, "Scheduled execution details are admin-only.")
        store = schedule_store()
        for schedule in store.list("admin"):
            if any("scheduled-private-" + occurrence["id"] == workspace_id for occurrence in store.history(schedule["id"])):
                manager = get_workspace_manager(execution_identity(schedule))
                execution_id = workspace_id.replace("scheduled-private-", "scheduled-", 1)
                state = manager.load_session_state(execution_id)
                return json_ok({"id": workspace_id, "state": state, "read_only": True,
                                "workflow_run": scheduled_checkpoint(manager, execution_id, execution_identity(schedule))})
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Scheduled session not found.")
    mgr = get_workspace_manager(identity_id)

    if not mgr.workspace_exists(workspace_id):
        if getattr(mgr, "workspace_was_evicted", lambda _workspace_id: False)(workspace_id):
            raise AppError(
                "WORKSPACE_EXPIRED",
                "This temporary workspace has expired.",
            )
        raise AppError(ErrorCode.TABLE_NOT_FOUND, f"Workspace '{workspace_id}' not found")

    # Load session state
    state = mgr.load_session_state(workspace_id)
    if state is None:
        state = {}

    if workspace_id.startswith("scheduled-") and state.get("activeWorkspace", {}).get("scheduledRun"):
        return json_ok({"id": workspace_id, "state": state,
                        "workflow_run": scheduled_checkpoint(mgr, workspace_id, identity_id)})
    return json_ok({"id": workspace_id, "state": state})


@session_bp.route("/delete", methods=["POST"])
def delete_session():
    """Delete a workspace."""
    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or data.get("name", "")).strip()
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workspace id is required")

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if not mgr.delete_workspace(workspace_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, f"Workspace '{workspace_id}' not found")
    if workspace_id.startswith("scheduled-") and is_local_mode():
        from data_formulator.workflows.scheduler import schedule_store, scheduling_available
        if scheduling_available():
            schedule_store().forget(workspace_id.removeprefix("scheduled-"))

    return json_ok({"id": workspace_id})


@session_bp.route("/create", methods=["POST"])
def create_workspace_route():
    """Create a new workspace."""
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
    """Export a workspace as a zip.

    Body: ``{ "state": {...}, "workspace_id": "session_..." }``

    ``workspace_id`` identifies which workspace's files to package.
    This avoids the need for an ``X-Workspace-Id`` header, allowing
    export from the landing page where no workspace is active.
    """
    data = request.get_json(force=True)
    state: dict = data.get("state")
    workspace_id: str = (data.get("workspace_id") or "").strip()
    if state is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "State payload is required")
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "workspace_id is required")

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)
    if not mgr.workspace_exists(workspace_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, f"Workspace '{workspace_id}' not found")

    ws = mgr.open_workspace(workspace_id, identity_id)

    from data_formulator.datalake.workspace_manager import _strip_sensitive
    clean_state = _strip_sensitive(state)
    buf = ws.export_session_zip(clean_state)

    filename = f"df_session_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=filename)


@session_bp.route("/import", methods=["POST"])
def import_session():
    """Import a workspace from a zip.

    The optional ``workspace_id`` form field specifies the target
    workspace.  If the workspace doesn't exist yet it is created
    automatically, so callers can generate a fresh ID client-side.
    When omitted, falls back to the ``X-Workspace-Id`` header.
    """
    if "file" not in request.files:
        raise AppError(ErrorCode.INVALID_REQUEST, "No file uploaded")

    file = request.files["file"]
    workspace_id = (request.form.get("workspace_id") or "").strip()

    try:
        identity_id = get_identity_id()
        mgr = get_workspace_manager(identity_id)

        if workspace_id:
            if mgr.workspace_exists(workspace_id):
                ws = mgr.open_workspace(workspace_id, identity_id)
            else:
                ws = mgr.create_and_open_workspace(workspace_id, identity_id)
        else:
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
