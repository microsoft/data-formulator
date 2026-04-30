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
    _search_duckdb,
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
# Tests: DuckDB search and Python fallback consistency
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


class TestDuckDBSearchConsistency:
    """Verify DuckDB and Python search produce equivalent results."""

    @pytest.fixture(autouse=True)
    def _setup_cache(self, tmp_path: Path) -> None:
        self.user_home = tmp_path
        save_catalog(tmp_path, "pg_prod", RICH_TABLES)

    def _compare(self, query: str, exclude: set[str] | None = None) -> None:
        exc = exclude or set()
        ids = list_cached_sources(self.user_home)
        needle = query.strip().lower()
        py_results = _search_python(self.user_home, needle, ids, exc, 20)
        duck_results = _search_duckdb(self.user_home, needle, ids, exc, 20)
        assert len(py_results) == len(duck_results), f"Count mismatch for '{query}'"
        for pr, dr in zip(py_results, duck_results):
            assert pr["name"] == dr["name"], f"Name mismatch for '{query}'"
            assert pr["score"] == dr["score"], f"Score mismatch for '{query}': {pr} vs {dr}"
            assert set(pr["matched_columns"]) == set(dr["matched_columns"])

    def test_table_name_match(self) -> None:
        self._compare("orders")

    def test_table_description_match(self) -> None:
        self._compare("订单")

    def test_column_name_match(self) -> None:
        self._compare("customer_name")

    def test_column_description_match(self) -> None:
        self._compare("Primary key")

    def test_no_match(self) -> None:
        self._compare("zzz_nonexistent_zzz")

    def test_exclude_tables(self) -> None:
        exc = {"public.orders"}
        ids = list_cached_sources(self.user_home)
        needle = "orders"
        py_results = _search_python(self.user_home, needle, ids, exc, 20)
        duck_results = _search_duckdb(self.user_home, needle, ids, exc, 20)
        assert all(r["name"] != "public.orders" for r in py_results)
        assert all(r["name"] != "public.orders" for r in duck_results)

    def test_search_catalog_cache_uses_duckdb_by_default(self) -> None:
        """Top-level search_catalog_cache should still work end-to-end."""
        results = search_catalog_cache(self.user_home, "product")
        assert len(results) >= 1
        assert any(r["name"] == "public.products" for r in results)

    def test_fallback_when_duckdb_fails(self) -> None:
        with patch("data_formulator.datalake.catalog_cache._search_duckdb",
                    side_effect=RuntimeError("DuckDB broken")):
            results = search_catalog_cache(self.user_home, "orders")
            assert len(results) >= 1
            assert results[0]["name"] == "public.orders"


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
