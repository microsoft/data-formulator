"""Tests for loading the deployment-owned governed source manifest."""

from __future__ import annotations

import json

import pytest

from data_formulator.mcp.errors import McpProfileValidationError
from data_formulator.mcp.profile import McpServerProfile
from data_formulator.mcp_gateway.registry import McpProfileRegistry
from data_formulator.mcp_gateway.source_manifest import (
    load_governed_source_registry_from_environment,
)

pytestmark = [pytest.mark.backend]


def _profile() -> McpServerProfile:
    return McpServerProfile.from_dict({
        "profile_id": "fabric-pilot",
        "version": "v1",
        "endpoint": "https://gateway.example.com/mcp",
        "audience": "api://data-formulator-mcp-gateway",
        "server_label": "fabric-pilot",
        "source_class": "fabric_iq",
        "operations": ["catalog", "schema", "semantic_query", "health"],
        "capability_manifest": {
            "profile_version": "v1",
            "result_schema_version": "v1",
            "required_operations": ["catalog", "schema", "semantic_query", "health"],
        },
        "allowed_tools": [
            "fabric.list_entities",
            "fabric.get_schema",
            "fabric.search_ontology",
        ],
        "operation_tools": {
            "catalog": "fabric.list_entities",
            "schema": "fabric.get_schema",
            "semantic_query": "fabric.search_ontology",
        },
        "limits": {
            "max_rows": 10_000,
            "max_bytes": 32 * 1024 * 1024,
            "max_pages": 200,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    })


def test_loads_registry_from_the_configured_deployment_manifest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    manifest_path = tmp_path / "governed-sources.json"
    manifest_path.write_text(
        json.dumps({
            "manifest_version": "v1",
            "sources": [
                {
                    "connector_id": "fabric-sales",
                    "profile_id": "fabric-pilot",
                    "source_reference": {
                        "source_id": "fabric:workspace-1:ontology-2",
                        "snapshot_id": "snapshot-1",
                    },
                },
            ],
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv("MCP_GOVERNED_SOURCE_MANIFEST_PATH", str(manifest_path))

    registry = load_governed_source_registry_from_environment(
        profile_registry=McpProfileRegistry([_profile()])
    )

    assert registry is not None
    assert registry.get("fabric-sales").source_reference.snapshot_id == "snapshot-1"


def test_leaves_governed_sources_unavailable_when_no_manifest_is_configured(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("MCP_GOVERNED_SOURCE_MANIFEST_PATH", raising=False)

    registry = load_governed_source_registry_from_environment(
        profile_registry=McpProfileRegistry([_profile()])
    )

    assert registry is None


def test_rejects_a_malformed_configured_manifest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    manifest_path = tmp_path / "governed-sources.json"
    manifest_path.write_text("{not-json", encoding="utf-8")
    monkeypatch.setenv("MCP_GOVERNED_SOURCE_MANIFEST_PATH", str(manifest_path))

    with pytest.raises(McpProfileValidationError, match="could not be loaded"):
        load_governed_source_registry_from_environment(
            profile_registry=McpProfileRegistry([_profile()])
        )
