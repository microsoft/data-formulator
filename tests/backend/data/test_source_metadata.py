"""Tests for unified source metadata — Phase 1 schema & pipeline.

Covers ColumnInfo.description backward compat, metadata merge during
ingest, get_column_types default, and /api/tables/list-tables extension.
"""
from __future__ import annotations

import json
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from data_formulator.datalake.workspace_metadata import (
    ColumnInfo,
    TableMetadata,
    WorkspaceMetadata,
)
from data_formulator.data_loader.external_data_loader import (
    _merge_source_metadata,
    infer_source_metadata_status,
    SOURCE_METADATA_PARTIAL,
    SOURCE_METADATA_SYNCED,
    SOURCE_METADATA_UNAVAILABLE,
)

pytestmark = [pytest.mark.backend]


# ── ColumnInfo backward-compat ────────────────────────────────────────

class TestColumnInfoDescription:
    def test_from_dict_without_description(self):
        """Old YAML data without description deserializes cleanly."""
        col = ColumnInfo.from_dict({"name": "order_id", "dtype": "int64"})
        assert col.name == "order_id"
        assert col.dtype == "int64"
        assert col.description is None

    def test_from_dict_with_description(self):
        col = ColumnInfo.from_dict({
            "name": "order_id",
            "dtype": "int64",
            "description": "Unique order identifier",
        })
        assert col.description == "Unique order identifier"

    def test_to_dict_omits_none_description(self):
        """description key is not emitted when None — keeps YAML clean."""
        col = ColumnInfo(name="x", dtype="int64")
        d = col.to_dict()
        assert "description" not in d

    def test_to_dict_includes_description_when_present(self):
        col = ColumnInfo(name="x", dtype="int64", description="A column")
        d = col.to_dict()
        assert d["description"] == "A column"

    def test_roundtrip_with_description(self):
        original = ColumnInfo(name="c", dtype="text", description="Some desc")
        restored = ColumnInfo.from_dict(original.to_dict())
        assert restored.description == "Some desc"

    def test_roundtrip_without_description(self):
        original = ColumnInfo(name="c", dtype="text")
        restored = ColumnInfo.from_dict(original.to_dict())
        assert restored.description is None


# ── TableMetadata serialization with column descriptions ──────────────

class TestTableMetadataColumnDescriptions:
    def _make_meta(self, columns):
        return TableMetadata(
            name="test",
            source_type="data_loader",
            filename="test.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            columns=columns,
        )

    def test_serialize_columns_with_descriptions(self):
        meta = self._make_meta([
            ColumnInfo(name="a", dtype="int64", description="Column A"),
            ColumnInfo(name="b", dtype="text"),
        ])
        d = meta.to_dict()
        assert d["columns"][0]["description"] == "Column A"
        assert "description" not in d["columns"][1]

    def test_deserialize_old_metadata_no_column_description(self):
        """Simulate loading workspace.yaml written before description existed."""
        data = {
            "source_type": "data_loader",
            "filename": "test.parquet",
            "file_type": "parquet",
            "created_at": "2026-01-01T00:00:00+00:00",
            "columns": [
                {"name": "a", "dtype": "int64"},
                {"name": "b", "dtype": "text"},
            ],
        }
        meta = TableMetadata.from_dict("test", data)
        assert meta.columns[0].description is None
        assert meta.columns[1].description is None


# ── _merge_source_metadata ────────────────────────────────────────────

