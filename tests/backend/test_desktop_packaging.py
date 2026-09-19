import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


pytestmark = [pytest.mark.backend]
PROJECT_ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("desktop_metadata", PROJECT_ROOT / "packaging/desktop_metadata.py")
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)
desktop_spec = importlib.util.spec_from_file_location("desktop_test", PROJECT_ROOT / "packaging/test_desktop.py")
desktop_test = importlib.util.module_from_spec(desktop_spec)
desktop_spec.loader.exec_module(desktop_test)


@pytest.mark.parametrize("version,expected", [
    ("0.8.0a2", "0.8.0.10002"),
    ("0.8.0b1", "0.8.0.20001"),
    ("0.8.0rc3", "0.8.0.30003"),
    ("0.8.0", "0.8.0.60000"),
    ("0.9", "0.9.0.60000"),
])
def test_release_versions(tmp_path, version, expected):
    project = tmp_path / "pyproject.toml"
    project.write_text(f'[project]\nversion = "{version}"\n')
    assert metadata.release_metadata(project)["windows_version"] == expected


@pytest.mark.parametrize("version", ["1.0.dev1", "1.0.post1", "1!1.0", "1.0+local", "1.2.3.4", "65536.0", "1.0a10000"])
def test_unsupported_release_versions(tmp_path, version):
    project = tmp_path / "pyproject.toml"
    project.write_text(f'[project]\nversion = "{version}"\n')
    with pytest.raises(ValueError):
        metadata.release_metadata(project)


def test_inventory_counts_without_following_symlinks(tmp_path):
    package = tmp_path / "package"
    package.mkdir()
    (package / "module.py").write_text("hello")
    (package / "data.json").write_text("{}")
    try:
        (tmp_path / "alias").symlink_to(package, target_is_directory=True)
    except OSError:
        pytest.skip("Creating symlinks requires permission on this host")
    result = metadata.bundle_inventory(tmp_path)
    assert result["files"] == 2
    assert result["bytes"] == 7
    assert result["symlinks"] == 1
    assert result["python_source_files"] == 1


def test_inventory_rejects_missing_bundle(tmp_path):
    with pytest.raises(ValueError):
        metadata.bundle_inventory(tmp_path / "missing")


def test_gui_readiness_requires_mounted_frontend():
    from data_formulator import desktop

    class Window:
        def __init__(self, result):
            self.result = result

        def evaluate_js(self, script):
            assert "desktop=1" in script
            assert "childElementCount" in script
            return self.result

    assert desktop._gui_is_ready(Window(True))
    assert not desktop._gui_is_ready(Window(False))
    assert not desktop._gui_is_ready(Window(None))


def test_gui_timeout_writes_failure(tmp_path, monkeypatch):
    from data_formulator import desktop

    exit_codes = []
    monkeypatch.setattr(desktop.os, "_exit", exit_codes.append)
    report = tmp_path / "result.json"
    desktop._gui_test_timeout(str(report))
    assert json.loads(report.read_text())["passed"] is False
    assert exit_codes == [1]


def test_gui_success_writes_result(tmp_path, monkeypatch):
    from data_formulator import desktop

    monkeypatch.setattr(desktop, "_gui_is_ready", lambda window: True)
    exit_codes = []
    monkeypatch.setattr(desktop.os, "_exit", exit_codes.append)
    report = tmp_path / "result.json"
    desktop._monitor_gui_test(object(), str(report))
    assert json.loads(report.read_text())["passed"] is True
    assert exit_codes == [0]


def test_desktop_test_preserves_explicit_data_home(tmp_path, monkeypatch):
    executable = tmp_path / "app.exe"
    executable.touch()
    home = tmp_path / "retained-data"
    home.mkdir()
    sentinel = home / "workspace.txt"
    sentinel.write_text("keep")
    calls = []
    monkeypatch.setattr(desktop_test, "smoke_test", lambda exe, data, reports: calls.append((exe, data)))
    monkeypatch.setattr(sys, "argv", [
        "test_desktop.py", "--exe", str(executable),
        "--data-home", str(home), "--reports", str(tmp_path / "reports"),
    ])

    desktop_test.main()

    assert calls == [(executable.resolve(), home.resolve())]
    assert sentinel.read_text() == "keep"


def test_desktop_test_rejects_missing_explicit_data_home(tmp_path, monkeypatch):
    executable = tmp_path / "app.exe"
    executable.touch()
    monkeypatch.setattr(sys, "argv", [
        "test_desktop.py", "--exe", str(executable),
        "--data-home", str(tmp_path / "missing"), "--reports", str(tmp_path / "reports"),
    ])
    with pytest.raises(RuntimeError, match="Test data directory does not exist"):
        desktop_test.main()


def test_desktop_test_cleans_default_data_home(tmp_path, monkeypatch):
    executable = tmp_path / "app.exe"
    executable.touch()
    homes = []
    monkeypatch.setattr(desktop_test, "smoke_test", lambda exe, home, reports: homes.append(home))
    monkeypatch.setattr(sys, "argv", [
        "test_desktop.py", "--exe", str(executable), "--reports", str(tmp_path / "reports"),
    ])

    desktop_test.main()

    assert len(homes) == 1
    assert not homes[0].exists()


