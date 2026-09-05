# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for the catalog_cache module and its integration with DataConnector.

Covers save/load/delete, catalog finding and listing, and DataConnector cache
integration.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
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
    load_catalog_snapshot,
    record_catalog_refresh_failure,
    save_catalog,
    find_catalog_cache,
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

    def test_legacy_synced_at_populates_both_freshness_clocks(self, tmp_path: Path) -> None:
        cache_dir = tmp_path / "catalog_cache"
        cache_dir.mkdir()
        synced_at = "2026-01-01T00:00:00Z"
        (cache_dir / "legacy.json").write_text(json.dumps({
            "source_id": "legacy",
            "synced_at": synced_at,
            "tables": SAMPLE_TABLES,
        }), encoding="utf-8")

        snapshot = load_catalog_snapshot(
            tmp_path,
            "legacy",
            listing_ttl_seconds=60,
            metadata_ttl_seconds=60,
            now=datetime(2026, 1, 1, 0, 0, 30, tzinfo=timezone.utc),
        )

        assert snapshot is not None
        assert snapshot.listing_refreshed_at == synced_at
        assert snapshot.metadata_refreshed_at == synced_at
        assert snapshot.listing_freshness == "fresh"
        assert snapshot.metadata_freshness == "fresh"

    def test_listing_and_metadata_have_independent_freshness(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "src1", SAMPLE_TABLES)
        path = tmp_path / "catalog_cache" / "src1.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        now = datetime(2026, 1, 2, tzinfo=timezone.utc)
        data["listing_refreshed_at"] = (now - timedelta(seconds=30)).isoformat()
        data["metadata_refreshed_at"] = (now - timedelta(hours=2)).isoformat()
        path.write_text(json.dumps(data), encoding="utf-8")

        snapshot = load_catalog_snapshot(
            tmp_path,
            "src1",
            listing_ttl_seconds=60,
            metadata_ttl_seconds=60,
            now=now,
        )

        assert snapshot is not None
        assert snapshot.listing_freshness == "fresh"
        assert snapshot.metadata_freshness == "stale"

    def test_listing_refresh_preserves_enriched_metadata(self, tmp_path: Path) -> None:
        rich = [{
            "name": "public.orders",
            "path": ["public", "orders"],
            "table_key": "orders-key",
            "metadata": {"description": "Orders", "columns": [{"name": "id"}]},
        }]
        save_catalog(tmp_path, "src1", rich)
        save_catalog(tmp_path, "src1", [{
            "name": "public.orders",
            "path": ["public", "orders"],
            "table_key": "orders-key",
            "metadata": {"row_count": 10},
        }], refresh_kind="listing")

        loaded = load_catalog(tmp_path, "src1")
        assert loaded is not None
        assert loaded[0]["metadata"] == {
            "description": "Orders",
            "columns": [{"name": "id"}],
            "row_count": 10,
        }

    def test_refresh_failure_preserves_last_good_tables(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "src1", SAMPLE_TABLES)
        record_catalog_refresh_failure(tmp_path, "src1", "connection timed out")

        assert load_catalog(tmp_path, "src1") == SAMPLE_TABLES
        snapshot = load_catalog_snapshot(
            tmp_path, "src1", listing_ttl_seconds=60, metadata_ttl_seconds=60,
        )
        assert snapshot is not None
        assert snapshot.refresh_status == "failed"
        assert snapshot.last_refresh_error == "connection timed out"

    def test_atomic_replace_failure_preserves_existing_catalog(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "src1", [{"name": "old_table"}])

        with patch("data_formulator.datalake.catalog_cache.os.replace", side_effect=OSError):
            save_catalog(tmp_path, "src1", [{"name": "new_table"}])

        assert load_catalog(tmp_path, "src1") == [{"name": "old_table"}]
        assert list((tmp_path / "catalog_cache").glob("*.tmp")) == []


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
    """Verify per-field scoring and match reasons from the shared finder."""

    @pytest.fixture(autouse=True)
    def _setup_cache(self, tmp_path: Path) -> None:
        self.user_home = tmp_path
        save_catalog(tmp_path, "pg_prod", RICH_TABLES)

    def _run(self, query: str, **kwargs: Any) -> list[dict[str, Any]]:
        fields = kwargs.pop("fields", None)
        results, _ = find_catalog_cache(
            self.user_home,
            query,
            source_ids=list_cached_sources(self.user_home),
            filter_by="table",
            fields=list(fields) if fields else None,
            **kwargs,
        )
        return results

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
        results, _ = find_catalog_cache(
            self.user_home,
            "orders",
            source_ids=list_cached_sources(self.user_home),
            filter_by="table",
            exclude_tables={"public.orders"},
        )
        assert all(r["name"] != "public.orders" for r in results)

    def test_finder_end_to_end(self) -> None:
        results = self._run("product")
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
        # The inventory previews depth-0 children so one call can answer
        # "what is available" without a drill-down per source.
        assert by_id["pg_prod"]["top_level"] == ["Sales", "customers"]
        assert by_id["flat_src"]["top_level"] == ["t1", "t2"]
        assert by_id["pg_prod"]["top_level_truncated"] is False

    def test_top_level_preview_reports_truncation(self, tmp_path: Path) -> None:
        from data_formulator.datalake.catalog_cache import list_sources_summary

        save_catalog(tmp_path, "wide", [
            {"name": f"t{i}", "path": [f"t{i}"], "table_key": f"k{i}"}
            for i in range(13)
        ])

        source = list_sources_summary(tmp_path)[0]
        assert len(source["top_level"]) == 12
        assert source["top_level_truncated"] is True

    def test_empty_when_no_cache(self, tmp_path: Path) -> None:
        from data_formulator.datalake.catalog_cache import list_sources_summary

        assert list_sources_summary(tmp_path) == []


