# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for the catalog_cache module and its integration with DataConnector.

Covers:
- save / load / delete round-trip with user-home path
- search_catalog_cache keyword matching and exclusion
- list_cached_sources
- DataConnector routes correctly call save/delete with user-home path
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import flask
import pyarrow as pa
import pytest

from data_formulator.datalake.catalog_cache import (
    delete_catalog,
    list_cached_sources,
    load_catalog,
    save_catalog,
    search_catalog_cache,
    _search_python,
)

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

SAMPLE_TABLES: list[dict[str, Any]] = [
    {
        "name": "public.orders",
        "path": ["public", "orders"],
        "metadata": {
            "columns": [
                {"name": "order_id", "type": "int"},
                {"name": "customer_name", "type": "varchar"},
            ],
            "description": "订单事实表",
        },
    },
    {
        "name": "public.products",
        "path": ["public", "products"],
        "metadata": {
            "columns": [
                {"name": "product_id", "type": "int"},
                {"name": "title", "type": "varchar"},
            ],
            "description": "Product catalog",
        },
    },
]


# ==================================================================
# Tests: save / load round-trip
# ==================================================================

class TestSaveLoadCatalog:

    def test_save_creates_directory_and_file(self, tmp_path: Path) -> None:
        user_home = tmp_path / "users" / "alice"
        save_catalog(user_home, "pg_prod", SAMPLE_TABLES)

        cache_file = user_home / "catalog_cache" / "pg_prod.json"
        assert cache_file.is_file()

        with open(cache_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["source_id"] == "pg_prod"
        assert len(data["tables"]) == 2

    def test_load_returns_saved_tables(self, tmp_path: Path) -> None:
        user_home = tmp_path / "users" / "bob"
        save_catalog(user_home, "mysql_dev", SAMPLE_TABLES)

        loaded = load_catalog(user_home, "mysql_dev")
        assert loaded is not None
        assert len(loaded) == 2
        assert loaded[0]["name"] == "public.orders"

    def test_load_returns_none_for_missing(self, tmp_path: Path) -> None:
        assert load_catalog(tmp_path, "nonexistent") is None

    def test_save_overwrites_existing(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "src1", [{"name": "old_table"}])
        save_catalog(tmp_path, "src1", [{"name": "new_table"}])
        loaded = load_catalog(tmp_path, "src1")
        assert loaded is not None
        assert len(loaded) == 1
        assert loaded[0]["name"] == "new_table"

    def test_source_id_with_special_chars(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "mysql:prod/db", SAMPLE_TABLES)
        loaded = load_catalog(tmp_path, "mysql:prod/db")
        assert loaded is not None
        assert len(loaded) == 2


# ==================================================================
# Tests: delete
# ==================================================================

class TestDeleteCatalog:

    def test_delete_removes_file(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", SAMPLE_TABLES)
        cache_file = tmp_path / "catalog_cache" / "pg_prod.json"
        assert cache_file.exists()

        delete_catalog(tmp_path, "pg_prod")
        assert not cache_file.exists()

    def test_delete_nonexistent_is_silent(self, tmp_path: Path) -> None:
        delete_catalog(tmp_path, "nonexistent")

    def test_delete_rejects_symlink_escape(self, tmp_path: Path) -> None:
        cache_dir = tmp_path / "catalog_cache"
        cache_dir.mkdir()
        outside = tmp_path / "outside.json"
        outside.write_text("do not delete", encoding="utf-8")
        link = cache_dir / "pg_prod.json"
        try:
            link.symlink_to(outside)
        except OSError:
            pytest.skip("symlink creation is not available on this platform")

        delete_catalog(tmp_path, "pg_prod")

        assert outside.exists()
        assert link.is_symlink()


# ==================================================================
# Tests: list_cached_sources
# ==================================================================

class TestListCachedSources:

    def test_returns_source_ids(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", [])
        save_catalog(tmp_path, "mysql_dev", [])
        sources = list_cached_sources(tmp_path)
        assert set(sources) == {"pg_prod", "mysql_dev"}

    def test_returns_empty_for_missing_dir(self, tmp_path: Path) -> None:
        assert list_cached_sources(tmp_path / "nonexistent") == []

    def test_returns_canonical_id_with_colon(self, tmp_path: Path) -> None:
        # ``mysql:mysql`` is sanitised to ``mysql--mysql.json`` on disk, but
        # callers (agents, frontend) need the canonical id back so that
        # ``connector_id`` lookups against the in-memory registry succeed.
        # Regression: previously this returned the filename stem.
        save_catalog(tmp_path, "mysql:mysql", [])
        save_catalog(tmp_path, "postgresql:prod-db", [])
        assert set(list_cached_sources(tmp_path)) == {
            "mysql:mysql",
            "postgresql:prod-db",
        }

    def test_falls_back_to_stem_when_source_id_missing(self, tmp_path: Path) -> None:
        # Corrupted / legacy files without a ``source_id`` field still surface
        # something usable rather than silently dropping the source.
        cache_dir = tmp_path / "catalog_cache"
        cache_dir.mkdir()
        (cache_dir / "legacy_stem.json").write_text("{}", encoding="utf-8")
        assert list_cached_sources(tmp_path) == ["legacy_stem"]


# ==================================================================
# Tests: search_catalog_cache
# ==================================================================

class TestSearchCatalogCache:

    @pytest.fixture(autouse=True)
    def _setup_cache(self, tmp_path: Path) -> None:
        self.user_home = tmp_path
        save_catalog(tmp_path, "pg_prod", SAMPLE_TABLES)

    def test_search_by_table_name(self) -> None:
        results = search_catalog_cache(self.user_home, "orders")
        assert len(results) >= 1
        assert results[0]["name"] == "public.orders"

    def test_search_by_description(self) -> None:
        results = search_catalog_cache(self.user_home, "订单")
        assert len(results) >= 1
        assert results[0]["name"] == "public.orders"

    def test_search_by_column_name(self) -> None:
        results = search_catalog_cache(self.user_home, "customer_name")
        assert len(results) >= 1
        assert "customer_name" in results[0]["matched_columns"]

    def test_search_excludes_imported_tables(self) -> None:
        results = search_catalog_cache(
            self.user_home, "orders", exclude_tables={"public.orders"},
        )
        names = {r["name"] for r in results}
        assert "public.orders" not in names

    def test_search_returns_empty_for_no_match(self) -> None:
        results = search_catalog_cache(self.user_home, "zzz_nonexistent_zzz")
        assert results == []

    def test_search_respects_limit_per_source(self) -> None:
        many_tables = [
            {"name": f"table_{i}", "metadata": {"columns": [], "description": "match"}}
            for i in range(50)
        ]
        save_catalog(self.user_home, "big_source", many_tables)
        results = search_catalog_cache(
            self.user_home, "match",
            source_ids=["big_source"],
            limit_per_source=5,
        )
        assert len(results) <= 5


# ==================================================================
# Tests: structured-field search produces match_reasons and scoring
# ==================================================================

RICH_TABLES: list[dict[str, Any]] = [
    {
        "name": "public.orders",
        "metadata": {
            "columns": [
                {"name": "order_id", "type": "int", "description": "Primary key"},
                {"name": "customer_name", "type": "varchar"},
            ],
            "description": "订单事实表",
        },
    },
    {
        "name": "public.products",
        "metadata": {
            "columns": [
                {"name": "product_id", "type": "int"},
                {"name": "title", "type": "varchar", "description": "Product title"},
            ],
            "description": "Product catalog",
        },
    },
    {
        "name": "public.empty_meta",
        "metadata": {"columns": []},
    },
]


class TestStructuredFieldSearch:
    """Verify per-field scoring + match_reasons reported by ``_search_python``."""

    @pytest.fixture(autouse=True)
    def _setup_cache(self, tmp_path: Path) -> None:
        self.user_home = tmp_path
        save_catalog(tmp_path, "pg_prod", RICH_TABLES)

    def _run(self, query: str, **kwargs: Any) -> list[dict[str, Any]]:
        ids = list_cached_sources(self.user_home)
        return _search_python(self.user_home, query, ids, set(), 20, **kwargs)

    def test_table_name_match_reports_table_name_reason(self) -> None:
        results = self._run("orders")
        assert len(results) >= 1
        assert results[0]["name"] == "public.orders"
        assert "table_name" in results[0]["match_reasons"]

    def test_table_description_match(self) -> None:
        results = self._run("订单")
        assert len(results) >= 1
        assert results[0]["name"] == "public.orders"
        assert "source_description" in results[0]["match_reasons"]

    def test_column_name_match(self) -> None:
        results = self._run("customer_name")
        assert len(results) >= 1
        assert "customer_name" in results[0]["matched_columns"]
        assert "column_name" in results[0]["match_reasons"]

    def test_column_description_match(self) -> None:
        results = self._run("Primary key")
        assert len(results) >= 1
        assert "source_column_description" in results[0]["match_reasons"]

    def test_no_match_returns_empty(self) -> None:
        assert self._run("zzz_nonexistent_zzz") == []

    def test_exclude_tables_drops_matches(self) -> None:
        ids = list_cached_sources(self.user_home)
        results = _search_python(
            self.user_home, "orders", ids, {"public.orders"}, 20,
        )
        assert all(r["name"] != "public.orders" for r in results)

    def test_search_catalog_cache_end_to_end(self) -> None:
        results = search_catalog_cache(self.user_home, "product")
        assert any(r["name"] == "public.products" for r in results)

    def test_regex_query_alternation(self) -> None:
        results = self._run("orders|products")
        names = {r["name"] for r in results}
        assert {"public.orders", "public.products"} <= names


# ==================================================================
# Tests: list_sources_summary / list_path_children (design-docs/32)
# ==================================================================

_HIER_TABLES: list[dict[str, Any]] = [
    {
        "name": "monthly_orders",
        "table_key": "k_orders",
        "path": ["Sales", "monthly_orders"],
        "metadata": {"description": "Monthly orders", "columns": []},
    },
    {
        "name": "monthly_returns",
        "table_key": "k_returns",
        "path": ["Sales", "monthly_returns"],
        "metadata": {"description": "Monthly returns", "columns": []},
    },
    {
        "name": "fy24",
        "table_key": "k_fy24",
        "path": ["Sales", "Archive", "fy24"],
        "metadata": {"description": "FY24 archive", "columns": []},
    },
    {
        "name": "customers",
        "table_key": "k_customers",
        "path": ["customers"],
        "metadata": {"description": "Customer dimension", "columns": []},
    },
]


class TestListSourcesSummary:
    def test_flat_and_hierarchical(self, tmp_path: Path) -> None:
        from data_formulator.datalake.catalog_cache import list_sources_summary

        save_catalog(tmp_path, "pg_prod", _HIER_TABLES)
        save_catalog(tmp_path, "flat_src", [
            {"name": "t1", "table_key": "k1", "metadata": {}},
            {"name": "t2", "table_key": "k2", "metadata": {}},
        ])

        summary = list_sources_summary(tmp_path)
        by_id = {s["source_id"]: s for s in summary}
        assert by_id["pg_prod"]["table_count"] == 4
        assert by_id["pg_prod"]["is_hierarchical"] is True
        assert by_id["flat_src"]["table_count"] == 2
        assert by_id["flat_src"]["is_hierarchical"] is False

    def test_empty_when_no_cache(self, tmp_path: Path) -> None:
        from data_formulator.datalake.catalog_cache import list_sources_summary

        assert list_sources_summary(tmp_path) == []


class TestListPathChildren:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path: Path) -> None:
        self.user_home = tmp_path
        save_catalog(tmp_path, "pg_prod", _HIER_TABLES)

    def test_root_lists_folders_and_top_level_tables(self) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        result = list_path_children(self.user_home, "pg_prod")

        folder_names = {f["name"] for f in result["folders"]}
        table_names = {t["name"] for t in result["tables"]}
        assert folder_names == {"Sales"}
        assert table_names == {"customers"}
        assert result["total_folders"] == 1
        assert result["total_tables"] == 1
        assert result["truncated"] is False

    def test_drill_into_folder(self) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        result = list_path_children(self.user_home, "pg_prod", path=["Sales"])

        folder_names = {f["name"] for f in result["folders"]}
        table_names = {t["name"] for t in result["tables"]}
        assert folder_names == {"Archive"}
        assert table_names == {"monthly_orders", "monthly_returns"}

    def test_filter_narrows_results(self) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        result = list_path_children(
            self.user_home, "pg_prod", path=["Sales"], filter="orders",
        )
        assert {t["name"] for t in result["tables"]} == {"monthly_orders"}
        assert result["folders"] == []

    def test_missing_source_returns_empty(self, tmp_path: Path) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        result = list_path_children(tmp_path, "missing_src")
        assert result["folders"] == []
        assert result["tables"] == []
        assert result["truncated"] is False

    def test_truncation_includes_hint(self) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        # 5 leaves at root, cap to 2 → truncated with hint.
        many_root = [
            {"name": f"t{i}", "table_key": f"k{i}", "path": [f"t{i}"], "metadata": {}}
            for i in range(5)
        ]
        save_catalog(self.user_home, "many_src", many_root)
        result = list_path_children(self.user_home, "many_src", limit=2)

        assert result["truncated"] is True
        assert len(result["tables"]) == 2
        assert "hint" in result
        assert result["total_tables"] == 5


# ==================================================================
# Tests: search_catalog_cache regex / exclude / fields / path_prefix
# ==================================================================

class TestSearchCatalogCacheExtended:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path: Path) -> None:
        self.user_home = tmp_path
        save_catalog(tmp_path, "pg_prod", _HIER_TABLES)

    def test_regex_alternation_matches_two_tables(self) -> None:
        results = search_catalog_cache(
            self.user_home, "monthly_(orders|returns)",
        )
        names = {r["name"] for r in results}
        assert names == {"monthly_orders", "monthly_returns"}

    def test_exclude_pattern_filters_out_matches(self) -> None:
        results = search_catalog_cache(
            self.user_home, "monthly", exclude_pattern="returns",
        )
        names = {r["name"] for r in results}
        assert names == {"monthly_orders"}

    def test_path_prefix_scopes_search(self) -> None:
        results = search_catalog_cache(
            self.user_home, "customers|monthly_orders",
            path_prefix=["Sales"],
        )
        names = {r["name"] for r in results}
        # ``customers`` is at the root → must be excluded by the prefix.
        assert names == {"monthly_orders"}

    def test_fields_restricts_search_surface(self) -> None:
        # ``archive`` appears only in the FY24 description; the leaf name
        # is ``fy24``.  Restricting to ``name`` should miss; ``description``
        # should hit.
        name_only = search_catalog_cache(
            self.user_home, "archive", fields=["name"],
        )
        desc_only = search_catalog_cache(
            self.user_home, "archive", fields=["description"],
        )
        assert name_only == []
        assert {r["name"] for r in desc_only} == {"fy24"}

    def test_bad_regex_raises_catalog_search_error(self) -> None:
        from data_formulator.datalake.catalog_cache import CatalogSearchError

        with pytest.raises(CatalogSearchError):
            search_catalog_cache(self.user_home, "(")


# ==================================================================
# Tests: connector_connect triggers catalog save
# ==================================================================

class TestConnectorConnectCatalogSave:
    """Verify that /api/connectors/connect calls save_catalog with user-home path."""

    @pytest.fixture
    def app(self) -> flask.Flask:
        from data_formulator.data_connector import connectors_bp
        from data_formulator.error_handler import register_error_handlers
        _app = flask.Flask(__name__)
        _app.config["TESTING"] = True
        _app.secret_key = "test"
        _app.register_blueprint(connectors_bp)
        register_error_handlers(_app)
        return _app

    def test_connect_saves_catalog_to_user_home(self, app: flask.Flask, tmp_path: Path) -> None:
        from data_formulator.data_connector import DATA_CONNECTORS, DataConnector
        from data_formulator.data_loader.external_data_loader import ExternalDataLoader

        class _StubLoader(ExternalDataLoader):
            def __init__(self, params):
                self.params = params
            def test_connection(self):
                return True
            def list_tables(self, table_filter=None):
                return [{"name": "public.users", "metadata": {}}]
            def fetch_data_as_arrow(self, source_table, import_options=None):
                return pa.table({"x": [1]})
            @staticmethod
            def list_params():
                return [{"name": "host", "type": "string", "required": True}]
            @staticmethod
            def auth_instructions():
                return ""

        connector = DataConnector.from_loader(
            _StubLoader, source_id="test_pg", display_name="Test PG",
        )
        DATA_CONNECTORS["test_pg"] = connector

        user_home = tmp_path / "users" / "test_user"

        try:
            with patch.object(DataConnector, "_get_identity", return_value="test_user"), \
                 patch.object(DataConnector, "_get_vault", return_value=None), \
                 patch("data_formulator.datalake.workspace.get_user_home", return_value=user_home):
                resp = app.test_client().post("/api/connectors/connect", json={
                    "connector_id": "test_pg",
                    "params": {"host": "localhost"},
                    "persist": False,
                })

            data = resp.get_json()
            assert data["status"] == "success"

            cache_file = user_home / "catalog_cache" / "test_pg.json"
            assert cache_file.is_file(), (
                f"catalog_cache should be created at {cache_file}"
            )
            with open(cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            assert cached["source_id"] == "test_pg"
            assert len(cached["tables"]) == 1
        finally:
            DATA_CONNECTORS.pop("test_pg", None)


# ==================================================================
# Tests: synced_at and table_key in cache
# ==================================================================

class TestCatalogCacheSyncedAt:

    def test_save_writes_synced_at(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "src1", [{"name": "t1"}])
        cache_file = tmp_path / "catalog_cache" / "src1.json"
        with open(cache_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert "synced_at" in data
        assert data["synced_at"].endswith("Z") or "+" in data["synced_at"]

    def test_load_catalog_ignores_synced_at(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "src2", [{"name": "t2"}])
        loaded = load_catalog(tmp_path, "src2")
        assert loaded is not None
        assert loaded[0]["name"] == "t2"


class TestSearchReturnsTableKey:

    def test_python_search_includes_table_key(self, tmp_path: Path) -> None:
        tables = [{
            "name": "orders",
            "table_key": "uuid-123",
            "metadata": {"description": "Order table", "source_metadata_status": "synced"},
        }]
        save_catalog(tmp_path, "src1", tables)
        results = _search_python(tmp_path, "order", ["src1"], set(), 20)
        assert len(results) == 1
        assert results[0]["table_key"] == "uuid-123"
        assert results[0]["metadata_status"] == "synced"

    def test_python_search_empty_table_key(self, tmp_path: Path) -> None:
        tables = [{"name": "users", "metadata": {"description": "User table"}}]
        save_catalog(tmp_path, "src1", tables)
        results = _search_python(tmp_path, "user", ["src1"], set(), 20)
        assert len(results) == 1
        assert results[0]["table_key"] == ""
