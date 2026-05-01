# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Docker-based sandbox for executing Python code in an isolated container.

The workspace directory is mounted **read-only** as the container's working
directory so user scripts can read data files via e.g.
``pd.read_csv("file.csv")`` but cannot tamper with the host filesystem.
The output DataFrame is serialised to Parquet and read back via a
bind-mounted output directory.
"""

import logging
import os
import shutil
import subprocess
import tempfile
import textwrap

import pandas as pd

from data_formulator.datalake.parquet_utils import safe_data_filename
from data_formulator.security.sanitize import sanitize_error_message
from .base import Sandbox

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_DOCKER_IMAGE = os.environ.get(
    "DOCKER_SANDBOX_IMAGE", "data-formulator-sandbox"
)
DEFAULT_TIMEOUT = int(os.environ.get("DOCKER_SANDBOX_TIMEOUT", "120"))


def _safe_error_response(content, detail=None):
    response = {"status": "error", "content": content}
    if detail:
        safe_detail = sanitize_error_message(detail)
        if safe_detail:
            response["diagnostics"] = {"safe_detail": safe_detail}
    return response


class DockerSandbox(Sandbox):
    """Execute Python code inside a Docker container.

    The workspace directory is bind-mounted **read-only** as the
    container's working directory.  Scripts read files directly via
    e.g. ``pd.read_csv("file.csv")``.

    Parameters
    ----------
    docker_image : str
        Docker image tag to use.  The default ``data-formulator-sandbox``
        is built from ``Dockerfile.sandbox`` and has all required packages
        pre-installed.  Override with ``DOCKER_SANDBOX_IMAGE`` env-var.
    timeout : int
        Wall-clock timeout in seconds (default: 120 or
        ``DOCKER_SANDBOX_TIMEOUT``).
    """

    def __init__(
        self,
        docker_image: str = DEFAULT_DOCKER_IMAGE,
        timeout: int = DEFAULT_TIMEOUT,
    ):
        self.docker_image = docker_image
        self.timeout = timeout

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def run_python_code(
        self,
        code: str,
        workspace,
        output_variable: str,
    ) -> dict:
        """Execute *code* in a Docker container and return the result DataFrame.

        The wrapper script runs the user code, then serialises
        ``output_variable`` to Parquet so the host can read it back.

        Returns
        -------
        dict
            ``{'status': 'ok', 'content': DataFrame}``  on success, or
            ``{'status': 'error', 'content': str}``    on failure.
        """
        # Use local_dir() to materialise workspace files locally
        # (no-op for local workspaces, downloads blobs for Azure).
        with workspace.local_dir() as local_path:
            workspace_path = str(local_path)

            tmpdir = tempfile.mkdtemp(prefix="df_docker_")
            output_dir = os.path.join(tmpdir, "outputs")
            os.makedirs(output_dir, exist_ok=True)

            # ---- build wrapper script -----------------------------------------
            output_parquet = f"/sandbox/outputs/{output_variable}.parquet"
            wrapper_script = textwrap.dedent("""\
                import warnings
                warnings.filterwarnings('ignore')

                # --- user code ---
                {user_code}

                # --- serialise output ---
                import pandas as _pd
                _out = {output_variable}
                if not isinstance(_out, _pd.DataFrame):
                    _df_vars = [
                        _k for _k, _v in dict(locals()).items()
                        if isinstance(_v, _pd.DataFrame) and not _k.startswith('_')
                    ]
                    raise TypeError(
                        '{output_variable} is not a DataFrame '
                        f'(type: {{type(_out).__name__}}). '
                        f'Available DataFrame variables in code: {{_df_vars}}. '
                        f'This usually means the JSON spec output_variable '
                        f'does not match the variable name in the Python code.'
                    )
                _out.to_parquet('{output_parquet}', index=False)

                print("__DOCKER_SANDBOX_OK__")
            """).format(
                user_code=code,
                output_variable=output_variable,
                output_parquet=output_parquet,
            )

            script_path = os.path.join(tmpdir, "run.py")
            with open(script_path, "w") as f:
                f.write(wrapper_script)

            # ---- assemble docker command --------------------------------------
            docker_cmd: list[str] = [
                "docker", "run",
                "--rm",
                "--memory", "512m",
                "--cpus", "1",
                "--pids-limit", "256",
            ]

            # Only set an explicit user on platforms that support os.getuid/os.getgid
            user_flag: list[str] = []
            if hasattr(os, "getuid") and hasattr(os, "getgid"):
                try:
                    user_flag = ["--user", f"{os.getuid()}:{os.getgid()}"]
                except OSError:
                    # Fall back to image's default user if UID/GID cannot be determined
                    user_flag = []
            docker_cmd += user_flag

            abs_ws = os.path.abspath(workspace_path)
            docker_cmd += ["-v", f"{abs_ws}:/sandbox/workdir:ro"]
            docker_cmd += ["-v", f"{output_dir}:/sandbox/outputs:rw"]
            docker_cmd += ["-v", f"{script_path}:/sandbox/run.py:ro"]
            docker_cmd += ["-w", "/sandbox/workdir"]
            docker_cmd += [self.docker_image]
            docker_cmd += ["python", "/sandbox/run.py"]

            # ---- execute ------------------------------------------------------
            try:
                proc = subprocess.run(
                    docker_cmd,
                    capture_output=True,
                    timeout=self.timeout,
                    text=True,
                )
            except subprocess.TimeoutExpired:
                self._cleanup(tmpdir)
                return {
                    "status": "error",
                    "content": f"Docker sandbox execution timed out after {self.timeout}s",
                }
            except FileNotFoundError:
                self._cleanup(tmpdir)
                return {
                    "status": "error",
                    "content": (
                        "Docker is not installed or not on the PATH. "
                        "Install Docker to use the docker sandbox."
                    ),
                }
            except Exception as exc:
                logger.exception("Failed to start Docker container")
                self._cleanup(tmpdir)
                return _safe_error_response(
                    "Failed to start Docker container.",
                    f"{type(exc).__name__}: {exc}",
                )

            stdout = proc.stdout or ""
            stderr = proc.stderr or ""

            if proc.returncode != 0 or "__DOCKER_SANDBOX_OK__" not in stdout:
                self._cleanup(tmpdir)
                err_detail = stderr.strip() or stdout.strip() or "Unknown error"
                logger.error("Docker sandbox execution failed: %s", err_detail)
                safe_detail = sanitize_error_message(err_detail)
                return _safe_error_response(
                    safe_detail or "Docker sandbox execution failed.",
                    safe_detail,
                )

            # ---- read back output ---------------------------------------------
            # Defensive: ensure the filename stays inside output_dir even if
            # output_variable somehow contains path separators.
            try:
                safe_name = safe_data_filename(output_variable)
            except ValueError:
                self._cleanup(tmpdir)
                return {
                    "status": "error",
                    "content": "Invalid output_variable",
                }
            parquet_out = os.path.realpath(
                os.path.join(output_dir, f"{safe_name}.parquet")
            )
            if not parquet_out.startswith(os.path.realpath(output_dir) + os.sep):
                self._cleanup(tmpdir)
                return {
                    "status": "error",
                    "content": "Invalid output_variable",
                }
            if not os.path.exists(parquet_out):
                self._cleanup(tmpdir)
                return {
                    "status": "error",
                    "content": f'Output variable "{output_variable}" was not produced',
                }

            try:
                output_df = pd.read_parquet(parquet_out)
            except Exception as exc:
                logger.exception("Failed to read output parquet")
                self._cleanup(tmpdir)
                return _safe_error_response(
                    "Failed to read output parquet.",
                    f"{type(exc).__name__}: {exc}",
                )

            self._cleanup(tmpdir)
            return {"status": "ok", "content": output_df}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _cleanup(tmpdir: str) -> None:
        """Best-effort recursive removal of *tmpdir*."""
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
