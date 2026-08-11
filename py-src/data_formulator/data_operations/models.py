from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Any, ClassVar, Literal, Mapping


DATA_OPERATION_SCHEMA_VERSION = 1

JsonScalar = str | int | float | bool | None
FrozenJsonValue = JsonScalar | tuple["FrozenJsonValue", ...] | Mapping[str, "FrozenJsonValue"]


def _new_id() -> str:
    return str(uuid.uuid4())


def _canonical_hash(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _freeze_json(value: Any) -> FrozenJsonValue:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        return MappingProxyType({
            str(key): _freeze_json(item)
            for key, item in value.items()
        })
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(item) for item in value)
    raise TypeError(f"Unsupported JSON value: {type(value).__name__}")


def _thaw_json(value: FrozenJsonValue) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw_json(item) for item in value]
    return value


class DataOperationStatus(StrEnum):
    DRAFT = "draft"
    AWAITING_SELECTION = "awaiting_selection"
    RUNNING = "running"
    LOADED = "loaded"
    PARTIALLY_LOADED = "partially_loaded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SUPERSEDED = "superseded"


@dataclass(frozen=True)
class OperationFilter:
    column: str
    operator: str
    value: FrozenJsonValue = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "value", _freeze_json(self.value))

    def to_dict(self) -> dict[str, Any]:
        result = {"column": self.column, "operator": self.operator}
        if self.value is not None:
            result["value"] = _thaw_json(self.value)
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> OperationFilter:
        return cls(
            column=str(value["column"]),
            operator=str(value["op"]),
            value=value.get("value"),
        )


@dataclass(frozen=True)
class LoadQueryOrder:
    column: str
    direction: Literal["asc", "desc"] = "asc"

    def __post_init__(self) -> None:
        if self.direction not in ("asc", "desc"):
            raise ValueError(f"Unsupported order direction: {self.direction!r}")

    def to_dict(self) -> dict[str, str]:
        return {"column": self.column, "dir": self.direction}

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> LoadQueryOrder:
        direction = value.get("dir", "asc")
        if direction not in ("asc", "desc"):
            raise ValueError(f"Unsupported order direction: {direction!r}")
        return cls(column=str(value["column"]), direction=direction)


@dataclass(frozen=True)
class LoadQuery:
    """Raw-row subset of the shared SPJQ vocabulary used for loading."""

    filters: tuple[OperationFilter, ...] = ()
    columns: tuple[str, ...] = ()
    order_by: tuple[LoadQueryOrder, ...] = ()
    limit: int | None = None

    def __post_init__(self) -> None:
        if self.limit is not None and self.limit < 1:
            raise ValueError("Load query limit must be positive")
        if len(self.order_by) > 1:
            raise ValueError("Load query supports at most one order_by clause")

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if self.filters:
            result["filters"] = [
                {
                    **{"column": item.column, "op": item.operator},
                    **({"value": _thaw_json(item.value)} if item.value is not None else {}),
                }
                for item in self.filters
            ]
        if self.columns:
            result["columns"] = list(self.columns)
        if self.order_by:
            result["order_by"] = [item.to_dict() for item in self.order_by]
        if self.limit is not None:
            result["limit"] = self.limit
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any] | None) -> LoadQuery:
        raw = value or {}
        return cls(
            filters=tuple(
                OperationFilter.from_dict(item)
                for item in raw.get("filters", ())
            ),
            columns=tuple(str(item) for item in raw.get("columns", ())),
            order_by=tuple(
                LoadQueryOrder.from_dict(item)
                for item in raw.get("order_by", ())
            ),
            limit=(int(raw["limit"]) if raw.get("limit") is not None else None),
        )


@dataclass(frozen=True)
class ConnectorQueryStep:
    kind: ClassVar[Literal["connector_query"]] = "connector_query"

    source_id: str
    table_key: str
    display_name: str
    source_table: str
    source_table_name: str | None = None
    query: LoadQuery = field(default_factory=LoadQuery)

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "kind": self.kind,
            "source_id": self.source_id,
            "table_key": self.table_key,
            "display_name": self.display_name,
            "source_table": self.source_table,
        }
        if self.source_table_name is not None:
            result["source_table_name"] = self.source_table_name
        if query := self.query.to_dict():
            result["query"] = query
        return result

    def to_public_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "kind": self.kind,
            "display_name": self.display_name,
        }
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> ConnectorQueryStep:
        return cls(
            source_id=str(value["source_id"]),
            table_key=str(value["table_key"]),
            display_name=str(value["display_name"]),
            source_table=str(value["source_table"]),
            source_table_name=(
                str(value["source_table_name"])
                if value.get("source_table_name") is not None
                else None
            ),
            query=LoadQuery.from_dict(value.get("query")),
        )


DataOperationStep = ConnectorQueryStep


def _step_from_dict(value: Mapping[str, Any]) -> DataOperationStep:
    kind = value.get("kind")
    if kind == ConnectorQueryStep.kind:
        return ConnectorQueryStep.from_dict(value)
    raise ValueError(f"Unsupported data operation step kind: {kind!r}")


