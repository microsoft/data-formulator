# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unsandboxed main-process executor -- for benchmarking only.

This runs user code directly in the main process with no isolation.
It is NOT exposed as a CLI option and should only be used to measure
the raw execution overhead baseline in benchmarks.
"""

import os
import warnings

import pandas as pd

from .base import Sandbox


class NotASandbox(Sandbox):
    """Execute Python code directly in the main process (no isolation).

    For benchmarking only -- measures raw exec() overhead without any
    subprocess or container overhead.  No security restrictions are
    applied.
    """

    def run_python_code(
        self,
        code: str,
        workspace,
        output_variable: str,
    ) -> dict:
        with workspace.local_dir() as local_path:
            workspace_path = os.path.abspath(str(local_path))
            original_cwd = os.getcwd()

            try:
                os.chdir(workspace_path)
                warnings.filterwarnings("ignore")

                namespace = {output_variable: None}
                # Security: this sandbox has NO isolation and is for benchmarking only.
                # In production, use LocalSandbox or DockerSandbox. Code executed here
                # is HMAC-SHA256 signed at generation time (see code_signing.py) and
                # verified by the /refresh-derived-data endpoint before reaching exec().
                exec(code, namespace)  # nosec  # codeql[py/code-injection]

                output_df = namespace[output_variable]
                if not isinstance(output_df, pd.DataFrame):
                    return {
                        "status": "error",
                        "content": (
                            f'Output variable "{output_variable}" is not a '
                            f"DataFrame (type: {type(output_df).__name__})"
                        ),
                    }
                return {"status": "ok", "content": output_df}

            except Exception as e:
                return {
                    "status": "error",
                    "content": f"Error: {type(e).__name__} - {e}",
                }
            finally:
                os.chdir(original_cwd)
