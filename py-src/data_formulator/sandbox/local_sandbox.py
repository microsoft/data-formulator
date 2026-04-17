# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Local sandbox -- executes Python code in a persistent warm subprocess.

The script runs with the workspace directory as its working directory
so user scripts access files via e.g. ``pd.read_csv("sample.csv")``.
"""

import atexit
import logging
import os
import threading
import warnings
from multiprocessing import Pipe, Process
from sys import addaudithook

import pandas as pd

from .base import Sandbox

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Persistent warm worker
# ---------------------------------------------------------------------------

def _warm_worker_loop(conn):
    """Long-lived child process that pre-imports heavy libraries then
    waits for code to execute.

    Protocol (over *conn*):
        Host -> worker:  (code: str, allowed_objects: dict, workspace_path: str)
        Worker -> host:   {"status": "ok", "allowed_objects": {...}}
                      or {"status": "error", "error_message": "..."}
        Host -> worker:  None   -> terminate
    """
    warnings.filterwarnings("ignore")

    # Scrub sensitive environment variables before accepting any code.
    # Legitimate sandbox code (pandas/numpy transforms) never needs these.
    _SENSITIVE_PATTERNS = ("KEY", "SECRET", "TOKEN", "PASSWORD", "CREDENTIAL", "CONNECTION_STRING")
    for _key in list(os.environ):
        if any(p in _key.upper() for p in _SENSITIVE_PATTERNS):
            del os.environ[_key]

    # Mutable container: the audit hook reads this to know which
    # workspace directory is currently allowed for file reads.
    # Set before each exec(), cleared after.  When None, only
    # library-level opens (pre-import phase) are permitted.
    _allowed_workspace = [None]

    # Build a set of directories that should always be readable
    # (Python stdlib, site-packages, etc.) so that library imports
    # (e.g. pyarrow.parquet) are not blocked during code execution.
    import site as _site, sysconfig as _sysconfig
    _allowed_lib_prefixes = set()
    for _p in (
        *_site.getsitepackages(),
        _site.getusersitepackages(),
        _sysconfig.get_path("stdlib"),
        _sysconfig.get_path("purelib"),
        _sysconfig.get_path("platlib"),
    ):
        if _p:
            _rp = os.path.realpath(_p)
            if not _rp.endswith(os.sep):
                _rp += os.sep
            _allowed_lib_prefixes.add(_rp)
    _allowed_lib_prefixes = tuple(_allowed_lib_prefixes)  # tuple for fast startswith()

    # Pre-import heavy libraries BEFORE audit hooks so that libraries
    # needing ctypes/dlopen (e.g., scipy/sklearn -> BLAS) can load freely.
    # These stay in sys.modules for the lifetime of the worker.
    try:
        import numpy  # noqa: F401
        import pandas  # noqa: F401
        import duckdb  # noqa: F401
    except ImportError:
        pass
    try:
        import scipy  # noqa: F401
        from sklearn import (  # noqa: F401
            linear_model, cluster, tree, ensemble,
            svm, neighbors, decomposition, preprocessing,
        )
    except ImportError:
        pass

    import sys as _sys

    # Install audit hooks once -- they persist for the process lifetime.
    def block_mischief(event, arg):
        if type(event) != str:
            raise RuntimeError("bad audit event")
        # Block file writes (only allow reading)
        if event == "open" and type(arg[1]) == str and arg[1] not in ("r", "rb"):
            raise IOError("file write forbidden")
        # Restrict file reads to the workspace directory during code execution.
        # Always allow reads from Python library directories (stdlib, site-packages).
        if (event == "open" and type(arg[1]) == str and arg[1] in ("r", "rb")
                and _allowed_workspace[0] is not None):
            resolved = os.path.realpath(arg[0])
            if not resolved.startswith(_allowed_workspace[0]) and not resolved.startswith(_allowed_lib_prefixes):
                raise IOError(f"file read outside workspace forbidden: {arg[0]}")
        # Block dangerous filesystem / process operations
        _blocked_prefixes = ("subprocess", "shutil", "winreg", "webbrowser")
        if event.split(".")[0] in _blocked_prefixes:
            raise IOError("potentially dangerous, filesystem-accessing functions forbidden")
        # Block dangerous os operations (process execution, signals,
        # environment manipulation).  We intentionally do NOT add "os"
        # to _blocked_prefixes because libraries like pandas/numpy rely
        # on safe os.* audit events (os.listdir, os.scandir, os.stat)
        # that share the same prefix.
        _blocked_os_events = frozenset({
            "os.system", "os.exec", "os.spawn", "os.fork",
            "os.kill", "os.killpg", "os.startfile",
            "os.putenv", "os.unsetenv",
        })
        if event in _blocked_os_events:
            raise IOError("dangerous os operation forbidden in sandbox")
        # Block network access — code should only transform data, not
        # make outbound connections (prevents data exfiltration).
        if event in ("socket.connect", "socket.bind", "socket.sendto",
                      "socket.sendmsg", "socket.getaddrinfo"):
            raise IOError("network access forbidden in sandbox")
        # Block ctypes / dynamic library loading (could bypass audit hooks)
        if event in ("ctypes.dlopen", "ctypes.dlsym", "ctypes.set_errno"):
            raise IOError("ctypes access forbidden in sandbox")
        # Block import of dangerous modules (allow re-import of ctypes
        # since scipy/sklearn pre-loaded it for BLAS access).
        if event == "import" and type(arg[0]) == str:
            _blocked_modules = ("subprocess", "shutil", "socket", "http",
                                "urllib", "requests", "ctypes", "multiprocessing",
                                "signal", "resource")
            mod_name = arg[0].split(".")[0]
            if mod_name in _blocked_modules:
                if mod_name == "ctypes" and "ctypes" in _sys.modules:
                    pass
                else:
                    raise ImportError(f"import of '{mod_name}' is forbidden in sandbox")

    addaudithook(block_mischief)
    del block_mischief

    while True:
        try:
            msg = conn.recv()
        except (EOFError, OSError):
            break

        if msg is None:
            break

        code, allowed_objects, workspace_path = msg

        # Resolve the workspace path once so the audit hook can compare
        # against a canonical absolute prefix (with trailing separator).
        if workspace_path:
            _ws = os.path.realpath(workspace_path)
            if not _ws.endswith(os.sep):
                _ws += os.sep
            _allowed_workspace[0] = _ws
        else:
            _allowed_workspace[0] = None

        # Change working directory to workspace before executing user
        # code.  Done here (not via a code preamble) so that ``import os``
        # is never injected into the exec namespace.
        if workspace_path:
            os.chdir(workspace_path)

        namespace = {**allowed_objects}
        try:
            # Security: code is HMAC-SHA256 signed by the server when first generated
            # by AI agents (see code_signing.py). The /refresh-derived-data endpoint
            # verifies the signature before forwarding code here, ensuring only
            # server-originated code is executed. Additional audit hooks above block
            # file writes, network access, subprocess spawning, and dangerous imports.
            exec(code, namespace)  # nosec  # codeql[py/code-injection]
        except Exception as err:
            conn.send({"status": "error", "error_message": f"Error: {type(err).__name__} - {err}"})
            _allowed_workspace[0] = None
            continue

        _allowed_workspace[0] = None

        result_objs = {k: namespace[k] for k in allowed_objects}
        response_msg = {"status": "ok", "allowed_objects": result_objs}

        # Collect DataFrame variable names for diagnostics.
        try:
            _df_names = [
                k for k, v in namespace.items()
                if isinstance(v, pandas.DataFrame)
                and not k.startswith('_') and k not in allowed_objects
            ]
            response_msg["df_names"] = _df_names
        except Exception:
            pass

        conn.send(response_msg)

    conn.close()


class _WarmWorkerPool:
    """Pool of persistent child processes with pre-imported libraries.

    Workers are forked once and reuse the same process for multiple
    calls, avoiding the ~600ms pandas/numpy import overhead each time.
    A simple LIFO stack ensures thread-safe checkout/return.
    """

    def __init__(self, size: int = 2):
        self._size = size
        self._lock = threading.Lock()
        self._available: list[tuple[Process, object]] = []
        self._all: list[tuple[Process, object]] = []
        self._closed = False
        atexit.register(self.shutdown)

    def _spawn(self) -> tuple[Process, object]:
        parent_conn, child_conn = Pipe()
        p = Process(target=_warm_worker_loop, args=(child_conn,), daemon=True)
        p.start()
        return p, parent_conn

    def acquire(self) -> tuple[Process, object]:
        """Get a warm worker (process, conn). Spawns one if needed."""
        with self._lock:
            while self._available:
                proc, conn = self._available.pop()
                if proc.is_alive():
                    return proc, conn
                # Dead worker -- discard and try next
            # No available workers -- spawn a new one (up to pool size is advisory)
            pair = self._spawn()
            self._all.append(pair)
            return pair

    def release(self, proc: Process, conn) -> None:
        """Return a worker to the pool for reuse."""
        with self._lock:
            if not self._closed and proc.is_alive():
                self._available.append((proc, conn))

    def discard(self, proc: Process, conn) -> None:
        """Discard a broken worker (don't put it back)."""
        try:
            conn.send(None)
        except Exception:
            pass
        try:
            proc.terminate()
        except Exception:
            pass

    def shutdown(self) -> None:
        with self._lock:
            self._closed = True
            all_workers = list(self._all)
            self._available.clear()
            self._all.clear()

        for proc, conn in all_workers:
            try:
                conn.send(None)
            except Exception:
                pass
            try:
                proc.join(timeout=2)
            except Exception:
                pass
            if proc.is_alive():
                proc.terminate()


# Module-level pool -- shared by all LocalSandbox instances using subprocess mode.
_worker_pool = _WarmWorkerPool(size=2)


class LocalSandbox(Sandbox):
    """Execute Python code in a persistent warm subprocess.

    Uses a pool of pre-warmed child processes with pandas/numpy/duckdb
    already imported, giving ~1 ms execution overhead per call.
    Audit hooks in the child block file writes and dangerous operations.
    """

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def run_python_code(
        self,
        code: str,
        workspace,
        output_variable: str,
    ) -> dict:
        """Execute *code* and return the result DataFrame.

        The script runs with the workspace directory as its working
        directory so scripts access data files via e.g.
        ``pd.read_csv("sample.csv")``.

        Returns
        -------
        dict
            ``{'status': 'ok', 'content': DataFrame}``  on success, or
            ``{'status': 'error', 'content': str}``    on failure.
        """
        with workspace.local_dir() as local_path:
            workspace_path = os.path.abspath(str(local_path))
            # Debug: list files in workspace directory before execution
            try:
                ws_files = os.listdir(workspace_path)
                logger.info(f"[LocalSandbox] workspace_path={workspace_path}")
                logger.info(f"[LocalSandbox] files in workspace ({len(ws_files)}): {ws_files}")
            except Exception as e:
                logger.warning(f"[LocalSandbox] failed to list workspace dir: {e}")
            try:
                allowed_objects = {output_variable: None}
                result = self._run_in_warm_subprocess(code, allowed_objects, workspace_path)

                if result["status"] == "ok":
                    output_df = result["allowed_objects"][output_variable]
                    if not isinstance(output_df, pd.DataFrame):
                        df_names = result.get("df_names", [])
                        return {
                            "status": "error",
                            "content": (
                                f'Output variable "{output_variable}" is not a '
                                f"DataFrame (type: {type(output_df).__name__}). "
                                f"Available DataFrame variables in code: "
                                f"{df_names if df_names else 'none'}. "
                                f"This usually means the JSON spec's "
                                f"output_variable does not match the variable "
                                f"name actually used in the Python code."
                            ),
                            "df_names": df_names,
                        }
                    return {"status": "ok", "content": output_df}
                else:
                    # Normalise: the warm-subprocess protocol uses
                    # "error_message" but the public sandbox API uses "content".
                    return {
                        "status": "error",
                        "content": result.get("error_message", result.get("content", "Unknown error")),
                    }

            except Exception as e:
                return {
                    "status": "error",
                    "content": f"Error during execution setup: {type(e).__name__} - {e}",
                }

    # ------------------------------------------------------------------
    # Warm subprocess execution (persistent worker pool)
    # ------------------------------------------------------------------

    # Maximum wall-clock time for a single code execution (seconds).
    EXECUTION_TIMEOUT = int(os.environ.get("DF_SANDBOX_TIMEOUT", "120"))

    @staticmethod
    def _run_in_warm_subprocess(code, allowed_objects, workspace_path=None):
        """Send code to a warm worker from the pool, return the result."""
        proc, conn = _worker_pool.acquire()
        try:
            conn.send((code, {**allowed_objects}, workspace_path))
            # Enforce a wall-clock timeout to prevent runaway code
            if conn.poll(timeout=LocalSandbox.EXECUTION_TIMEOUT):
                result = conn.recv()
            else:
                # Timed out — kill and discard the worker
                _worker_pool.discard(proc, conn)
                return {
                    "status": "error",
                    "content": (
                        f"Code execution timed out after "
                        f"{LocalSandbox.EXECUTION_TIMEOUT}s"
                    ),
                }
            _worker_pool.release(proc, conn)
            return result
        except Exception as e:
            _worker_pool.discard(proc, conn)
            return {"status": "error", "content": f"Error: worker communication failed - {e}"}


