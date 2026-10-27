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

pytestmark = [pytest.mark.slow, pytest.mark.backend]


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
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr(confinement, "shared_read_roots", lambda: [os.path.realpath(tmp_path / "users")])
    assert confinement.worker_key(str(tmp_path / "users" / "me" / "workspaces" / "a")) == confinement.SHARED
    assert confinement.worker_key(str(tmp_path / "linked")) == os.path.realpath(tmp_path / "linked")
    assert confinement.worker_key(None) == ""


def test_multi_user_servers_dedicate_a_worker_to_each_workspace(tmp_path, monkeypatch):
    # DuckDB and pyarrow open files natively, past the audit hook, so a worker
    # shared between visitors could read the other visitors' workspaces.
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: False)
    monkeypatch.setattr(confinement, "shared_read_roots", lambda: [os.path.realpath(tmp_path / "sites")])
    visitor = tmp_path / "sites" / "unesco" / "users" / "visitor" / "workspaces" / "a"
    assert confinement.worker_key(str(visitor)) == os.path.realpath(visitor)
    command = confinement.confined_worker_command("bwrap", confinement.worker_key(str(visitor)), "/tmp/w", 5, 6)
    assert os.path.realpath(visitor) in command and os.path.realpath(tmp_path / "sites") not in command


def test_bwrap_can_skip_proc_where_containers_forbid_mounting_it():
    assert "--proc" in confinement.bwrap_prefix([], "/tmp/w")
    without = confinement.bwrap_prefix([], "/tmp/w", mount_proc=False)
    assert "--proc" not in without and "/proc" not in without


def test_bwrap_workers_survive_the_thread_that_prewarmed_them():
    # Linux sends --die-with-parent's signal when the spawning thread exits.
    assert "--die-with-parent" not in confinement.bwrap_prefix([], "/tmp/w")


def _fake_binary(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\nexit 0\n")
    path.chmod(0o644)  # as a zip built on Windows leaves it
    return path


def test_bwrap_is_found_from_setting_then_path_then_bundle(tmp_path, monkeypatch):
    bundled = _fake_binary(tmp_path / "pkg" / "bin" / "bwrap")
    monkeypatch.setattr(confinement, "BUNDLED_BWRAP", bundled)
    monkeypatch.delenv("DF_SANDBOX_BWRAP", raising=False)
    monkeypatch.setattr(confinement.shutil, "which", lambda name: None)
    assert confinement.bwrap_executable() == str(bundled)
    assert os.access(bundled, os.X_OK)  # the executable bit is restored
    on_path = _fake_binary(tmp_path / "usr" / "bin" / "bwrap")
    on_path.chmod(0o755)
    monkeypatch.setattr(confinement.shutil, "which", lambda name: str(on_path))
    assert confinement.bwrap_executable() == str(on_path)
    configured = _fake_binary(tmp_path / "opt" / "bwrap")
    monkeypatch.setenv("DF_SANDBOX_BWRAP", str(configured))
    assert confinement.bwrap_executable() == str(configured)
    monkeypatch.setenv("DF_SANDBOX_BWRAP", str(tmp_path / "missing"))
    assert confinement.bwrap_executable() is None


def test_unusable_bwrap_means_no_confinement(tmp_path, monkeypatch):
    monkeypatch.setattr(confinement.sys, "platform", "linux")
    monkeypatch.setattr(confinement, "bwrap_executable", lambda: "/usr/bin/bwrap")
    monkeypatch.setattr(confinement, "bwrap_usable", lambda path: False)
    assert confinement.confinement_kind() is None
    assert "cannot create a sandbox" in confinement.describe()


def test_required_os_sandbox_refuses_to_fall_back(tmp_path, monkeypatch):
    monkeypatch.setenv("DF_REQUIRE_OS_SANDBOX", "1")
    pool = local_sandbox._WarmWorkerPool()
    monkeypatch.setattr(pool, "_confinement", lambda: None)
    with pytest.raises(RuntimeError, match="requires OS isolation"):
        pool.acquire(str(tmp_path))
    pool.shutdown()


def test_plain_worker_command_has_no_os_sandbox():
    command = confinement.confined_worker_command(None, "", "/tmp", 5, 6)
    assert command == [os.sys.executable, "-I", "-m", "data_formulator.sandbox.confined_worker", "5", "6", "0"]


def test_demo_site_workspaces_share_the_worker(tmp_path, monkeypatch):
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    (tmp_path / "users").mkdir()
    roots = confinement.shared_read_roots()
    # The sites folder exists before any demo session, so a worker started now can read later ones.
    assert os.path.realpath(tmp_path / "sites") in roots
    site_workspace = tmp_path / "sites" / "unesco" / "users" / "visitor" / "workspaces" / "a"
    assert confinement.worker_key(str(site_workspace)) == confinement.SHARED
    assert confinement.worker_key(str(tmp_path / "credentials")) != confinement.SHARED


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


@pytest.mark.skipif(os.name != "posix", reason="clean workers inherit POSIX pipe descriptors")
def test_unconfined_worker_is_a_fresh_interpreter_without_server_state(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-server-secret")
    import data_formulator.model_registry  # noqa: F401  (server state the worker must not inherit)
    pool = local_sandbox._WarmWorkerPool()
    monkeypatch.setattr(pool, "_confinement", lambda: None)
    proc, conn = pool.acquire(str(tmp_path))
    try:
        assert isinstance(proc, local_sandbox._ConfinedProcess)
        conn.send(("import os, sys\nout = (os.environ.get('OPENAI_API_KEY'),"
                   " 'data_formulator.model_registry' in sys.modules, 'data_formulator.app' in sys.modules)",
                   {"out": None}, str(tmp_path)))
        assert conn.poll(60) and conn.recv()["allowed_objects"]["out"] == (None, False, False)
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
