# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for sandbox execution backends (local and Docker)."""

import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager

import pandas as pd
import pytest

from data_formulator.sandbox import LocalSandbox, DockerSandbox, create_sandbox

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _MinimalWorkspace:
    """Lightweight workspace stand-in for sandbox tests (no metadata/yaml)."""
    def __init__(self, path: str):
        self._path = path

    @contextmanager
    def local_dir(self):
        yield self._path

SIMPLE_TRANSFORM = """\
import pandas as pd
output_df = pd.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6]})
"""

TRANSFORM_WITH_INPUT = """\
import pandas as pd
df = pd.DataFrame({"x": [10, 20], "y": [30, 40]})
output_df = df.assign(z=df["x"] + df["y"])
"""

SYNTAX_ERROR_CODE = """\
import pandas as pd
output_df = pd.DataFrame({"a" [1, 2]})
"""

RUNTIME_ERROR_CODE = """\
import pandas as pd
1 / 0
"""

NON_DF_OUTPUT = """\
output_df = "I am not a DataFrame"
"""

MULTI_TABLE_TRANSFORM = """\
import pandas as pd, json
data = json.loads('[{"a":1},{"a":2}]')
df = pd.DataFrame.from_records(data)
output_df = df.assign(doubled=df["a"] * 2)
"""


@pytest.fixture
def workspace(tmp_path):
    """Create a temporary workspace directory with a small CSV file."""
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text("name,value\nAlice,10\nBob,20\n")
    return _MinimalWorkspace(str(tmp_path))


def _docker_available() -> bool:
    """Return True if Docker CLI is present and the daemon is reachable."""
    try:
        proc = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=10,
        )
        return proc.returncode == 0
    except Exception:
        return False


skip_no_docker = pytest.mark.skipif(
    not _docker_available(),
    reason="Docker is not available",
)


# ===================================================================
# create_sandbox factory
# ===================================================================

class TestCreateSandbox:
    def test_local(self):
        sb = create_sandbox("local")
        assert isinstance(sb, LocalSandbox)

    def test_docker(self):
        sb = create_sandbox("docker")
        assert isinstance(sb, DockerSandbox)

    def test_default_is_local(self):
        sb = create_sandbox()
        assert isinstance(sb, LocalSandbox)


# ===================================================================
# LocalSandbox
# ===================================================================

class TestLocalSandbox:
    """Tests for LocalSandbox (warm subprocess with audit hooks)."""

    @pytest.fixture
    def sandbox(self):
        return LocalSandbox()

    def test_simple_transform(self, sandbox, workspace):
        result = sandbox.run_python_code(SIMPLE_TRANSFORM, workspace, "output_df")
        assert result["status"] == "ok"
        df = result["content"]
        assert isinstance(df, pd.DataFrame)
        assert len(df) == 3

    def test_derived_columns(self, sandbox, workspace):
        result = sandbox.run_python_code(TRANSFORM_WITH_INPUT, workspace, "output_df")
        assert result["status"] == "ok"
        assert list(result["content"]["z"]) == [40, 60]

    def test_read_csv_from_workspace(self, sandbox, workspace):
        code = """\
import pandas as pd
output_df = pd.read_csv("sample.csv")
"""
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "ok"
        assert len(result["content"]) == 2

    def test_write_to_workdir_blocked(self, sandbox, workspace):
        """Subprocess audit hook blocks all file writes, even in workdir.
        (Detailed security tests in tests/backend/security/test_sandbox_security.py)
        """
        code = """\
import pandas as pd
df = pd.DataFrame({"x": [1]})
df.to_csv("temp_output.csv", index=False)
output_df = pd.read_csv("temp_output.csv")
"""
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "error"

    def test_syntax_error(self, sandbox, workspace):
        result = sandbox.run_python_code(SYNTAX_ERROR_CODE, workspace, "output_df")
        assert result["status"] == "error"

    def test_runtime_error(self, sandbox, workspace):
        result = sandbox.run_python_code(RUNTIME_ERROR_CODE, workspace, "output_df")
        assert result["status"] == "error"

    def test_non_dataframe_output(self, sandbox, workspace):
        result = sandbox.run_python_code(NON_DF_OUTPUT, workspace, "output_df")
        assert result["status"] == "error"
        assert "not a DataFrame" in result["content"]

    def test_duckdb_sql(self, sandbox, workspace):
        """duckdb.sql() works in subprocess mode (unrestricted globals)."""
        code = """\
import pandas as pd
import duckdb
df = pd.DataFrame({"x": [1, 2, 3]})
output_df = duckdb.sql("SELECT x, x*10 AS x10 FROM df").df()
"""
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "ok"
        assert list(result["content"]["x10"]) == [10, 20, 30]


