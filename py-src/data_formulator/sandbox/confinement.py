# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""OS-level confinement for the local Python sandbox's warm workers.

Audit hooks inside the worker are a guard rail, not a boundary (PEP 578), so on
macOS and Linux each worker also runs under the operating system's sandbox:

* Reads: the Python installation, system libraries, and workspaces: Data
  Formulator's workspace folders (``users/``, ``workspaces/``), or one outside
  workspace such as a linked folder. Not the home directory (SSH keys, cloud
  credentials) or Data Formulator's credential store, configuration, logs, and
  schedules. The audit hook still limits each run to its own workspace.
* Writes: a private temporary directory only. Results return over a pipe.
* Network (macOS): internet allowed; loopback and Unix sockets denied, so code
  cannot call Data Formulator's local API or other local services. Only the
  system DNS socket is reachable.
* Network (Linux): none. Bubblewrap cannot separate loopback from the internet
  without a proxy; agents fetch remote data with ``run_terminal`` instead.

Windows, or Linux without Bubblewrap, keeps the audit-hook-only worker.
"""

from __future__ import annotations

import json
import os
import shutil
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
    if sys.platform.startswith("linux") and shutil.which("bwrap"):
        return "bwrap"
    return None


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
    """Data Formulator's workspace folders, readable by the shared worker (single-user local mode)."""
    from data_formulator.datalake.workspace import get_data_formulator_home

    home = get_data_formulator_home()
    return [os.path.realpath(home / name) for name in ("users", "workspaces") if (home / name).is_dir()]


def worker_key(workspace: str | None) -> str:
    """Workers are shared across Data Formulator's workspaces and dedicated to any other folder."""
    if not workspace:
        return ""
    resolved = os.path.realpath(workspace)
    if any(resolved == root or resolved.startswith(root + os.sep) for root in shared_read_roots()):
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


def bwrap_prefix(read_roots: list[str], write_dir: str) -> list[str]:
    """``bwrap`` arguments: a read-only view of system and Python paths, no network, one writable directory."""
    command = ["bwrap", "--die-with-parent", "--unshare-all", "--cap-drop", "ALL",
               "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp"]
    for path in [*_LINUX_SYSTEM_READS, *read_roots]:
        command += ["--ro-bind-try", path, path]
    command += ["--bind", write_dir, write_dir, "--chdir", write_dir]
    return command


def confined_worker_command(kind: str, key: str, write_dir: str,
                            read_fd: int, write_fd: int) -> list[str]:
    """The command that starts one confined warm worker for ``key`` (see :func:`worker_key`)."""
    read_roots = python_read_roots()
    read_roots += shared_read_roots() if key == SHARED else [key] if key else []
    write_dir = os.path.realpath(write_dir)
    allow_network = network_allowed(kind)
    # -I: ignore the environment and user site, and never put the working
    # directory on sys.path, so workspace files cannot shadow real modules.
    worker = [sys.executable, "-I", "-m", "data_formulator.sandbox.confined_worker",
              str(read_fd), str(write_fd), "1" if allow_network else "0"]
    if kind == "seatbelt":
        return [SEATBELT, "-p", seatbelt_profile(read_roots, write_dir, allow_network=allow_network), *worker]
    if kind == "bwrap":
        bwrap = shutil.which("bwrap") or "bwrap"
        return [bwrap, *bwrap_prefix(read_roots, write_dir)[1:], "--", *worker]
    raise ValueError(f"Unknown confinement: {kind}")


def worker_environment(write_dir: str) -> dict[str, str]:
    """A minimal environment: no secrets from the server process, caches in the private directory."""
    environment = {key: value for key, value in os.environ.items()
                   if key in {"PATH", "LANG", "LC_ALL", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR",
                              "REQUESTS_CA_BUNDLE", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
                              "http_proxy", "https_proxy", "no_proxy"}}
    environment.update({"HOME": write_dir, "TMPDIR": write_dir, "TMP": write_dir, "TEMP": write_dir,
                        "MPLCONFIGDIR": os.path.join(write_dir, "matplotlib"),
                        "XDG_CACHE_HOME": os.path.join(write_dir, "cache"),
                        "PYTHONDONTWRITEBYTECODE": "1"})
    return environment
