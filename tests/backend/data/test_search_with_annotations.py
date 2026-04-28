"""Tests for catalog search with annotation overlay.

Background
----
Search results should include user annotations with higher weight.
User annotation description match: +8
Source description match: +5
User column description match: +3
Source column description match: +1
Table name match: +10
Column name match: +2
User notes match: +3

Also tests match_reasons field in results.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from data_formulator.datalake.catalog_cache import (
    _search_python,
    save_catalog,
    search_catalog_cache,
)

pytestmark = [pytest.mark.backend]


def _setup_cache(tmp_path: Path, source_id: str, tables: list[dict]) -> None:
    save_catalog(tmp_path, source_id, tables)


class TestSearchWithAnnotations:

    def test_user_description_boosts_score(self, tmp_path: Path):
        tables = [
            {
                "name": "orders",
                "table_key": "k1",
                "metadata": {"description": "Generic order table"},
            },
            {
                "name": "products",
                "table_key": "k2",
                "metadata": {"description": "Product catalog"},
            },
        ]
        _setup_cache(tmp_path, "src1", tables)

        annotations = {
            "src1": {
                "tables": {
                    "k2": {"description": "Contains finance related product data"},
                },
            },
        }

        results = search_catalog_cache(
            tmp_path, "finance", annotations_by_source=annotations,
        )
        assert len(results) == 1
        assert results[0]["table_key"] == "k2"
        assert "user_description" in results[0]["match_reasons"]

    def test_user_annotation_higher_weight(self, tmp_path: Path):
        tables = [
            {
                "name": "t1",
                "table_key": "k1",
                "metadata": {"description": "Contains revenue data"},
            },
            {
                "name": "t2",
                "table_key": "k2",
                "metadata": {"description": "No match here"},
            },
        ]
        _setup_cache(tmp_path, "src1", tables)

        annotations = {
            "src1": {
                "tables": {
                    "k2": {"description": "Revenue summary report"},
                },
            },
        }

        results = search_catalog_cache(
            tmp_path, "revenue", annotations_by_source=annotations,
        )
        assert len(results) == 2
        # t2 has user_description match (+8) > t1 has source_description match (+5)
        assert results[0]["table_key"] == "k2"
        assert results[0]["score"] > results[1]["score"]

    def test_user_notes_match(self, tmp_path: Path):
        tables = [
            {"name": "t1", "table_key": "k1", "metadata": {}},
        ]
        _setup_cache(tmp_path, "src1", tables)

        annotations = {
            "src1": {
                "tables": {
                    "k1": {"notes": "Used for quarterly finance reports"},
                },
            },
        }

        results = search_catalog_cache(
            tmp_path, "quarterly", annotations_by_source=annotations,
        )
        assert len(results) == 1
        assert "user_notes" in results[0]["match_reasons"]

    def test_user_column_description_match(self, tmp_path: Path):
        tables = [
            {
                "name": "t1",
                "table_key": "k1",
                "metadata": {"columns": [{"name": "amount", "description": ""}]},
            },
        ]
        _setup_cache(tmp_path, "src1", tables)

        annotations = {
            "src1": {
                "tables": {
                    "k1": {"columns": {"amount": {"description": "Tax-inclusive revenue"}}},
                },
            },
        }

        results = search_catalog_cache(
            tmp_path, "tax", annotations_by_source=annotations,
        )
        assert len(results) == 1
        assert "user_column_description" in results[0]["match_reasons"]
        assert "amount" in results[0]["matched_columns"]


class TestMatchReasons:

    def test_table_name_reason(self, tmp_path: Path):
        tables = [{"name": "revenue_report", "table_key": "k1", "metadata": {}}]
        _setup_cache(tmp_path, "src1", tables)

        results = _search_python(tmp_path, "revenue", ["src1"], set(), 20)
        assert len(results) == 1
        assert "table_name" in results[0]["match_reasons"]

    def test_source_description_reason(self, tmp_path: Path):
        tables = [{"name": "t1", "table_key": "k1", "metadata": {"description": "Revenue data"}}]
        _setup_cache(tmp_path, "src1", tables)

        results = _search_python(tmp_path, "revenue", ["src1"], set(), 20)
        assert "source_description" in results[0]["match_reasons"]

    def test_column_name_reason(self, tmp_path: Path):
        tables = [{
            "name": "t1",
            "table_key": "k1",
            "metadata": {"columns": [{"name": "revenue_amt"}]},
        }]
        _setup_cache(tmp_path, "src1", tables)

        results = _search_python(tmp_path, "revenue", ["src1"], set(), 20)
        assert "column_name" in results[0]["match_reasons"]

    def test_multiple_reasons(self, tmp_path: Path):
        tables = [{
            "name": "revenue",
            "table_key": "k1",
            "metadata": {
                "description": "Revenue summary",
                "columns": [{"name": "revenue_amt", "description": "Annual revenue"}],
            },
        }]
        _setup_cache(tmp_path, "src1", tables)

        results = _search_python(tmp_path, "revenue", ["src1"], set(), 20)
        reasons = results[0]["match_reasons"]
        assert "table_name" in reasons
        assert "source_description" in reasons
        assert "column_name" in reasons
        assert "source_column_description" in reasons


class TestDisplayDescription:

    def test_display_uses_user_over_source(self, tmp_path: Path):
        tables = [{
            "name": "t1",
            "table_key": "k1",
            "metadata": {"description": "Source desc"},
        }]
        _setup_cache(tmp_path, "src1", tables)

        annotations = {
            "src1": {"tables": {"k1": {"description": "User desc"}}},
        }
        results = _search_python(
            tmp_path, "t1", ["src1"], set(), 20,
            annotations_by_source=annotations,
        )
        assert results[0]["description"] == "User desc"

    def test_display_falls_back_to_source(self, tmp_path: Path):
        tables = [{
            "name": "t1",
            "table_key": "k1",
            "metadata": {"description": "Source desc"},
        }]
        _setup_cache(tmp_path, "src1", tables)

        results = _search_python(tmp_path, "t1", ["src1"], set(), 20)
        assert results[0]["description"] == "Source desc"
