"""Warm worker pool: prewarming starts workers in the background and acquire claims them."""

import threading
import time

import pytest

from data_formulator.sandbox import local_sandbox
from data_formulator.sandbox.local_sandbox import SandboxSession, _WarmWorkerPool


class _Proc:
    def __init__(self):
        self.alive = True
        self.pid = 0
        self.exitcode = None

    def is_alive(self):
        return self.alive

    def terminate(self):
        self.alive = False

    def kill(self):
        self.alive = False

    def join(self, timeout=None):
        pass


class _Conn:
    def send(self, message):
        pass

    def poll(self, timeout=0.0):
        return True

    def recv(self):
        return {"status": "ok"}

    def close(self):
        pass


@pytest.fixture
def pool(monkeypatch):
    pool = _WarmWorkerPool(size=2)
    spawned = []
    gate = threading.Event()

    def spawn(workspace_path=None):
        gate.wait(5)
        pair = (_Proc(), _Conn())
        spawned.append(pair)
        return pair

    monkeypatch.setattr(pool, "_spawn", spawn)
    monkeypatch.setattr(pool, "_key", lambda workspace_path: workspace_path)
    pool.spawned, pool.gate = spawned, gate
    yield pool
    pool.gate.set()
    pool.shutdown()


def _wait_until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline
        time.sleep(0.01)


def test_prewarm_returns_immediately_and_fills_the_pool(pool):
    started = time.monotonic()
    pool.prewarm("/ws/a")
    assert time.monotonic() - started < 0.5
    pool.gate.set()
    _wait_until(lambda: len(pool._available.get("/ws/a", [])) == 2)
    assert len(pool.spawned) == 2


def test_prewarm_does_not_start_more_than_needed(pool):
    pool.prewarm("/ws/a")
    pool.prewarm("/ws/a")
    pool.gate.set()
    _wait_until(lambda: len(pool._available.get("/ws/a", [])) == 2)
    pool.prewarm("/ws/a")
    time.sleep(0.05)
    assert len(pool.spawned) == 2


def test_acquire_claims_a_starting_worker_instead_of_spawning_another(pool):
    pool.prewarm("/ws/a", count=1)
    result = {}
    thread = threading.Thread(target=lambda: result.setdefault("pair", pool.acquire("/ws/a")))
    thread.start()
    time.sleep(0.05)
    assert "pair" not in result
    pool.gate.set()
    thread.join(5)
    assert result["pair"] is pool.spawned[0]
    assert len(pool.spawned) == 1
    assert pool._available.get("/ws/a", []) == []


def test_workers_started_for_an_evicted_workspace_are_discarded(pool):
    pool.prewarm("/ws/a", count=1)
    for name in ("/ws/b", "/ws/c", "/ws/d"):
        pool.prewarm(name, count=0)
    pool.gate.set()
    _wait_until(lambda: len(pool.spawned) == 1 and not pool._pending.get("/ws/a"))
    assert "/ws/a" not in pool._available
    assert not pool.spawned[0][0].alive


def test_session_with_a_workspace_does_not_block_on_a_cold_start(pool, monkeypatch):
    monkeypatch.setattr(local_sandbox, "_worker_pool", pool)
    started = time.monotonic()
    session = SandboxSession("/ws/a")
    assert time.monotonic() - started < 0.5
    assert session._conn is None
    pool.gate.set()
    assert session.execute("_pack = 1", {"_pack": None}, "/ws/a")["status"] == "ok"
    session.close()
    assert len(pool.spawned) == 1
    assert len(pool._available["/ws/a"]) == 1


def test_used_idle_workers_beyond_the_cap_are_discarded_oldest_first(pool, monkeypatch):
    # Each isolated worker is a separate ~200 MB interpreter; multi-user servers keep few idle.
    monkeypatch.setattr(pool, "_idle_limits", lambda: (600.0, 2))
    pool.gate.set()
    pairs = [pool.acquire(name) for name in ("/ws/a", "/ws/b", "/ws/c")]
    for pair in pairs:
        pool.release(*pair)
        time.sleep(0.01)
    assert [pair[0].alive for pair in pairs] == [False, True, True]
    assert sum(len(v) for v in pool._available.values()) == 2


def test_prewarmed_workers_are_not_counted_against_the_cap(pool, monkeypatch):
    monkeypatch.setattr(pool, "_idle_limits", lambda: (600.0, 0))
    pool.prewarm("/ws/a", count=2)
    pool.gate.set()
    _wait_until(lambda: len(pool._available.get("/ws/a", [])) == 2)
    used = pool.acquire("/ws/a")
    pool.release(*used)
    assert not used[0].alive  # a used worker over the cap goes
    assert len(pool._available["/ws/a"]) == 1 and pool._available["/ws/a"][0][0].alive


def test_idle_workers_expire(pool, monkeypatch):
    monkeypatch.setattr(pool, "_idle_limits", lambda: (0.05, None))
    pool.gate.set()
    pair = pool.acquire("/ws/a")
    pool.release(*pair)
    assert pair[0].alive
    time.sleep(0.1)
    with pool._lock:
        stale = pool._reap_locked()
    for proc, conn in stale:
        pool.discard(proc, conn)
    assert not pair[0].alive and pool._available["/ws/a"] == []
