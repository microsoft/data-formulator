import os
from pathlib import Path
from threading import BoundedSemaphore, Event, Thread

import pyarrow as pa
import pytest

from data_formulator.data_operations import (
    ConnectorQueryStep,
    DataOperation,
    DataOperationExecutor,
    DataOperationPlan,
    DataOperationStatus,
    LoadQuery,
    LoadQueryOrder,
    OperationFilter,
)
from data_formulator.datalake.workspace import Workspace
from data_formulator.data_loader.query_runtime import execute_source_query, query_worker_scope
from data_formulator.data_loader import query_runtime


class _RemoteLoader:
    QUERY_EXECUTION = "remote_file_scan"

    def __init__(self, params=None):
        self.params = params or {}
        self.calls = 0

    def query_data_as_arrow(self):
        self.calls += 1
        return pa.table({"pid": [os.getpid()], "calls": [self.calls], "owner": [self.params.get("owner", "test")]})

    def fail(self):
        raise ValueError("Fixture query failure")

    def crash(self):
        os._exit(7)

    def block(self, marker):
        Path(marker).touch()
        Event().wait(60)


def test_query_worker_reuses_process_with_fresh_loaders_and_owned_results():
    with query_worker_scope(Event()) as worker:
        assert worker._process is None
        first = execute_source_query(_RemoteLoader({"owner": "first"}), "query_data_as_arrow")
        second = execute_source_query(_RemoteLoader({"owner": "second"}), "query_data_as_arrow")
        assert first.column("pid").to_pylist() == second.column("pid").to_pylist()
        assert first.column("pid")[0].as_py() != os.getpid()
        assert first.column("calls").to_pylist() == second.column("calls").to_pylist() == [1]
    assert worker._process is None
    assert first.column("owner").to_pylist() == ["first"]
    assert second.column("owner").to_pylist() == ["second"]


def test_query_worker_scopes_do_not_share_processes():
    with query_worker_scope(Event()) as outer:
        first = execute_source_query(_RemoteLoader(), "query_data_as_arrow")
        with query_worker_scope(Event()) as inner:
            second = execute_source_query(_RemoteLoader(), "query_data_as_arrow")
            assert first.column("pid").to_pylist() != second.column("pid").to_pylist()
        assert inner._process is None
        third = execute_source_query(_RemoteLoader(), "query_data_as_arrow")
        assert first.column("pid").to_pylist() == third.column("pid").to_pylist()
    assert outer._process is None


def test_query_worker_recovers_from_errors_and_native_exit():
    with query_worker_scope(Event()) as worker:
        first = execute_source_query(_RemoteLoader(), "query_data_as_arrow")
        with pytest.raises(RuntimeError, match="Fixture query failure"):
            execute_source_query(_RemoteLoader(), "fail")
        second = execute_source_query(_RemoteLoader(), "query_data_as_arrow")
        assert first.equals(second)
        with pytest.raises(RuntimeError, match="worker exited"):
            execute_source_query(_RemoteLoader(), "crash")
        assert worker._process is None
        third = execute_source_query(_RemoteLoader(), "query_data_as_arrow")
        assert first.column("pid").to_pylist() != third.column("pid").to_pylist()


def test_query_worker_cancellation_kills_read_and_releases_capacity(tmp_path, monkeypatch):
    slots = BoundedSemaphore(1)
    monkeypatch.setattr(query_runtime, "_worker_slots", slots)
    signal = Event()
    marker = tmp_path / "started"
    cancel_finished = Event()

    def cancel_when_reading():
        while not cancel_finished.wait(0.01):
            if marker.exists():
                signal.set()
                return

    with query_worker_scope(signal) as worker:
        execute_source_query(_RemoteLoader(), "query_data_as_arrow")
        watcher = Thread(target=cancel_when_reading)
        watcher.start()
        try:
            with pytest.raises(query_runtime.QueryCancelled):
                execute_source_query(_RemoteLoader(), "block", str(marker))
            assert worker._process is None
            assert slots.acquire(blocking=False)
            slots.release()
        finally:
            cancel_finished.set()
            watcher.join()


