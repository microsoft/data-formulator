# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Install a shipped demo's content from its page, on a local install.

The demo's ``build.py`` (shipped in ``data_formulator/demos/<id>/``) downloads its public data
and writes the sessions into the sites folder. It runs in a background thread of this process,
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

from data_formulator.auth.identity import is_local_mode
from data_formulator.errors import AppError, ErrorCode
from data_formulator.sites import all_demo_ids, demo_status, packaged_demo_dir, site_profile, sites_dir

logger = logging.getLogger(__name__)

_LOG_LINES = 200
_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def can_install(site_id: str) -> bool:
    """Whether this server lets the page install the demo: local installs of a shipped demo."""
    folder = packaged_demo_dir(site_id)
    return is_local_mode() and folder is not None and (folder / "build.py").is_file()


def listed_demos() -> list[dict[str, str]]:
    """The demos to offer in the app's menu: installed ones, and here-installable shipped ones."""
    return [{"id": site_id, "name": str(site_profile(site_id).get("name") or site_id)}
            for site_id in all_demo_ids() if demo_status(site_id) == "ready" or can_install(site_id)]


def _run(site_id: str, job: dict[str, Any]) -> None:
    def log(line: str) -> None:
        job["log"].append(line)

    try:
        folder = packaged_demo_dir(site_id)
        assert folder is not None
        spec = importlib.util.spec_from_file_location(f"data_formulator_demo_build_{site_id.replace('-', '_')}",
                                                      folder / "build.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.install(sites_dir(), log=log)
        job["state"] = "done"
    except Exception as exc:  # the build's own errors and any unexpected one end the job the same way
        logger.exception("Installing demo %r failed", site_id)
        log(f"error: {exc}")
        job["state"] = "failed"
        job["error"] = str(exc) or type(exc).__name__
    finally:
        # The installed profile (and content) now take effect.
        site_profile.cache_clear()
        job["finished"] = time.time()


def status(site_id: str) -> dict[str, Any]:
    """The demo's install state: ``ready``/``not_installed``, plus the latest job's progress."""
    if not site_profile(site_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Demo not found.")
    job = _jobs.get(site_id)
    return {
        "status": demo_status(site_id),
        "can_install": can_install(site_id),
        "job": None if job is None else {
            "state": job["state"],
            "error": job.get("error"),
            "log": list(job["log"]),
        },
    }


def start(site_id: str) -> dict[str, Any]:
    """Start installing the demo unless a job for it is already running."""
    if not site_profile(site_id):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "Demo not found.")
    if not can_install(site_id):
        raise AppError(ErrorCode.ACCESS_DENIED, "This demo can only be installed on a local Data Formulator.")
    with _lock:
        job = _jobs.get(site_id)
        if job is None or job["state"] != "running":
            job = {"state": "running", "log": deque(maxlen=_LOG_LINES), "started": time.time()}
            _jobs[site_id] = job
            threading.Thread(target=_run, args=(site_id, job), name=f"demo-install-{site_id}", daemon=True).start()
    return status(site_id)
