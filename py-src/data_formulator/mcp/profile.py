"""Immutable, administrator-owned contracts for governed MCP servers."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import re
from types import MappingProxyType
from typing import Any, Mapping
from urllib.parse import urlsplit

from data_formulator.mcp.errors import McpProfileValidationError


class McpOperation(str, Enum):
    """Product operations exposed by the governed gateway."""

    CATALOG = "catalog"
    SCHEMA = "schema"
    SEMANTIC_QUERY = "semantic_query"
    BOUNDED_READ = "bounded_read"
    HEALTH = "health"


class McpSourceClass(str, Enum):
    """Source-specific capability profiles supported by the gateway."""

    FABRIC_IQ = "fabric_iq"
    ONELAKE_METADATA = "onelake_metadata"
    WORK_IQ = "work_iq"


_SUPPORTED_PROFILE_VERSION = "v1"
_PROFILE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_SERVER_LABEL_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_SUPPORTED_OPERATIONS: dict[McpSourceClass, frozenset[McpOperation]] = {
    McpSourceClass.FABRIC_IQ: frozenset({
        McpOperation.CATALOG,
        McpOperation.SCHEMA,
        McpOperation.SEMANTIC_QUERY,
        McpOperation.HEALTH,
    }),
    McpSourceClass.ONELAKE_METADATA: frozenset({
        McpOperation.CATALOG,
        McpOperation.SCHEMA,
        McpOperation.HEALTH,
    }),
    McpSourceClass.WORK_IQ: frozenset({
        McpOperation.SCHEMA,
        McpOperation.HEALTH,
    }),
}
_WORK_IQ_BLOCKED_TOOLS = frozenset({
    "workiq.create_entity",
    "workiq.update_entity",
    "workiq.delete_entity",
    "workiq.do_action",
    "workiq.call_function",
    "workiq.ask",
})
_WORK_IQ_READ_ONLY_TOOLS = frozenset({
    "workiq.fetch",
    "workiq.get_schema",
    "workiq.search_paths",
})


@dataclass(frozen=True)
class McpOperationLimits:
    """Bounds enforced before an MCP result reaches the workspace."""

    max_rows: int
    max_bytes: int
    max_pages: int
    total_timeout_seconds: float

    @classmethod
    def from_dict(cls, data: object) -> "McpOperationLimits":
        if not isinstance(data, dict):
            raise McpProfileValidationError("limits must be an object")

        max_rows = _positive_int(data.get("max_rows"), "max_rows")
        max_bytes = _positive_int(data.get("max_bytes"), "max_bytes")
        max_pages = _positive_int(data.get("max_pages"), "max_pages")
        total_timeout_seconds = _positive_number(
            data.get("total_timeout_seconds"), "total_timeout_seconds"
        )
        return cls(
            max_rows=max_rows,
            max_bytes=max_bytes,
            max_pages=max_pages,
            total_timeout_seconds=total_timeout_seconds,
        )


@dataclass(frozen=True)
class McpToolPolicy:
    """Tool allowlist and approval policy for one source class."""

    allowed_tools: frozenset[str]
    require_approval: bool

    @classmethod
    def from_dict(
        cls, data: object, source_class: McpSourceClass
    ) -> "McpToolPolicy":
        if not isinstance(data, dict):
            raise McpProfileValidationError("tool policy must be an object")

        value = data.get("allowed_tools")
        if not isinstance(value, list) or not value:
            raise McpProfileValidationError("allowed_tools must be a nonempty list")

        tools = frozenset(_required_string(tool, "tool") for tool in value)
        if any("*" in tool for tool in tools):
            raise McpProfileValidationError("tool allowlist cannot contain wildcards")

        require_approval = data.get("require_approval")
        if not isinstance(require_approval, bool):
            raise McpProfileValidationError("require_approval must be a boolean")

        if source_class is McpSourceClass.WORK_IQ:
            if tools & _WORK_IQ_BLOCKED_TOOLS:
                raise McpProfileValidationError(
                    "Work IQ mutation and broad reasoning tools are not allowed"
                )
            if not tools <= _WORK_IQ_READ_ONLY_TOOLS or "workiq.fetch" not in tools:
                raise McpProfileValidationError(
                    "Work IQ policy must include only approved read tools and fetch"
                )

        return cls(allowed_tools=tools, require_approval=require_approval)


@dataclass(frozen=True)
class McpCapabilityManifest:
    """Pinned capabilities expected from an approved upstream server."""

    profile_version: str
    result_schema_version: str
    required_operations: frozenset[McpOperation]

    @classmethod
    def from_dict(cls, data: object) -> "McpCapabilityManifest":
        if not isinstance(data, dict):
            raise McpProfileValidationError("capability manifest must be an object")

        profile_version = _required_string(data.get("profile_version"), "profile_version")
        if profile_version != _SUPPORTED_PROFILE_VERSION:
            raise McpProfileValidationError("unsupported profile version")

        result_schema_version = _required_string(
            data.get("result_schema_version"), "result_schema_version"
        )
        if result_schema_version != _SUPPORTED_PROFILE_VERSION:
            raise McpProfileValidationError("unsupported result schema version")

        required_operations = _parse_operations(data.get("required_operations"))
        return cls(
            profile_version=profile_version,
            result_schema_version=result_schema_version,
            required_operations=required_operations,
        )


@dataclass(frozen=True)
class McpSourceReference:
    """Stable source and snapshot identifiers supplied by an approved profile."""

    source_id: str
    snapshot_id: str

    @classmethod
    def from_dict(cls, data: object) -> "McpSourceReference":
        if not isinstance(data, dict):
            raise McpProfileValidationError("source reference must be an object")

        source_id = _required_string(data.get("source_id"), "source_id")
        snapshot_id = _required_string(data.get("snapshot_id"), "snapshot_id")
        if source_id.lower().startswith(("http://", "https://")):
            raise McpProfileValidationError("source_id must not be an endpoint")

        return cls(source_id=source_id, snapshot_id=snapshot_id)


@dataclass(frozen=True)
class McpServerProfile:
    """Validated configuration for one allowlisted upstream MCP server."""

    profile_id: str
    version: str
    endpoint: str
    audience: str
    server_label: str
    source_class: McpSourceClass
    operations: frozenset[McpOperation]
    capability_manifest: McpCapabilityManifest
    allowed_tools: frozenset[str]
    operation_tools: Mapping[McpOperation, str]
    limits: McpOperationLimits
    require_approval: bool

    @classmethod
    def from_dict(cls, data: object) -> "McpServerProfile":
        if not isinstance(data, dict):
            raise McpProfileValidationError("profile must be an object")

        profile_id = _required_string(data.get("profile_id"), "profile_id")
        if not _PROFILE_ID_PATTERN.fullmatch(profile_id):
            raise McpProfileValidationError("profile_id has an invalid format")

        version = _required_string(data.get("version"), "version")
        if version != _SUPPORTED_PROFILE_VERSION:
            raise McpProfileValidationError("unsupported profile version")

        endpoint = validate_mcp_endpoint(data.get("endpoint"))
        audience = _required_string(data.get("audience"), "audience")

        server_label = _required_string(data.get("server_label"), "server_label")
        if not _SERVER_LABEL_PATTERN.fullmatch(server_label):
            raise McpProfileValidationError("server_label has an invalid format")

        source_class = _parse_source_class(data.get("source_class"))
        operations = _parse_operations(data.get("operations"))
        unsupported_operations = operations - _SUPPORTED_OPERATIONS[source_class]
        if unsupported_operations:
            raise McpProfileValidationError(
                "operation is not supported by this source class"
            )

        capability_manifest = McpCapabilityManifest.from_dict(
            data.get("capability_manifest")
        )
        if capability_manifest.required_operations != operations:
            raise McpProfileValidationError(
                "capability manifest operations must match profile operations"
            )

        tool_policy = McpToolPolicy.from_dict(data, source_class)
        operation_tools = _parse_operation_tools(
            data.get("operation_tools"),
            operations,
            tool_policy.allowed_tools,
        )
        limits = McpOperationLimits.from_dict(data.get("limits"))

        return cls(
            profile_id=profile_id,
            version=version,
            endpoint=endpoint,
            audience=audience,
            server_label=server_label,
            source_class=source_class,
            operations=operations,
            capability_manifest=capability_manifest,
            allowed_tools=tool_policy.allowed_tools,
            operation_tools=operation_tools,
            limits=limits,
            require_approval=tool_policy.require_approval,
        )


def _required_string(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise McpProfileValidationError(f"{field_name} must be a nonempty string")
    return value.strip()


def validate_mcp_endpoint(value: object) -> str:
    """Require a credential-free trusted HTTPS MCP endpoint."""
    endpoint = _required_string(value, "endpoint")
    parsed = urlsplit(endpoint)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise McpProfileValidationError("endpoint must be a trusted HTTPS URL")
    return endpoint


def _parse_source_class(value: object) -> McpSourceClass:
    try:
        return McpSourceClass(_required_string(value, "source_class"))
    except ValueError as exc:
        raise McpProfileValidationError("source_class is not supported") from exc


def _parse_operations(value: object) -> frozenset[McpOperation]:
    if not isinstance(value, list) or not value:
        raise McpProfileValidationError("operations must be a nonempty list")
    try:
        return frozenset(McpOperation(_required_string(operation, "operation")) for operation in value)
    except ValueError as exc:
        raise McpProfileValidationError("operation is not supported") from exc


def _parse_operation_tools(
    value: object,
    operations: frozenset[McpOperation],
    allowed_tools: frozenset[str],
) -> Mapping[McpOperation, str]:
    if not isinstance(value, dict):
        raise McpProfileValidationError("operation mapping must be an object")

    parsed: dict[McpOperation, str] = {}
    for raw_operation, raw_tool in value.items():
        try:
            operation = McpOperation(_required_string(raw_operation, "operation"))
        except ValueError as exc:
            raise McpProfileValidationError(
                "operation mapping contains an unsupported operation"
            ) from exc
        try:
            tool = _required_string(raw_tool, "tool")
        except McpProfileValidationError as exc:
            raise McpProfileValidationError(
                "operation mapping tool must be a nonempty string"
            ) from exc
        parsed[operation] = tool

    required_operations = operations - {McpOperation.HEALTH}
    if set(parsed) != required_operations:
        raise McpProfileValidationError(
            "operation mapping must cover exactly the declared non-health operations"
        )
    if len(set(parsed.values())) != len(parsed):
        raise McpProfileValidationError(
            "operation mapping must assign distinct tools to each operation"
        )
    if not set(parsed.values()) <= allowed_tools:
        raise McpProfileValidationError(
            "operation mapping must use only allowlisted tools"
        )

    return MappingProxyType(parsed)


def _positive_int(value: Any, field_name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise McpProfileValidationError(f"{field_name} limit must be a positive integer")
    return value


def _positive_number(value: Any, field_name: str) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or value <= 0
    ):
        raise McpProfileValidationError(f"{field_name} limit must be a positive number")
    return float(value)
