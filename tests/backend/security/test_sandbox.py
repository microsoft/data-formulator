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

from data_formulator.sandbox import LocalSandbox, DockerSandbox, SandboxSession, create_sandbox

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


# ===================================================================
# SandboxSession (namespace persistence)
# ===================================================================

class TestSandboxSession:
    """Tests for SandboxSession — persistent namespace across calls."""

    def test_variable_persists_across_calls(self, workspace):
        """Variables defined in call 1 are available in call 2."""
        with SandboxSession() as session:
            r1 = session.execute(
                "x = 42\n_pack = {'stdout': str(x)}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r1["status"] == "ok"
            assert r1["allowed_objects"]["_pack"]["stdout"] == "42"

            r2 = session.execute(
                "_pack = {'stdout': str(x * 2)}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r2["status"] == "ok"
            assert r2["allowed_objects"]["_pack"]["stdout"] == "84"

    def test_dataframe_persists(self, workspace):
        """A DataFrame created in call 1 can be used in call 2."""
        with SandboxSession() as session:
            r1 = session.execute(
                "import pandas as pd\ndf = pd.DataFrame({'a': [1,2,3]})\n_pack = None\n",
                {"_pack": None},
                workspace._path,
            )
            assert r1["status"] == "ok"

            r2 = session.execute(
                "_pack = {'stdout': str(len(df))}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r2["status"] == "ok"
            assert r2["allowed_objects"]["_pack"]["stdout"] == "3"

    def test_close_clears_namespace(self, workspace):
        """After close(), a new session does not see old variables."""
        session1 = SandboxSession()
        session1.execute("my_var = 999\n_pack = None\n", {"_pack": None}, workspace._path)
        session1.close()

        with SandboxSession() as session2:
            r = session2.execute(
                "import traceback as _tb\n"
                "try:\n"
                "    _pack = {'stdout': str(my_var)}\n"
                "except NameError:\n"
                "    _pack = {'stdout': 'NameError'}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r["status"] == "ok"
            assert r["allowed_objects"]["_pack"]["stdout"] == "NameError"

    def test_context_manager(self, workspace):
        """Session works as a context manager and cleans up on exit."""
        with SandboxSession() as session:
            r = session.execute("_pack = {'stdout': 'ok'}\n", {"_pack": None}, workspace._path)
            assert r["status"] == "ok"
        assert session._closed is True

    def test_error_does_not_break_session(self, workspace):
        """A runtime error in one call does not kill the session."""
        with SandboxSession() as session:
            session.execute("x = 10\n_pack = None\n", {"_pack": None}, workspace._path)

            r_err = session.execute("1 / 0\n", {"_pack": None}, workspace._path)
            assert r_err["status"] == "error"

            r_ok = session.execute(
                "_pack = {'stdout': str(x)}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r_ok["status"] == "ok"
            assert r_ok["allowed_objects"]["_pack"]["stdout"] == "10"

    def test_backward_compat_3tuple(self, workspace):
        """Existing LocalSandbox (3-tuple protocol) still works correctly."""
        sandbox = LocalSandbox()
        result = sandbox.run_python_code(SIMPLE_TRANSFORM, workspace, "output_df")
        assert result["status"] == "ok"
        assert len(result["content"]) == 3


# ===================================================================
# SandboxSession — cross-turn save / restore
# ===================================================================

class TestSandboxSessionSaveRestore:
    """Tests for save_namespace / restore_namespace (cross-turn persistence)."""

    def test_save_and_restore_dataframe(self, workspace, tmp_path):
        """DataFrames survive a save ➜ close ➜ new session ➜ restore cycle."""
        save_dir = tmp_path / "ns_save"

        with SandboxSession() as s1:
            s1.execute(
                "import pandas as pd\n"
                "df = pd.DataFrame({'x': [1,2,3], 'y': [4,5,6]})\n"
                "total = 42\n"
                "_pack = None\n",
                {"_pack": None},
                workspace._path,
            )
            saved = s1.save_namespace(save_dir, workspace._path)
            assert saved is True

        assert (save_dir / "_manifest.json").exists()
        assert (save_dir / "df.parquet").exists()

        with SandboxSession() as s2:
            ok = SandboxSession.restore_namespace(s2, save_dir, workspace._path)
            assert ok is True

            r = s2.execute(
                "_pack = {'rows': len(df), 'total': total}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r["status"] == "ok"
            assert r["allowed_objects"]["_pack"]["rows"] == 3
            assert r["allowed_objects"]["_pack"]["total"] == 42

    def test_save_scalars_only(self, workspace, tmp_path):
        """Save and restore work when there are only scalars (no DataFrames)."""
        save_dir = tmp_path / "ns_save"

        with SandboxSession() as s1:
            s1.execute(
                "count = 100\nname = 'test'\nflag = True\n_pack = None\n",
                {"_pack": None},
                workspace._path,
            )
            saved = s1.save_namespace(save_dir, workspace._path)
            assert saved is True

        with SandboxSession() as s2:
            SandboxSession.restore_namespace(s2, save_dir, workspace._path)
            r = s2.execute(
                "_pack = {'count': count, 'name': name, 'flag': flag}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r["status"] == "ok"
            pack = r["allowed_objects"]["_pack"]
            assert pack["count"] == 100
            assert pack["name"] == "test"
            assert pack["flag"] is True

    def test_save_empty_namespace_returns_false(self, workspace, tmp_path):
        """If no user variables exist, save_namespace returns False."""
        save_dir = tmp_path / "ns_save"
        with SandboxSession() as s:
            s.execute("_pack = None\n", {"_pack": None}, workspace._path)
            saved = s.save_namespace(save_dir, workspace._path)
            assert saved is False
        assert not save_dir.exists()

    def test_restore_missing_dir_returns_false(self, workspace, tmp_path):
        """restore_namespace returns False when save_dir doesn't exist."""
        with SandboxSession() as s:
            ok = SandboxSession.restore_namespace(s, tmp_path / "nonexistent", workspace._path)
            assert ok is False

    def test_restore_does_not_clobber_existing_vars(self, workspace, tmp_path):
        """Variables defined after restore co-exist with restored ones."""
        save_dir = tmp_path / "ns_save"

        with SandboxSession() as s1:
            s1.execute("a = 1\n_pack = None\n", {"_pack": None}, workspace._path)
            s1.save_namespace(save_dir, workspace._path)

        with SandboxSession() as s2:
            s2.execute("b = 2\n_pack = None\n", {"_pack": None}, workspace._path)
            SandboxSession.restore_namespace(s2, save_dir, workspace._path)
            r = s2.execute(
                "_pack = {'a': a, 'b': b}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r["status"] == "ok"
            assert r["allowed_objects"]["_pack"] == {"a": 1, "b": 2}

    def test_multiple_dataframes(self, workspace, tmp_path):
        """Multiple DataFrames are saved and restored independently."""
        save_dir = tmp_path / "ns_save"

        with SandboxSession() as s1:
            s1.execute(
                "import pandas as pd\n"
                "sales = pd.DataFrame({'sku': ['A','B'], 'qty': [10,20]})\n"
                "inventory = pd.DataFrame({'sku': ['A','B'], 'stock': [5,15]})\n"
                "_pack = None\n",
                {"_pack": None},
                workspace._path,
            )
            s1.save_namespace(save_dir, workspace._path)

        with SandboxSession() as s2:
            SandboxSession.restore_namespace(s2, save_dir, workspace._path)
            r = s2.execute(
                "_pack = {'sales_len': len(sales), 'inv_len': len(inventory)}\n",
                {"_pack": None},
                workspace._path,
            )
            assert r["status"] == "ok"
            pack = r["allowed_objects"]["_pack"]
            assert pack["sales_len"] == 2
            assert pack["inv_len"] == 2
