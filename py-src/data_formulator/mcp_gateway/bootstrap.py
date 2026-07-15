"""Compose deployment-owned governed MCP configuration without network access."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from data_formulator.data_connector import register_governed_mcp_connectors
from data_formulator.mcp.errors import McpProfileValidationError
from data_formulator.mcp_gateway.profile_manifest import (
    load_profile_registry_from_environment,
)
from data_formulator.mcp_gateway.source_manifest import (
    load_governed_source_registry_from_environment,
)

if TYPE_CHECKING:
    from data_formulator.data_loader.mcp_governed_data_loader import (
        McpGovernedGatewayClient,
    )

_SOURCE_MANIFEST_PATH_ENVIRONMENT_VARIABLE = (
    "MCP_GOVERNED_SOURCE_MANIFEST_PATH"
)


def bootstrap_governed_mcp_connectors(
    *,
    gateway_client: "McpGovernedGatewayClient",
) -> bool:
    """Load profiles then sources and atomically register governed connectors."""
    profile_registry = load_profile_registry_from_environment()
    if profile_registry is None:
        if os.environ.get(
            _SOURCE_MANIFEST_PATH_ENVIRONMENT_VARIABLE, ""
        ).strip():
            raise McpProfileValidationError(
                "governed MCP sources require configured profiles"
            )
        return False

    source_registry = load_governed_source_registry_from_environment(
        profile_registry=profile_registry,
    )
    if source_registry is None:
        return False

    register_governed_mcp_connectors(
        source_registry=source_registry,
        gateway_client=gateway_client,
    )
    return True