def test_query_worker_deadline_kills_read_and_releases_capacity(tmp_path, monkeypatch):
    slots = BoundedSemaphore(1)
    monkeypatch.setattr(query_runtime, "_worker_slots", slots)
    with query_worker_scope(Event()) as worker:
        execute_source_query(_RemoteLoader(), "query_data_as_arrow")
        monkeypatch.setattr(query_runtime, "_query_timeout", 0.2)
        with pytest.raises(TimeoutError, match="execution deadline"):
            execute_source_query(_RemoteLoader(), "block", str(tmp_path / "started"))
        assert worker._process is None
        assert slots.acquire(blocking=False)
        slots.release()


def test_query_worker_queue_is_bounded_and_cancellable(monkeypatch):
    slots = BoundedSemaphore(1)
    monkeypatch.setattr(query_runtime, "_worker_slots", slots)
    monkeypatch.setattr(query_runtime, "_queue_timeout", 0.1)
    slots.acquire()
    signal = Event()
    try:
        with query_worker_scope(signal) as worker:
            with pytest.raises(TimeoutError, match="waiting"):
                execute_source_query(_RemoteLoader(), "query_data_as_arrow")
            assert worker._process is None
            signal.set()
            with pytest.raises(query_runtime.QueryCancelled):
                execute_source_query(_RemoteLoader(), "query_data_as_arrow")
            assert not slots.acquire(blocking=False)
    finally:
        slots.release()


def test_query_worker_is_lazy_for_non_remote_calls_and_restores_context():
    loader = _RemoteLoader()
    loader.QUERY_EXECUTION = "service"
    with query_worker_scope(Event()) as worker:
        result = execute_source_query(loader, "query_data_as_arrow")
        assert result.column("pid").to_pylist() == [os.getpid()]
        assert worker._process is None
    assert query_runtime.cancellation.get() is None
    assert query_runtime._run_worker.get() is None


def test_query_worker_start_failure_releases_capacity(monkeypatch):
    from unittest.mock import Mock

    slots = BoundedSemaphore(1)
    monkeypatch.setattr(query_runtime, "_worker_slots", slots)
    context = Mock()
    parent, child = Mock(), Mock()
    context.Pipe.return_value = (parent, child)
    context.Process.return_value.pid = None
    context.Process.return_value.start.side_effect = RuntimeError("Spawn failed")
    monkeypatch.setattr(query_runtime, "get_context", lambda method: context)
    with query_worker_scope(Event()) as worker:
        with pytest.raises(RuntimeError, match="Spawn failed"):
            execute_source_query(_RemoteLoader(), "query_data_as_arrow")
        assert worker._process is None
        parent.close.assert_called_once()
        child.close.assert_called_once()
        assert slots.acquire(blocking=False)
        slots.release()


def test_stream_reuses_and_closes_query_worker_on_disconnect():
    from data_formulator.routes.agents import _cancellable_agent_stream

    thinking = Event()
    release = Event()
    finished = Event()
    workers = []
    results = []

    def events():
        try:
            workers.append(query_runtime._run_worker.get())
            results.append(execute_source_query(_RemoteLoader(), "query_data_as_arrow"))
            yield "first"
            results.append(execute_source_query(_RemoteLoader(), "query_data_as_arrow"))
            yield "second"
            thinking.set()
            release.wait(30)
            yield "discarded"
        finally:
            finished.set()

    stream = _cancellable_agent_stream(events())
    try:
        while next(stream) != "first":
            pass
        while next(stream) != "second":
            pass
        assert thinking.wait(2)
        assert results[0].equals(results[1])
        stream.close()
        assert workers[0]._process is None
    finally:
        release.set()
        stream.close()
        assert finished.wait(5)


class _Loader:
    def __init__(self, table: pa.Table | None = None, error: Exception | None = None, source_meta: dict | None = None):
        self.table = table
        self.error = error
        self.source_meta = source_meta
        self.calls: list[tuple[str, dict]] = []

    def fetch_data_as_arrow(self, source_table: str, import_options: dict):
        self.calls.append((source_table, import_options))
        if self.error is not None:
            raise self.error
        return self.table

    def get_column_types(self, source_table: str):
        if self.source_meta is None:
            raise NotImplementedError
        return self.source_meta

    def get_safe_params(self):
        return {"host": "example.test"}

    def query_data_as_arrow(self, source_table, query, limit):
        self.calls.append((source_table, {"query": query, "limit": limit}))
        return self.table