@pytest.mark.parametrize("result", [None, False, True])
def test_smoke_test_requires_fresh_gui_success(tmp_path, monkeypatch, result):
    report = tmp_path / "gui-result.json"
    report.write_text('{"passed": true}')
    calls = []
    monkeypatch.setenv("DF_DESKTOP_GUI_TEST", "inherited")
    monkeypatch.setenv("DF_DESKTOP_SELF_TEST", "inherited")

    def fake_run(command, env, timeout, log):
        calls.append(env)
        if env.get("DF_DESKTOP_GUI_TEST") == "1":
            assert not report.exists()
            if result is not None:
                report.write_text(json.dumps({"passed": result}))

    monkeypatch.setattr(desktop_test, "run_process", fake_run)
    if result is True:
        desktop_test.smoke_test(tmp_path / "app.exe", tmp_path / "data", tmp_path)
    else:
        with pytest.raises(RuntimeError, match="GUI did not report success"):
            desktop_test.smoke_test(tmp_path / "app.exe", tmp_path / "data", tmp_path)
    assert "DF_DESKTOP_GUI_TEST" not in calls[0]
    assert "DF_DESKTOP_SELF_TEST" not in calls[1]

def test_headless_smoke_test_cannot_reuse_gui_success(tmp_path, monkeypatch):
    report = tmp_path / "gui-result.json"
    report.write_text('{"passed": true}')
    calls = []
    monkeypatch.setattr(desktop_test, "run_process", lambda command, env, timeout, log: calls.append(env))
    desktop_test.smoke_test(tmp_path / "app.exe", tmp_path / "data", tmp_path, headless=True)
    assert len(calls) == 1
    assert calls[0]["DF_DESKTOP_SELF_TEST"] == "1"
    result = json.loads(report.read_text())
    assert result["passed"] is False
    assert result["skipped"] is True


def test_headless_smoke_test_propagates_sandbox_failure(tmp_path, monkeypatch):
    def fail(command, env, timeout, log):
        raise RuntimeError("sandbox failed")

    monkeypatch.setattr(desktop_test, "run_process", fail)
    with pytest.raises(RuntimeError, match="sandbox failed"):
        desktop_test.smoke_test(tmp_path / "app.exe", tmp_path / "data", tmp_path, headless=True)


def test_desktop_process_failure_keeps_log(tmp_path):
    log = tmp_path / "failed.log"
    with pytest.raises(RuntimeError, match="Desktop exited with 7"):
        desktop_test.run_process(
            [sys.executable, "-c", "print('failure detail'); raise SystemExit(7)"],
            os.environ.copy(), 30, log,
        )
    assert "failure detail" in log.read_text()


