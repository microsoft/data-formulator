"""Load administrator-owned governed MCP profiles from deployment configuration."""

from __future__ import annotations

import json
import os
from pathlib import Path

from data_formulator.mcp.errors import McpProfileValidationError
from data_formulator.mcp.profile import McpServerProfile
from data_formulator.mcp_gateway.registry import McpProfileRegistry

_PROFILE_MANIFEST_PATH_ENVIRONMENT_VARIABLE = (
    "MCP_GOVERNED_PROFILE_MANIFEST_PATH"
)
_PROFILE_MANIFEST_VERSION = "v1"


def load_profile_registry_from_environment() -> McpProfileRegistry | None:
    """Load the fixed profile manifest or leave governed MCP unavailable."""
    raw_path = os.environ.get(
        _PROFILE_MANIFEST_PATH_ENVIRONMENT_VARIABLE, ""
    ).strip()
    if not raw_path:
        return None

    try:
        with Path(raw_path).open(encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise McpProfileValidationError(
            "governed MCP profile manifest could not be loaded"
        ) from exc

    if not isinstance(manifest, dict) or set(manifest) != {
        "manifest_version",
        "profiles",
    }:
        raise McpProfileValidationError(
            "governed MCP profile manifest has an unsupported schema"
        )
    if manifest["manifest_version"] != _PROFILE_MANIFEST_VERSION:
        raise McpProfileValidationError(
            "governed MCP profile manifest version is not supported"
        )

    raw_profiles = manifest["profiles"]
    if not isinstance(raw_profiles, list) or not raw_profiles:
        raise McpProfileValidationError(
            "governed MCP profile manifest must contain profiles"
        )
    return McpProfileRegistry(
        McpServerProfile.from_dict(raw_profile)
        for raw_profile in raw_profiles
    )
