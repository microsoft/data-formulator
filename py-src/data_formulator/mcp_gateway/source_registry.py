"""Read-only registry for administrator-defined governed MCP sources."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from data_formulator.mcp.errors import (
    McpGovernedSourceNotFoundError,
    McpProfileValidationError,
)
from data_formulator.mcp.profile import McpServerProfile, McpSourceReference
from data_formulator.mcp_gateway.registry import McpProfileRegistry

_CONNECTOR_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
_MANIFEST_VERSION = "v1"


@dataclass(frozen=True)
class McpGovernedSource:
    """One public connector ID bound to an approved profile and source scope."""

    connector_id: str
    profile: McpServerProfile
    source_reference: McpSourceReference


class McpGovernedSourceRegistry:
    """Resolve only source bindings supplied by the deployment manifest."""

    def __init__(self, sources: list[McpGovernedSource]) -> None:
        self._sources: dict[str, McpGovernedSource] = {}
        for source in sources:
            if source.connector_id in self._sources:
                raise McpProfileValidationError(
                    "duplicate governed MCP connector identifier"
                )
            self._sources[source.connector_id] = source

    @classmethod
    def from_manifest(
        cls,
        manifest: object,
        *,
        profile_registry: McpProfileRegistry,
    ) -> "McpGovernedSourceRegistry":
        if not isinstance(manifest, dict):
            raise McpProfileValidationError(
                "governed MCP source manifest must be an object"
            )
        if set(manifest) != {"manifest_version", "sources"}:
            raise McpProfileValidationError(
                "governed MCP source manifest has an unsupported schema"
            )
        if manifest["manifest_version"] != _MANIFEST_VERSION:
            raise McpProfileValidationError(
                "governed MCP source manifest version is not supported"
            )

        raw_sources = manifest["sources"]
        if not isinstance(raw_sources, list) or not raw_sources:
            raise McpProfileValidationError(
                "governed MCP source manifest must contain sources"
            )

        sources = [
            _parse_source(raw_source, profile_registry=profile_registry)
            for raw_source in raw_sources
        ]
        return cls(sources)

    def get(self, connector_id: str) -> McpGovernedSource:
        try:
            return self._sources[connector_id]
        except KeyError as exc:
            raise McpGovernedSourceNotFoundError(
                "governed MCP connector is not configured"
            ) from exc

    def sources(self) -> tuple[McpGovernedSource, ...]:
        """Return the immutable deployment-owned source bindings."""
        return tuple(self._sources.values())


def _parse_source(
    raw_source: object,
    *,
    profile_registry: McpProfileRegistry,
) -> McpGovernedSource:
    if not isinstance(raw_source, dict):
        raise McpProfileValidationError(
            "governed MCP source manifest entry must be an object"
        )
    if set(raw_source) != {"connector_id", "profile_id", "source_reference"}:
        raise McpProfileValidationError(
            "governed MCP source manifest entry has an unsupported schema"
        )

    connector_id = _required_connector_id(raw_source["connector_id"])
    profile_id = _required_string(raw_source["profile_id"], "profile_id")
    raw_source_reference = raw_source["source_reference"]
    if (
        not isinstance(raw_source_reference, dict)
        or set(raw_source_reference) != {"source_id", "snapshot_id"}
    ):
        raise McpProfileValidationError(
            "governed MCP source reference has an unsupported schema"
        )
    try:
        source_reference = McpSourceReference.from_dict(raw_source_reference)
    except McpProfileValidationError as exc:
        raise McpProfileValidationError(
            "governed MCP source reference is invalid"
        ) from exc

    return McpGovernedSource(
        connector_id=connector_id,
        profile=profile_registry.get(profile_id),
        source_reference=source_reference,
    )


def _required_connector_id(value: Any) -> str:
    connector_id = _required_string(value, "connector_id")
    if not _CONNECTOR_ID_PATTERN.fullmatch(connector_id):
        raise McpProfileValidationError(
            "governed MCP connector identifier has an invalid format"
        )
    return connector_id


def _required_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise McpProfileValidationError(f"{field_name} must be a nonempty string")
    return value.strip()
