import importlib.util
import json
import os
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


def test_desktop_process_failure_keeps_log(tmp_path):
    log = tmp_path / "failed.log"
    with pytest.raises(RuntimeError, match="Desktop exited with 7"):
        desktop_test.run_process(
            [sys.executable, "-c", "print('failure detail'); raise SystemExit(7)"],
            os.environ.copy(), 30, log,
        )
    assert "failure detail" in log.read_text()