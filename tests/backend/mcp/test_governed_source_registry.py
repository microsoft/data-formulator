"""Tests for the read-only governed MCP source-manifest registry."""

from __future__ import annotations

import pytest

from data_formulator.mcp.profile import McpServerProfile
from data_formulator.mcp.errors import (
    McpGovernedSourceNotFoundError,
    McpProfileNotFoundError,
    McpProfileValidationError,
)
from data_formulator.mcp_gateway.registry import McpProfileRegistry
from data_formulator.mcp_gateway.source_registry import McpGovernedSourceRegistry

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


def test_manifest_registry_resolves_a_public_connector_to_its_fixed_source():
    profile = _profile()
    registry = McpGovernedSourceRegistry.from_manifest(
        {
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
        },
        profile_registry=McpProfileRegistry([profile]),
    )

    source = registry.get("fabric-sales")

    assert source.profile is profile
    assert source.source_reference.source_id == "fabric:workspace-1:ontology-2"
    assert source.source_reference.snapshot_id == "snapshot-1"


def test_manifest_registry_rejects_undeclared_source_reference_fields():
    with pytest.raises(McpProfileValidationError, match="source reference"):
        McpGovernedSourceRegistry.from_manifest(
            {
                "manifest_version": "v1",
                "sources": [
                    {
                        "connector_id": "fabric-sales",
                        "profile_id": "fabric-pilot",
                        "source_reference": {
                            "source_id": "fabric:workspace-1:ontology-2",
                            "snapshot_id": "snapshot-1",
                            "endpoint": "https://untrusted.example.com/mcp",
                        },
                    },
                ],
            },
            profile_registry=McpProfileRegistry([_profile()]),
        )


def test_manifest_registry_rejects_an_unknown_public_connector():
    registry = McpGovernedSourceRegistry.from_manifest(
        {
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
        },
        profile_registry=McpProfileRegistry([_profile()]),
    )

    with pytest.raises(McpGovernedSourceNotFoundError):
        registry.get("unconfigured-connector")


def test_manifest_registry_rejects_a_source_for_an_unknown_profile():
    manifest = {
        "manifest_version": "v1",
        "sources": [
            {
                "connector_id": "fabric-sales",
                "profile_id": "unconfigured-profile",
                "source_reference": {
                    "source_id": "fabric:workspace-1:ontology-2",
                    "snapshot_id": "snapshot-1",
                },
            },
        ],
    }

    with pytest.raises(McpProfileNotFoundError):
        McpGovernedSourceRegistry.from_manifest(
            manifest,
            profile_registry=McpProfileRegistry([_profile()]),
        )


@pytest.mark.parametrize(
    "manifest",
    [
        {
            "manifest_version": "v2",
            "sources": [],
        },
        {
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
                {
                    "connector_id": "fabric-sales",
                    "profile_id": "fabric-pilot",
                    "source_reference": {
                        "source_id": "fabric:workspace-2:ontology-3",
                        "snapshot_id": "snapshot-2",
                    },
                },
            ],
        },
        {
            "manifest_version": "v1",
            "sources": [
                {
                    "connector_id": "https://untrusted.example.com/mcp",
                    "profile_id": "fabric-pilot",
                    "source_reference": {
                        "source_id": "fabric:workspace-1:ontology-2",
                        "snapshot_id": "snapshot-1",
                    },
                },
            ],
        },
    ],
)
def test_manifest_registry_rejects_an_invalid_deployment_manifest(manifest):
    with pytest.raises(McpProfileValidationError):
        McpGovernedSourceRegistry.from_manifest(
            manifest,
            profile_registry=McpProfileRegistry([_profile()]),
        )
