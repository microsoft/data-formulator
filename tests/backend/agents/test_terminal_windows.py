"""Terminal commands on Windows: run in WSL, sandboxed by Bubblewrap there when it is installed.

These run on any OS; Windows itself is simulated (``sys.platform``, ``wsl.exe`` and its probes)."""

from __future__ import annotations

import importlib
import subprocess
import sys
import types

import pytest

from data_formulator.analyst import process_io
from data_formulator.sandbox import wsl

terminal = importlib.import_module("data_formulator.analyst.skills.terminal.skill")
pytestmark = [pytest.mark.backend]

WSL = r"C:\Windows\System32\wsl.exe"
SANDBOX = wsl.WslSandbox(bwrap="/usr/bin/bwrap", home="/home/me", interop=True)
CACHED = (wsl.wsl_ready, wsl.wsl_sandbox)


@pytest.fixture(autouse=True)
def terminal_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "config"))
    monkeypatch.delenv("DF_TERMINAL_MODE", raising=False)
    for check in CACHED:
        check.cache_clear()
    yield
    for check in CACHED:
        check.cache_clear()


def windows(monkeypatch, *, host: str | None = WSL, sandbox: wsl.WslSandbox | None = SANDBOX) -> None:
    monkeypatch.setattr(terminal.sys, "platform", "win32")
    monkeypatch.setattr(wsl, "wsl_host", lambda: host)
    monkeypatch.setattr(wsl, "wsl_sandbox", lambda executable: sandbox)


@pytest.mark.parametrize("path,expected", [
    (r"C:\Users\me\data", "/mnt/c/Users/me/data"),
    (r"d:\scratch dir\x.csv", "/mnt/d/scratch dir/x.csv"),
    ("C:\\", "/mnt/c"),
])
def test_windows_paths_map_to_wsl_mounts(path, expected):
    assert wsl.to_wsl_path(path) == expected


@pytest.mark.parametrize("path", [r"\\server\share\data", r"C:relative", "relative"])
def test_paths_wsl_cannot_reach_are_refused(path):
    with pytest.raises(OSError, match="not on a local drive"):
        wsl.to_wsl_path(path)


def test_wsl_receives_df_variables_with_paths_translated():
    shared = wsl.share_environment({"DF_SCRATCH_DIR": r"C:\s", "TMPDIR": r"C:\t", "HTTPS_PROXY": "http://proxy",
                                    "PATH": r"C:\Windows", "DF_PYTHON": r"C:\python.exe", "WSLENV": "EXISTING/u"})
    items = shared["WSLENV"].split(":")
    assert items[0] == "EXISTING/u"
    assert {"DF_SCRATCH_DIR/p", "TMPDIR/p", "HTTPS_PROXY"} <= set(items)
    # Windows-only values stay on the Windows side.
    assert not {"PATH", "PATH/p", "DF_PYTHON", "DF_PYTHON/p"} & set(items)


def test_wsl_detection_needs_a_distribution_and_a_working_bubblewrap(monkeypatch):
    monkeypatch.setattr(wsl.sys, "platform", "win32")
    calls = []

    def run(argv, timeout=60):
        calls.append(argv)
        if argv[-1] == "true":
            return types.SimpleNamespace(returncode=0, stdout="")
        return types.SimpleNamespace(returncode=0, stdout="/usr/bin/bwrap\n/home/me\nyes\n")
    monkeypatch.setattr(wsl, "_run", run)
    assert wsl.wsl_ready(WSL) is True
    assert wsl.wsl_sandbox(WSL) == SANDBOX
    assert wsl.wsl_sandbox(WSL) == SANDBOX
    assert len(calls) == 2  # cached: WSL starts once per check

    wsl.wsl_ready.cache_clear()
    wsl.wsl_sandbox.cache_clear()
    monkeypatch.setattr(wsl, "_run", lambda argv, timeout=60: types.SimpleNamespace(returncode=1, stdout=""))
    assert wsl.wsl_ready(WSL) is False
    assert wsl.wsl_sandbox(WSL) is None


def test_windows_host_and_install_hints(monkeypatch):
    windows(monkeypatch)
    assert terminal.terminal_host() == "wsl"
    assert terminal.terminal_sandbox() == "/usr/bin/bwrap"
    assert terminal.sandbox_install_hint() is None

    windows(monkeypatch, sandbox=None)
    assert terminal.terminal_sandbox() is None
    assert "inside WSL" in terminal.sandbox_install_hint()
    assert "sudo apt install bubblewrap" in terminal.sandbox_install_hint()

    windows(monkeypatch, host=None, sandbox=None)
    assert terminal.terminal_host() == "windows"
    assert "wsl --install" in terminal.sandbox_install_hint()


def test_windows_terminal_is_available_in_local_mode(monkeypatch):
    from data_formulator import configuration

    monkeypatch.setattr(configuration.sys, "platform", "win32")
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr(configuration, "user_connectors_disabled", lambda: False)
    assert configuration.terminal_available() is True


