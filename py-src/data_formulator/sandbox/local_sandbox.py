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
        Host -> worker:  (code: str, allowed_objects: dict)
        Worker -> host:   {"status": "ok", "allowed_objects": {...}}
                      or {"status": "error", "error_message": "..."}
        Host -> worker:  None   -> terminate
    """
    warnings.filterwarnings("ignore")

    # Install audit hooks once -- they persist for the process lifetime.
    def block_mischief(event, arg):
        if type(event) != str:
            raise RuntimeError("bad audit event")
        # Block file writes (only allow reading)
        if event == "open" and type(arg[1]) == str and arg[1] not in ("r", "rb"):
            raise IOError("file write forbidden")
        # Block dangerous filesystem / process operations
        _blocked_prefixes = ("subprocess", "shutil", "winreg", "webbrowser")
        if event.split(".")[0] in _blocked_prefixes:
            raise IOError("potentially dangerous, filesystem-accessing functions forbidden")
        # Block network access — code should only transform data, not
        # make outbound connections (prevents data exfiltration).
        if event in ("socket.connect", "socket.bind", "socket.sendto",
                      "socket.sendmsg", "socket.getaddrinfo"):
            raise IOError("network access forbidden in sandbox")
        # Block ctypes / dynamic library loading (could bypass audit hooks)
        if event in ("ctypes.dlopen", "ctypes.dlsym", "ctypes.set_errno"):
            raise IOError("ctypes access forbidden in sandbox")
        # Block import of dangerous modules
        if event == "import" and type(arg[0]) == str:
            _blocked_modules = ("subprocess", "shutil", "socket", "http",
                                "urllib", "requests", "ctypes", "multiprocessing",
                                "signal", "resource")
            mod_name = arg[0].split(".")[0]
            if mod_name in _blocked_modules:
                raise ImportError(f"import of '{mod_name}' is forbidden in sandbox")

    addaudithook(block_mischief)
    del block_mischief

    # Pre-import heavy libraries so first call is fast.
    # These stay in sys.modules for the lifetime of the worker.
    try:
        import numpy  # noqa: F401
        import pandas  # noqa: F401
        import duckdb  # noqa: F401
    except ImportError:
        pass

    while True:
        try:
            msg = conn.recv()
        except (EOFError, OSError):
            break

        if msg is None:
            break

        code, allowed_objects = msg

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
            continue

        conn.send({"status": "ok", "allowed_objects": {k: namespace[k] for k in allowed_objects}})

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

            # Prepend a chdir so the script runs inside the workspace directory.
            ws_escaped = workspace_path.replace("\\", "\\\\").replace("'", "\\'")
            chdir_preamble = f"import os as _sandbox_os; _sandbox_os.chdir('{ws_escaped}')\n"
            code_with_chdir = chdir_preamble + code

            try:
                allowed_objects = {output_variable: None}
                result = self._run_in_warm_subprocess(code_with_chdir, allowed_objects)

                if result["status"] == "ok":
                    output_df = result["allowed_objects"][output_variable]
                    if not isinstance(output_df, pd.DataFrame):
                        return {
                            "status": "error",
                            "content": (
                                f'Output variable "{output_variable}" is not a '
                                f"DataFrame (type: {type(output_df).__name__})"
                            ),
                        }
                    return {"status": "ok", "content": output_df}
                else:
                    return result

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
    def _run_in_warm_subprocess(code, allowed_objects):
        """Send code to a warm worker from the pool, return the result."""
        proc, conn = _worker_pool.acquire()
        try:
            conn.send((code, {**allowed_objects}))
            # Enforce a wall-clock timeout to prevent runaway code
            if conn.poll(timeout=LocalSandbox.EXECUTION_TIMEOUT):
                result = conn.recv()
            else:
                # Timed out — kill and discard the worker
                _worker_pool.discard(proc, conn)
                return {
                    "status": "error",
                    "error_message": (
                        f"Code execution timed out after "
                        f"{LocalSandbox.EXECUTION_TIMEOUT}s"
                    ),
                }
            _worker_pool.release(proc, conn)
            return result
        except Exception as e:
            _worker_pool.discard(proc, conn)
            return {"status": "error", "error_message": f"Error: worker communication failed - {e}"}