class TestSummarizeCatalogSources:
    def test_balances_samples_across_branches(self, tmp_path: Path) -> None:
        from data_formulator.datalake.catalog_cache import summarize_catalog_sources

        save_catalog(tmp_path, "warehouse", [
            {"name": "a1", "path": ["Alpha", "a1"], "table_key": "ka1"},
            {"name": "a2", "path": ["Alpha", "a2"], "table_key": "ka2"},
            {"name": "b1", "path": ["Beta", "b1"], "table_key": "kb1"},
            {"name": "root", "path": ["root"], "table_key": "kr"},
        ])

        summary = summarize_catalog_sources(tmp_path, top_level_limit=2, table_limit=3)[0]

        assert summary["table_count"] == 4
        assert summary["folder_count"] == 2
        assert summary["max_depth"] == 1
        assert {item["path"][0] for item in summary["sample_tables"]} == {
            "Alpha", "Beta", "root",
        }
        assert summary["omitted"] == {"top_level": 1, "tables": 1}

    def test_empty_catalog_has_zero_stats(self, tmp_path: Path) -> None:
        from data_formulator.datalake.catalog_cache import summarize_catalog_sources

        save_catalog(tmp_path, "empty", [])

        assert summarize_catalog_sources(tmp_path) == [{
            "source_id": "empty",
            "table_count": 0,
            "folder_count": 0,
            "max_depth": 0,
            "top_level": [],
            "sample_tables": [],
            "omitted": {"top_level": 0, "tables": 0},
        }]