class TestMergeSourceMetadata:
    def _make_meta(self, columns, description=None):
        return TableMetadata(
            name="orders",
            source_type="data_loader",
            filename="orders.parquet",
            file_type="parquet",
            created_at=datetime.now(timezone.utc),
            columns=columns,
            description=description,
        )

    def test_merges_table_description(self):
        meta = self._make_meta([ColumnInfo("a", "int64")])
        _merge_source_metadata(meta, {"description": "Order table"})
        assert meta.description == "Order table"

    def test_merges_column_descriptions(self):
        meta = self._make_meta([
            ColumnInfo("order_id", "int64"),
            ColumnInfo("status", "text"),
        ])
        _merge_source_metadata(meta, {
            "columns": [
                {"name": "order_id", "type": "integer", "description": "PK"},
                {"name": "status", "type": "varchar"},
            ],
        })
        assert meta.columns[0].description == "PK"
        assert meta.columns[1].description is None

    def test_no_crash_on_empty_source_meta(self):
        meta = self._make_meta([ColumnInfo("a", "int64")])
        _merge_source_metadata(meta, {})
        assert meta.description is None

    def test_no_crash_when_columns_none(self):
        meta = self._make_meta(None)
        _merge_source_metadata(meta, {
            "description": "desc",
            "columns": [{"name": "x", "description": "y"}],
        })
        assert meta.description == "desc"

    def test_empty_description_clears_existing(self):
        """Per design: source returns empty → clear (以源为准)."""
        meta = self._make_meta([ColumnInfo("a", "int64")], description="existing")
        _merge_source_metadata(meta, {"description": ""})
        assert meta.description is None

    def test_missing_key_preserves_existing(self):
        """When source doesn't include 'description' key, keep existing."""
        meta = self._make_meta([ColumnInfo("a", "int64")], description="existing")
        _merge_source_metadata(meta, {"columns": [{"name": "a"}]})
        assert meta.description == "existing"


# ── ingest_to_workspace metadata enrichment ───────────────────────────

class TestIngestMetadataEnrichment:
    def test_ingest_enriches_metadata_on_success(self):
        """ingest_to_workspace should call get_column_types and merge."""
        import pyarrow as pa
        from data_formulator.data_loader.external_data_loader import ExternalDataLoader

        arrow = pa.table({"a": [1, 2], "b": ["x", "y"]})

        class FakeLoader(ExternalDataLoader):
            def __init__(self, params):
                self.params = params

            @staticmethod
            def list_params():
                return []

            @staticmethod
            def auth_instructions():
                return ""

            def list_tables(self, table_filter=None):
                return []

            def fetch_data_as_arrow(self, source_table, import_options=None):
                return arrow

            def get_column_types(self, source_table):
                return {
                    "description": "Test table",
                    "columns": [
                        {"name": "a", "type": "integer", "description": "Col A"},
                        {"name": "b", "type": "varchar"},
                    ],
                }

        loader = FakeLoader({})
        workspace = MagicMock()
        fake_meta = TableMetadata(
            name="t", source_type="data_loader",
            filename="t.parquet", file_type="parquet",
            created_at=datetime.now(timezone.utc),
            columns=[ColumnInfo("a", "int64"), ColumnInfo("b", "object")],
        )
        workspace.write_parquet_from_arrow.return_value = fake_meta

        result = loader.ingest_to_workspace(workspace, "t", "src.t")
        assert result.description == "Test table"
        assert result.columns[0].description == "Col A"
        assert result.columns[1].description is None
        workspace.add_table_metadata.assert_called_once_with(fake_meta)

    def test_ingest_succeeds_when_metadata_fails(self):
        """Metadata enrichment failure must not block import."""
        import pyarrow as pa
        from data_formulator.data_loader.external_data_loader import ExternalDataLoader

        arrow = pa.table({"x": [1]})

        class FailingMetaLoader(ExternalDataLoader):
            def __init__(self, params):
                self.params = params

            @staticmethod
            def list_params():
                return []

            @staticmethod
            def auth_instructions():
                return ""

            def list_tables(self, table_filter=None):
                return []

            def fetch_data_as_arrow(self, source_table, import_options=None):
                return arrow

            def get_column_types(self, source_table):
                raise RuntimeError("metadata unavailable")

        loader = FailingMetaLoader({})
        workspace = MagicMock()
        fake_meta = TableMetadata(
            name="t", source_type="data_loader",
            filename="t.parquet", file_type="parquet",
            created_at=datetime.now(timezone.utc),
            columns=[ColumnInfo("x", "int64")],
        )
        workspace.write_parquet_from_arrow.return_value = fake_meta

        result = loader.ingest_to_workspace(workspace, "t", "src.t")
        assert result is fake_meta
        workspace.add_table_metadata.assert_not_called()


# ── get_column_types default preserves description ────────────────────

