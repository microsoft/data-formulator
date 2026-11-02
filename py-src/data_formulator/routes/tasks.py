# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The user's view of background tasks in the active session: list them, read a log, stop one."""

from __future__ import annotations

from flask import Blueprint, request

from data_formulator.auth.identity import get_identity_id
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.workspace_factory import get_active_workspace_id

task_bp = Blueprint("tasks", __name__, url_prefix="/api/tasks")
LOG_LIMIT = 64 * 1024


def _scope() -> tuple[str, str]:
    identity, workspace_id = get_identity_id(), get_active_workspace_id()
    if not identity:
        raise AppError(ErrorCode.AUTH_REQUIRED, "Sign in to see background tasks.")
    if not workspace_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Open a session to see its background tasks.")
    return identity, workspace_id


@task_bp.route("/list", methods=["GET", "POST"])
def list_tasks():
    from data_formulator.analyst.background_tasks import task_manager

    identity, workspace_id = get_identity_id(), get_active_workspace_id()
    if not identity or not workspace_id:
        return json_ok({"tasks": []})
    return json_ok({"tasks": [task.summary(lines=3) for task in task_manager().list(identity, workspace_id)]})


@task_bp.route("/stop", methods=["POST"])
def stop_tasks():
    """Stop tasks the user picked (an interrupt, then a forced kill); a waiting agent hears about it."""
    from data_formulator.analyst.background_tasks import task_manager

    identity, workspace_id = _scope()
    ids = (request.get_json(silent=True) or {}).get("task_ids")
    if not isinstance(ids, list) or not all(isinstance(item, str) for item in ids):
        raise AppError(ErrorCode.INVALID_REQUEST, "task_ids must be a list of task ids.")
    manager = task_manager()
    stopped = [task.summary(lines=3) for task_id in ids
               if (task := manager.stop(task_id, identity, workspace_id, by="user")) is not None]
    return json_ok({"tasks": stopped})


@task_bp.route("/log", methods=["POST"])
def task_log():
    """The end of a task's log (its last 64 KiB)."""
    from data_formulator.analyst.background_tasks import task_manager

    identity, workspace_id = _scope()
    task = task_manager().get(str((request.get_json(silent=True) or {}).get("task_id") or ""), identity, workspace_id)
    if task is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "Background task not found in this session.")
    try:
        with open(task.log_path, "rb") as log:
            log.seek(0, 2)
            size = log.tell()
            log.seek(max(0, size - LOG_LIMIT))
            text = log.read().decode("utf-8", errors="replace")
    except OSError:
        text, size = "", 0
    return json_ok({"task": task.summary(lines=3), "log": text, "truncated": size > LOG_LIMIT})
