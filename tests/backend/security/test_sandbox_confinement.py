# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""OS confinement of the local Python sandbox's warm workers (sandbox/confinement.py)."""

import os
import socket
from contextlib import contextmanager

import pandas as pd
import pytest

from data_formulator.sandbox import confinement
from data_formulator.sandbox import local_sandbox
from data_formulator.sandbox.local_sandbox import LocalSandbox

pytestmark = [pytest.mark.backend]


class _Workspace:
    def __init__(self, path):
        self._path = str(path)

    @contextmanager
    def local_dir(self):
        yield self._path


def test_seatbelt_profile_allows_internet_but_not_loopback_or_secrets():
    profile = confinement.seatbelt_profile(["/py"], "/private/tmp/w", allow_network=True)
    assert profile.startswith("(version 1)(deny default)")
    assert '(subpath "/py")' in profile and '(allow file-write* (subpath "/private/tmp/w")' in profile
    assert '(deny network-outbound (remote ip "localhost:*"))' in profile
    assert "mDNSResponder" in profile
    for secret in (".vault_key", "credentials.db", "configuration.json", "/Users"):
        assert secret not in profile
    offline = confinement.seatbelt_profile(["/py"], "/private/tmp/w", allow_network=False)
    assert "network-outbound" not in offline and "system-socket" not in offline


def test_bwrap_has_no_network_and_binds_read_only():
    command = confinement.bwrap_prefix(["/venv"], "/tmp/w")
    assert "--unshare-all" in command and "--share-net" not in command
    assert ["--ro-bind-try", "/venv", "/venv"] == command[command.index("/venv") - 1:command.index("/venv") + 2]
    assert ["--bind", "/tmp/w", "/tmp/w"] == command[command.index("--bind"):command.index("--bind") + 3]
    assert not confinement.network_allowed("bwrap") and confinement.network_allowed("seatbelt")


def test_worker_command_isolates_the_interpreter(monkeypatch):
    monkeypatch.setattr(confinement, "shared_read_roots", lambda: ["/df/users"])
    command = confinement.confined_worker_command("seatbelt", confinement.SHARED, "/tmp", 5, 6)
    assert command[0] == confinement.SEATBELT and '(subpath "/df/users")' in command[2]
    assert command[3:6] == [os.sys.executable, "-I", "-m"] and command[-3:] == ["5", "6", "1"]
    linked = confinement.confined_worker_command("seatbelt", "/data/linked", "/tmp", 5, 6)
    assert '(subpath "/data/linked")' in linked[2] and "/df/users" not in linked[2]


def test_worker_keys_share_df_workspaces(tmp_path, monkeypatch):
    monkeypatch.setattr(confinement, "shared_read_roots", lambda: [os.path.realpath(tmp_path / "users")])
    assert confinement.worker_key(str(tmp_path / "users" / "me" / "workspaces" / "a")) == confinement.SHARED
    assert confinement.worker_key(str(tmp_path / "linked")) == os.path.realpath(tmp_path / "linked")
    assert confinement.worker_key(None) == ""


def test_worker_environment_drops_server_secrets(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    monkeypatch.setenv("CREDENTIAL_VAULT_KEY", "vault")
    environment = confinement.worker_environment("/tmp/w")
    assert "OPENAI_API_KEY" not in environment and "CREDENTIAL_VAULT_KEY" not in environment
    assert environment["HOME"] == environment["TMPDIR"] == "/tmp/w"


def test_confinement_can_be_disabled(monkeypatch):
    monkeypatch.setenv("DF_SANDBOX_OS_CONFINEMENT", "0")
    assert confinement.confinement_kind() is None


def test_frozen_desktop_builds_keep_the_audit_hook_worker(monkeypatch):
    monkeypatch.setattr(confinement.sys, "frozen", True, raising=False)
    assert confinement.confinement_kind() is None


def test_failed_confinement_falls_back_to_audit_hooks(tmp_path, monkeypatch, caplog):
    pool = local_sandbox._WarmWorkerPool()
    monkeypatch.setattr(pool, "_confinement", lambda: None if pool._confinement_failed else "seatbelt")

    def broken(kind, key):
        raise OSError("sandbox-exec missing")

    monkeypatch.setattr(local_sandbox, "_spawn_confined", broken)
    proc, conn = pool.acquire(str(tmp_path))
    try:
        assert pool._confinement_failed and "falling back" in caplog.text
        conn.send(("out = 1 + 1", {"out": None}, str(tmp_path)))
        assert conn.poll(60) and conn.recv()["allowed_objects"]["out"] == 2
    finally:
        pool.shutdown()


confined = pytest.mark.skipif(confinement.confinement_kind() != "seatbelt",
                              reason="macOS sandbox-exec confinement is not available")


@confined
class TestSeatbeltWorker:
    """Real workers under sandbox-exec: the OS, not only the audit hooks, enforces the policy."""

    @pytest.fixture
    def workspace(self, tmp_path):
        root = tmp_path / "ws"
        root.mkdir()
        (root / "sample.csv").write_text("name,value\nAlice,10\nBob,20\n")
        (tmp_path / "outside").mkdir()
        (tmp_path / "outside" / "secret.txt").write_text("secret")
        return _Workspace(root)

    def _run(self, workspace, code):
        return LocalSandbox().run_python_code(code + "\nimport pandas as pd\nout = pd.DataFrame({'ok': [1]})\n",
                                              workspace, "out")

    def test_transform_works(self, workspace):
        result = LocalSandbox().run_python_code(
            "import pandas as pd\nout = pd.read_csv('sample.csv').assign(double=lambda d: d.value * 2)\n",
            workspace, "out")
        assert result["status"] == "ok", result
        assert result["content"]["double"].tolist() == [20, 40]

    def test_reads_outside_the_workspace_are_denied_by_the_os(self, workspace):
        # listdir is not an "open" audit event, so only the OS sandbox stops it.
        result = self._run(workspace, "import os\nos.listdir(os.path.join(os.getcwd(), '..', 'outside'))")
        assert result["status"] == "error" and "Operation not permitted" in result["content"]

    def test_loopback_is_denied(self, workspace):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen()
        port = server.getsockname()[1]
        try:
            result = self._run(workspace, f"import socket\nsocket.create_connection(('127.0.0.1', {port}), timeout=3)")
        finally:
            server.close()
        assert result["status"] == "error" and "Operation not permitted" in result["content"]

    def test_writes_outside_the_private_directory_are_denied(self, workspace):
        result = self._run(workspace, "import os\nos.mkdir(os.path.join(os.getcwd(), 'made_by_code'))")
        assert result["status"] == "error"
        assert not os.path.exists(os.path.join(workspace._path, "made_by_code"))