@pytest.mark.skipif(sys.platform == "win32", reason="Exercises the macOS shell builder")
@pytest.mark.parametrize("failure,failures,verify_failure,attempts,succeeds", [
    ("Resource busy", 1, False, 2, True),
    ("Resource busy", 3, False, 3, False),
    ("Permission denied", 1, False, 1, False),
    ("", 0, True, 1, False),
])
def test_dmg_retries_only_resource_busy(tmp_path, failure, failures, verify_failure, attempts, succeeds):
    tools = tmp_path / "tools"
    tools.mkdir()
    commands = {
        "ditto": '#!/bin/bash\n/bin/cp -R "$1" "$2"\n',
        "sleep": "#!/bin/bash\nexit 0\n",
        "hdiutil": """#!/bin/bash
if [[ $1 == verify ]]; then exit "$VERIFY_FAILURE"; fi
count=0
if [[ -f "$ATTEMPTS_FILE" ]]; then read -r count < "$ATTEMPTS_FILE"; fi
count=$((count + 1))
printf '%s\\n' "$count" > "$ATTEMPTS_FILE"
for output in "$@"; do :; done
printf 'candidate' > "$output"
if [[ $count -le $FAILURES ]]; then
    printf 'hdiutil: create failed - %s\\n' "$FAILURE" >&2
    exit 1
fi
""",
    }
    for name, script in commands.items():
        tool = tools / name
        tool.write_text(script)
        tool.chmod(0o755)
    app = tmp_path / "Data Formulator.app"
    executable = app / "Contents" / "MacOS" / "Data Formulator"
    executable.parent.mkdir(parents=True)
    executable.touch()
    output = tmp_path / "release" / "candidate.dmg"
    attempts_file = tmp_path / "attempts"
    result = subprocess.run(
        ["bash", str(PROJECT_ROOT / "packaging/macos/build-dmg.sh"), str(app), str(output)],
        env={**os.environ, "PATH": f"{tools}{os.pathsep}{os.environ['PATH']}",
             "FAILURE": failure, "FAILURES": str(failures), "VERIFY_FAILURE": str(int(verify_failure)),
             "ATTEMPTS_FILE": str(attempts_file)},
        capture_output=True, text=True, timeout=30,
    )
    assert (result.returncode == 0) is succeeds, result.stderr
    assert int(attempts_file.read_text()) == attempts
    assert output.exists() is succeeds
    if failure and failures:
        assert failure in result.stderr


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="PowerShell 7 is required")
@pytest.mark.parametrize("prepare_outcome", ["prepare", "unexpected-error"])
def test_external_signing_phase_handoff(tmp_path, prepare_outcome):
    payload = tmp_path / "payload"
    payload.mkdir()
    (payload / "Data Formulator.exe").write_bytes(b"application")
    bootstrapper = tmp_path / "bootstrapper.exe"
    bootstrapper.touch()
    compiler = tmp_path / "compiler.ps1"
    compiler.write_text("""
$definitions = @{}
foreach ($argument in $args) {
    if ($argument.StartsWith('/D')) {
        $parts = $argument.Substring(2).Split('=', 2)
        $definitions[$parts[0]] = $parts[1]
    }
}
if ($env:FAKE_COMPILER_OUTCOME -ne 'assemble') {
    $file = Join-Path $definitions.ExternalUninstallerDir 'uninst-cache.exe'
    Set-Content -LiteralPath $file -Value 'uninstaller'
    if ($env:FAKE_COMPILER_OUTCOME -eq 'prepare') {
        Write-Output "Signed uninstaller mode is enabled. Sign $file and compile again"
    } else { Write-Output 'Unrelated compiler error' }
    exit 2
}
$file = Join-Path $definitions.OutputDir "Data-Formulator-$($definitions.AppVersion)-Windows-x64-Setup.exe"
Set-Content -LiteralPath $file -Value 'setup'
exit 0
""")
    script = """
$ErrorActionPreference = 'Stop'
function uv {
    Write-Output '{"version":"0.8.0b1","windows_version":"0.8.0.20001"}'
    $global:LASTEXITCODE = 0
}
function Get-AuthenticodeSignature {
    param([string]$LiteralPath)
    $status = if ($LiteralPath.EndsWith('uninst-cache.exe') -and $env:FAKE_CACHE_SIGNED -ne '1') { 'NotSigned' } else { 'Valid' }
    [pscustomobject]@{
        Status = $status
        SignerCertificate = [pscustomobject]@{ Subject = 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US' }
        TimeStamperCertificate = [pscustomobject]@{ Subject = 'CN=Timestamp' }
    }
}
$common = @{ PayloadDir=$env:PAYLOAD; OutputDir=$env:CANDIDATE; Compiler=$env:COMPILER; Bootstrapper=$env:BOOTSTRAPPER }
& $env:WRAPPER @common -SigningPhase PrepareUninstaller -SignedUninstallerDir $env:UNINSTALLER_CACHE
if (@(Get-ChildItem $env:CANDIDATE -Filter '*.sha256').Count) { throw 'Preparation emitted a release checksum' }
$env:FAKE_CACHE_SIGNED = '1'
$env:FAKE_COMPILER_OUTCOME = 'assemble'
& $env:WRAPPER @common -SigningPhase AssembleInstaller -SignedUninstallerDir $env:UNINSTALLER_CACHE
if (@(Get-ChildItem $env:CANDIDATE -Filter '*.sha256').Count) { throw 'Assembly emitted a release checksum' }
& $env:WRAPPER -PayloadDir $env:PAYLOAD -OutputDir $env:CANDIDATE -SigningPhase VerifyInstaller -Compiler 'missing-compiler'
"""
    output = tmp_path / "candidate"
    result = subprocess.run(
        ["pwsh", "-NoProfile", "-NonInteractive", "-Command", script],
        env={**os.environ, "WRAPPER": str(PROJECT_ROOT / "packaging/windows/build-installer.ps1"),
             "PAYLOAD": str(payload), "CANDIDATE": str(output), "COMPILER": str(compiler),
             "BOOTSTRAPPER": str(bootstrapper), "UNINSTALLER_CACHE": str(tmp_path / "cache"),
             "FAKE_COMPILER_OUTCOME": prepare_outcome, "FAKE_CACHE_SIGNED": "0"},
        capture_output=True, text=True, timeout=30,
    )
    if prepare_outcome == "unexpected-error":
        assert result.returncode != 0
        assert "Unexpected uninstaller preparation result" in result.stderr
        assert not list(output.glob("*.sha256"))
    else:
        assert result.returncode == 0, result.stdout + result.stderr
        manifests = list(output.glob("*.payload.json"))
        assert len(manifests) == 1
        manifest = json.loads(manifests[0].read_text(encoding="utf-8-sig"))
        assert manifest["version"] == "0.8.0.20001"
        assert {file["path"] for file in manifest["files"]} == {"Data Formulator.exe", ".data-formulator-payload"}
        assert len(list(output.glob("*.sha256"))) == 1
        assert (payload / "Data Formulator.exe").read_bytes() == b"application"