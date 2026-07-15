"""Tests for the fixed-source governed MCP data loader."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

import data_formulator.data_connector as data_connector
from data_formulator.mcp.errors import (
    McpProfileValidationError,
    McpResultValidationError,
)
from data_formulator.mcp.profile import (
    McpOperation,
    McpServerProfile,
    McpSourceReference,
)
from data_formulator.mcp_gateway.contracts import McpOperationResult
from data_formulator.mcp_gateway.source_registry import (
    McpGovernedSource,
    McpGovernedSourceRegistry,
)
from data_formulator.data_connector import register_governed_mcp_connectors
from data_formulator.data_loader.mcp_governed_data_loader import (
    create_mcp_governed_data_loader_type,
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
            "max_pages": 1,
            "total_timeout_seconds": 30,
        },
        "require_approval": True,
    })


def _source() -> McpGovernedSource:
    return McpGovernedSource(
        connector_id="fabric-sales",
        profile=_profile(),
        source_reference=McpSourceReference(
            source_id="fabric:workspace-1:ontology-2",
            snapshot_id="snapshot-1",
        ),
    )


@dataclass
class _GatewayClient:
    result: McpOperationResult
    calls: list[dict[str, Any]] = field(default_factory=list)

    def execute(self, **kwargs: Any) -> McpOperationResult:
        self.calls.append(kwargs)
        return self.result


class TestMcpGovernedDataLoader:
    def test_lists_catalog_from_its_server_resolved_source(self):
        source = _source()
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=(
                    {
                        "name": "sales.orders",
                        "metadata": {
                            "columns": [{"name": "order_id", "type": "INTEGER"}],
                            "_source_name": "untrusted.orders",
                            "mcp_snapshot_id": "untrusted-snapshot",
                            "mcp_source_id": "untrusted-source",
                        },
                    },
                ),
                next_page=None,
            )
        )
        loader_type = create_mcp_governed_data_loader_type(
            source=source,
            gateway_client=gateway_client,
        )

        tables = loader_type({}).list_tables()

        assert tables == [
            {
                "name": "sales.orders",
                "table_key": "sales.orders",
                "metadata": {
                    "_source_name": "sales.orders",
                    "columns": [{"name": "order_id", "type": "INTEGER"}],
                    "mcp_snapshot_id": "snapshot-1",
                    "mcp_source_id": "fabric:workspace-1:ontology-2",
                },
            },
        ]
        assert gateway_client.calls == [
            {
                "source": source,
                "operation": McpOperation.CATALOG,
                "arguments": {},
                "page": 1,
            },
        ]

    def test_catalog_refresh_requeries_the_same_immutable_source(self):
        source = _source()
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=({"name": "sales.orders", "metadata": {}},),
                next_page=None,
            )
        )
        loader_type = create_mcp_governed_data_loader_type(
            source=source,
            gateway_client=gateway_client,
        )
        loader = loader_type({})

        first = loader.sync_catalog_metadata(table_filter="sales")
        gateway_client.result = McpOperationResult(
            profile_id=source.profile.profile_id,
            operation=McpOperation.CATALOG,
            source_reference=source.source_reference,
            items=({"name": "sales.customers", "metadata": {}},),
            next_page=None,
        )
        second = loader.sync_catalog_metadata(table_filter="sales")

        assert [table["table_key"] for table in first] == ["sales.orders"]
        assert [table["table_key"] for table in second] == ["sales.customers"]
        assert len(gateway_client.calls) == 2
        for call in gateway_client.calls:
            assert call == {
                "source": source,
                "operation": McpOperation.CATALOG,
                "arguments": {"table_filter": "sales"},
                "page": 1,
            }

    def test_rejects_a_catalog_continuation_token(self):
        source = _source()
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=(),
                next_page="page-2",
            )
        )
        loader_type = create_mcp_governed_data_loader_type(
            source=source,
            gateway_client=gateway_client,
        )

        with pytest.raises(McpResultValidationError, match="continuation"):
            loader_type({}).list_tables()

    def test_rejects_catalog_results_for_a_different_source(self):
        source = _source()
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=McpSourceReference(
                    source_id="fabric:workspace-2:ontology-3",
                    snapshot_id="snapshot-1",
                ),
                items=(),
                next_page=None,
            )
        )
        loader_type = create_mcp_governed_data_loader_type(
            source=source,
            gateway_client=gateway_client,
        )

        with pytest.raises(McpResultValidationError, match="source"):
            loader_type({}).list_tables()

    def test_rejects_catalog_metadata_that_is_not_an_object(self):
        source = _source()
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=({"name": "sales.orders", "metadata": "invalid"},),
                next_page=None,
            )
        )
        loader_type = create_mcp_governed_data_loader_type(
            source=source,
            gateway_client=gateway_client,
        )

        with pytest.raises(McpResultValidationError, match="metadata"):
            loader_type({}).list_tables()

    def test_preserves_the_server_resolved_source_name_in_catalog_metadata(self):
        source = _source()
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=(
                    {
                        "name": "sales.orders",
                        "metadata": {"_source_name": "untrusted-override"},
                    },
                ),
                next_page=None,
            )
        )
        loader_type = create_mcp_governed_data_loader_type(
            source=source,
            gateway_client=gateway_client,
        )

        tables = loader_type({}).list_tables()

        assert tables[0]["metadata"]["_source_name"] == "sales.orders"

    def test_registers_only_manifest_resolved_admin_connectors(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        source = _source()
        registry = McpGovernedSourceRegistry([source])
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=(),
                next_page=None,
            )
        )
        monkeypatch.setattr(data_connector, "DATA_CONNECTORS", {})
        monkeypatch.setattr(data_connector, "_ADMIN_CONNECTOR_IDS", set())

        register_governed_mcp_connectors(
            source_registry=registry,
            gateway_client=gateway_client,
        )

        assert set(data_connector.DATA_CONNECTORS) == {"fabric-sales"}
        assert data_connector._ADMIN_CONNECTOR_IDS == {"fabric-sales"}

    def test_manifest_connector_is_shared_without_identity_copies(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        source = _source()
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=(),
                next_page=None,
            )
        )
        monkeypatch.setattr(data_connector, "DATA_CONNECTORS", {})
        monkeypatch.setattr(data_connector, "_ADMIN_CONNECTOR_IDS", set())

        register_governed_mcp_connectors(
            source_registry=McpGovernedSourceRegistry([source]),
            gateway_client=gateway_client,
        )

        alice = [
            (key, connector)
            for key, connector, _is_admin
            in data_connector._visible_connector_items("user:alice")
        ]
        bob = [
            (key, connector)
            for key, connector, _is_admin
            in data_connector._visible_connector_items("user:bob")
        ]

        assert alice == bob == [
            ("fabric-sales", data_connector.DATA_CONNECTORS["fabric-sales"]),
        ]
        assert (
            data_connector._user_connector_key("user:alice", "fabric-sales")
            not in data_connector.DATA_CONNECTORS
        )
        assert (
            data_connector._user_connector_key("user:bob", "fabric-sales")
            not in data_connector.DATA_CONNECTORS
        )

    def test_rejects_collisions_without_partially_registering_connectors(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        source = _source()
        additional_source = McpGovernedSource(
            connector_id="fabric-finance",
            profile=source.profile,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-3",
                snapshot_id="snapshot-1",
            ),
        )
        registry = McpGovernedSourceRegistry([additional_source, source])
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=(),
                next_page=None,
            )
        )
        monkeypatch.setattr(
            data_connector,
            "DATA_CONNECTORS",
            {"fabric-sales": object()},
        )
        monkeypatch.setattr(data_connector, "_ADMIN_CONNECTOR_IDS", set())

        with pytest.raises(McpProfileValidationError, match="conflicts"):
            register_governed_mcp_connectors(
                source_registry=registry,
                gateway_client=gateway_client,
            )

        assert set(data_connector.DATA_CONNECTORS) == {"fabric-sales"}
        assert data_connector._ADMIN_CONNECTOR_IDS == set()

    def test_loader_construction_failure_does_not_partially_register_connectors(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ):
        source = _source()
        additional_source = McpGovernedSource(
            connector_id="fabric-finance",
            profile=source.profile,
            source_reference=McpSourceReference(
                source_id="fabric:workspace-1:ontology-3",
                snapshot_id="snapshot-1",
            ),
        )
        registry = McpGovernedSourceRegistry([source, additional_source])
        gateway_client = _GatewayClient(
            McpOperationResult(
                profile_id=source.profile.profile_id,
                operation=McpOperation.CATALOG,
                source_reference=source.source_reference,
                items=(),
                next_page=None,
            )
        )
        original_from_loader = data_connector.DataConnector.from_loader
        construction_count = 0

        def fail_second_construction(*args, **kwargs):
            nonlocal construction_count
            construction_count += 1
            if construction_count == 2:
                raise RuntimeError("construction failed")
            return original_from_loader(*args, **kwargs)

        monkeypatch.setattr(data_connector, "DATA_CONNECTORS", {})
        monkeypatch.setattr(data_connector, "_ADMIN_CONNECTOR_IDS", set())
        monkeypatch.setattr(
            data_connector.DataConnector,
            "from_loader",
            fail_second_construction,
        )

        with pytest.raises(RuntimeError, match="construction failed"):
            register_governed_mcp_connectors(
                source_registry=registry,
                gateway_client=gateway_client,
            )

        assert data_connector.DATA_CONNECTORS == {}
        assert data_connector._ADMIN_CONNECTOR_IDS == set()