def _operation(*steps: ConnectorQueryStep) -> DataOperation:
    plan = DataOperationPlan(
        id="plan-1",
        label="Load data",
        summary="",
        steps=steps,
    )
    return DataOperation(
        id="operation-1",
        reason="Load data",
        plans=(plan,),
        status=DataOperationStatus.RUNNING,
        selected_plan_id=plan.id,
    )


def _step(display_name: str = "Recent orders", source_id: str = "warehouse"):
    return ConnectorQueryStep(
        source_id=source_id,
        table_key="public.orders",
        display_name=display_name,
        source_table="public.orders",
        source_table_name="orders",
        query=LoadQuery(
            limit=2,
            filters=(OperationFilter("region", "IN", ["west", "east"]),),
            columns=("id",),
            order_by=(LoadQueryOrder("created_at", "desc"),),
        ),
    )


def test_executor_materializes_bounded_table_with_provenance(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    loader = _Loader(pa.table({"id": [1, 2, 3], "region": ["west", "east", "north"]}))
    executor = DataOperationExecutor(workspace, lambda _source_id: loader)

    result = executor.execute(_operation(_step()))

    assert result.result_table_ids == ("recent_orders",)
    assert loader.calls == [("public.orders", {
        "size": 2,
        "source_filters": [{"column": "region", "operator": "IN", "value": ["west", "east"]}],
        "columns": ["id"],
        "sort_columns": ["created_at"],
        "sort_order": "desc",
    })]
    metadata = workspace.get_table_metadata("recent_orders")
    assert metadata is not None
    assert metadata.row_count == 2
    assert metadata.source_table == "public.orders"
    assert metadata.loader_params == {"host": "example.test"}
    assert '"filters": [{"column": "region", "operator": "IN", "value": ["west", "east"]}]' in metadata.description
    assert '"requested_limit": 2' in metadata.description
    assert '"loaded_row_count": 2' in metadata.description
    assert workspace.read_data_as_df("recent_orders")["id"].tolist() == [1, 2]
    assert result.failed_steps == ()


@pytest.mark.parametrize("limit", [None, 1])
def test_executor_materializes_aggregate_without_raw_fetch(tmp_path, limit):
    workspace = Workspace("test-user", root_dir=tmp_path)
    loader = _Loader(pa.table({"region": ["west", "east"], "total": [30, 20]}))
    query = LoadQuery.from_dict({"group_by": ["region"],
        "aggregates": [{"op": "sum", "column": "amount", "as": "total"}],
        **({"limit": limit} if limit else {})})
    step = ConnectorQueryStep(source_id="warehouse", table_key="orders", display_name="Totals",
                              source_table="orders", query=query)
    result = DataOperationExecutor(workspace, lambda _: loader).execute(_operation(step))
    assert not result.failed_steps
    assert loader.calls == [("orders", {"query": query.to_dict(), "limit": (limit or 10000) + 1})]
    metadata = workspace.get_table_metadata(result.result_table_ids[0])
    assert metadata.row_count == (limit or 2)
    assert metadata.import_options["structured_query"] == query.to_dict()
    assert [column.name for column in metadata.columns] == ["region", "total"]


def test_executor_rejects_overflow_instead_of_publishing_partial_aggregate(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    loader = _Loader(pa.table({"region": list(range(10001))}))
    step = ConnectorQueryStep(source_id="warehouse", table_key="orders", display_name="Regions",
                              source_table="orders", query=LoadQuery(group_by=("region",)))
    result = DataOperationExecutor(workspace, lambda _: loader).execute(_operation(step))
    assert not result.result_table_ids
    assert "exceeds 10000" in result.failed_steps[0].error.message
    assert workspace.list_tables() == []


def test_executor_publishes_source_descriptions(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    loader = _Loader(
        pa.table({"id": [1]}),
        source_meta={
            "description": "Customer orders",
            "columns": [{"name": "id", "description": "Order id"}],
        },
    )
    executor = DataOperationExecutor(workspace, lambda _source_id: loader)

    executor.execute(_operation(ConnectorQueryStep(
        source_id="warehouse",
        table_key="public.orders",
        display_name="Orders",
        source_table="public.orders",
    )))

    metadata = workspace.get_table_metadata("orders")
    assert metadata is not None
    assert metadata.description.startswith("Customer orders\n\nWorkspace table: Orders.")
    assert '"table_key": "public.orders"' in metadata.description
    assert [column.description for column in metadata.columns] == ["Order id"]


def test_executor_keeps_successful_tables_when_later_step_fails(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    loaders = {
        "first": _Loader(pa.table({"id": [1]})),
        "second": _Loader(error=RuntimeError("source unavailable")),
    }
    executor = DataOperationExecutor(workspace, loaders.__getitem__)

    result = executor.execute(_operation(
        _step("Orders", "first"),
        _step("Customers", "second"),
    ))

    assert result.result_table_ids == ("orders",)
    assert workspace.list_tables() == ["orders"]
    assert len(result.failed_steps) == 1
    assert result.failed_steps[0].step_index == 1
    assert result.failed_steps[0].display_name == "Customers"
    assert result.failed_steps[0].error.code == "connector_error"


def test_executor_allocates_distinct_fresh_names(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet_from_arrow(pa.table({"id": [0]}), "orders")
    loader = _Loader(pa.table({"id": [1]}))
    executor = DataOperationExecutor(workspace, lambda _source_id: loader)

    result = executor.execute(_operation(_step("Orders"), _step("Orders")))

    assert result.result_table_ids == ("orders_2", "orders_3")


def test_executor_recovers_published_tables_without_refetching(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    operation = _operation(_step())
    first_loader = _Loader(pa.table({"id": [1]}))
    first_result = DataOperationExecutor(
        workspace,
        lambda _source_id: first_loader,
    ).execute(operation)
    retry_loader = _Loader(error=AssertionError("retry must not refetch"))

    retry_result = DataOperationExecutor(
        workspace,
        lambda _source_id: retry_loader,
    ).execute(operation)

    assert retry_result == first_result
    assert retry_loader.calls == []


@pytest.mark.parametrize(("label", "expected"), [
    ("Last of Us Part II Reviews", "games_reviews_last_of_us_part_ii_reviews"),
    ("games_reviews.csv", "games_reviews_id_eq_42"),
    ("az://account/container/games_reviews.csv", "games_reviews_id_eq_42"),
])
def test_executor_names_file_subsets_and_persists_scope(tmp_path: Path, label: str, expected: str) -> None:
    from data_formulator.agents.agent_utils import generate_data_summary

    workspace = Workspace("test-user", root_dir=tmp_path)
    source = "az://account/container/games_reviews.csv"
    step = ConnectorQueryStep(
        source_id="blob",
        table_key=source,
        source_table=source,
        source_table_name=source,
        display_name=label,
        query=LoadQuery(filters=(OperationFilter("id", "EQ", 42),), columns=("id",)),
    )
    loader = _Loader(pa.table({"id": [42]}), source_meta={"description": "All game reviews"})

    result = DataOperationExecutor(workspace, lambda _source_id: loader).execute(_operation(step))

    assert result.result_table_ids == (expected,)
    reopened = Workspace("test-user", root_dir=tmp_path)
    metadata = reopened.get_table_metadata(expected)
    assert metadata.source_table == source
    assert metadata.import_options["source_filters"] == [{"column": "id", "operator": "EQ", "value": 42}]
    summary = generate_data_summary([{"name": expected}], workspace=reopened)
    assert '"value": 42' in summary
    assert 'selected columns ["id"]' in summary
    assert "All game reviews" in summary


def test_executor_bounds_long_file_names_and_preserves_scope_label() -> None:
    source = "az://account/container/" + "long_source_" * 10 + ".csv"
    step = ConnectorQueryStep(
        source_id="blob", table_key=source, source_table=source,
        display_name="West region " + "orders " * 30,
    )
    requested = DataOperationExecutor._requested_table_name(step)
    name = DataOperationExecutor._allocate_table_name(requested, set())
    assert len(name) <= 80
    assert "west_region" in name
    assert "account" not in name
    assert DataOperationExecutor._allocate_table_name(requested, set()) == name
    distinct = DataOperationExecutor._allocate_table_name(requested + "east", set())
    assert distinct != name
    collision = DataOperationExecutor._allocate_table_name(requested, {name})
    assert len(collision) <= 80
    assert collision != name
    assert collision.endswith("_2")