class TestGetColumnTypesDefault:
    def test_preserves_table_description(self):
        from data_formulator.data_loader.external_data_loader import ExternalDataLoader

        class DescLoader(ExternalDataLoader):
            def __init__(self, params):
                self.params = params

            @staticmethod
            def list_params():
                return []

            @staticmethod
            def auth_instructions():
                return ""

            def list_tables(self, table_filter=None):
                return []

            def fetch_data_as_arrow(self, source_table, import_options=None):
                raise NotImplementedError

            def get_metadata(self, path):
                return {
                    "description": "Order fact table",
                    "columns": [{"name": "id", "type": "integer"}],
                }

        loader = DescLoader({})
        result = loader.get_column_types("public.orders")
        assert result["description"] == "Order fact table"
        assert result["columns"] == [{"name": "id", "type": "integer"}]

    def test_returns_empty_when_no_metadata(self):
        from data_formulator.data_loader.external_data_loader import ExternalDataLoader

        class EmptyLoader(ExternalDataLoader):
            def __init__(self, params):
                self.params = params

            @staticmethod
            def list_params():
                return []

            @staticmethod
            def auth_instructions():
                return ""

            def list_tables(self, table_filter=None):
                return []

            def fetch_data_as_arrow(self, source_table, import_options=None):
                raise NotImplementedError

            def get_metadata(self, path):
                return {}

        loader = EmptyLoader({})
        assert loader.get_column_types("t") == {}


# ── source_metadata_status inference ──────────────────────────────────

class TestInferSourceMetadataStatus:
    def test_none_metadata_returns_unavailable(self):
        assert infer_source_metadata_status(None) == SOURCE_METADATA_UNAVAILABLE

    def test_empty_metadata_returns_unavailable(self):
        assert infer_source_metadata_status({}) == SOURCE_METADATA_UNAVAILABLE

    def test_columns_without_descriptions_returns_synced(self):
        meta = {"description": "Order table", "columns": [{"name": "id"}]}
        assert infer_source_metadata_status(meta) == SOURCE_METADATA_SYNCED

    def test_columns_with_description_returns_synced(self):
        meta = {"columns": [{"name": "id", "description": "Primary key"}]}
        assert infer_source_metadata_status(meta) == SOURCE_METADATA_SYNCED

    def test_both_table_and_column_metadata_returns_synced(self):
        meta = {
            "description": "Order table",
            "columns": [{"name": "id", "description": "PK"}],
        }
        assert infer_source_metadata_status(meta) == SOURCE_METADATA_SYNCED

    def test_explicit_status_overrides_inference(self):
        meta = {"source_metadata_status": "unavailable", "description": "Override"}
        assert infer_source_metadata_status(meta) == SOURCE_METADATA_UNAVAILABLE

    def test_no_columns_key_returns_partial_with_desc(self):
        meta = {"description": "Table only"}
        assert infer_source_metadata_status(meta) == SOURCE_METADATA_PARTIAL

    def test_empty_columns_returns_partial(self):
        meta = {"description": "Known empty columns", "columns": []}
        assert infer_source_metadata_status(meta) == SOURCE_METADATA_PARTIAL


# ── _tables_to_catalog_tree injects status ────────────────────────────

class TestCatalogTreeMetadataStatus:
    def _make_loader(self):
        from data_formulator.data_loader.external_data_loader import ExternalDataLoader
        import pyarrow as pa

        class StubLoader(ExternalDataLoader):
            def __init__(self, params):
                self.params = params

            @staticmethod
            def list_params():
                return []

            @staticmethod
            def auth_instructions():
                return ""

            def list_tables(self, table_filter=None):
                return []

            def fetch_data_as_arrow(self, source_table, import_options=None):
                return pa.table({"x": [1]})

        return StubLoader({})

    def test_tree_leaf_has_status_injected(self):
        loader = self._make_loader()
        tables = [
            {
                "name": "orders",
                "metadata": {
                    "description": "Full",
                    "columns": [{"name": "id", "description": "PK"}],
                },
            },
            {
                "name": "bare_table",
                "metadata": {"columns": [{"name": "x"}]},
            },
        ]
        tree = loader._tables_to_catalog_tree(tables)
        orders = next(n for n in tree if n["name"] == "orders")
        bare = next(n for n in tree if n["name"] == "bare_table")
        assert orders["metadata"]["source_metadata_status"] == SOURCE_METADATA_SYNCED
        assert bare["metadata"]["source_metadata_status"] == SOURCE_METADATA_SYNCED

    def test_explicit_status_preserved_in_tree(self):
        loader = self._make_loader()
        tables = [{
            "name": "custom",
            "metadata": {"source_metadata_status": "partial"},
        }]
        tree = loader._tables_to_catalog_tree(tables)
        assert tree[0]["metadata"]["source_metadata_status"] == "partial"
