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
        Host -> worker:  (code, allowed_objects, workspace_path)           — fresh namespace
                     or  (code, allowed_objects, workspace_path, True)     — persistent namespace
                     or  "__clear_ns__"                                    — reset persistent namespace
                     or  None                                              — terminate
        Worker -> host:   {"status": "ok", "allowed_objects": {...}}
                      or {"status": "error", "error_message": "..."}
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

    # Persistent namespace for SandboxSession (None when not active).
    _persistent_ns = None

    while True:
        try:
            msg = conn.recv()
        except (EOFError, OSError):
            break

        if msg is None:
            break

        # "__clear_ns__" resets the persistent namespace.
        if msg == "__clear_ns__":
            _persistent_ns = None
            conn.send({"status": "ok"})
            continue

        # Unpack: 3-tuple (legacy) or 4-tuple (with persist flag).
        if len(msg) == 4:
            code, allowed_objects, workspace_path, persist = msg
        else:
            code, allowed_objects, workspace_path = msg
            persist = False

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

        # Build or reuse namespace.
        if persist and _persistent_ns is not None:
            # Merge output-variable placeholders into the existing namespace
            # so the capture wrapper can write to them.
            _persistent_ns.update(allowed_objects)
            namespace = _persistent_ns
        else:
            namespace = {**allowed_objects}
            if persist:
                _persistent_ns = namespace

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


class SandboxSession:
    """A session that keeps the Python namespace alive across multiple executions.

    Use as a context manager inside an agent turn so that consecutive
    ``explore()`` / ``execute_python()`` calls share variables (like a
    Jupyter kernel).  The namespace is cleared and the worker returned to
    the pool on ``close()`` / ``__exit__``.
    """

    EXECUTION_TIMEOUT = int(os.environ.get("DF_SANDBOX_TIMEOUT", "120"))

    def __init__(self):
        self._proc, self._conn = _worker_pool.acquire()
        self._closed = False

    # -- public API --------------------------------------------------------

    def execute(self, code: str, allowed_objects: dict, workspace_path: str | None = None) -> dict:
        """Run *code* with namespace persisted between calls.

        Returns the same dict contract as ``_warm_worker_loop``:
        ``{"status": "ok", "allowed_objects": {...}}`` or
        ``{"status": "error", "error_message": "..."}``.
        """
        if self._closed:
            return {"status": "error", "error_message": "Session is closed"}
        try:
            self._conn.send((code, {**allowed_objects}, workspace_path, True))
            if self._conn.poll(timeout=self.EXECUTION_TIMEOUT):
                return self._conn.recv()
            # Timed out — kill and discard the worker
            _worker_pool.discard(self._proc, self._conn)
            self._closed = True
            return {
                "status": "error",
                "error_message": f"Code execution timed out after {self.EXECUTION_TIMEOUT}s",
            }
        except Exception as e:
            _worker_pool.discard(self._proc, self._conn)
            self._closed = True
            return {"status": "error", "error_message": f"Worker communication failed: {e}"}

    def close(self):
        """Clear the persistent namespace and return the worker to the pool."""
        if self._closed:
            return
        self._closed = True
        try:
            self._conn.send("__clear_ns__")
            if self._conn.poll(timeout=5):
                self._conn.recv()
                _worker_pool.release(self._proc, self._conn)
            else:
                # Ack didn't arrive in time -- worker may still be busy or
                # the pipe has stale data.  Discard rather than returning a
                # contaminated worker to the pool (otherwise the next
                # session's recv() would pick up the leftover ack).
                _worker_pool.discard(self._proc, self._conn)
        except Exception:
            _worker_pool.discard(self._proc, self._conn)

    # -- cross-turn namespace save/restore ---------------------------------

    def save_namespace(self, save_dir, workspace_path: str | None = None):
        """Serialize user DataFrames and scalars from the persistent namespace
        to *save_dir* so they can be restored in a future session.

        DataFrames are saved as parquet files (by the **host** process, since
        the worker's audit hooks forbid file writes).  Scalars are stored in
        a JSON manifest alongside the list of saved DataFrame names.
        """
        import json as _json
        from pathlib import Path
        save_dir = Path(save_dir)

        collect_code = (
            "import pandas as _pd\n"
            "_user_dfs = {}\n"
            "_user_scalars = {}\n"
            "for _k, _v in dict(globals()).items():\n"
            "    if _k.startswith('_') or _k == '__builtins__':\n"
            "        continue\n"
            "    if isinstance(_v, _pd.DataFrame):\n"
            "        _user_dfs[_k] = _v\n"
            "    elif isinstance(_v, (int, float, str, bool)):\n"
            "        _user_scalars[_k] = _v\n"
            "_pack = {'dataframes': _user_dfs, 'scalars': _user_scalars}\n"
        )
        result = self.execute(collect_code, {"_pack": None}, workspace_path)
        if result.get("status") != "ok":
            logger.warning("save_namespace: collect failed: %s", result.get("error_message"))
            return False

        pack = result["allowed_objects"].get("_pack")
        if not pack or not isinstance(pack, dict):
            return False

        dfs = pack.get("dataframes", {})
        scalars = pack.get("scalars", {})
        if not dfs and not scalars:
            return False

        save_dir.mkdir(parents=True, exist_ok=True)
        manifest = {"dataframes": [], "scalars": scalars}
        for name, df in dfs.items():
            if isinstance(df, pd.DataFrame):
                df.to_parquet(save_dir / f"{name}.parquet", index=False)
                manifest["dataframes"].append(name)

        (save_dir / "_manifest.json").write_text(
            _json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
        )
        logger.info("[SandboxSession] Saved namespace: %d DataFrames, %d scalars to %s",
                     len(manifest["dataframes"]), len(scalars), save_dir)
        return True

    @staticmethod
    def restore_namespace(session, save_dir, workspace_path: str | None = None):
        """Restore previously saved DataFrames and scalars into *session*.

        Returns True if restoration succeeded, False if nothing to restore.
        This is a static helper so it can be called right after creating a
        new session (the save_dir comes from the previous turn's save).
        """
        import json as _json
        from pathlib import Path
        save_dir = Path(save_dir)
        manifest_path = save_dir / "_manifest.json"
        if not manifest_path.exists():
            return False

        manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
        df_names = manifest.get("dataframes", [])
        scalars = manifest.get("scalars", {})
        if not df_names and not scalars:
            return False

        lines = ["import pandas as pd"]
        for name in df_names:
            parquet_path = (save_dir / f"{name}.parquet").resolve().as_posix()
            lines.append(f'{name} = pd.read_parquet(r"{parquet_path}")')
        for name, value in scalars.items():
            lines.append(f"{name} = {repr(value)}")
        lines.append("_pack = None")

        restore_code = "\n".join(lines)
        result = session.execute(restore_code, {"_pack": None}, workspace_path)
        if result.get("status") != "ok":
            logger.warning("restore_namespace failed: %s", result.get("error_message"))
            return False

        logger.info("[SandboxSession] Restored namespace: %d DataFrames, %d scalars from %s",
                     len(df_names), len(scalars), save_dir)
        return True

    # -- context manager ---------------------------------------------------

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


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


