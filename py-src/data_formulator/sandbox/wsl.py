# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Run terminal commands inside WSL when Data Formulator runs on Windows.

Windows has no sandbox the terminal can use, but WSL (Windows Subsystem for Linux) runs a real
Linux system whose Bubblewrap can confine a command just as on Linux. A command then runs as
``wsl.exe -e bwrap … -- <argv>``: Linux tools in the user's default distribution, Windows drives
mounted at ``/mnt/<drive>``. These checks start WSL, so their answers are cached for the
server's lifetime; installing WSL or Bubblewrap takes effect after a restart.
"""

from __future__ import annotations

import functools
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path, PureWindowsPath
from typing import NamedTuple

# Environment variables a WSL command receives (WSLENV); "/p" ones hold Windows paths, translated to WSL paths.
SHARED_PATHS = ("DF_SCRATCH_DIR", "DF_RUNTIME_DIR", "DF_SITE_PACKAGES", "TMPDIR", "XDG_CACHE_HOME", "UV_CACHE_DIR",
                "PIP_CACHE_DIR", "npm_config_cache", "YARN_CACHE_FOLDER", "MPLCONFIGDIR", "HF_HOME", "NUMBA_CACHE_DIR",
                "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS")
SHARED_VALUES = ("PYTHONDONTWRITEBYTECODE", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
                 "http_proxy", "https_proxy", "all_proxy", "no_proxy", "AWS_PROFILE", "AWS_DEFAULT_PROFILE",
                 "AWS_REGION", "AWS_DEFAULT_REGION")


def _run(argv: list[str], timeout: float = 60) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return None


def wsl_executable() -> str | None:
    """``wsl.exe`` on Windows, or None."""
    if sys.platform != "win32":
        return None
    candidate = shutil.which("wsl.exe") or str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "wsl.exe")
    return candidate if Path(candidate).is_file() else None


@functools.lru_cache(maxsize=None)
def wsl_ready(wsl: str) -> bool:
    """Whether WSL has a default Linux distribution that starts (``wsl.exe`` alone exists before one is installed)."""
    result = _run([wsl, "-e", "true"])
    return result is not None and result.returncode == 0


class WslSandbox(NamedTuple):
    bwrap: str
    """Bubblewrap inside WSL."""
    home: str
    """The WSL user's Linux home, where CLI logins inside WSL keep their state."""
    interop: bool
    """Whether ``/run/WSL`` exists: the sockets through which a Linux process can start Windows programs."""


@functools.lru_cache(maxsize=None)
def wsl_sandbox(wsl: str) -> WslSandbox | None:
    """A Bubblewrap inside WSL that can create a sandbox, with what confining a command needs; or None."""
    result = _run([wsl, "-e", "sh", "-c",
                   'b=$(command -v bwrap) && "$b" --unshare-all --ro-bind / / true '
                   '&& printf "%s\\n%s\\n%s\\n" "$b" "$HOME" "$([ -d /run/WSL ] && echo yes)"'])
    if result is None or result.returncode != 0:
        return None
    lines = (result.stdout.splitlines() + ["", "", ""])[:3]
    bwrap, home, interop = (line.strip() for line in lines)
    if not bwrap.startswith("/") or not home.startswith("/"):
        return None
    return WslSandbox(bwrap, home, interop == "yes")


def wsl_host() -> str | None:
    """``wsl.exe`` when terminal commands can run in WSL here, else None."""
    wsl = wsl_executable()
    return wsl if wsl and wsl_ready(wsl) else None


def to_wsl_path(path: str | os.PathLike) -> str:
    """``C:\\Users\\me\\x`` as WSL sees it, ``/mnt/c/Users/me/x`` (the default mount root)."""
    windows = PureWindowsPath(path)
    if not re.fullmatch(r"[A-Za-z]:", windows.drive) or not windows.root:
        raise OSError(f"{path} is not on a local drive that WSL mounts; command was not run.")
    return "/".join([f"/mnt/{windows.drive[0].lower()}", *windows.parts[1:]])


def share_environment(environment: dict[str, str]) -> dict[str, str]:
    """``environment`` with WSLENV set so the command in WSL receives these variables (paths translated)."""
    shared = [f"{name}/p" for name in SHARED_PATHS if name in environment]
    shared += [name for name in SHARED_VALUES if name in environment]
    existing = [item for item in environment.get("WSLENV", "").split(":") if item]
    return {**environment, "WSLENV": ":".join(dict.fromkeys([*existing, *shared]))}
