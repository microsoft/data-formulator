"""Tests for bounded, profile-pinned gateway operation contracts."""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from data_formulator.mcp.errors import (
    McpOperationValidationError,
    McpResultValidationError,
)
from data_formulator.mcp.profile import (
    McpOperation,
    McpOperationLimits,
    McpServerProfile,
    McpSourceReference,
)
from data_formulator.mcp_gateway.contracts import (
    McpOperationRequest,
    McpOperationResult,
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
            "max_rows": 2,
            "max_bytes": 1024,
            "max_pages": 2,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    })


def _source_reference() -> McpSourceReference:
    return McpSourceReference(
        source_id="fabric:workspace-1:ontology-2",
        snapshot_id="snapshot-1",
    )


class TestMcpOperationRequest:
    def test_creates_profile_pinned_catalog_request(self):
        request = McpOperationRequest.create(
            profile=_profile(),
            operation=McpOperation.CATALOG,
            source_reference=_source_reference(),
            arguments={"query": "orders"},
            operation_id="operation-1",
        )

        assert request.profile_id == "fabric-pilot"
        assert request.operation is McpOperation.CATALOG
        assert request.arguments == {"query": "orders"}

    @pytest.mark.parametrize(
        "arguments",
        [
            {"tool": "fabric.delete_ontology"},
            {"endpoint": "https://untrusted.example/mcp"},
            {"tool_name": "fabric.list_entities"},
        ],
    )
    def test_rejects_caller_supplied_tool_or_endpoint(self, arguments):
        with pytest.raises(McpOperationValidationError, match="arguments"):
            McpOperationRequest.create(
                profile=_profile(),
                operation=McpOperation.CATALOG,
                source_reference=_source_reference(),
                arguments=arguments,
                operation_id="operation-1",
            )

    def test_rejects_operation_outside_profile_mapping(self):
        with pytest.raises(McpOperationValidationError, match="approved"):
            McpOperationRequest.create(
                profile=_profile(),
                operation=McpOperation.BOUNDED_READ,
                source_reference=_source_reference(),
                arguments={},
                operation_id="operation-1",
            )

    def test_rejects_page_above_profile_limit(self):
        with pytest.raises(McpOperationValidationError, match="page"):
            McpOperationRequest.create(
                profile=_profile(),
                operation=McpOperation.CATALOG,
                source_reference=_source_reference(),
                arguments={},
                operation_id="operation-1",
                page=3,
            )


class TestMcpOperationResult:
    def test_parses_versioned_bounded_result_for_matching_source(self):
        request = McpOperationRequest.create(
            profile=_profile(),
            operation=McpOperation.CATALOG,
            source_reference=_source_reference(),
            arguments={},
            operation_id="operation-1",
        )
        payload = json.dumps({
            "result_schema_version": "v1",
            "source_reference": {
                "source_id": "fabric:workspace-1:ontology-2",
                "snapshot_id": "snapshot-1",
            },
            "items": [{"name": "orders"}, {"name": "customers"}],
            "next_page": "page-2",
        })

        result = McpOperationResult.from_upstream_json(
            profile=_profile(),
            request=request,
            payload=payload,
        )

        assert result.items == ({"name": "orders"}, {"name": "customers"})
        assert result.next_page == "page-2"

    @pytest.mark.parametrize(
        "payload",
        [
            "not-json",
            json.dumps({
                "result_schema_version": "v2",
                "source_reference": {
                    "source_id": "fabric:workspace-1:ontology-2",
                    "snapshot_id": "snapshot-1",
                },
                "items": [],
            }),
            json.dumps({
                "result_schema_version": "v1",
                "source_reference": {
                    "source_id": "fabric:workspace-1:other",
                    "snapshot_id": "snapshot-1",
                },
                "items": [],
            }),
            json.dumps({
                "result_schema_version": "v1",
                "source_reference": {
                    "source_id": "fabric:workspace-1:ontology-2",
                    "snapshot_id": "snapshot-1",
                },
                "items": [{"name": "one"}, {"name": "two"}, {"name": "three"}],
            }),
        ],
    )
    def test_rejects_malformed_or_unbounded_result(self, payload):
        request = McpOperationRequest.create(
            profile=_profile(),
            operation=McpOperation.CATALOG,
            source_reference=_source_reference(),
            arguments={},
            operation_id="operation-1",
        )

        with pytest.raises(McpResultValidationError):
            McpOperationResult.from_upstream_json(
                profile=_profile(),
                request=request,
                payload=payload,
            )

    def test_rejects_result_exceeding_profile_byte_limit(self):
        profile = replace(
            _profile(),
            limits=McpOperationLimits(
                max_rows=2,
                max_bytes=64,
                max_pages=2,
                total_timeout_seconds=30,
            ),
        )
        request = McpOperationRequest.create(
            profile=profile,
            operation=McpOperation.CATALOG,
            source_reference=_source_reference(),
            arguments={},
            operation_id="operation-1",
        )
        payload = json.dumps({
            "result_schema_version": "v1",
            "source_reference": {
                "source_id": "fabric:workspace-1:ontology-2",
                "snapshot_id": "snapshot-1",
            },
            "items": [],
        })

        with pytest.raises(McpResultValidationError, match="byte"):
            McpOperationResult.from_upstream_json(
                profile=profile,
                request=request,
                payload=payload,
            )
