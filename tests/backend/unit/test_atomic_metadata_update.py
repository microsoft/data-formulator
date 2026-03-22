"""Unit test for atomic metadata update (P2: concurrent lost-update race).

Regression: two concurrent uploads both read the same workspace.yaml,
each added one table, and the second write overwrote the first —
resulting in only one table surviving.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone

import pytest

from data_formulator.datalake.metadata import TableMetadata
from data_formulator.datalake.workspace import Workspace

pytestmark = [pytest.mark.backend]

N_THREADS = 8


def test_concurrent_add_table_no_lost_updates(tmp_path) -> None:
    """N threads each add one table; all N must survive in metadata."""
    ws = Workspace("test-user", root_dir=tmp_path)
    barrier = threading.Barrier(N_THREADS)
    errors: list[Exception] = []

    def _add(index: int) -> None:
        try:
            barrier.wait(timeout=5)
            table = TableMetadata(
                name=f"table_{index}",
                source_type="upload",
                filename=f"file_{index}.csv",
                file_type="csv",
                created_at=datetime.now(timezone.utc),
            )
            ws.add_table_metadata(table)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=_add, args=(i,)) for i in range(N_THREADS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, f"Threads raised: {errors}"
    tables = ws.list_tables()
    assert len(tables) == N_THREADS, (
        f"Expected {N_THREADS} tables but found {len(tables)}: {tables}"
    )
