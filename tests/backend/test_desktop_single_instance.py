from __future__ import annotations

import socket
import threading

import pytest

from data_formulator import desktop


pytestmark = [pytest.mark.backend]


def test_second_instance_signals_primary(monkeypatch):
    monkeypatch.setattr(desktop, "_INSTANCE_PORT", 0)
    coordinator = desktop._claim_single_instance()
    assert coordinator is not None
    monkeypatch.setattr(desktop, "_INSTANCE_PORT", coordinator.getsockname()[1])

    activated = threading.Event()
    listener = threading.Thread(
        target=desktop._listen_for_activation,
        args=(coordinator, activated),
        daemon=True,
    )
    listener.start()
    try:
        assert desktop._claim_single_instance() is None
        assert activated.wait(1)
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