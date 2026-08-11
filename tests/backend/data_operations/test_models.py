from dataclasses import FrozenInstanceError

import pytest

from data_formulator.data_operations import (
    ConnectorQueryStep,
    DataOperation,
    DataOperationPlan,
    DataOperationStatus,
    LoadQuery,
    LoadQueryOrder,
    OperationFilter,
    build_data_operation_action,
)


def _step() -> ConnectorQueryStep:
    return ConnectorQueryStep(
        source_id="warehouse",
        table_key="public.orders",
        display_name="Recent orders",
        source_table="public.orders",
        query=LoadQuery(
            filters=(OperationFilter("order_date", "GTE", "2026-01-01"),),
            order_by=(LoadQueryOrder("order_date", "desc"),),
        ),
    )


def test_operation_round_trip_preserves_identity_and_status() -> None:
    plan = DataOperationPlan(
        id="plan-1",
        label="Recent orders",
        summary="Orders since January",
        steps=(_step(),),
    )
    operation = DataOperation(
        id="operation-1",
        reason="Analyze recent demand",
        plans=(plan,),
        status=DataOperationStatus.RUNNING,
        selected_plan_id=plan.id,
    )

    restored = DataOperation.from_dict(operation.to_dict())

    assert restored == operation
    assert restored.plans[0].plan_hash == plan.plan_hash


def test_operation_round_trip_preserves_discovery_presentation() -> None:
    operation = DataOperation(
        reason="Choose a dataset",
        description="I found engagement datasets that can support this analysis.",
        canvas_title="Engagement datasets",
        canvas_summary="Movies are the better fit for title-level analysis.",
        plans=(DataOperationPlan(
            label="Movies",
            summary="Movie engagement",
            steps=(_step(),),
        ),),
    )

    restored = DataOperation.from_dict(operation.to_dict())

    assert restored == operation
    assert operation.to_public_dict()["description"] == (
        "I found engagement datasets that can support this analysis."
    )
    assert "show_in_canvas" not in operation.to_public_dict()
    assert operation.to_public_dict()["plans"][0]["summary"] == "Movie engagement"


def test_plan_hash_depends_on_executable_steps_not_display_text() -> None:
    first = DataOperationPlan(
        label="Recent orders",
        summary="Recommended",
        steps=(_step(),),
    )
    renamed = DataOperationPlan(
        label="Orders from this year",
        summary="Different explanation",
        steps=(_step(),),
    )

    assert first.id != renamed.id
    assert first.plan_hash == renamed.plan_hash


def test_plan_rejects_tampered_serialized_hash() -> None:
    serialized = DataOperationPlan(
        label="Recent orders",
        summary="",
        steps=(_step(),),
    ).to_dict()
    serialized["steps"][0]["table_key"] = "public.other_table"

    with pytest.raises(ValueError, match="hash does not match"):
        DataOperationPlan.from_dict(serialized)


def test_operation_rejects_unknown_selected_plan() -> None:
    plan = DataOperationPlan(label="Recent orders", summary="", steps=(_step(),))

    with pytest.raises(ValueError, match="selected_plan_id"):
        DataOperation(
            reason="Analyze recent demand",
            plans=(plan,),
            selected_plan_id="missing-plan",
        )


def test_models_are_immutable() -> None:
    plan = DataOperationPlan(label="Recent orders", summary="", steps=(_step(),))

    with pytest.raises(FrozenInstanceError):
        plan.label = "Changed"  # type: ignore[misc]


def test_load_query_rejects_multiple_order_clauses() -> None:
    with pytest.raises(ValueError, match="at most one order_by"):
        LoadQuery(order_by=(
            LoadQueryOrder("created_at", "desc"),
            LoadQueryOrder("id", "asc"),
        ))


def test_nested_filter_values_cannot_change_after_hashing() -> None:
    source_value = {"regions": ["west", "east"]}
    step = ConnectorQueryStep(
        source_id="warehouse",
        table_key="public.orders",
        display_name="Regional orders",
        source_table="public.orders",
        query=LoadQuery(filters=(OperationFilter("region", "IN", source_value),)),
    )
    plan = DataOperationPlan(label="Regional orders", summary="", steps=(step,))
    original_hash = plan.plan_hash

    source_value["regions"].append("north")
    serialized = plan.to_dict()
    serialized["steps"][0]["query"]["filters"][0]["value"]["regions"].append("south")

    assert plan.plan_hash == original_hash
    assert plan.steps[0].query.filters[0].to_dict()["value"] == {
        "regions": ["west", "east"],
    }


def test_action_factory_owns_the_versioned_wire_envelope() -> None:
    plan = DataOperationPlan(
        id="plan-1",
        label="Recent orders",
        summary="",
        steps=(_step(),),
    )
    operation = DataOperation(
        id="operation-1",
        reason="Analyze recent demand",
        plans=(plan,),
    )

    action = build_data_operation_action(operation)

    assert action["type"] == "data_operation"
    assert action["operation"]["schema_version"] == 1
    assert action["operation"]["id"] == "operation-1"
    assert action["operation"]["plans"][0]["id"] == "plan-1"
    public_step = action["operation"]["plans"][0]["steps"][0]
    assert public_step == {
        "kind": "connector_query",
        "display_name": "Recent orders",
    }
    assert "source_id" not in public_step
    assert "filters" not in public_step


def test_load_query_requires_positive_limit_and_valid_order() -> None:
    with pytest.raises(ValueError, match="limit"):
        LoadQuery(limit=0)
    with pytest.raises(ValueError, match="direction"):
        LoadQueryOrder("created_at", "sideways")  # type: ignore[arg-type]

