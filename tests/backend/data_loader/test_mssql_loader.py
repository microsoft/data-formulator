from __future__ import annotations

import threading
import time
from unittest import mock

import pytest

from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader


class FakeCursor:
    """Cursor that fails if another cursor is active on the same connection.

    mssql-python does not support MARS, so a connection accepts only one
    active statement at a time.
    """

    def __init__(self, conn):
        self._conn = conn
        self.description = None

    def execute(self, query):
        if self._conn.active:
            raise RuntimeError("Connection is busy with results for another command")
        self._conn.active = True
        self._conn.queries.append(query)
        time.sleep(self._conn.hold)
        return self

    def fetchall(self):
        return []

    def close(self):
        self._conn.active = False


class FakeConnection:
    def __init__(self, hold=0.0):
        self.active = False
        self.hold = hold
        self.queries: list[str] = []

    def cursor(self):
        return FakeCursor(self)


def build_loader(params=None, conn=None):
    conn = conn if conn is not None else FakeConnection()
    merged = {"server": "sql.example.net", "database": "appdb", "_auth_path": "entra_id"}
    merged.update(params or {})
    with mock.patch(
        "data_formulator.data_loader.mssql_data_loader.mssql_python.connect",
        return_value=conn,
    ) as connect:
        loader = MSSQLDataLoader(merged)
    return loader, connect


def test_blank_port_falls_back_to_default():
    """A saved connector spec can carry an empty string instead of no key."""
    _, connect = build_loader({"port": ""})

    assert "SERVER=sql.example.net,1433;" in connect.call_args.args[0]


@pytest.mark.parametrize(
    "param, expected",
    [
        ("encrypt", "Encrypt=yes;"),
        ("trust_server_certificate", "TrustServerCertificate=no;"),
    ],
)
def test_blank_connection_params_fall_back_to_defaults(param, expected):
    _, connect = build_loader({param: ""})

    assert expected in connect.call_args.args[0]


def test_blank_connection_timeout_falls_back_to_default():
    _, connect = build_loader({"connection_timeout": ""})

    assert connect.call_args.kwargs["timeout"] == 30


def test_read_sql_holds_the_lock_while_it_queries():
    conn = FakeConnection()
    loader, _ = build_loader(conn=conn)
    started = threading.Event()

    def run():
        started.set()
        loader._read_sql("SELECT 1")

    worker = threading.Thread(target=run)
    with loader._lock:
        worker.start()
        assert started.wait(timeout=5)
        # The lock is held here, so the worker cannot reach the connection.
        assert conn.queries == []

    worker.join(timeout=5)
    assert not worker.is_alive()
    assert conn.queries == ["SELECT 1"]


def test_concurrent_queries_do_not_collide():
    """Preview requests run on separate Flask threads but share one connection."""
    conn = FakeConnection(hold=0.01)
    loader, _ = build_loader(conn=conn)
    errors: list[Exception] = []

    def run():
        try:
            loader._read_sql("SELECT 1")
        except Exception as exc:  # pragma: no cover - regression path
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert errors == []
    assert len(conn.queries) == 8
