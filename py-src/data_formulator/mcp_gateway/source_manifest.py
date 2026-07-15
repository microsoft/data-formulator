"""Load the deployment-owned governed MCP source manifest."""

from __future__ import annotations

import json
import os
from pathlib import Path

from data_formulator.mcp.errors import McpProfileValidationError
from data_formulator.mcp_gateway.registry import McpProfileRegistry
from data_formulator.mcp_gateway.source_registry import McpGovernedSourceRegistry

_MANIFEST_PATH_ENVIRONMENT_VARIABLE = "MCP_GOVERNED_SOURCE_MANIFEST_PATH"


def load_governed_source_registry_from_environment(
    *,
    profile_registry: McpProfileRegistry,
) -> McpGovernedSourceRegistry | None:
    """Load the fixed manifest or leave governed sources unavailable when unset."""
    raw_path = os.environ.get(_MANIFEST_PATH_ENVIRONMENT_VARIABLE, "").strip()
    if not raw_path:
        return None

    try:
        with Path(raw_path).open(encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise McpProfileValidationError(
            "governed MCP source manifest could not be loaded"
        ) from exc

    return McpGovernedSourceRegistry.from_manifest(
        manifest,
        profile_registry=profile_registry,
    )
