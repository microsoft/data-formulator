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
from data_formulator.sandbox import local_sandbox
from data_formulator.sandbox.docker_sandbox import docker_run_command

pytestmark = [pytest.mark.slow, pytest.mark.backend]

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


class TestLocalSandboxAuditRegressions:
    """Exercise the real audit-only worker, even on hosts with OS confinement."""

    @pytest.fixture
    def run_code(self, monkeypatch, workspace):
        pool = local_sandbox._WarmWorkerPool()
        monkeypatch.setattr(pool, "_confinement", lambda: None)
        monkeypatch.setattr(local_sandbox, "_worker_pool", pool)

        def run(code, workspace_path=workspace._path):
            return LocalSandbox._run_in_warm_subprocess(
                code, {"out": None}, workspace_path,
            )

        yield run
        pool.shutdown()

    @pytest.mark.parametrize("flags", [
        "os.O_WRONLY | os.O_CREAT",
        "os.O_RDWR",
        "os.O_RDONLY | os.O_TRUNC",
        "os.O_RDONLY | os.O_CREAT",
        "os.O_WRONLY | os.O_APPEND",
    ])
    def test_low_level_writes_denied(self, run_code, workspace, flags):
        target = os.path.join(workspace._path, "canary.txt")
        with open(target, "w") as stream:
            stream.write("unchanged")
        result = run_code(f"import os\nfd = os.open({target!r}, {flags})\nos.close(fd)")
        assert result["status"] == "error", result
        assert "file write forbidden" in result["error_message"]
        with open(target) as stream:
            assert stream.read() == "unchanged"

    @pytest.mark.parametrize("path_kind", [
        "absolute", "bytes", "relative",
        pytest.param("symlink", marks=pytest.mark.skipif(
            os.name == "nt", reason="Creating Windows symlinks requires extra privileges",
        )),
    ])
    def test_other_workspace_reads_denied(self, run_code, workspace, tmp_path, path_kind):
        sibling = tmp_path.parent / (tmp_path.name + "-sibling")
        sibling.mkdir()
        target = sibling / "canary.txt"
        target.write_text("controlled other-workspace data")
        try:
            path = str(target)
            if path_kind == "bytes":
                path = os.fsencode(path)
            elif path_kind == "symlink":
                link = tmp_path / "outside-link"
                link.symlink_to(target)
                path = str(link)
            elif path_kind == "relative":
                path = os.path.relpath(target, workspace._path)
            result = run_code(f"import os\nfd = os.open({path!r}, os.O_RDONLY)\nos.close(fd)")
            assert result["status"] == "error", result
            assert "file read" in result["error_message"]
        finally:
            target.unlink()
            sibling.rmdir()

    @pytest.mark.parametrize("api", ["open", "os.open"])
    def test_no_workspace_does_not_allow_arbitrary_reads(self, run_code, tmp_path, api):
        target = tmp_path / "canary.txt"
        target.write_text("controlled data")
        expression = f"open({str(target)!r}).close()" if api == "open" else (
            f"os.close(os.open({str(target)!r}, os.O_RDONLY))"
        )
        result = run_code("import os\n" + expression, workspace_path=None)
        assert result["status"] == "error", result
        assert "file read outside workspace" in result["error_message"]

    def test_workspace_reads_and_libraries_still_work(self, run_code, workspace):
        pd.DataFrame({"value": [10, 20]}).to_parquet(
            os.path.join(workspace._path, "sample.parquet"),
        )
        result = run_code("""\
import os
import pandas as pd
import duckdb
from sklearn.linear_model import LinearRegression
fd = os.open(os.fsencode(os.path.abspath("sample.csv")), os.O_RDONLY)
try:
    raw = os.read(fd, 4096)
finally:
    os.close(fd)
with open("sample.csv", "rb") as stream:
    assert raw == stream.read()
csv = pd.read_csv("sample.csv")
parquet = pd.read_parquet("sample.parquet")
assert csv.value.tolist() == parquet.value.tolist() == [10, 20]
model = LinearRegression().fit([[1], [2]], [10, 20])
assert round(model.predict([[3]])[0]) == 30
out = duckdb.sql("SELECT sum(value) AS total FROM csv").df()
""")
        assert result["status"] == "ok", result
        assert result["allowed_objects"]["out"]["total"].tolist() == [30]

    def test_relative_low_level_opens_denied(self, run_code):
        result = run_code("import os\nfd = os.open('sample.csv', os.O_RDONLY)\nos.close(fd)")
        assert result["status"] == "error", result
        assert "absolute path" in result["error_message"]

    @pytest.mark.skipif(os.open not in os.supports_dir_fd, reason="dir_fd is not supported")
    def test_dir_fd_relative_opens_denied(self, run_code, tmp_path):
        directory = tmp_path / "nested"
        directory.mkdir()
        (directory / "canary.txt").write_text("controlled data")
        result = run_code(
            f"import os\nparent = os.open({str(directory)!r}, os.O_RDONLY)\n"
            "try:\n"
            "    child = os.open('canary.txt', os.O_RDONLY, dir_fd=parent)\n"
            "    os.close(child)\n"
            "finally:\n"
            "    os.close(parent)\n"
        )
        assert result["status"] == "error", result
        assert "absolute path" in result["error_message"]

    def test_descriptor_opens_denied(self, run_code):
        result = run_code("""\
import os
fd = os.open(os.path.abspath("sample.csv"), os.O_RDONLY)
try:
    open(fd, "rb", closefd=False).close()
finally:
    os.close(fd)
""")
        assert result["status"] == "error", result
        assert "unverified descriptor" in result["error_message"]

    @pytest.mark.parametrize("mode, flags", [
        ("'r'", "os.O_WRONLY"),
        ("'r'", "os.O_RDWR"),
        ("None", "None"),
        ("'w'", "os.O_RDONLY"),
        ("42", "os.O_RDONLY"),
        pytest.param("None", "os.O_TMPFILE", marks=pytest.mark.skipif(
            not hasattr(os, "O_TMPFILE"), reason="O_TMPFILE is Linux-specific",
        )),
    ])
    def test_open_flags_checked_independently_of_mode(self, run_code, mode, flags):
        result = run_code(
            f"import os, sys\nsys.audit('open', os.path.abspath('sample.csv'), {mode}, {flags})"
        )
        assert result["status"] == "error", result
        assert "file write forbidden" in result["error_message"]

    def test_persistent_session_can_read_workspace_across_calls(self, run_code, workspace):
        pd.DataFrame({"value": [10, 20]}).to_parquet(
            os.path.join(workspace._path, "sample.parquet"),
        )
        with local_sandbox.SandboxSession(workspace._path) as session:
            first = session.execute(
                "import pandas as pd\ndf = pd.read_csv('sample.csv')\nout = len(df)",
                {"out": None}, workspace._path,
            )
            assert first["status"] == "ok", first
            assert first["allowed_objects"]["out"] == 2
            second = session.execute(
                "other = pd.read_parquet('sample.parquet')\n"
                "out = int(df.value.sum() + other.value.sum())",
                {"out": None}, workspace._path,
            )
            assert second["status"] == "ok", second
            assert second["allowed_objects"]["out"] == 60

    def test_uncached_private_subprocess_import_denied(self, run_code):
        result = run_code(
            "import sys\nsys.modules.pop('_posixsubprocess', None)\nimport _posixsubprocess"
        )
        assert result["status"] == "error", result
        assert "import of '_posixsubprocess' is forbidden" in result["error_message"]

    @pytest.mark.parametrize("event", [
        "os.posix_spawn", "os.posix_spawnp", "os.forkpty",
        "os.exec", "os.spawn", "os.fork", "_posixsubprocess.fork_exec",
    ])
    def test_process_events_denied_without_spawning(self, run_code, event):
        result = run_code(f"import sys\nsys.audit({event!r})")
        assert result["status"] == "error", result
        assert "forbidden" in result["error_message"]

    @pytest.mark.parametrize("module, attribute", [
        ("_posixsubprocess", "fork_exec"),
        ("subprocess", "_fork_exec"),
    ])
    @pytest.mark.skipif(os.name != "posix", reason="POSIX process aliases")
    def test_cached_process_aliases_denied(self, run_code, module, attribute):
        # No arguments: an unguarded native function only raises TypeError;
        # it cannot spawn a process. The patched entry point must raise OSError.
        result = run_code(
            f"import sys\ngetattr(sys.modules[{module!r}], {attribute!r})()"
        )
        assert result["status"] == "error", result
        assert "OSError" in result["error_message"]
        assert "forbidden" in result["error_message"]


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


