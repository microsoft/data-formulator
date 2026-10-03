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
        self._tables = tables if tables is not None else []

    @staticmethod
    def list_params():
        return []

    @staticmethod
    def auth_instructions():
        return ""

    @staticmethod
    def catalog_hierarchy():
        return [
            {"key": "database", "label": "Database"},
            {"key": "table", "label": "Table"},
        ]

    def list_tables(self, table_filter=None):
        # Return fresh dicts so ensure_table_keys does not leak between tests.
        return [dict(t) for t in self._tables]

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


# ── table_key on tree / search responses ──────────────────────────────
#
# ``sync_catalog_metadata()`` backfills ``table_key`` before returning.  The
# tree and search responses must carry the same field, otherwise a loader that
# does not set it in ``list_tables()`` (athena, bigquery, s3, mongodb, ...)
# produces tree nodes without a stable identity.

def _table_nodes(tree):
    """Flatten the nested catalog tree down to its table nodes."""
    out = []
    for node in tree:
        if node.get("node_type") == "table" or node.get("metadata"):
            out.append(node)
        out.extend(_table_nodes(node.get("children") or []))
    return out


_DEFAULT_TABLES = [
    {"name": "orders", "path": ["shop", "orders"], "metadata": {"columns": []}},
    {"name": "users", "path": ["shop", "users"], "metadata": {"columns": []}},
]


class TestTreeAndSearchTableKey:
    def test_list_tables_tree_backfills_table_key(self):
        loader = _StubLoader(tables=_DEFAULT_TABLES)
        nodes = _table_nodes(loader.list_tables_tree()["tree"])
        assert nodes, "expected at least one table node"
        missing = [n["name"] for n in nodes if not (n.get("metadata") or {}).get("table_key")]
        assert missing == [], f"table nodes missing table_key: {missing}"

    def test_search_catalog_backfills_table_key(self):
        loader = _StubLoader(tables=_DEFAULT_TABLES)
        nodes = _table_nodes(loader.search_catalog("ord", limit=10)["tree"])
        assert nodes, "expected at least one table node"
        missing = [n["name"] for n in nodes if not (n.get("metadata") or {}).get("table_key")]
        assert missing == [], f"table nodes missing table_key: {missing}"

    def test_explicit_table_key_survives_tree(self):
        loader = _StubLoader(tables=[
            {"name": "orders", "path": ["shop", "orders"], "table_key": "uuid-123",
             "metadata": {"columns": []}},
        ])
        nodes = _table_nodes(loader.list_tables_tree()["tree"])
        assert nodes[0]["metadata"]["table_key"] == "uuid-123"

    def test_tree_and_sync_report_the_same_key(self):
        loader = _StubLoader(tables=_DEFAULT_TABLES)
        from_tree = {
            n["name"]: (n.get("metadata") or {}).get("table_key")
            for n in _table_nodes(loader.list_tables_tree()["tree"])
        }
        from_sync = {
            t["name"]: t.get("table_key")
            for t in loader.sync_catalog_metadata()
        }
        assert from_tree == from_sync

    def test_source_name_is_preferred_over_name(self):
        loader = _StubLoader(tables=[
            {"name": "orders", "path": ["shop", "orders"],
             "metadata": {"_source_name": "shop.orders", "columns": []}},
        ])
        nodes = _table_nodes(loader.list_tables_tree()["tree"])
        assert nodes[0]["metadata"]["table_key"] == "shop.orders"

    def test_empty_catalog_is_fine(self):
        loader = _StubLoader(tables=[])
        assert _table_nodes(loader.list_tables_tree()["tree"]) == []
        assert loader.search_catalog("nothing")["tree"] == []


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


# ── _tables_to_catalog_tree normalisation ─────────────────────────────

class TestTreeNormalizationBackfill:
    """``_tables_to_catalog_tree`` is the shared exit for every tree builder.

    Loaders that override ``list_tables_tree``/``search_catalog`` construct
    nodes without routing through the base methods, so backfilling at the call
    sites is not enough: the invariant has to hold inside the normalisation
    step itself.
    """

    def test_backfills_key_when_record_has_none(self):
        loader = _StubLoader(tables=_DEFAULT_TABLES)
        tree = loader._tables_to_catalog_tree([dict(t) for t in _DEFAULT_TABLES])
        nodes = _table_nodes(tree)
        assert nodes
        for node in nodes:
            assert node["metadata"]["table_key"]

    def test_explicit_key_is_not_overwritten(self):
        loader = _StubLoader()
        tree = loader._tables_to_catalog_tree([
            {"name": "orders", "table_key": "explicit-key", "metadata": {}},
        ])
        assert _table_nodes(tree)[0]["metadata"]["table_key"] == "explicit-key"

    def test_source_name_is_preferred_over_name(self):
        loader = _StubLoader()
        tree = loader._tables_to_catalog_tree([
            {
                "name": "short",
                "path": ["db", "short"],
                "metadata": {"_source_name": "db.short"},
            },
        ])
        assert _table_nodes(tree)[0]["metadata"]["table_key"] == "db.short"
