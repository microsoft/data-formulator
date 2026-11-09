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
  POST /api/sessions/update-meta — update display name and/or starred flag (lightweight, no full state)
  POST /api/sessions/export      — export active workspace as zip
  POST /api/sessions/import      — import workspace from zip
  POST /api/sessions/wormhole/*  — send / receive a session with a one-time code (local mode)

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


def scheduled_checkpoint(manager, workspace_id: str, identity_id: str) -> dict | None:
    from data_formulator.routes.workflows import run_path
    from data_formulator.workflows.agent import public_run
    try:
        workspace = manager.open_workspace(workspace_id, identity_id)
        path = run_path(workspace, workspace_id.removeprefix("scheduled-"))
        return public_run(json.loads(path.read_text(encoding="utf-8"))) if path.exists() else None
    except (OSError, ValueError, AppError):
        logger.warning("Scheduled checkpoint unavailable for %s", workspace_id)
        return None


# ---------------------------------------------------------------------------
# Published example sessions (published before sessions were shared by
# wormhole): opening one imports a copy into the user's sessions, like the
# built-in demos; administrators can remove them.
# ---------------------------------------------------------------------------

def _examples_dir():
    from data_formulator.configuration import configuration_path
    directory = configuration_path().parent / "examples"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _published_examples() -> list[dict]:
    index = _examples_dir() / "index.json"
    return json.loads(index.read_text(encoding="utf-8")) if index.exists() else []


def _write_examples(examples: list[dict]) -> None:
    index = _examples_dir() / "index.json"
    temporary = index.with_suffix(".tmp")
    temporary.write_text(json.dumps(examples, ensure_ascii=False), encoding="utf-8")
    temporary.replace(index)


def _published_example(identifier: str) -> dict:
    example = next((item for item in _published_examples() if item["id"] == identifier), None)
    if example is None:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Example session not found.")
    return example


def _require_example_admin() -> None:
    from data_formulator.routes.configurations import can_configure
    if not can_configure():
        raise AppError(ErrorCode.ACCESS_DENIED, "Only administrators can manage example sessions.")
    if request.headers.get("Sec-Fetch-Site") == "cross-site":
        raise AppError(ErrorCode.ACCESS_DENIED, "Example sessions must be managed from the application.")


@session_bp.route("/examples", methods=["GET"])
def list_examples():
    return json_ok({"examples": _published_examples()})


@session_bp.route("/examples/<identifier>", methods=["GET"])
def download_example(identifier: str):
    example = _published_example(identifier)
    return send_file(_examples_dir() / f"{example['id']}.zip", mimetype="application/zip")


@session_bp.route("/examples/<identifier>", methods=["DELETE"])
def unpublish_example(identifier: str):
    _require_example_admin()
    example = _published_example(identifier)
    _write_examples([item for item in _published_examples() if item["id"] != example["id"]])
    (_examples_dir() / f"{example['id']}.zip").unlink(missing_ok=True)
    return json_ok({"id": example["id"]})


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
    """Auto-persist frontend state to the active workspace.

    ``base_revision`` (optional) is the revision the client's copy came from; a save based on an older one
    than the stored state is refused with SESSION_CONFLICT, so a stale copy cannot overwrite newer work.
    """
    from data_formulator.datalake.workspace_manager import SessionConflictError

    data = request.get_json(force=True)
    state: dict = data.get("state")
    workspace_id: str = data.get("id", "").strip() or data.get("name", "").strip()
    base_revision = data.get("base_revision")

    if state is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "State payload is required")
    if base_revision is not None and (not isinstance(base_revision, int) or isinstance(base_revision, bool)):
        raise AppError(ErrorCode.INVALID_REQUEST, "base_revision must be an integer")

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

        revision = mgr.save_session_state(ws_id, state, base_revision=base_revision)
    except SessionConflictError as exc:
        raise AppError(
            "SESSION_CONFLICT",
            "This session was saved from another tab or window since this copy was loaded.",
            detail=f"stored revision {exc.revision}, client revision {base_revision}",
        ) from exc
    except OSError as exc:
        _raise_if_storage_full(exc)

    return json_ok({"id": ws_id, "saved_at": datetime.utcnow().isoformat(), "revision": revision})


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
        if w.get("starred"):
            entry["starred"] = True
        sessions.append(entry)
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
    revision = mgr.state_revision(workspace_id)

    if workspace_id.startswith("scheduled-") and state.get("activeWorkspace", {}).get("scheduledRun"):
        return json_ok({"id": workspace_id, "state": state, "revision": revision,
                        "workflow_run": scheduled_checkpoint(mgr, workspace_id, identity_id)})
    return json_ok({"id": workspace_id, "state": state, "revision": revision})


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
    """Update a workspace's display name and/or starred flag without writing full session state."""
    data = request.get_json(force=True)
    workspace_id: str = (data.get("id") or "").strip()
    display_name: str = (data.get("display_name") or "").strip()
    starred = data.get("starred")
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Workspace id is required")
    if starred is not None and not isinstance(starred, bool):
        raise AppError(ErrorCode.INVALID_REQUEST, "starred must be a boolean")
    if not display_name and starred is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "display_name or starred is required")

    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    if not mgr.workspace_exists(workspace_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Workspace not found")

    result: dict = {"id": workspace_id}
    if display_name:
        mgr.update_display_name(workspace_id, display_name)
        result["display_name"] = display_name
    if starred is not None:
        mgr.set_starred(workspace_id, starred)
        result["starred"] = starred
    return json_ok(result)


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

    from data_formulator.datalake.session_archive import build_session_archive
    buf = build_session_archive(ws, state)

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
        # The archive's snapshot carries its own (old) timestamps; an expiring
        # backend must not mistake the freshly imported workspace for an idle one.
        imported_id = workspace_id or get_active_workspace_id()
        if imported_id:
            mgr.mark_accessed(imported_id)
        return json_ok({"state": state})
    except ValueError:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid session file")
    except Exception as e:
        logger.error("Error importing session", exc_info=e)
        raise AppError(ErrorCode.INTERNAL_ERROR, "Failed to import session")


# ---------------------------------------------------------------------------
# Wormhole sharing (design-docs/71): send a session to someone with a one-time
# code, or receive one. Transfers run in the background on this server.
# ---------------------------------------------------------------------------

def _require_wormhole_request() -> None:
    from urllib.parse import urlsplit
    from data_formulator.session_wormhole import enabled

    if not enabled():
        raise AppError(ErrorCode.ACCESS_DENIED,
                       "Wormhole sharing is available only when Data Formulator runs on your own computer.")
    # Codes are secrets: only the app itself, on this machine, may start transfers or read them.
    host = urlsplit(request.host_url).hostname
    if (request.remote_addr not in {"127.0.0.1", "::1"} or host not in {"localhost", "127.0.0.1", "::1"}
            or request.headers.get("Sec-Fetch-Site") == "cross-site"
            or (request.method != "GET" and request.headers.get("Origin") != request.host_url.rstrip("/"))):
        raise AppError(ErrorCode.ACCESS_DENIED, "Wormhole sharing must be used from the application.")


def _wormhole_body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "A JSON body is required")
    return data


@session_bp.route("/wormhole/send", methods=["POST"])
def wormhole_send():
    """Offer a saved session through a wormhole. Body: ``{ "workspace_id": "session_..." }``."""
    from data_formulator import session_wormhole
    from data_formulator.datalake.session_archive import build_session_archive

    _require_wormhole_request()
    workspace_id = str(_wormhole_body().get("workspace_id") or "").strip()
    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)
    if not workspace_id or not mgr.workspace_exists(workspace_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Session not found.")
    state = mgr.load_session_state(workspace_id) or {}
    display_name = str((state.get("activeWorkspace") or {}).get("displayName") or workspace_id)
    archive = build_session_archive(mgr.open_workspace(workspace_id, identity_id), state).getvalue()
    transfer = session_wormhole.start_send(identity_id, workspace_id, display_name, archive)
    return json_ok({"transfer": transfer})


@session_bp.route("/wormhole/receive", methods=["POST"])
def wormhole_receive():
    """Receive a session by its code into a new session. Body: ``{ "code": "7-guitarist-revenge" }``."""
    from data_formulator import session_wormhole

    _require_wormhole_request()
    try:
        code = session_wormhole.normalize_code(_wormhole_body().get("code"))
    except ValueError as error:
        raise AppError(ErrorCode.INVALID_REQUEST, str(error))
    identity_id = get_identity_id()
    mgr = get_workspace_manager(identity_id)

    def import_received(path, offered_name: str) -> tuple[str, str]:
        workspace_id = session_wormhole.new_workspace_id()
        workspace = mgr.create_and_open_workspace(workspace_id, identity_id)
        try:
            with open(path, "rb") as archive:
                state = workspace.import_session_zip(archive)
            if not isinstance(state, dict):
                raise ValueError("state.json is not a session state")
            name = str((state.get("activeWorkspace") or {}).get("displayName") or offered_name or "Received session")
            state["activeWorkspace"] = {"id": workspace_id, "displayName": name}
            mgr.save_session_state(workspace_id, state)
        except BaseException:
            mgr.delete_workspace(workspace_id)
            raise
        return workspace_id, name

    transfer = session_wormhole.start_receive(identity_id, code, import_received)
    return json_ok({"transfer": transfer})


@session_bp.route("/wormhole/transfers", methods=["GET"])
def wormhole_transfers():
    from data_formulator import session_wormhole

    _require_wormhole_request()
    return json_ok({"transfers": session_wormhole.list_transfers(get_identity_id())})


@session_bp.route("/wormhole/cancel", methods=["POST"])
def wormhole_cancel():
    from data_formulator import session_wormhole

    _require_wormhole_request()
    transfer_id = str(_wormhole_body().get("id") or "")
    if not session_wormhole.cancel(get_identity_id(), transfer_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Transfer not found.")
    return json_ok({"transfer": session_wormhole.get_transfer(get_identity_id(), transfer_id)})


@session_bp.route("/wormhole/dismiss", methods=["POST"])
def wormhole_dismiss():
    from data_formulator import session_wormhole

    _require_wormhole_request()
    transfer_id = str(_wormhole_body().get("id") or "")
    return json_ok({"dismissed": session_wormhole.dismiss(get_identity_id(), transfer_id)})


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