def test_docker_command_is_confined():
    command = docker_run_command("img", "/ws", "/out", "/run.py")
    joined = " ".join(command)
    for flag in ("--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges",
                 "--memory 512m", "--pids-limit 256", "/ws:/sandbox/workdir:ro", "/out:/sandbox/outputs:rw"):
        assert flag in joined
    assert command[command.index("--tmpfs") + 1].startswith("/tmp:")
    assert command[-3:] == ["img", "python", "/sandbox/run.py"]


@skip_no_docker
class TestDockerSandboxConfinement:
    """The container has no network, an immutable root, and no privileges."""

    @pytest.fixture
    def sandbox(self):
        return DockerSandbox(timeout=120)

    def test_transform_still_works(self, sandbox, workspace):
        code = "import pandas as pd\noutput_df = pd.read_csv('sample.csv').assign(double=lambda d: d.value * 2)\n"
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "ok", result
        assert result["content"]["double"].tolist() == [20, 40]

    @pytest.mark.parametrize("code", [
        "import socket\nsocket.create_connection(('1.1.1.1', 80), timeout=3)\n",
        "import socket\nsocket.getaddrinfo('example.com', 443)\n",
        "open('/etc/evil', 'w').write('x')\n",
        "open('/usr/local/lib/evil.py', 'w').write('x')\n",
    ])
    def test_network_and_root_writes_fail(self, sandbox, workspace, code):
        result = sandbox.run_python_code(code + "import pandas as pd\noutput_df = pd.DataFrame()\n", workspace, "output_df")
        assert result["status"] == "error"

    def test_tmp_is_writable_but_private(self, sandbox, workspace):
        code = "import pandas as pd\nopen('/tmp/x', 'w').write('ok')\noutput_df = pd.DataFrame({'v': [open('/tmp/x').read()]})\n"
        result = sandbox.run_python_code(code, workspace, "output_df")
        assert result["status"] == "ok", result
        assert result["content"]["v"].tolist() == ["ok"]
