from __future__ import annotations

import socket
import subprocess
import sys
import threading

import pytest

from data_formulator import desktop


pytestmark = [pytest.mark.backend]


@pytest.fixture(autouse=True)
def isolated_desktop_home(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    monkeypatch.setattr(desktop, "_INSTANCE_PORT", 0)


def test_second_instance_signals_primary(monkeypatch):
    coordinator = desktop._claim_single_instance()
    assert coordinator is not None
    try:
        assert desktop._claim_single_instance() is None
        assert coordinator.activate.wait(1)
    finally:
        coordinator.close()


def test_unrelated_port_occupant_is_not_treated_as_existing_instance(monkeypatch):
    occupant = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    occupant.bind((desktop._INSTANCE_HOST, 0))
    occupant.listen(1)
    monkeypatch.setattr(desktop, "_INSTANCE_PORT", occupant.getsockname()[1])
    monkeypatch.setattr(desktop, "_signal_existing_instance", lambda: False)
    try:
        with pytest.raises(RuntimeError, match="coordination port"):
            desktop._claim_single_instance()
    finally:
        occupant.close()


def test_activate_window_restores_and_shows_window():
    calls: list[str] = []

    class Window:
        def restore(self):
            calls.append("restore")

        def show(self):
            calls.append("show")

    activate = threading.Event()
    worker = threading.Thread(
        target=desktop._activate_window,
        args=(Window(), activate),
        daemon=True,
    )
    worker.start()
    activate.set()

    for _ in range(100):
        if calls == ["restore", "show"]:
            break
        threading.Event().wait(0.01)
    assert calls == ["restore", "show"]


def test_coordination_permission_error_is_not_reported_as_port_in_use(monkeypatch):
    from unittest.mock import MagicMock

    coordinator = MagicMock()
    coordinator.bind.side_effect = PermissionError(13, "Access denied")
    monkeypatch.setattr(desktop.socket, "socket", lambda *args: coordinator)
    monkeypatch.setattr(desktop, "_signal_existing_instance", lambda: False)

    with pytest.raises(RuntimeError, match="Access denied"):
        desktop._claim_single_instance()
    coordinator.close.assert_called_once()


def test_stale_port_file_does_not_block_launch():
    (desktop._instance_directory() / "port").write_text("49731", encoding="ascii")
    coordinator = desktop._claim_single_instance()
    assert coordinator is not None
    try:
        assert int((desktop._instance_directory() / "port").read_text()) == coordinator.listener.getsockname()[1]
    finally:
        coordinator.close()


def test_close_releases_ownership():
    first = desktop._claim_single_instance()
    first.close()
    second = desktop._claim_single_instance()
    assert second is not None
    second.close()


def test_separate_data_homes_can_launch_independently(tmp_path, monkeypatch):
    first = desktop._claim_single_instance()
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "other-user"))
    second = desktop._claim_single_instance()
    try:
        assert first is not None
        assert second is not None
    finally:
        first.close()
        second.close()


def test_another_process_activates_primary():
    coordinator = desktop._claim_single_instance()
    try:
        subprocess.run(
            [sys.executable, "-c",
             "from data_formulator.desktop import _claim_single_instance; "
             "assert _claim_single_instance() is None"],
            check=True, capture_output=True, timeout=10,
        )
        assert coordinator.activate.wait(1)
    finally:
        coordinator.close()


def test_abrupt_process_exit_releases_ownership():
    subprocess.run(
        [sys.executable, "-c",
         "import os; from data_formulator.desktop import _claim_single_instance; "
         "coordinator = _claim_single_instance(); assert coordinator is not None; os._exit(0)"],
        check=True, capture_output=True, timeout=10,
    )
    coordinator = desktop._claim_single_instance()
    assert coordinator is not None
    coordinator.close()


def test_waiting_launcher_recovers_when_primary_exits(monkeypatch):
    from filelock import FileLock

    primary_lock = FileLock(desktop._instance_directory() / "instance.lock")
    primary_lock.acquire(timeout=0)

    def primary_exits(timeout):
        primary_lock.release()
        return False

    monkeypatch.setattr(desktop, "_signal_existing_instance", primary_exits)
    coordinator = desktop._claim_single_instance()
    assert coordinator is not None
    coordinator.close()


def test_socket_creation_failure_releases_ownership(monkeypatch):
    from filelock import FileLock
    from unittest.mock import Mock

    monkeypatch.setattr(desktop.socket, "socket", Mock(side_effect=OSError("No sockets available")))
    with pytest.raises(RuntimeError, match="No sockets available"):
        desktop._claim_single_instance()
    with FileLock(desktop._instance_directory() / "instance.lock", timeout=0):
        pass