"""Validation contract for administrator-owned MCP server profiles."""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from data_formulator.mcp.profile import (
    McpCapabilityManifest,
    McpOperation,
    McpProfileValidationError,
    McpServerProfile,
    McpSourceClass,
    McpSourceReference,
    McpToolPolicy,
)

pytestmark = [pytest.mark.backend]


def _profile_data(**overrides: object) -> dict[str, object]:
    profile: dict[str, object] = {
        "profile_id": "fabric-pilot",
        "version": "v1",
        "endpoint": "https://gateway.example.com/mcp",
        "audience": "api://data-formulator-mcp-gateway",
        "server_label": "fabric-pilot",
        "source_class": McpSourceClass.FABRIC_IQ.value,
        "operations": [
            McpOperation.CATALOG.value,
            McpOperation.SCHEMA.value,
            McpOperation.SEMANTIC_QUERY.value,
            McpOperation.HEALTH.value,
        ],
        "capability_manifest": {
            "profile_version": "v1",
            "result_schema_version": "v1",
            "required_operations": [
                McpOperation.CATALOG.value,
                McpOperation.SCHEMA.value,
                McpOperation.SEMANTIC_QUERY.value,
                McpOperation.HEALTH.value,
            ],
        },
        "allowed_tools": ["fabric.list_entities", "fabric.search_ontology"],
        "limits": {
            "max_rows": 10_000,
            "max_bytes": 32 * 1024 * 1024,
            "max_pages": 200,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    }
    profile.update(overrides)
    return profile


class TestMcpServerProfile:
    def test_creates_immutable_fabric_iq_profile(self):
        profile = McpServerProfile.from_dict(_profile_data())

        assert profile.profile_id == "fabric-pilot"
        assert profile.operations == frozenset({
            McpOperation.CATALOG,
            McpOperation.SCHEMA,
            McpOperation.SEMANTIC_QUERY,
            McpOperation.HEALTH,
        })
        assert profile.capability_manifest.required_operations == profile.operations
        with pytest.raises(FrozenInstanceError):
            profile.profile_id = "other"  # type: ignore[misc]

    def test_rejects_profile_with_mismatched_capability_manifest(self):
        with pytest.raises(McpProfileValidationError, match="manifest"):
            McpServerProfile.from_dict(_profile_data(capability_manifest={
                "profile_version": "v1",
                "result_schema_version": "v1",
                "required_operations": [McpOperation.CATALOG.value],
            }))

    @pytest.mark.parametrize(
        "endpoint",
        [
            "http://gateway.example.com/mcp",
            "https:///mcp",
            "https://user:password@gateway.example.com/mcp",
            "https://gateway.example.com/mcp?profile=user-input",
        ],
    )
    def test_rejects_untrusted_endpoint(self, endpoint):
        with pytest.raises(McpProfileValidationError, match="endpoint"):
            McpServerProfile.from_dict(_profile_data(endpoint=endpoint))

    @pytest.mark.parametrize("allowed_tools", [["*"], ["fabric.*"]])
    def test_rejects_wildcard_tool_allowlist(self, allowed_tools):
        with pytest.raises(McpProfileValidationError, match="tool"):
            McpServerProfile.from_dict(_profile_data(allowed_tools=allowed_tools))

    def test_rejects_unknown_operation(self):
        with pytest.raises(McpProfileValidationError, match="operation"):
            McpServerProfile.from_dict(_profile_data(operations=["execute_sql"]))

    def test_rejects_source_class_operation_mismatch(self):
        with pytest.raises(McpProfileValidationError, match="source class"):
            McpServerProfile.from_dict(_profile_data(
                source_class=McpSourceClass.ONELAKE_METADATA.value,
                operations=[McpOperation.SEMANTIC_QUERY.value],
            ))

    @pytest.mark.parametrize(
        "tool_name",
        [
            "workiq.create_entity",
            "workiq.update_entity",
            "workiq.delete_entity",
            "workiq.do_action",
            "workiq.call_function",
            "workiq.ask",
        ],
    )
    def test_rejects_work_iq_mutation_or_broad_reasoning_tool(self, tool_name):
        with pytest.raises(McpProfileValidationError, match="Work IQ"):
            McpServerProfile.from_dict(_profile_data(
                source_class=McpSourceClass.WORK_IQ.value,
                operations=[McpOperation.SCHEMA.value, McpOperation.HEALTH.value],
                capability_manifest={
                    "profile_version": "v1",
                    "result_schema_version": "v1",
                    "required_operations": [
                        McpOperation.SCHEMA.value,
                        McpOperation.HEALTH.value,
                    ],
                },
                allowed_tools=[tool_name],
            ))

    @pytest.mark.parametrize(
        "limits",
        [
            {"max_rows": 0, "max_bytes": 32, "max_pages": 1, "total_timeout_seconds": 1},
            {"max_rows": 1, "max_bytes": 0, "max_pages": 1, "total_timeout_seconds": 1},
            {"max_rows": 1, "max_bytes": 32, "max_pages": 0, "total_timeout_seconds": 1},
            {"max_rows": 1, "max_bytes": 32, "max_pages": 1, "total_timeout_seconds": 0},
        ],
    )
    def test_rejects_nonpositive_limits(self, limits):
        with pytest.raises(McpProfileValidationError, match="limit"):
            McpServerProfile.from_dict(_profile_data(limits=limits))

    def test_rejects_unsupported_profile_version(self):
        with pytest.raises(McpProfileValidationError, match="version"):
            McpServerProfile.from_dict(_profile_data(version="v2"))


class TestMcpSupportingContracts:
    def test_creates_immutable_read_only_work_iq_policy(self):
        policy = McpToolPolicy.from_dict({
            "allowed_tools": ["workiq.fetch", "workiq.get_schema"],
            "require_approval": True,
        }, McpSourceClass.WORK_IQ)

        assert policy.allowed_tools == frozenset({
            "workiq.fetch",
            "workiq.get_schema",
        })
        with pytest.raises(FrozenInstanceError):
            policy.require_approval = False  # type: ignore[misc]

    def test_rejects_work_iq_policy_without_approved_read_tool(self):
        with pytest.raises(McpProfileValidationError, match="Work IQ"):
            McpToolPolicy.from_dict({
                "allowed_tools": ["workiq.search_paths"],
                "require_approval": True,
            }, McpSourceClass.WORK_IQ)

    def test_creates_capability_manifest_for_profile_version(self):
        manifest = McpCapabilityManifest.from_dict({
            "profile_version": "v1",
            "result_schema_version": "v1",
            "required_operations": ["catalog", "schema"],
        })

        assert manifest.required_operations == frozenset({
            McpOperation.CATALOG,
            McpOperation.SCHEMA,
        })

    @pytest.mark.parametrize(
        "manifest",
        [
            {
                "profile_version": "v2",
                "result_schema_version": "v1",
                "required_operations": ["catalog"],
            },
            {
                "profile_version": "v1",
                "result_schema_version": "v2",
                "required_operations": ["catalog"],
            },
            {
                "profile_version": "v1",
                "result_schema_version": "v1",
                "required_operations": ["execute_sql"],
            },
        ],
    )
    def test_rejects_incompatible_capability_manifest(self, manifest):
        with pytest.raises(McpProfileValidationError):
            McpCapabilityManifest.from_dict(manifest)

    def test_creates_source_reference_with_stable_ids(self):
        reference = McpSourceReference.from_dict({
            "source_id": "fabric:workspace-1:ontology-2",
            "snapshot_id": "2026-07-14T16:00:00Z",
        })

        assert reference.source_id == "fabric:workspace-1:ontology-2"
        assert reference.snapshot_id == "2026-07-14T16:00:00Z"

    @pytest.mark.parametrize(
        ("reference", "field_name"),
        [
            ({"source_id": "", "snapshot_id": "snapshot-1"}, "source_id"),
            (
                {
                    "source_id": "https://untrusted.example/source",
                    "snapshot_id": "snapshot-1",
                },
                "source_id",
            ),
            ({"source_id": "fabric:source", "snapshot_id": ""}, "snapshot_id"),
        ],
    )
    def test_rejects_unstable_or_endpoint_source_reference(self, reference, field_name):
        with pytest.raises(McpProfileValidationError, match=field_name):
            McpSourceReference.from_dict(reference)
