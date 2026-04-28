"""Tests for catalog_merge — merged metadata view from cache + annotations.

Background
----
The merge module produces a runtime merged metadata view combining
source metadata from catalog_cache with user annotations. User
annotations have priority for display, but source descriptions
are preserved for agent search weighting.
"""
from __future__ import annotations

import pytest

from data_formulator.datalake.catalog_merge import (
    merge_catalog,
    merge_table_metadata,
)

pytestmark = [pytest.mark.backend]


class TestMergeTableMetadata:

    def test_no_annotation(self):
        cache = {
            "name": "orders",
            "table_key": "uuid-1",
            "metadata": {
                "description": "Source description",
                "columns": [
                    {"name": "id", "type": "int", "description": "Primary key"},
                ],
            },
        }
        result = merge_table_metadata(cache, None)
        meta = result["metadata"]
        assert meta["display_description"] == "Source description"
        assert meta["source_description"] == "Source description"
        assert meta["user_description"] == ""
        assert meta["columns"][0]["display_description"] == "Primary key"

    def test_user_annotation_overrides_display(self):
        cache = {
            "name": "orders",
            "table_key": "uuid-1",
            "metadata": {
                "description": "From source",
                "columns": [
                    {"name": "id", "type": "int", "description": "Source col desc"},
                ],
            },
        }
        ann = {
            "description": "User override",
            "columns": {"id": {"description": "User col desc"}},
        }
        result = merge_table_metadata(cache, ann)
        meta = result["metadata"]
        assert meta["display_description"] == "User override"
        assert meta["source_description"] == "From source"
        assert meta["user_description"] == "User override"
        assert meta["columns"][0]["display_description"] == "User col desc"
        assert meta["columns"][0]["source_description"] == "Source col desc"

    def test_notes_and_tags(self):
        cache = {"name": "t1", "table_key": "k1", "metadata": {}}
        ann = {"notes": "Business context", "tags": ["finance"]}
        result = merge_table_metadata(cache, ann)
        assert result["metadata"]["notes"] == "Business context"
        assert result["metadata"]["tags"] == ["finance"]

    def test_user_only_column(self):
        cache = {
            "name": "t1",
            "table_key": "k1",
            "metadata": {"columns": [{"name": "id", "type": "int"}]},
        }
        ann = {"columns": {"new_col": {"description": "User added"}}}
        result = merge_table_metadata(cache, ann)
        col_names = [c["name"] for c in result["metadata"]["columns"]]
        assert "id" in col_names
        assert "new_col" in col_names
        new_col = next(c for c in result["metadata"]["columns"] if c["name"] == "new_col")
        assert new_col["display_description"] == "User added"

    def test_does_not_mutate_input(self):
        cache = {"name": "t1", "table_key": "k1", "metadata": {"description": "orig"}}
        ann = {"description": "user"}
        merge_table_metadata(cache, ann)
        assert cache["metadata"]["description"] == "orig"
        assert "display_description" not in cache["metadata"]


class TestMergeCatalog:

    def test_merges_by_table_key(self):
        cache_tables = [
            {"name": "t1", "table_key": "k1", "metadata": {"description": "Source T1"}},
            {"name": "t2", "table_key": "k2", "metadata": {"description": "Source T2"}},
        ]
        annotations = {
            "tables": {
                "k1": {"description": "User T1"},
            },
        }
        result = merge_catalog(cache_tables, annotations)
        assert len(result) == 2

        t1 = next(t for t in result if t["table_key"] == "k1")
        assert t1["metadata"]["display_description"] == "User T1"

        t2 = next(t for t in result if t["table_key"] == "k2")
        assert t2["metadata"]["display_description"] == "Source T2"

    def test_none_annotations(self):
        cache_tables = [{"name": "t1", "table_key": "k1", "metadata": {"description": "D"}}]
        result = merge_catalog(cache_tables, None)
        assert result[0]["metadata"]["display_description"] == "D"

    def test_empty_annotations(self):
        cache_tables = [{"name": "t1", "table_key": "k1", "metadata": {}}]
        result = merge_catalog(cache_tables, {"tables": {}})
        assert result[0]["metadata"]["display_description"] == ""