# ===================================================================
# DockerSandbox
# ===================================================================

@skip_no_docker
class TestDockerSandbox:
    """Tests for DockerSandbox — requires a running Docker daemon."""

    @pytest.fixture
    def sandbox(self):
        return DockerSandbox(timeout=120)

    def test_simple_transform(self, sandbox, workspace):
        result = sandbox.run_python_code(SIMPLE_TRANSFORM, workspace, "output_df")
        assert result["status"] == "ok"
        df = result["content"]
        assert isinstance(df, pd.DataFrame)
        assert list(df.columns) == ["a", "b"]
        assert len(df) == 3

    def test_derived_columns(self, sandbox, workspace):
        result = sandbox.run_python_code(TRANSFORM_WITH_INPUT, workspace, "output_df")
        assert result["status"] == "ok"
        df = result["content"]
        assert "z" in df.columns
        assert list(df["z"]) == [40, 60]

    def test_read_csv_from_workspace(self, sandbox, workspace):
        code = """\
import pandas as pd
output_df = pd.read_csv("sample.csv")
"""
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "ok"
        assert list(result["content"].columns) == ["name", "value"]

    def test_syntax_error(self, sandbox, workspace):
        result = sandbox.run_python_code(SYNTAX_ERROR_CODE, workspace, "output_df")
        assert result["status"] == "error"

    def test_runtime_error(self, sandbox, workspace):
        result = sandbox.run_python_code(RUNTIME_ERROR_CODE, workspace, "output_df")
        assert result["status"] == "error"

    def test_non_dataframe_output(self, sandbox, workspace):
        result = sandbox.run_python_code(NON_DF_OUTPUT, workspace, "output_df")
        assert result["status"] == "error"
        assert "not a DataFrame" in result["content"]

    def test_json_usage(self, sandbox, workspace):
        result = sandbox.run_python_code(MULTI_TABLE_TRANSFORM, workspace, "output_df")
        assert result["status"] == "ok"
        assert list(result["content"]["doubled"]) == [2, 4]

    def test_duckdb_sql(self, sandbox, workspace):
        code = """\
import pandas as pd
import duckdb
df = pd.DataFrame({"x": [1, 2, 3]})
output_df = duckdb.sql("SELECT x, x*10 AS x10 FROM df").df()
"""
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "ok"
        assert list(result["content"]["x10"]) == [10, 20, 30]


# ===================================================================
# DockerSandbox — missing Docker
# ===================================================================

class TestDockerSandboxNoDocker:
    """Verify graceful error when Docker is unavailable."""

    def test_missing_docker_returns_error(self, workspace, monkeypatch):
        """If 'docker' binary doesn't exist, run_python_code should return
        an error dict, not raise."""
        import subprocess as sp

        original_run = sp.run

        def fake_run(*args, **kwargs):
            raise FileNotFoundError("docker not found")

        monkeypatch.setattr(sp, "run", fake_run)

        sb = DockerSandbox()
        result = sb.run_python_code(SIMPLE_TRANSFORM, workspace, "output_df")
        assert result["status"] == "error"
        assert "not installed" in result["content"].lower() or "docker" in result["content"].lower()
