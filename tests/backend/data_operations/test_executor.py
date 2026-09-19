from pathlib import Path

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