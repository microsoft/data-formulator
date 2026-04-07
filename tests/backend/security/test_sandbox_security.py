# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Sandbox security tests — verify that untrusted code is properly confined.

These tests focus on what the sandbox must BLOCK, not on whether valid
transforms produce correct results (that stays in integration/test_sandbox.py).
"""

import os
import subprocess
from contextlib import contextmanager

import pandas as pd
import pytest

from data_formulator.sandbox import LocalSandbox, DockerSandbox

pytestmark = [pytest.mark.backend]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _MinimalWorkspace:
    """Lightweight workspace stand-in for sandbox tests."""
    def __init__(self, path: str):
        self._path = path

    @contextmanager
    def local_dir(self):
        yield self._path


@pytest.fixture
def workspace(tmp_path):
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text("name,value\nAlice,10\nBob,20\n")
    return _MinimalWorkspace(str(tmp_path))


def _docker_available() -> bool:
    try:
        proc = subprocess.run(["docker", "info"], capture_output=True, timeout=10)
        return proc.returncode == 0
    except Exception:
        return False


skip_no_docker = pytest.mark.skipif(
    not _docker_available(),
    reason="Docker is not available",
)


# ===================================================================
# LocalSandbox — file-write restrictions
# ===================================================================

class TestLocalSandboxFileWriteBlocked:
    """Subprocess audit hook must block all file writes."""

    @pytest.fixture
    def sandbox(self):
        return LocalSandbox()

    def test_open_write_blocked(self, sandbox, workspace):
        code = """\
import pandas as pd
with open("evil.txt", "w") as f:
    f.write("pwned")
output_df = pd.DataFrame()
"""
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"

    def test_csv_write_blocked(self, sandbox, workspace):
        code = """\
import pandas as pd
df = pd.DataFrame({"x": [1]})
df.to_csv("temp_output.csv", index=False)
output_df = pd.read_csv("temp_output.csv")
"""
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"


# ===================================================================
# LocalSandbox — process execution blocked
# ===================================================================

class TestLocalSandboxProcessExecBlocked:
    """The audit hook must block all forms of process execution."""

    @pytest.fixture
    def sandbox(self):
        return LocalSandbox()

    def test_os_system(self, sandbox, workspace):
        code = 'import os, pandas as pd\nos.system("echo pwned")\noutput_df = pd.DataFrame()'
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"

    def test_os_popen(self, sandbox, workspace):
        code = 'import os, pandas as pd\nos.popen("echo pwned").read()\noutput_df = pd.DataFrame()'
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"

    def test_os_execvp(self, sandbox, workspace):
        code = 'import os, pandas as pd\nos.execvp("echo", ["echo", "pwned"])\noutput_df = pd.DataFrame()'
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"

    def test_os_spawnlp(self, sandbox, workspace):
        code = 'import os, pandas as pd\nos.spawnlp(os.P_WAIT, "echo", "echo", "pwned")\noutput_df = pd.DataFrame()'
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"

    def test_os_kill(self, sandbox, workspace):
        code = 'import os, pandas as pd\nos.kill(os.getpid(), 0)\noutput_df = pd.DataFrame()'
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"

    def test_os_via_sys_modules(self, sandbox, workspace):
        """os.system() obtained via sys.modules must still be blocked."""
        code = 'import sys, pandas as pd\nos = sys.modules["os"]\nos.system("echo pwned")\noutput_df = pd.DataFrame()'
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"

    def test_os_putenv(self, sandbox, workspace):
        code = 'import os, pandas as pd\nos.putenv("EVIL", "value")\noutput_df = pd.DataFrame()'
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"


# ===================================================================
# DockerSandbox — workspace isolation
# ===================================================================

@skip_no_docker
class TestDockerSandboxSecurity:
    """Docker container must enforce read-only workspace mount."""

    @pytest.fixture
    def sandbox(self):
        return DockerSandbox(timeout=120)

    def test_workspace_readonly(self, sandbox, workspace):
        code = """\
import pandas as pd
with open("evil.txt", "w") as f:
    f.write("pwned")
output_df = pd.DataFrame()
"""
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"
        assert not os.path.exists(os.path.join(workspace._path, "evil.txt"))
