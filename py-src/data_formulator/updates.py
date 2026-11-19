# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Is a newer Data Formulator out?

Checked against where this copy came from: the desktop app against the project's GitHub releases (its downloads),
a pip or uv install against PyPI. A source checkout (an editable install) is updated with git, and a shared server
by whoever runs it, so neither checks. ``DF_UPDATE_CHECK=off`` turns the check off. The answer is kept for a few
hours, and a failed check (offline, rate-limited) only means no update is offered.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from importlib.metadata import PackageNotFoundError, distribution
from typing import Any, Literal

from packaging.version import InvalidVersion, Version

logger = logging.getLogger(__name__)

PACKAGE = "data_formulator"
GITHUB_LATEST = "https://api.github.com/repos/microsoft/data-formulator/releases/latest"
PYPI_PROJECT = "https://pypi.org/pypi/data_formulator/json"
CHECK_EVERY_SECONDS = 6 * 3600
TIMEOUT_SECONDS = 5

InstallKind = Literal["desktop", "uv-tool", "pip", "source", "unknown"]

_cache: tuple[float, dict[str, Any]] | None = None
_lock = threading.Lock()


def current_version() -> str:
    try:
        return distribution(PACKAGE).version
    except PackageNotFoundError:
        return ""


def install_kind() -> InstallKind:
    """How this copy was installed, which decides where its updates come from."""
    if os.environ.get("DATA_FORMULATOR_DESKTOP") == "1":
        return "desktop"
    try:
        found = distribution(PACKAGE)
    except PackageNotFoundError:
        return "unknown"
    try:
        direct = json.loads(found.read_text("direct_url.json") or "{}")
    except ValueError:
        direct = {}
    if direct.get("dir_info", {}).get("editable") or str(direct.get("url", "")).startswith("file:"):
        return "source"
    prefix = sys.prefix.replace("\\", "/")
    return "uv-tool" if "/uv/tools/" in prefix else "pip"


def _newer(latest: str, current: str) -> bool:
    try:
        return Version(latest) > Version(current)
    except InvalidVersion:
        return False


def _from_github(current: str) -> dict[str, Any] | None:
    """The latest release on GitHub, with this platform's download."""
    import requests

    release = requests.get(GITHUB_LATEST, timeout=TIMEOUT_SECONDS, headers={"Accept": "application/vnd.github+json"}).json()
    tag = str(release.get("tag_name") or "").lstrip("v")
    if not tag or release.get("draft"):
        return None
    platform = "macos" if sys.platform == "darwin" else "windows" if sys.platform.startswith("win") else ""
    asset = next((item for item in release.get("assets") or []
                  if platform and platform in str(item.get("name", "")).lower()), None)
    return {"latest": tag, "url": release.get("html_url"),
            **({"download_url": asset.get("browser_download_url")} if asset else {})}


def _from_pypi(current: str) -> dict[str, Any] | None:
    """The newest release on PyPI: a final one, or a pre-release too when this copy is one."""
    import requests

    project = requests.get(PYPI_PROJECT, timeout=TIMEOUT_SECONDS).json()
    try:
        pre = Version(current).is_prerelease
    except InvalidVersion:
        pre = False
    versions = []
    for text, files in (project.get("releases") or {}).items():
        try:
            version = Version(text)
        except InvalidVersion:
            continue
        if files and not all(item.get("yanked") for item in files) and (pre or not version.is_prerelease):
            versions.append(version)
    if not versions:
        return None
    latest = str(max(versions))
    return {"latest": latest, "url": f"https://pypi.org/project/{PACKAGE}/{latest}/"}


def check(*, force: bool = False) -> dict[str, Any]:
    """``{current, kind, update_available, latest?, url?, download_url?, command?}``."""
    global _cache
    current, kind = current_version(), install_kind()
    answer: dict[str, Any] = {"current": current, "kind": kind, "update_available": False}
    if not current or kind in ("source", "unknown") or os.environ.get("DF_UPDATE_CHECK", "").lower() in ("0", "off", "false"):
        return answer
    with _lock:
        if not force and _cache and time.monotonic() - _cache[0] < CHECK_EVERY_SECONDS:
            return dict(_cache[1])
    try:
        found = _from_github(current) if kind == "desktop" else _from_pypi(current)
    except Exception as exc:  # noqa: BLE001 - offline or rate-limited: no update offered, nothing breaks
        logger.info("Update check failed: %s", exc)
        found = None
    if found and _newer(found["latest"], current):
        answer.update(found, update_available=True)
        if kind != "desktop":
            answer["command"] = f"uv tool upgrade {PACKAGE}" if kind == "uv-tool" else f"pip install -U {PACKAGE}"
    with _lock:
        _cache = (time.monotonic(), dict(answer))
    return answer
