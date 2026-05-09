"""Tests for sync_catalog_metadata base class method and table_key contract.

Background
----
The catalog metadata sync feature introduces a new ExternalDataLoader method
``sync_catalog_metadata()`` with a default implementation that delegates to
``list_tables()`` and ensures every record has a ``table_key``.  New
ErrorCodes are added for catalog/annotation operations.
"""
from __future__ import annotations

import pytest
import pyarrow as pa

from data_formulator.data_loader.external_data_loader import (
    ExternalDataLoader,
    SOURCE_METADATA_SYNCED,
    SOURCE_METADATA_NOT_SYNCED,
    SOURCE_METADATA_PARTIAL,
    SOURCE_METADATA_UNAVAILABLE,
)
from data_formulator.errors import ErrorCode

pytestmark = [pytest.mark.backend]


# ── Stub loader for testing ───────────────────────────────────────────

class _StubLoader(ExternalDataLoader):
    """Minimal concrete loader for base-class method testing."""

    def __init__(self, params=None, tables=None):
        self.params = params or {}
        self._tables = tables or []

    @staticmethod
    def list_params():
        return []

    @staticmethod
    def auth_instructions():
        return ""

    def list_tables(self, table_filter=None):
        return list(self._tables)

    def fetch_data_as_arrow(self, source_table, import_options=None):
        return pa.table({"x": [1]})


# ── sync_catalog_metadata default implementation ──────────────────────

class TestSyncCatalogMetadataDefault:
    def test_returns_list_tables_results(self):
        tables = [
            {"name": "orders", "table_key": "public.orders", "metadata": {}},
            {"name": "users", "table_key": "public.users", "metadata": {}},
        ]
        loader = _StubLoader(tables=tables)
        result = loader.sync_catalog_metadata()
        assert len(result) == 2
        assert result[0]["name"] == "orders"
        assert result[1]["name"] == "users"

    def test_passes_table_filter(self):
        tables = [{"name": "orders", "table_key": "orders", "metadata": {}}]
        loader = _StubLoader(tables=tables)
        result = loader.sync_catalog_metadata(table_filter="orders")
        assert len(result) == 1

    def test_empty_tables(self):
        loader = _StubLoader(tables=[])
        result = loader.sync_catalog_metadata()
        assert result == []


# ── ensure_table_keys ─────────────────────────────────────────────────

class TestEnsureTableKeys:
    def test_existing_table_key_preserved(self):
        tables = [{"name": "t", "table_key": "my-uuid-123", "metadata": {}}]
        ExternalDataLoader.ensure_table_keys(tables)
        assert tables[0]["table_key"] == "my-uuid-123"

    def test_fallback_to_source_name(self):
        tables = [{"name": "t", "metadata": {"_source_name": "db.public.t"}}]
        ExternalDataLoader.ensure_table_keys(tables)
        assert tables[0]["table_key"] == "db.public.t"

    def test_fallback_to_name(self):
        tables = [{"name": "orders", "metadata": {}}]
        ExternalDataLoader.ensure_table_keys(tables)
        assert tables[0]["table_key"] == "orders"

    def test_fallback_to_name_no_metadata(self):
        tables = [{"name": "orders"}]
        ExternalDataLoader.ensure_table_keys(tables)
        assert tables[0]["table_key"] == "orders"

    def test_empty_list(self):
        tables = []
        ExternalDataLoader.ensure_table_keys(tables)
        assert tables == []

    def test_does_not_overwrite_existing_key(self):
        tables = [
            {"name": "t", "table_key": "explicit", "metadata": {"_source_name": "fallback"}},
        ]
        ExternalDataLoader.ensure_table_keys(tables)
        assert tables[0]["table_key"] == "explicit"


# ── source_metadata_status constants ──────────────────────────────────

class TestSourceMetadataStatusConstants:
    def test_synced_value(self):
        assert SOURCE_METADATA_SYNCED == "synced"

    def test_not_synced_value(self):
        assert SOURCE_METADATA_NOT_SYNCED == "not_synced"

    def test_partial_value(self):
        assert SOURCE_METADATA_PARTIAL == "partial"

    def test_unavailable_value(self):
        assert SOURCE_METADATA_UNAVAILABLE == "unavailable"


# ── New ErrorCodes exist ──────────────────────────────────────────────

class TestCatalogErrorCodes:
    def test_catalog_sync_timeout(self):
        assert ErrorCode.CATALOG_SYNC_TIMEOUT == "CATALOG_SYNC_TIMEOUT"

    def test_catalog_not_found(self):
        assert ErrorCode.CATALOG_NOT_FOUND == "CATALOG_NOT_FOUND"
