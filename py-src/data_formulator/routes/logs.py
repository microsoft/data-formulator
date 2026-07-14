# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Server log inspection routes.

Data Formulator persists all server + Python-execution logs to a rotating
file under ``<DATA_FORMULATOR_HOME>/logs/data_formulator.log`` (configured in
``app.configure_file_logging``). This is the artifact a user can send when
reporting a problem.

Access policy — logs are **server-side only**:

* In **local single-user mode** (``is_local_mode()`` is true) the user *is*
  the server operator, so these endpoints expose the log to the UI (view /
  tail / download).
* In any **hosted / multi-user** deployment these endpoints return
  ``ACCESS_DENIED``. The operator reads the file directly on the server host;
  end users never see server logs.

Routes:
  GET /api/logs/info      — metadata: path, size, existence, local-mode flag
  GET /api/logs/tail      — last N lines of the current log file
  GET /api/logs/download  — download the current log file
"""

import logging
import os
from collections import deque

from flask import Blueprint, current_app, request, send_file

from data_formulator.auth.identity import is_local_mode
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

logs_bp = Blueprint("logs", __name__, url_prefix="/api/logs")

# Hard cap so a huge log can never blow up memory / the response.
_MAX_TAIL_LINES = 5000
_DEFAULT_TAIL_LINES = 500


def _require_local_mode() -> None:
    """Reject the request unless running in local single-user mode."""
    if not is_local_mode():
        raise AppError(
            ErrorCode.ACCESS_DENIED,
            "Server logs are only viewable in local mode.",
        )


def _log_path() -> str | None:
    """Resolve the active log file path (set by configure_file_logging)."""
    return current_app.config.get("LOG_FILE_PATH")


@logs_bp.route("/info", methods=["GET"])
def logs_info():
    """Return log file metadata (local mode only)."""
    _require_local_mode()
    path = _log_path()
    exists = bool(path) and os.path.isfile(path)
    size = os.path.getsize(path) if exists else 0
    return json_ok({
        "path": path,
        "exists": exists,
        "size": size,
    })


@logs_bp.route("/tail", methods=["GET"])
def logs_tail():
    """Return the last N lines of the current log file (local mode only)."""
    _require_local_mode()
    path = _log_path()
    if not path or not os.path.isfile(path):
        return json_ok({"path": path, "exists": False, "lines": [], "content": ""})

    try:
        lines = int(request.args.get("lines", _DEFAULT_TAIL_LINES))
    except (TypeError, ValueError):
        lines = _DEFAULT_TAIL_LINES
    lines = max(1, min(lines, _MAX_TAIL_LINES))

    # deque with maxlen keeps memory bounded regardless of file size.
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            tail = deque(fh, maxlen=lines)
    except OSError as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, f"Could not read log file: {exc}")

    content = "".join(tail)
    return json_ok({
        "path": path,
        "exists": True,
        "lines": len(tail),
        "content": content,
    })


@logs_bp.route("/download", methods=["GET"])
def logs_download():
    """Download the current log file as an attachment (local mode only)."""
    _require_local_mode()
    path = _log_path()
    if not path or not os.path.isfile(path):
        raise AppError(ErrorCode.VALIDATION_ERROR, "No log file available.")
    return send_file(
        path,
        mimetype="text/plain",
        as_attachment=True,
        download_name="data_formulator.log",
    )
