# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""OS-level confinement for the local Python sandbox's warm workers.

Audit hooks inside the worker are a guard rail, not a boundary (PEP 578), so on
macOS and Linux each worker also runs under the operating system's sandbox:

* Reads: the Python installation, system libraries, and workspaces. In
  single-user local mode one worker reads all of Data Formulator's workspace
  folders (``users/``, ``workspaces/``, and demo sites' ``sites/``); on a
  multi-user server each worker reads only its own workspace, because native
  libraries (DuckDB, pyarrow) open files without passing the audit hook. Never
  the home directory (SSH keys, cloud credentials) or Data Formulator's
  credential store, sessions, configuration, logs, and schedules.
* Writes: a private temporary directory only. Results return over a pipe.
* Network (macOS): internet allowed; loopback and Unix sockets denied, so code
  cannot call Data Formulator's local API or other local services. Only the
  system DNS socket is reachable.
* Network (Linux): none. Bubblewrap cannot separate loopback from the internet
  without a proxy; agents fetch remote data with ``run_terminal`` instead.
  Containers that forbid mounting ``/proc`` (App Service, Docker) get no
  ``/proc`` at all rather than the host's.

Windows, or Linux without a usable Bubblewrap, keeps the audit-hook-only worker,
started as a fresh interpreter with a minimal environment so it inherits none of
the server's memory or secrets. Bubblewrap is found through ``DF_SANDBOX_BWRAP``,
then ``PATH``, then a binary a deployment package bundles at ``sandbox/bin/bwrap``.
``DF_REQUIRE_OS_SANDBOX=1`` refuses to run code instead of falling back.
"""

from __future__ import annotations

import functools
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SEATBELT = "/usr/bin/sandbox-exec"
# System locations the interpreter and native extensions load from (dyld, SSL
# certificates, time zones, Homebrew/MacPorts libraries).
_MACOS_SYSTEM_READS = ("/System", "/usr", "/Library", "/private/etc", "/private/var/db", "/dev",
                       "/opt/homebrew", "/opt/local")
_LINUX_SYSTEM_READS = ("/usr", "/lib", "/lib32", "/lib64", "/bin", "/sbin", "/etc", "/opt")
# macOS resolves host names through this socket.
_MACOS_DNS_SOCKET = "/private/var/run/mDNSResponder"
# A bubblewrap binary that a deployment package may carry (App Service images
# have no bwrap and some hosts cannot install one at runtime). Build pipelines
# copy it here; it is git-ignored and never part of the source tree.
BUNDLED_BWRAP = Path(__file__).resolve().parent / "bin" / "bwrap"


def bwrap_executable() -> str | None:
    """``DF_SANDBOX_BWRAP`` (``$VARS`` expanded, e.g. ``$APP_PATH/...``), else ``bwrap`` on
    ``PATH``, else the bundled binary. A configured path that does not exist falls through."""
    configured = os.path.expandvars(os.environ.get("DF_SANDBOX_BWRAP", "").strip())
    candidates = [configured, shutil.which("bwrap"), str(BUNDLED_BWRAP)]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            if not os.access(candidate, os.X_OK):
                try:
                    # Zips built on Windows drop the executable bit.
                    os.chmod(candidate, 0o755)
                except OSError:
                    continue
            if os.access(candidate, os.X_OK):
                return candidate
    return None


@functools.lru_cache(maxsize=None)
def bwrap_usable(bwrap: str) -> bool:
    """Whether *bwrap* can create a sandbox here (some hosts forbid user namespaces)."""
    try:
        return subprocess.run(
            [bwrap, "--unshare-all", "--ro-bind", "/", "/", "true"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def confinement_kind() -> str | None:
    """``"seatbelt"`` (macOS), ``"bwrap"`` (Linux), or ``None`` when unavailable or disabled."""
    if os.environ.get("DF_SANDBOX_OS_CONFINEMENT", "1").strip().lower() in ("0", "false", "off"):
        return None
    # A frozen desktop build's executable is the app itself, not an interpreter
    # that can run ``-m confined_worker``; it keeps the audit-hook worker.
    if getattr(sys, "frozen", False):
        return None
    if sys.platform == "darwin" and Path(SEATBELT).is_file():
        return "seatbelt"
    if sys.platform.startswith("linux"):
        bwrap = bwrap_executable()
        if bwrap and bwrap_usable(bwrap):
            return "bwrap"
    return None


def describe() -> str:
    """One line for the startup log: which isolation the Python sandbox will use."""
    kind = confinement_kind()
    if kind == "seatbelt":
        return "macOS sandbox-exec"
    if kind == "bwrap":
        bwrap = bwrap_executable()
        return f"bubblewrap ({bwrap}{'' if bwrap_can_mount_proc(bwrap) else ', without /proc'})"
    bwrap = bwrap_executable() if sys.platform.startswith("linux") else None
    reason = f"bubblewrap at {bwrap} cannot create a sandbox here" if bwrap else "no OS sandbox available"
    return f"none, audit hooks only ({reason})"


def network_allowed(kind: str | None) -> bool:
    return kind == "seatbelt"


def python_read_roots() -> list[str]:
    """Directories the interpreter needs: its prefixes and import paths (not the working directory)."""
    candidates = [sys.prefix, sys.base_prefix, sys.exec_prefix, sys.base_exec_prefix,
                  os.path.dirname(os.path.realpath(sys.executable)), os.path.dirname(sys.executable)]
    cwd = os.path.realpath(os.getcwd())
    for entry in sys.path:
        if entry and os.path.isabs(entry) and os.path.exists(entry) and os.path.realpath(entry) != cwd:
            candidates.append(entry)
    roots: list[str] = []
    for candidate in candidates:
        for path in {os.path.abspath(candidate), os.path.realpath(candidate)}:
            if os.path.exists(path) and path not in roots and path != "/":
                roots.append(path)
    return roots


SHARED = "shared"


def shared_read_roots() -> list[str]:
    """Data Formulator's workspace folders, readable by the shared worker (single-user local mode):
    ``users/``, ``workspaces/``, and ``sites/`` (each demo site's own ``users/``, see
    :mod:`data_formulator.sites`)."""
    from data_formulator.datalake.workspace import get_data_formulator_home

    home = get_data_formulator_home()
    try:
        # A shared worker started before a demo's first session must still see it: bwrap binds
        # only folders that exist, and later subfolders appear inside a bound one.
        (home / "sites").mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return [os.path.realpath(home / name) for name in ("users", "workspaces", "sites") if (home / name).is_dir()]


def worker_key(workspace: str | None) -> str:
    """Single-user local mode shares workers across Data Formulator's workspaces; otherwise
    (multi-user servers, or any other folder) a worker is dedicated to one workspace."""
    if not workspace:
        return ""
    resolved = os.path.realpath(workspace)
    from data_formulator.auth.identity import is_local_mode
    if is_local_mode() and any(resolved == root or resolved.startswith(root + os.sep)
                               for root in shared_read_roots()):
        return SHARED
    return resolved


def _sbpl(path: str) -> str:
    return json.dumps(path)


def seatbelt_profile(read_roots: list[str], write_dir: str, *, allow_network: bool) -> str:
    """A ``sandbox-exec`` profile: narrow reads, one writable directory, internet without loopback."""
    reads = " ".join(f"(subpath {_sbpl(path)})" for path in [*_MACOS_SYSTEM_READS, *read_roots, write_dir])
    profile = (
        "(version 1)(deny default)"
        "(allow process-exec process-fork)(allow signal (target self))"
        "(allow sysctl-read)(allow mach-lookup)(allow ipc-posix-shm)"
        # Existence and metadata only; contents stay restricted to the reads below.
        "(allow file-read-metadata)"
        f'(allow file-read* (literal "/") {reads})'
        f'(allow file-write* (subpath {_sbpl(write_dir)}) (literal "/dev/null"))'
    )
    if allow_network:
        profile += (
            '(allow system-socket)(allow network-outbound (remote ip "*:*"))'
            '(deny network-outbound (remote ip "localhost:*"))'
            f"(allow network-outbound (remote unix-socket (path-literal {_sbpl(_MACOS_DNS_SOCKET)})))"
        )
    return profile


@functools.lru_cache(maxsize=None)
def bwrap_can_mount_proc(bwrap: str = "bwrap") -> bool:
    """Whether a fresh ``/proc`` can be mounted; containers with masked ``/proc`` paths refuse it."""
    try:
        return subprocess.run(
            [bwrap, "--die-with-parent", "--unshare-all", "--ro-bind", "/", "/", "--proc", "/proc", "true"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15,
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def bwrap_prefix(read_roots: list[str], write_dir: str, *, mount_proc: bool = True) -> list[str]:
    """``bwrap`` arguments: a read-only view of system and Python paths, no network, one writable directory."""
    # No --die-with-parent: Linux delivers that signal when the spawning *thread*
    # exits, which kills workers prewarmed from short-lived threads. Workers exit
    # on their own when the server's end of the pipe closes.
    command = ["bwrap", "--unshare-all", "--cap-drop", "ALL", "--dev", "/dev"]
    if mount_proc:
        command += ["--proc", "/proc"]
    command += ["--tmpfs", "/tmp"]
    for path in [*_LINUX_SYSTEM_READS, *read_roots]:
        command += ["--ro-bind-try", path, path]
    command += ["--bind", write_dir, write_dir, "--chdir", write_dir]
    return command


def confined_worker_command(kind: str | None, key: str, write_dir: str,
                            read_fd: int, write_fd: int) -> list[str]:
    """The command that starts one warm worker for ``key`` (see :func:`worker_key`).

    ``kind`` ``None`` starts the same isolated interpreter without an OS sandbox.
    """
    read_roots = python_read_roots()
    read_roots += shared_read_roots() if key == SHARED else [key] if key else []
    write_dir = os.path.realpath(write_dir)
    allow_network = network_allowed(kind)
    # -s -P: no user site-packages, and never put the working directory on
    # sys.path, so workspace files cannot shadow real modules. Not -I: that also
    # drops PYTHONPATH, which App Service's build (Oryx) uses for its virtualenv;
    # worker_environment passes the server's import path explicitly instead.
    worker = [sys.executable, "-s", "-P", "-m", "data_formulator.sandbox.confined_worker",
              str(read_fd), str(write_fd), "1" if allow_network else "0"]
    if kind is None:
        return worker
    if kind == "seatbelt":
        return [SEATBELT, "-p", seatbelt_profile(read_roots, write_dir, allow_network=allow_network), *worker]
    if kind == "bwrap":
        bwrap = bwrap_executable() or "bwrap"
        prefix = bwrap_prefix(read_roots, write_dir, mount_proc=bwrap_can_mount_proc(bwrap))
        return [bwrap, *prefix[1:], "--", *worker]
    raise ValueError(f"Unknown confinement: {kind}")


def worker_import_path() -> list[str]:
    """The server's import directories (absolute, existing, not its working directory), so a
    worker imports the same packages however the server found them (venv, PYTHONPATH, source)."""
    cwd = os.path.realpath(os.getcwd())
    entries: list[str] = []
    for entry in sys.path:
        if (entry and os.path.isabs(entry) and os.path.isdir(entry)
                and os.path.realpath(entry) != cwd and entry not in entries):
            entries.append(entry)
    return entries


def worker_environment(write_dir: str) -> dict[str, str]:
    """A minimal environment: no secrets from the server process, caches in the private directory."""
    environment = {key: value for key, value in os.environ.items()
                   if key in {"PATH", "LANG", "LC_ALL", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR",
                              "REQUESTS_CA_BUNDLE", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
                              "http_proxy", "https_proxy", "no_proxy"}}
    environment.update({"HOME": write_dir, "TMPDIR": write_dir, "TMP": write_dir, "TEMP": write_dir,
                        "MPLCONFIGDIR": os.path.join(write_dir, "matplotlib"),
                        "XDG_CACHE_HOME": os.path.join(write_dir, "cache"),
                        "PYTHONDONTWRITEBYTECODE": "1",
                        "PYTHONPATH": os.pathsep.join(worker_import_path())})
    return environment