class TestListPathChildren:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path: Path) -> None:
        self.user_home = tmp_path
        save_catalog(tmp_path, "pg_prod", _HIER_TABLES)

    def test_root_lists_folders_and_top_level_tables(self) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        result = list_path_children(self.user_home, "pg_prod")

        assert result["items"] == [
            {
                "type": "folder",
                "name": "Sales",
                "path": ["Sales"],
                "child_count": 3,
                "descendant_table_count": 3,
            },
            {
                "type": "table",
                "name": "customers",
                "path": ["customers"],
                "table_key": "k_customers",
            },
        ]
        assert result["total_count"] == 2
        assert result["truncated"] is False

    def test_drill_into_folder(self) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        result = list_path_children(self.user_home, "pg_prod", path=["Sales"])

        folder_names = {item["name"] for item in result["items"] if item["type"] == "folder"}
        table_names = {item["name"] for item in result["items"] if item["type"] == "table"}
        assert folder_names == {"Archive"}
        assert table_names == {"monthly_orders", "monthly_returns"}

    def test_filter_by_node_type(self) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        folders = list_path_children(self.user_home, "pg_prod", filter_by="folder")
        tables = list_path_children(self.user_home, "pg_prod", filter_by="table")
        assert [item["name"] for item in folders["items"]] == ["Sales"]
        assert [item["name"] for item in tables["items"]] == ["customers"]

    def test_missing_source_returns_empty(self, tmp_path: Path) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        result = list_path_children(tmp_path, "missing_src")
        assert result["items"] == []
        assert result["truncated"] is False

    def test_truncation_continues_after_last_item(self) -> None:
        from data_formulator.datalake.catalog_cache import list_path_children

        # 5 leaves at root, cap to 2 → truncated with hint.
        many_root = [
            {"name": f"t{i}", "table_key": f"k{i}", "path": [f"t{i}"], "metadata": {}}
            for i in range(5)
        ]
        save_catalog(self.user_home, "many_src", many_root)
        result = list_path_children(self.user_home, "many_src", limit=2)

        assert result["truncated"] is True
        assert [item["name"] for item in result["items"]] == ["t0", "t1"]
        assert result["total_count"] == 5

        continued = list_path_children(
            self.user_home,
            "many_src",
            limit=2,
            start_after=result["next_start_after"],
        )
        assert [item["name"] for item in continued["items"]] == ["t2", "t3"]


class TestFindCatalogCache:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path: Path) -> None:
        self.user_home = tmp_path
        save_catalog(tmp_path, "pg_prod", _HIER_TABLES)

    def test_enumerates_tables_below_exact_path(self) -> None:
        from data_formulator.datalake.catalog_cache import find_catalog_cache

        results, truncated = find_catalog_cache(
            self.user_home,
            source_ids=["pg_prod"],
            path_prefix=["Sales"],
            filter_by="table",
        )

        assert {result["name"] for result in results} == {
            "monthly_orders", "monthly_returns", "fy24",
        }
        assert all(result["path"][0] == "Sales" for result in results)
        assert truncated is False

    def test_finds_folders_with_counts(self) -> None:
        from data_formulator.datalake.catalog_cache import find_catalog_cache

        results, _ = find_catalog_cache(
            self.user_home,
            query="archive",
            source_ids=["pg_prod"],
            filter_by="folder",
        )

        assert results == [{
            "type": "folder",
            "source_id": "pg_prod",
            "name": "Archive",
            "path": ["Sales", "Archive"],
            "child_count": 1,
            "descendant_table_count": 1,
            "score": 10,
            "match_reasons": ["folder_name"],
        }]

    def test_reports_truncation(self) -> None:
        from data_formulator.datalake.catalog_cache import find_catalog_cache

        results, truncated = find_catalog_cache(
            self.user_home,
            source_ids=["pg_prod"],
            filter_by="table",
            limit=2,
        )

        assert len(results) == 2
        assert truncated is True


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
        results, _ = find_catalog_cache(
            tmp_path, "order", source_ids=["src1"], filter_by="table",
        )
        assert len(results) == 1
        assert results[0]["table_key"] == "uuid-123"
        assert results[0]["metadata_status"] == "synced"

    def test_python_search_empty_table_key(self, tmp_path: Path) -> None:
        tables = [{"name": "users", "metadata": {"description": "User table"}}]
        save_catalog(tmp_path, "src1", tables)
        results, _ = find_catalog_cache(
            tmp_path, "user", source_ids=["src1"], filter_by="table",
        )
        assert len(results) == 1
        assert results[0]["table_key"] == ""
