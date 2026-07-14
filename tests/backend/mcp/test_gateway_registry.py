"""Tests for the administrator-owned governed MCP profile registry."""

from __future__ import annotations

import pytest

from data_formulator.mcp.errors import McpProfileNotFoundError, McpProfileValidationError
from data_formulator.mcp.profile import McpServerProfile
from data_formulator.mcp_gateway.registry import McpProfileRegistry

pytestmark = [pytest.mark.backend]


def _profile(profile_id: str = "fabric-pilot") -> McpServerProfile:
    return McpServerProfile.from_dict({
        "profile_id": profile_id,
        "version": "v1",
        "endpoint": "https://gateway.example.com/mcp",
        "audience": "api://data-formulator-mcp-gateway",
        "server_label": profile_id,
        "source_class": "fabric_iq",
        "operations": ["catalog", "schema", "semantic_query", "health"],
        "capability_manifest": {
            "profile_version": "v1",
            "result_schema_version": "v1",
            "required_operations": ["catalog", "schema", "semantic_query", "health"],
        },
        "allowed_tools": ["fabric.list_entities", "fabric.search_ontology"],
        "limits": {
            "max_rows": 10_000,
            "max_bytes": 32 * 1024 * 1024,
            "max_pages": 200,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    })


class TestMcpProfileRegistry:
    def test_resolves_registered_profile_by_identifier(self):
        profile = _profile()
        registry = McpProfileRegistry([profile])

        assert registry.get("fabric-pilot") is profile

    def test_rejects_duplicate_profile_identifier(self):
        with pytest.raises(McpProfileValidationError, match="duplicate"):
            McpProfileRegistry([_profile(), _profile()])

    def test_unknown_profile_returns_safe_lookup_error(self):
        registry = McpProfileRegistry([_profile()])

        with pytest.raises(McpProfileNotFoundError, match="profile is not configured"):
            registry.get("unknown-profile")
