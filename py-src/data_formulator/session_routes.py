# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Session save / load routes.

A saved session consists of:

    <sessions_root>/<safe_identity_id>/<session_name>/
        state.json   – the full Redux UI state (as-is, minus sensitive fields)
        workspace/   – a copy of the user's server-side workspace directory

The UI state is saved verbatim (rows included as JSON) – no parquet
conversion.  The workspace directory is copied wholesale so that any
server-side data (uploaded files, parquet, metadata) is preserved.

Export/import produce a single .dfsession zip containing both.
"""

import io
import json
import logging
import os
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, request, jsonify, send_file, current_app

from data_formulator.auth import get_identity_id
from data_formulator.datalake.workspace import Workspace, get_data_formulator_home

logger = logging.getLogger(__name__)


def _disk_persistence_enabled() -> bool:
    """Return True unless --disable-database was passed (no disk persistence)."""
    try:
        return not current_app.config.get('CLI_ARGS', {}).get('disable_database', False)
    except RuntimeError:
        return True

session_bp = Blueprint("sessions", __name__, url_prefix="/api/sessions")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_sessions_root() -> Path:
    return get_data_formulator_home() / "sessions"


def _sanitize(name: str) -> str:
    """Produce a filesystem-safe name (no slashes, no .., no control chars)."""
    name = re.sub(r'[/\\:*?"<>|\x00-\x1f]', '_', name)
    name = re.sub(r'\.{2,}', '.', name)
    name = name.strip('. ')
    return name or "unnamed"


def _identity_dir(identity_id: str) -> Path:
    """Return the per-user sessions directory, creating it if needed."""
    safe_id = _sanitize(identity_id)
    p = _get_sessions_root() / safe_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def _session_dir(identity_id: str, session_name: str) -> Path:
    return _identity_dir(identity_id) / _sanitize(session_name)


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


def _get_workspace_path(identity_id: str) -> Path:
    """Resolve the server-side workspace directory for an identity."""
    ws = Workspace(identity_id)
    return ws._path


def _strip_sensitive(state: dict) -> dict:
    """Return a copy of *state* with sensitive / ephemeral fields removed."""
    return {k: v for k, v in state.items() if k not in _SENSITIVE_FIELDS}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@session_bp.route("/save", methods=["POST"])
def save_session():
    """
    Save a session.

    Request JSON body:
        name:   str  – human-readable session name
        state:  dict – Redux UI state (saved as-is minus sensitive fields)
    """
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
    sess_dir = _session_dir(identity_id, name)

    # Wipe previous save with the same name
    if sess_dir.exists():
        shutil.rmtree(sess_dir)
    sess_dir.mkdir(parents=True)

    # 1. Copy workspace directory as-is (skip if persistence disabled or empty)
    if _disk_persistence_enabled():
        ws_path = _get_workspace_path(identity_id)
        if ws_path.exists() and any(ws_path.iterdir()):
            shutil.copytree(ws_path, sess_dir / "workspace", dirs_exist_ok=True)

    # 2. Save UI state (strip secrets, keep everything else including rows)
    clean_state = _strip_sensitive(state)
    (sess_dir / "state.json").write_text(
        json.dumps(clean_state, default=str), encoding="utf-8"
    )

    logger.info(f"Saved session '{name}' for {identity_id} -> {sess_dir}")
    return jsonify(status="ok", name=name, saved_at=datetime.now(timezone.utc).isoformat())


@session_bp.route("/list", methods=["GET"])
def list_sessions():
    """List saved sessions for the current user (sorted newest first)."""
    if not _disk_persistence_enabled():
        return jsonify(status="ok", sessions=[])

    identity_id = get_identity_id()
    user_dir = _identity_dir(identity_id)

    sessions = []
    if user_dir.exists():
        for child in sorted(user_dir.iterdir()):
            if not child.is_dir():
                continue
            state_file = child / "state.json"
            if not state_file.exists():
                continue

            stat = state_file.stat()
            sessions.append({
                "name": child.name,
                "saved_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })

    # Sort newest first
    sessions.sort(key=lambda s: s["saved_at"], reverse=True)
    return jsonify(status="ok", sessions=sessions)


@session_bp.route("/load", methods=["POST"])
def load_session():
    """
    Load a previously saved session.

    Restores the workspace directory and returns the UI state.
    """
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Session load is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    name: str = data.get("name", "").strip()
    if not name:
        return jsonify(status="error", message="Session name is required"), 400

    identity_id = get_identity_id()
    sess_dir = _session_dir(identity_id, name)
    state_file = sess_dir / "state.json"

    if not state_file.exists():
        return jsonify(status="error", message=f"Session '{name}' not found"), 404

    # 1. Restore workspace (only if persistence enabled and session has one)
    if _disk_persistence_enabled():
        ws_saved = sess_dir / "workspace"
        if ws_saved.exists():
            ws_path = _get_workspace_path(identity_id)
            if ws_path.exists():
                shutil.rmtree(ws_path)
            shutil.copytree(ws_saved, ws_path, dirs_exist_ok=True)

    # 2. Return UI state
    state = json.loads(state_file.read_text(encoding="utf-8"))
    return jsonify(status="ok", name=name, state=state)


@session_bp.route("/delete", methods=["POST"])
def delete_session():
    """
    Delete a saved session.

    Request JSON body:
        name: str  – session name to delete
    """
    if not _disk_persistence_enabled():
        return jsonify(status="error", message="Session delete is disabled (no disk persistence)"), 403

    data = request.get_json(force=True)
    name: str = data.get("name", "").strip()
    if not name:
        return jsonify(status="error", message="Session name is required"), 400

    identity_id = get_identity_id()
    sess_dir = _session_dir(identity_id, name)

    if not sess_dir.exists():
        return jsonify(status="error", message=f"Session '{name}' not found"), 404

    shutil.rmtree(sess_dir)
    logger.info(f"Deleted session '{name}' for {identity_id}")
    return jsonify(status="ok", name=name)


@session_bp.route("/export", methods=["POST"])
def export_session():
    """
    Export the current session as a .dfsession zip download.

    The zip contains state.json (UI state) and workspace/ (server files).
    """
    data = request.get_json(force=True)
    state: dict = data.get("state")
    if state is None:
        return jsonify(status="error", message="State payload is required"), 400

    identity_id = get_identity_id()
    clean_state = _strip_sensitive(state)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # UI state
        zf.writestr("state.json", json.dumps(clean_state, default=str))

        # Workspace files (skip if persistence disabled)
        if _disk_persistence_enabled():
            ws_path = _get_workspace_path(identity_id)
            if ws_path.exists():
                for ws_file in ws_path.rglob("*"):
                    if ws_file.is_file():
                        arcname = "workspace/" + str(ws_file.relative_to(ws_path))
                        zf.write(ws_file, arcname)
    buf.seek(0)

    filename = f"df_session_{datetime.now().strftime('%Y%m%d_%H%M%S')}.dfsession"
    return send_file(buf, mimetype="application/zip", as_attachment=True, download_name=filename)


@session_bp.route("/import", methods=["POST"])
def import_session():
    """
    Import a session from an uploaded .dfsession zip.

    Restores both the UI state and workspace files.
    """
    if "file" not in request.files:
        return jsonify(status="error", message="No file uploaded"), 400

    file = request.files["file"]
    try:
        with zipfile.ZipFile(io.BytesIO(file.read()), "r") as zf:
            if "state.json" not in zf.namelist():
                return jsonify(status="error", message="Invalid session file: missing state.json"), 400

            state = json.loads(zf.read("state.json"))

            # Restore workspace files (only if persistence enabled and zip contains any)
            if _disk_persistence_enabled():
                workspace_entries = [n for n in zf.namelist()
                                     if n.startswith("workspace/") and not n.endswith("/")]
                if workspace_entries:
                    identity_id = get_identity_id()
                    ws_path = _get_workspace_path(identity_id)
                    if ws_path.exists():
                        shutil.rmtree(ws_path)
                    ws_path.mkdir(parents=True, exist_ok=True)
                    for entry in workspace_entries:
                        rel = entry[len("workspace/"):]
                        dest = ws_path / rel
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(zf.read(entry))

        return jsonify(status="ok", state=state)
    except zipfile.BadZipFile:
        return jsonify(status="error", message="Invalid zip file"), 400
    except Exception as e:
        logger.error(f"Error importing session: {e}")
        return jsonify(status="error", message=str(e)), 400
