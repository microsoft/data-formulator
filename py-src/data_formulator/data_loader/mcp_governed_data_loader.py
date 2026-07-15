"""Fixed-source Data Formulator loader for governed MCP catalog metadata."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

import pyarrow as pa

from data_formulator.mcp.errors import McpResultValidationError
from data_formulator.mcp.profile import McpOperation
from data_formulator.mcp_gateway.contracts import McpOperationResult
from data_formulator.mcp_gateway.source_registry import McpGovernedSource
from data_formulator.data_loader.external_data_loader import ExternalDataLoader


class McpGovernedGatewayClient(Protocol):
    """Invoke a fixed product operation for one server-resolved source."""

    def execute(
        self,
        *,
        source: McpGovernedSource,
        operation: McpOperation,
        arguments: Mapping[str, object],
        page: int,
    ) -> McpOperationResult:
        """Return one validated operation result."""


class McpGovernedDataLoader(ExternalDataLoader):
    """Expose catalog metadata from one administrator-bound MCP source."""

    DISPLAY_NAME = "Governed MCP"

    def __init__(
        self,
        params: dict[str, Any],
        *,
        source: McpGovernedSource,
        gateway_client: McpGovernedGatewayClient,
    ) -> None:
        if params:
            raise ValueError("governed MCP loaders do not accept connection parameters")
        self.params: dict[str, Any] = {}
        self._source = source
        self._gateway_client = gateway_client

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        """Expose no browser-configurable connection parameters."""
        return []

    @staticmethod
    def auth_instructions() -> str:
        """Describe the administrator-owned authentication boundary."""
        return "This source is provisioned by an administrator."

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List one bounded catalog page from the fixed governed source."""
        arguments: dict[str, object] = {}
        if table_filter:
            arguments["table_filter"] = table_filter
        result = self._gateway_client.execute(
            source=self._source,
            operation=McpOperation.CATALOG,
            arguments=arguments,
            page=1,
        )
        if result.profile_id != self._source.profile.profile_id:
            raise McpResultValidationError(
                "governed MCP catalog result profile does not match the source"
            )
        if result.operation is not McpOperation.CATALOG:
            raise McpResultValidationError(
                "governed MCP catalog result operation is invalid"
            )
        if result.source_reference != self._source.source_reference:
            raise McpResultValidationError(
                "governed MCP catalog result source does not match the binding"
            )
        if result.next_page is not None:
            raise McpResultValidationError(
                "governed MCP catalog continuation is not supported"
            )
        return [_catalog_item_to_table(item, source=self._source) for item in result.items]

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """Reject bulk data reads until an approved data-plane contract exists."""
        raise NotImplementedError(
            "governed MCP bounded reads are not available in the catalog-only loader"
        )


def create_mcp_governed_data_loader_type(
    *,
    source: McpGovernedSource,
    gateway_client: McpGovernedGatewayClient,
) -> type[McpGovernedDataLoader]:
    """Create a loader type whose source binding cannot come from browser input."""

    class ConfiguredMcpGovernedDataLoader(McpGovernedDataLoader):
        def __init__(self, params: dict[str, Any]) -> None:
            super().__init__(
                params,
                source=source,
                gateway_client=gateway_client,
            )

    return ConfiguredMcpGovernedDataLoader


def _catalog_item_to_table(
    item: Mapping[str, Any],
    *,
    source: McpGovernedSource,
) -> dict[str, Any]:
    if set(item) - {"name", "metadata"} or "name" not in item:
        raise McpResultValidationError(
            "governed MCP catalog item has an unsupported schema"
        )
    name = item["name"]
    if not isinstance(name, str) or not name.strip():
        raise McpResultValidationError("governed MCP catalog item name is invalid")
    metadata = item.get("metadata", {})
    if not isinstance(metadata, Mapping):
        raise McpResultValidationError(
            "governed MCP catalog item metadata must be an object"
        )
    return {
        "name": name,
        "table_key": name,
        "metadata": {
            **dict(metadata),
            "_source_name": name,
            "mcp_source_id": source.source_reference.source_id,
            "mcp_snapshot_id": source.source_reference.snapshot_id,
        },
    }
