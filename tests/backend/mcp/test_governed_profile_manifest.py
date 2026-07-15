"""Tests for loading administrator-owned governed MCP profiles."""

from __future__ import annotations

import json

import pytest

from data_formulator.mcp.errors import McpProfileValidationError
from data_formulator.mcp_gateway.profile_manifest import (
    load_profile_registry_from_environment,
)

pytestmark = [pytest.mark.backend]


def _profile_data(*, profile_id: str = "fabric-pilot") -> dict[str, object]:
    return {
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
            "max_pages": 1,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    }


def test_leaves_profiles_unavailable_when_no_manifest_is_configured(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("MCP_GOVERNED_PROFILE_MANIFEST_PATH", raising=False)

    registry = load_profile_registry_from_environment()

    assert registry is None


def test_loads_profiles_from_the_configured_deployment_manifest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    manifest_path = tmp_path / "governed-profiles.json"
    manifest_path.write_text(
        json.dumps({
            "manifest_version": "v1",
            "profiles": [_profile_data()],
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv("MCP_GOVERNED_PROFILE_MANIFEST_PATH", str(manifest_path))

    registry = load_profile_registry_from_environment()

    assert registry is not None
    assert registry.get("fabric-pilot").profile_id == "fabric-pilot"


@pytest.mark.parametrize(
    "manifest",
    [
        {"manifest_version": "v1", "profiles": [], "extra": True},
        {"manifest_version": "v1", "profiles": []},
        {"manifest_version": "v2", "profiles": [_profile_data()]},
        {
            "manifest_version": "v1",
            "profiles": [_profile_data(), _profile_data()],
        },
    ],
)
def test_rejects_an_invalid_profile_manifest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
    manifest,
):
    manifest_path = tmp_path / "governed-profiles.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setenv("MCP_GOVERNED_PROFILE_MANIFEST_PATH", str(manifest_path))

    with pytest.raises(McpProfileValidationError):
        load_profile_registry_from_environment()


def test_rejects_a_malformed_configured_profile_manifest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    manifest_path = tmp_path / "governed-profiles.json"
    manifest_path.write_text("{not-json", encoding="utf-8")
    monkeypatch.setenv("MCP_GOVERNED_PROFILE_MANIFEST_PATH", str(manifest_path))

    with pytest.raises(McpProfileValidationError, match="could not be loaded"):
        load_profile_registry_from_environment()