@dataclass(frozen=True)
class DataOperationPlan:
    label: str
    summary: str
    steps: tuple[DataOperationStep, ...]
    id: str = field(default_factory=_new_id)
    plan_hash: str = field(init=False)

    def __post_init__(self) -> None:
        if not self.steps:
            raise ValueError("A data operation plan requires at least one step")
        object.__setattr__(self, "plan_hash", self.compute_hash())

    def compute_hash(self) -> str:
        return _canonical_hash({
            "schema_version": DATA_OPERATION_SCHEMA_VERSION,
            "steps": [step.to_dict() for step in self.steps],
        })

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "hash": self.plan_hash,
            "label": self.label,
            "summary": self.summary,
            "steps": [step.to_dict() for step in self.steps],
        }

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "hash": self.plan_hash,
            "label": self.label,
            "summary": self.summary,
            "steps": [step.to_public_dict() for step in self.steps],
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> DataOperationPlan:
        plan = cls(
            id=str(value["id"]),
            label=str(value["label"]),
            summary=str(value.get("summary", "")),
            steps=tuple(_step_from_dict(item) for item in value.get("steps", ())),
        )
        serialized_hash = value.get("hash")
        if serialized_hash != plan.plan_hash:
            raise ValueError("Data operation plan hash does not match its steps")
        return plan


@dataclass(frozen=True)
class OperationError:
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> OperationError:
        return cls(code=str(value["code"]), message=str(value["message"]))


@dataclass(frozen=True)
class FailedOperationStep:
    step_index: int
    display_name: str
    error: OperationError

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_index": self.step_index,
            "display_name": self.display_name,
            "error": self.error.to_dict(),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> FailedOperationStep:
        return cls(
            step_index=int(value["step_index"]),
            display_name=str(value["display_name"]),
            error=OperationError.from_dict(value["error"]),
        )


@dataclass(frozen=True)
class DataOperation:
    reason: str
    plans: tuple[DataOperationPlan, ...]
    description: str = ""
    canvas_title: str = ""
    canvas_summary: str = ""
    id: str = field(default_factory=_new_id)
    status: DataOperationStatus = DataOperationStatus.AWAITING_SELECTION
    selected_plan_id: str | None = None
    result_table_ids: tuple[str, ...] = ()
    error: OperationError | None = None
    failed_steps: tuple[FailedOperationStep, ...] = ()
    superseded_by_operation_id: str | None = None

    schema_version: ClassVar[int] = DATA_OPERATION_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if not self.plans:
            raise ValueError("A data operation requires at least one plan")
        plan_ids = [plan.id for plan in self.plans]
        if len(plan_ids) != len(set(plan_ids)):
            raise ValueError("Data operation plan IDs must be unique")
        if self.selected_plan_id is not None and self.selected_plan_id not in plan_ids:
            raise ValueError("selected_plan_id must identify a plan in this operation")

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "schema_version": self.schema_version,
            "id": self.id,
            "status": self.status.value,
            "reason": self.reason,
            "description": self.description,
            "canvas_title": self.canvas_title,
            "canvas_summary": self.canvas_summary,
            "plans": [plan.to_dict() for plan in self.plans],
        }
        if self.selected_plan_id is not None:
            result["selected_plan_id"] = self.selected_plan_id
        if self.result_table_ids:
            result["result_table_ids"] = list(self.result_table_ids)
        if self.error is not None:
            result["error"] = self.error.to_dict()
        if self.failed_steps:
            result["failed_steps"] = [item.to_dict() for item in self.failed_steps]
        if self.superseded_by_operation_id is not None:
            result["superseded_by_operation_id"] = self.superseded_by_operation_id
        return result

    def to_public_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "schema_version": self.schema_version,
            "id": self.id,
            "status": self.status.value,
            "reason": self.reason,
            "description": self.description,
            "canvas_title": self.canvas_title,
            "canvas_summary": self.canvas_summary,
            "plans": [plan.to_public_dict() for plan in self.plans],
        }
        if self.selected_plan_id is not None:
            result["selected_plan_id"] = self.selected_plan_id
        if self.result_table_ids:
            result["result_table_ids"] = list(self.result_table_ids)
        if self.error is not None:
            result["error"] = self.error.to_dict()
        if self.failed_steps:
            result["failed_steps"] = [item.to_dict() for item in self.failed_steps]
        if self.superseded_by_operation_id is not None:
            result["superseded_by_operation_id"] = self.superseded_by_operation_id
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> DataOperation:
        schema_version = value.get("schema_version")
        if schema_version != cls.schema_version:
            raise ValueError(
                f"Unsupported data operation schema version: {schema_version!r}"
            )
        error = value.get("error")
        return cls(
            id=str(value["id"]),
            status=DataOperationStatus(value["status"]),
            reason=str(value.get("reason", "")),
            description=str(value.get("description", "")),
            canvas_title=str(value.get("canvas_title", "")),
            canvas_summary=str(value.get("canvas_summary", "")),
            plans=tuple(
                DataOperationPlan.from_dict(item)
                for item in value.get("plans", ())
            ),
            selected_plan_id=(
                str(value["selected_plan_id"])
                if value.get("selected_plan_id") is not None
                else None
            ),
            result_table_ids=tuple(
                str(item) for item in value.get("result_table_ids", ())
            ),
            error=OperationError.from_dict(error) if error is not None else None,
            failed_steps=tuple(
                FailedOperationStep.from_dict(item)
                for item in value.get("failed_steps", ())
            ),
            superseded_by_operation_id=(
                str(value["superseded_by_operation_id"])
                if value.get("superseded_by_operation_id") is not None
                else None
            ),
        )