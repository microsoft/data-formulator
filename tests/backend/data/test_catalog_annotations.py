"""Tests for catalog_annotations module.

Background
----
Catalog annotations are user-owned metadata for catalog tables. This module
provides read/patch/lock/atomic-write operations with optimistic concurrency.

Covers:
- Single-table patch merge
- Empty description cleanup
- Version conflict detection
- Atomic write
- Corrupted file degradation
- Column-level annotation merge and cleanup
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from data_formulator.datalake.catalog_annotations import (
    AnnotationConflict,
    _clean_table_annotation,
    delete_annotations,
    load_annotations,
    patch_annotation,
)

pytestmark = [pytest.mark.backend]


# ── load / patch round-trip ───────────────────────────────────────────

class TestLoadAnnotations:
    def test_returns_none_for_missing(self, tmp_path: Path):
        assert load_annotations(tmp_path, "nonexistent") is None

    def test_returns_none_for_corrupted(self, tmp_path: Path):
        ann_dir = tmp_path / "catalog_annotations"
        ann_dir.mkdir()
        (ann_dir / "bad.json").write_text("{invalid json", encoding="utf-8")
        assert load_annotations(tmp_path, "bad") is None


class TestPatchAnnotation:
    def test_creates_new_file(self, tmp_path: Path):
        result = patch_annotation(
            tmp_path, "src1", "table-uuid-1",
            {"description": "Order table", "notes": "Business context"},
            expected_version=0,
        )
        assert result["version"] == 1

        data = load_annotations(tmp_path, "src1")
        assert data is not None
        assert data["version"] == 1
        assert data["tables"]["table-uuid-1"]["description"] == "Order table"
        assert data["tables"]["table-uuid-1"]["notes"] == "Business context"
        assert "updated_at" in data

    def test_increments_version(self, tmp_path: Path):
        patch_annotation(tmp_path, "src1", "t1", {"description": "v1"}, expected_version=0)
        result = patch_annotation(tmp_path, "src1", "t1", {"description": "v2"}, expected_version=1)
        assert result["version"] == 2

        data = load_annotations(tmp_path, "src1")
        assert data["tables"]["t1"]["description"] == "v2"

    def test_multiple_tables(self, tmp_path: Path):
        patch_annotation(tmp_path, "src1", "t1", {"description": "Table 1"}, expected_version=0)
        patch_annotation(tmp_path, "src1", "t2", {"description": "Table 2"}, expected_version=1)

        data = load_annotations(tmp_path, "src1")
        assert "t1" in data["tables"]
        assert "t2" in data["tables"]

    def test_preserves_other_tables(self, tmp_path: Path):
        patch_annotation(tmp_path, "src1", "t1", {"description": "A"}, expected_version=0)
        patch_annotation(tmp_path, "src1", "t2", {"description": "B"}, expected_version=1)

        data = load_annotations(tmp_path, "src1")
        assert data["tables"]["t1"]["description"] == "A"
        assert data["tables"]["t2"]["description"] == "B"


# ── Empty description cleanup ─────────────────────────────────────────

class TestCleanupSemantics:
    def test_empty_description_removes_key(self, tmp_path: Path):
        patch_annotation(tmp_path, "src1", "t1", {"description": "Initial"}, expected_version=0)
        patch_annotation(tmp_path, "src1", "t1", {"description": ""}, expected_version=1)

        data = load_annotations(tmp_path, "src1")
        assert "t1" not in data["tables"]

    def test_whitespace_description_removes_key(self, tmp_path: Path):
        patch_annotation(tmp_path, "src1", "t1", {"description": "Init"}, expected_version=0)
        patch_annotation(tmp_path, "src1", "t1", {"description": "  "}, expected_version=1)

        data = load_annotations(tmp_path, "src1")
        assert "t1" not in data["tables"]

    def test_all_empty_removes_table(self, tmp_path: Path):
        patch_annotation(
            tmp_path, "src1", "t1",
            {"description": "A", "notes": "B", "columns": {"c1": {"description": "D"}}},
            expected_version=0,
        )
        patch_annotation(
            tmp_path, "src1", "t1",
            {"description": "", "notes": "", "columns": {"c1": {"description": ""}}},
            expected_version=1,
        )
        data = load_annotations(tmp_path, "src1")
        assert "t1" not in data["tables"]


# ── Column-level annotations ──────────────────────────────────────────

class TestColumnAnnotations:
    def test_add_column_description(self, tmp_path: Path):
        patch_annotation(
            tmp_path, "src1", "t1",
            {"columns": {"order_id": {"description": "Unique ID"}}},
            expected_version=0,
        )
        data = load_annotations(tmp_path, "src1")
        assert data["tables"]["t1"]["columns"]["order_id"]["description"] == "Unique ID"

    def test_update_column_preserves_others(self, tmp_path: Path):
        patch_annotation(
            tmp_path, "src1", "t1",
            {"columns": {"c1": {"description": "First"}, "c2": {"description": "Second"}}},
            expected_version=0,
        )
        patch_annotation(
            tmp_path, "src1", "t1",
            {"columns": {"c1": {"description": "Updated"}}},
            expected_version=1,
        )
        data = load_annotations(tmp_path, "src1")
        assert data["tables"]["t1"]["columns"]["c1"]["description"] == "Updated"
        assert data["tables"]["t1"]["columns"]["c2"]["description"] == "Second"

    def test_empty_column_description_removes_column(self, tmp_path: Path):
        patch_annotation(
            tmp_path, "src1", "t1",
            {"description": "Keep", "columns": {"c1": {"description": "D"}}},
            expected_version=0,
        )
        patch_annotation(
            tmp_path, "src1", "t1",
            {"columns": {"c1": {"description": ""}}},
            expected_version=1,
        )
        data = load_annotations(tmp_path, "src1")
        assert "columns" not in data["tables"]["t1"]


# ── Version conflict ──────────────────────────────────────────────────

class TestVersionConflict:
    def test_conflict_raises(self, tmp_path: Path):
        patch_annotation(tmp_path, "src1", "t1", {"description": "A"}, expected_version=0)

        with pytest.raises(AnnotationConflict) as exc_info:
            patch_annotation(tmp_path, "src1", "t1", {"description": "B"}, expected_version=99)

        assert exc_info.value.current_version == 1

    def test_none_version_skips_check(self, tmp_path: Path):
        patch_annotation(tmp_path, "src1", "t1", {"description": "A"}, expected_version=0)
        result = patch_annotation(
            tmp_path, "src1", "t1", {"description": "B"}, expected_version=None,
        )
        assert result["version"] == 2

    def test_zero_version_for_new_file(self, tmp_path: Path):
        result = patch_annotation(
            tmp_path, "src1", "t1", {"description": "A"}, expected_version=0,
        )
        assert result["version"] == 1


# ── _clean_table_annotation ──────────────────────────────────────────

class TestCleanTableAnnotation:
    def test_all_empty_returns_none(self):
        assert _clean_table_annotation({}) is None
        assert _clean_table_annotation({"description": ""}) is None
        assert _clean_table_annotation({"description": "  ", "notes": ""}) is None

    def test_strips_whitespace(self):
        result = _clean_table_annotation({"description": "  hello  "})
        assert result == {"description": "hello"}

    def test_preserves_tags(self):
        result = _clean_table_annotation({"tags": ["finance", "orders"]})
        assert result["tags"] == ["finance", "orders"]

    def test_empty_tags_removed(self):
        assert _clean_table_annotation({"tags": []}) is None

    def test_columns_cleaned(self):
        result = _clean_table_annotation({
            "columns": {
                "c1": {"description": "good"},
                "c2": {"description": ""},
            }
        })
        assert "c1" in result["columns"]
        assert "c2" not in result["columns"]


# ── Delete ────────────────────────────────────────────────────────────

class TestDeleteAnnotations:
    def test_delete_removes_file(self, tmp_path: Path):
        patch_annotation(tmp_path, "src1", "t1", {"description": "A"}, expected_version=0)
        ann_file = tmp_path / "catalog_annotations" / "src1.json"
        assert ann_file.exists()

        delete_annotations(tmp_path, "src1")
        assert not ann_file.exists()

    def test_delete_nonexistent_is_noop(self, tmp_path: Path):
        delete_annotations(tmp_path, "nonexistent")
