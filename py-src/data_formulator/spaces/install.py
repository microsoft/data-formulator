# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Install a shipped space's content from its page, on a local install.

The space's ``build.py`` (shipped in ``data_formulator/spaces/shipped/<id>/``) downloads its public data
and writes the sessions into the spaces folder. It runs in a background thread of this process,
so it works the same from a source checkout, a pip install or the desktop app; the page polls
the job's progress.
"""

from __future__ import annotations

import importlib.util
import logging
import threading
import time
from collections import deque
from typing import Any

from flask import Flask, current_app

from data_formulator.auth.identity import is_local_mode
from data_formulator.errors import AppError, ErrorCode
from data_formulator.spaces import all_space_ids, space_status, shipped_space_dir, space_profile, spaces_dir

logger = logging.getLogger(__name__)

_LOG_LINES = 200
_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def can_install(space_id: str) -> bool:
    """Whether this server lets the page install the space: local installs of a shipped space."""
    folder = shipped_space_dir(space_id)
    return is_local_mode() and folder is not None and (folder / "build.py").is_file()


def listed_spaces() -> list[dict[str, str]]:
    """The spaces to offer in the app's menu: installed ones, and here-installable shipped ones."""
    return [{"id": space_id, "name": str(space_profile(space_id).get("name") or space_id)}
            for space_id in all_space_ids() if space_status(space_id) == "ready" or can_install(space_id)]


def _run(space_id: str, job: dict[str, Any], app: Flask) -> None:
    # The server's app context, so this thread resolves the same --data-dir (spaces folder, code-signing key).
    with app.app_context():
        _build(space_id, job)


def _build(space_id: str, job: dict[str, Any]) -> None:
    def log(line: str) -> None:
        job["log"].append(line)

    try:
        folder = shipped_space_dir(space_id)
        assert folder is not None
        spec = importlib.util.spec_from_file_location(f"data_formulator_space_build_{space_id.replace('-', '_')}",
                                                      folder / "build.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.install(spaces_dir(), log=log)
        job["state"] = "done"
    except Exception as exc:  # the build's own errors and any unexpected one end the job the same way
        logger.exception("Installing space %r failed", space_id)
        log(f"error: {exc}")
        job["state"] = "failed"
        job["error"] = str(exc) or type(exc).__name__
    finally:
        # The installed profile (and content) now take effect.
        space_profile.cache_clear()
        job["finished"] = time.time()


def status(space_id: str) -> dict[str, Any]:
    """The space's install state: ``ready``/``not_installed``, plus the latest job's progress."""
    if not space_profile(space_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Space not found.")
    job = _jobs.get(space_id)
    return {
        "status": space_status(space_id),
        "can_install": can_install(space_id),
        "job": None if job is None else {
            "state": job["state"],
            "error": job.get("error"),
            "log": list(job["log"]),
        },
    }


def start(space_id: str) -> dict[str, Any]:
    """Start installing the space unless a job for it is already running."""
    if not space_profile(space_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Space not found.")
    if not can_install(space_id):
        raise AppError(ErrorCode.ACCESS_DENIED, "This space can only be installed on a local Data Formulator.")
    with _lock:
        job = _jobs.get(space_id)
        if job is None or job["state"] != "running":
            job = {"state": "running", "log": deque(maxlen=_LOG_LINES), "started": time.time()}
            _jobs[space_id] = job
            threading.Thread(target=_run, args=(space_id, job, current_app._get_current_object()), name=f"space-install-{space_id}", daemon=True).start()
    return status(space_id)