def test_sandboxed_wsl_command_confines_writes_and_blocks_windows_programs(monkeypatch):
    windows(monkeypatch)
    command = terminal._wsl_confined_command(["ls", "-la"], [r"C:\Users\me\scratch", r"C:\Users\me\.azure"],
                                              [r"C:\Users\me\.data_formulator\.vault_key"], default_policy=True)
    assert command[:3] == [WSL, "-e", "/usr/bin/bwrap"]
    assert command[command.index("--ro-bind") + 1:command.index("--ro-bind") + 3] == ["/", "/"]
    assert ["--bind", "/mnt/c/Users/me/scratch", "/mnt/c/Users/me/scratch"] == command[
        command.index("/mnt/c/Users/me/scratch") - 1:command.index("/mnt/c/Users/me/scratch") + 2]
    # CLI state inside WSL stays writable when present.
    assert ["--bind-try", "/home/me/.azure", "/home/me/.azure"] == command[
        command.index("/home/me/.azure") - 1:command.index("/home/me/.azure") + 2]
    assert ["--ro-bind-try", "/dev/null", "/mnt/c/Users/me/.data_formulator/.vault_key"] == command[
        command.index("/mnt/c/Users/me/.data_formulator/.vault_key") - 2:command.index("/mnt/c/Users/me/.data_formulator/.vault_key") + 1]
    # Windows programs started from inside would run outside the sandbox.
    assert command[command.index("--tmpfs") + 1] == "/run/WSL"
    assert command[command.index("--unsetenv") + 1] == "WSL_INTEROP"
    assert command[-3:] == ["--", "ls", "-la"]

    command = terminal._wsl_confined_command(["ls"], [r"C:\s"], [], default_policy=False)
    assert "--bind-try" not in command


def test_sandboxed_wsl_command_refuses_without_bubblewrap(monkeypatch):
    windows(monkeypatch, sandbox=None)
    with pytest.raises(OSError, match="Bubblewrap inside WSL"):
        terminal._wsl_confined_command(["ls"], [r"C:\s"], [], default_policy=True)


def test_unsandboxed_commands_run_in_wsl_when_present_else_natively(tmp_path, monkeypatch):
    approved = {"argv": ["ls"], "cwd": str(tmp_path), "dangerouslyDisableSandbox": True, "decision": "approve",
                "sandboxDisablingReason": "No sandbox is installed."}
    windows(monkeypatch, sandbox=None)
    argv, environment, policy = terminal.prepare_command(approved, scratch_dir=tmp_path, runtime_dir=tmp_path)
    assert argv == [WSL, "-e", "ls"] and policy is None
    assert "DF_SCRATCH_DIR/p" in environment["WSLENV"].split(":")

    windows(monkeypatch, host=None, sandbox=None)
    argv, environment, _ = terminal.prepare_command({**approved, "argv": ["powershell", "-Command", "Get-ChildItem"]},
                                                     scratch_dir=tmp_path, runtime_dir=tmp_path)
    assert argv == ["powershell", "-Command", "Get-ChildItem"]
    assert "WSLENV" not in environment


def test_windows_without_wsl_requires_approval_for_every_command(tmp_path, monkeypatch):
    windows(monkeypatch, host=None, sandbox=None)
    proposal = terminal.TerminalRequests().propose("local:user", "conversation",
                                                   {"argv": ["powershell", "-Command", "dir"], "cwd": str(tmp_path),
                                                    "purpose": "List files"}, mode="auto")
    assert proposal["dangerouslyDisableSandbox"] is True
    assert proposal["sandboxUnavailable"] is True
    assert "wsl --install" in proposal["sandboxInstallHint"]


@pytest.mark.parametrize("host,sandbox,expected,unexpected", [
    (WSL, SANDBOX, "/mnt/<drive letter>", "No sandbox is installed"),
    (WSL, None, "No sandbox is installed", "powershell"),
    (None, None, "powershell -NoProfile", "/mnt/<drive letter>"),
])
def test_agent_is_told_where_commands_run(monkeypatch, host, sandbox, expected, unexpected):
    from data_formulator.analyst.skills import build_registry

    registry = build_registry()  # before simulating Windows: some connector libraries probe the real OS on import
    windows(monkeypatch, host=host, sandbox=sandbox)
    body = registry.with_terminal_policy("ask").load_body("terminal")
    assert expected in body and unexpected not in body
    assert "{terminal_policy}" not in body


# -- process helpers on Windows (simulated) ------------------------------------------------------

def test_windows_pipe_reader_thread_returns_output_and_end(monkeypatch):
    monkeypatch.setattr(process_io, "WINDOWS", True)
    process = subprocess.Popen([sys.executable, "-c", "print('hello'); print('world')"], stdout=subprocess.PIPE)
    pipe = process_io.OutputPipe(process.stdout)
    output = b""
    for _ in range(80):
        output += b"".join(pipe.read(0.25))
        if not pipe.open:
            break
    process.wait()
    pipe.close()
    assert not pipe.open
    assert output.replace(b"\r\n", b"\n") == b"hello\nworld\n"


def test_windows_spawn_uses_a_new_process_group(monkeypatch):
    monkeypatch.setattr(process_io, "WINDOWS", True)
    monkeypatch.setattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200, raising=False)
    seen = {}
    monkeypatch.setattr(subprocess, "Popen", lambda argv, **kwargs: seen.update(argv=argv, **kwargs))
    process_io.spawn(["cmd"], cwd="C:\\", env={})
    assert seen["creationflags"] == 0x200 and "start_new_session" not in seen
    assert seen["stdin"] is subprocess.DEVNULL and seen["stderr"] is subprocess.STDOUT


def test_windows_kill_ends_the_process_tree(monkeypatch):
    monkeypatch.setattr(process_io, "WINDOWS", True)
    runs = []
    monkeypatch.setattr(subprocess, "run", lambda argv, **kwargs: runs.append(argv))
    process = types.SimpleNamespace(pid=4242, poll=lambda: 0, kill=lambda: runs.append("kill"))
    process_io.kill_tree(process)
    assert runs == [["taskkill", "/T", "/F", "/PID", "4242"]]
