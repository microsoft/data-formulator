"""Tests for offline governed MCP deployment bootstrap."""

from __future__ import annotations

import json

import pytest

import data_formulator.data_connector as data_connector
import data_formulator.mcp_gateway.bootstrap as bootstrap
from data_formulator.mcp.errors import McpProfileValidationError

pytestmark = [pytest.mark.backend]


def _profile_data() -> dict[str, object]:
    return {
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
            "max_pages": 1,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    }


def test_absent_profile_configuration_does_not_load_sources_or_register(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[str] = []
    monkeypatch.delenv("MCP_GOVERNED_SOURCE_MANIFEST_PATH", raising=False)
    monkeypatch.setattr(
        bootstrap,
        "load_profile_registry_from_environment",
        lambda: None,
    )
    monkeypatch.setattr(
        bootstrap,
        "load_governed_source_registry_from_environment",
        lambda **_: calls.append("source"),
    )
    monkeypatch.setattr(
        bootstrap,
        "register_governed_mcp_connectors",
        lambda **_: calls.append("register"),
    )

    configured = bootstrap.bootstrap_governed_mcp_connectors(
        gateway_client=object()
    )

    assert configured is False
    assert calls == []


def test_source_configuration_without_profiles_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[str] = []
    monkeypatch.setenv(
        "MCP_GOVERNED_SOURCE_MANIFEST_PATH",
        "configured-sources.json",
    )
    monkeypatch.setattr(
        bootstrap,
        "load_profile_registry_from_environment",
        lambda: None,
    )
    monkeypatch.setattr(
        bootstrap,
        "load_governed_source_registry_from_environment",
        lambda **_: calls.append("source"),
    )

    with pytest.raises(McpProfileValidationError, match="profiles"):
        bootstrap.bootstrap_governed_mcp_connectors(gateway_client=object())

    assert calls == []


def test_valid_manifests_register_only_their_governed_connectors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    profile_path = tmp_path / "profiles.json"
    profile_path.write_text(
        json.dumps({
            "manifest_version": "v1",
            "profiles": [_profile_data()],
        }),
        encoding="utf-8",
    )
    source_path = tmp_path / "sources.json"
    source_path.write_text(
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
                }
            ],
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv(
        "MCP_GOVERNED_PROFILE_MANIFEST_PATH",
        str(profile_path),
    )
    monkeypatch.setenv(
        "MCP_GOVERNED_SOURCE_MANIFEST_PATH",
        str(source_path),
    )
    monkeypatch.setattr(data_connector, "DATA_CONNECTORS", {})
    monkeypatch.setattr(data_connector, "_ADMIN_CONNECTOR_IDS", set())

    configured = bootstrap.bootstrap_governed_mcp_connectors(
        gateway_client=object()
    )

    assert configured is True
    assert set(data_connector.DATA_CONNECTORS) == {"fabric-sales"}
    assert data_connector._ADMIN_CONNECTOR_IDS == {"fabric-sales"}
