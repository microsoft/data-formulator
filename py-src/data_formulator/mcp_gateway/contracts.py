"""Versioned, bounded contracts for fixed governed MCP operations."""

from __future__ import annotations

from dataclasses import dataclass
import json
from types import MappingProxyType
from typing import Any, Mapping

from data_formulator.mcp.errors import (
    McpOperationValidationError,
    McpProfileValidationError,
    McpResultValidationError,
)
from data_formulator.mcp.profile import (
    McpOperation,
    McpServerProfile,
    McpSourceReference,
)

_PROHIBITED_ARGUMENT_FIELDS = frozenset({
    "endpoint",
    "tool",
    "tool_name",
    "url",
})


@dataclass(frozen=True)
class McpOperationRequest:
    """A caller-owned request for one profile-approved MCP operation."""

    profile_id: str
    operation: McpOperation
    source_reference: McpSourceReference
    arguments: Mapping[str, Any]
    operation_id: str
    page: int

    @classmethod
    def create(
        cls,
        *,
        profile: McpServerProfile,
        operation: McpOperation,
        source_reference: McpSourceReference,
        arguments: Mapping[str, Any],
        operation_id: str,
        page: int = 1,
    ) -> "McpOperationRequest":
        if operation not in profile.operation_tools:
            raise McpOperationValidationError(
                "operation is not approved by the MCP profile"
            )
        if not operation_id.strip():
            raise McpOperationValidationError("operation identifier must be nonempty")
        if isinstance(page, bool) or not isinstance(page, int):
            raise McpOperationValidationError("page must be an integer")
        if page < 1 or page > profile.limits.max_pages:
            raise McpOperationValidationError("page exceeds the approved limit")
        return cls(
            profile_id=profile.profile_id,
            operation=operation,
            source_reference=source_reference,
            arguments=_freeze_arguments(arguments),
            operation_id=operation_id,
            page=page,
        )


@dataclass(frozen=True)
class McpOperationResult:
    """A bounded versioned result from an approved MCP operation."""

    profile_id: str
    operation: McpOperation
    source_reference: McpSourceReference
    items: tuple[Mapping[str, Any], ...]
    next_page: str | None

    @classmethod
    def from_upstream_json(
        cls,
        *,
        profile: McpServerProfile,
        request: McpOperationRequest,
        payload: str,
    ) -> "McpOperationResult":
        if request.profile_id != profile.profile_id:
            raise McpResultValidationError("result profile does not match request")
        if len(payload.encode("utf-8")) > profile.limits.max_bytes:
            raise McpResultValidationError("result exceeds the approved byte limit")

        try:
            parsed = json.loads(payload)
        except (TypeError, json.JSONDecodeError) as exc:
            raise McpResultValidationError("result is not valid JSON") from exc
        if not isinstance(parsed, dict):
            raise McpResultValidationError("result must be a JSON object")

        expected_keys = {
            "result_schema_version",
            "source_reference",
            "items",
            "next_page",
        }
        if set(parsed) - expected_keys or not {
            "result_schema_version",
            "source_reference",
            "items",
        } <= set(parsed):
            raise McpResultValidationError("result has an unsupported schema")
        if (
            parsed["result_schema_version"]
            != profile.capability_manifest.result_schema_version
        ):
            raise McpResultValidationError("result schema version is not approved")

        try:
            source_reference = McpSourceReference.from_dict(
                parsed["source_reference"]
            )
        except McpProfileValidationError as exc:
            raise McpResultValidationError("result source reference is invalid") from exc
        if source_reference != request.source_reference:
            raise McpResultValidationError("result source reference does not match request")

        raw_items = parsed["items"]
        if not isinstance(raw_items, list):
            raise McpResultValidationError("result items must be a list")
        if len(raw_items) > profile.limits.max_rows:
            raise McpResultValidationError("result exceeds the approved row limit")

        items: list[Mapping[str, Any]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                raise McpResultValidationError("result items must be objects")
            try:
                items.append(_freeze_json_object(item))
            except McpOperationValidationError as exc:
                raise McpResultValidationError("result item is not JSON-safe") from exc

        next_page = parsed.get("next_page")
        if next_page is not None and (
            not isinstance(next_page, str) or not next_page.strip()
        ):
            raise McpResultValidationError("result next page is invalid")

        return cls(
            profile_id=profile.profile_id,
            operation=request.operation,
            source_reference=source_reference,
            items=tuple(items),
            next_page=next_page,
        )


def _freeze_arguments(arguments: Mapping[str, Any]) -> Mapping[str, Any]:
    if not isinstance(arguments, Mapping):
        raise McpOperationValidationError("operation arguments must be an object")
    return _freeze_json_object(arguments)


def _freeze_json_object(value: Mapping[str, Any]) -> Mapping[str, Any]:
    frozen: dict[str, Any] = {}
    for key, nested_value in value.items():
        if not isinstance(key, str) or key.lower() in _PROHIBITED_ARGUMENT_FIELDS:
            raise McpOperationValidationError(
                "operation arguments contain a prohibited field"
            )
        frozen[key] = _freeze_json_value(nested_value)
    return MappingProxyType(frozen)


def _freeze_json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return tuple(_freeze_json_value(item) for item in value)
    if isinstance(value, Mapping):
        return _freeze_json_object(value)
    raise McpOperationValidationError("operation arguments must be JSON-safe")
