"""Tests for Superset catalog metadata sync features.

Background
----
- SupersetClient.get_dataset_columns() for fast column-only metadata fetch
- SupersetLoader.list_tables() now includes full column metadata via parallel fetch
- _build_column_entry() flattens Superset column metadata (including extra JSON)
  into a standardised dict for catalog cache / agent consumption
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from data_formulator.data_loader.superset_client import SupersetClient
from data_formulator.data_loader.superset_data_loader import SupersetLoader

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


def _make_mock_loader(datasets=None, columns_by_id=None, dashboards=None):
    """Create a SupersetLoader with mocked client and auth."""
    with patch.object(SupersetLoader, "__init__", lambda self, params: None):
        loader = SupersetLoader.__new__(SupersetLoader)
        loader.params = {"url": "https://superset.example.com"}
        loader.url = "https://superset.example.com"
        loader._access_token = "fake-token"
        loader._refresh_token = None
        loader.username = ""
        loader.password = ""

        mock_client = MagicMock()
        loader._client = mock_client

        # Bypass JWT expiry check — "fake-token" is not a real JWT
        loader._is_token_expired = staticmethod(lambda token, buffer_seconds=60: False)

        datasets = datasets or []
        dashboards = dashboards or []

        def _list_datasets(token, page=0, page_size=100):
            start = page * page_size
            batch = datasets[start:start + page_size]
            return {"result": batch, "count": len(datasets)}

        mock_client.list_datasets.side_effect = _list_datasets
        mock_client.list_dashboards.return_value = {"result": dashboards}
        mock_client.get_dashboard_datasets.return_value = {"result": []}

        columns_by_id = columns_by_id or {}

        def _get_columns(token, dataset_id):
            return columns_by_id.get(dataset_id, [])

        mock_client.get_dataset_columns.side_effect = _get_columns

        return loader


# ── SupersetClient.get_dataset_columns ────────────────────────────────

class TestGetDatasetColumns:
    def test_calls_correct_endpoint(self):
        with patch("data_formulator.data_loader.superset_client.requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.json.return_value = {
                "result": [
                    {"column_name": "id", "type": "INTEGER", "is_dttm": False},
                    {"column_name": "created_at", "type": "TIMESTAMP", "is_dttm": True},
                ]
            }
            mock_resp.raise_for_status = MagicMock()
            mock_get.return_value = mock_resp

            client = SupersetClient("https://superset.example.com")
            result = client.get_dataset_columns("test-token", 42)

            mock_get.assert_called_once_with(
                "https://superset.example.com/api/v1/dataset/42/column",
                headers={"Authorization": "Bearer test-token"},
                timeout=60,
            )
            assert len(result) == 2
            assert result[0]["column_name"] == "id"
            assert result[1]["is_dttm"] is True

    def test_returns_empty_on_empty_result(self):
        with patch("data_formulator.data_loader.superset_client.requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.json.return_value = {"result": []}
            mock_resp.raise_for_status = MagicMock()
            mock_get.return_value = mock_resp

            client = SupersetClient("https://superset.example.com")
            result = client.get_dataset_columns("test-token", 999)
            assert result == []

    def test_fallback_to_detail_on_http_error(self):
        """When /column endpoint returns 404, falls back to full detail."""
        import requests as _requests

        call_count = {"n": 0}

        def _mock_get(url, **kwargs):
            call_count["n"] += 1
            resp = MagicMock()
            if "/column" in url:
                resp.raise_for_status.side_effect = _requests.HTTPError("404")
            else:
                resp.raise_for_status = MagicMock()
                resp.json.return_value = {
                    "result": {
                        "columns": [
                            {"column_name": "id", "type": "BIGINT", "is_dttm": False},
                        ],
                    },
                }
            return resp

        with patch("data_formulator.data_loader.superset_client.requests.get", side_effect=_mock_get):
            client = SupersetClient("https://superset.example.com")
            result = client.get_dataset_columns("test-token", 42)

        assert call_count["n"] == 2
        assert len(result) == 1
        assert result[0]["column_name"] == "id"

    def test_propagates_error_when_both_endpoints_fail(self):
        import requests

        with patch("data_formulator.data_loader.superset_client.requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.raise_for_status.side_effect = requests.HTTPError("404")
            mock_get.return_value = mock_resp

            client = SupersetClient("https://superset.example.com")
            with pytest.raises(requests.HTTPError):
                client.get_dataset_columns("test-token", 42)


# ── SupersetLoader.list_tables uuid/description pass-through ──────────

class TestListTablesUuidPassthrough:
    def test_uuid_and_description_in_metadata(self):
        datasets = [
            {
                "id": 42,
                "table_name": "orders",
                "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "description": "Monthly order data",
                "row_count": 1000,
                "schema": "public",
                "database": {"database_name": "analytics"},
            },
        ]
        loader = _make_mock_loader(datasets=datasets)
        tables = loader.list_tables()
        all_ds_entries = [t for t in tables if "All Datasets" in t.get("path", [""])[0]]
        assert len(all_ds_entries) >= 1
        meta = all_ds_entries[0]["metadata"]
        assert meta["uuid"] == "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        assert meta["description"] == "Monthly order data"

    def test_no_uuid_when_missing(self):
        datasets = [
            {"id": 10, "table_name": "bare", "database": {"database_name": "db"}},
        ]
        loader = _make_mock_loader(datasets=datasets)
        tables = loader.list_tables()
        all_ds_entries = [t for t in tables if "All Datasets" in t.get("path", [""])[0]]
        assert "uuid" not in all_ds_entries[0]["metadata"]


# ── SupersetLoader.sync_catalog_metadata ──────────────────────────────

class TestSupersetSyncCatalogMetadata:
    def test_enriches_columns_and_sets_table_key(self):
        datasets = [
            {
                "id": 42,
                "table_name": "orders",
                "uuid": "uuid-42",
                "description": "Order dataset",
                "row_count": 1000,
                "schema": "public",
                "database": {"database_name": "analytics"},
            },
        ]
        columns_by_id = {
            42: [
                {"column_name": "order_id", "type": "INTEGER", "is_dttm": False,
                 "verbose_name": "Order ID"},
                {"column_name": "created_at", "type": "TIMESTAMP", "is_dttm": True},
            ],
        }
        loader = _make_mock_loader(datasets=datasets, columns_by_id=columns_by_id)
        result = loader.sync_catalog_metadata()

        synced = [t for t in result if t.get("table_key") == "uuid-42"]
        assert len(synced) >= 1
        entry = synced[0]
        assert entry["table_key"] == "uuid-42"
        meta = entry["metadata"]
        assert meta["source_metadata_status"] == "synced"
        assert len(meta["columns"]) == 2
        assert meta["columns"][0]["name"] == "order_id"
        assert meta["columns"][0]["description"] == "Order ID"
        assert meta["columns"][1]["is_dttm"] is True

    def test_column_fetch_failure_marks_unavailable(self):
        datasets = [
            {"id": 99, "table_name": "broken", "uuid": "uuid-99",
             "database": {"database_name": "db"}},
        ]

        def _fail_columns(token, dataset_id):
            raise Exception("API timeout")

        loader = _make_mock_loader(datasets=datasets)
        loader._client.get_dataset_columns.side_effect = _fail_columns

        result = loader.sync_catalog_metadata()
        broken = [t for t in result if t.get("table_key") == "uuid-99"]
        assert len(broken) >= 1
        assert broken[0]["metadata"]["source_metadata_status"] == "unavailable"

    def test_empty_columns_marks_partial(self):
        datasets = [
            {"id": 50, "table_name": "empty_cols", "uuid": "uuid-50",
             "database": {"database_name": "db"}},
        ]
        loader = _make_mock_loader(datasets=datasets, columns_by_id={50: []})
        result = loader.sync_catalog_metadata()
        entry = [t for t in result if t.get("table_key") == "uuid-50"]
        assert entry[0]["metadata"]["source_metadata_status"] == "partial"
        assert entry[0]["metadata"]["columns"] == []

    def test_table_key_fallback_without_uuid(self):
        datasets = [
            {"id": 77, "table_name": "no_uuid",
             "database": {"database_name": "db"}},
        ]
        loader = _make_mock_loader(datasets=datasets, columns_by_id={77: []})
        result = loader.sync_catalog_metadata()
        no_uuid = [t for t in result if "no_uuid" in t.get("name", "")]
        assert len(no_uuid) >= 1
        assert no_uuid[0]["table_key"]  # should have a fallback key


# ── list_tables now includes column metadata ──────────────────────────

class TestListTablesIncludesColumns:
    """list_tables() should return column metadata directly (no separate sync step)."""

    def test_list_tables_includes_columns(self):
        datasets = [
            {"id": 1, "table_name": "sales", "uuid": "uuid-1",
             "database": {"database_name": "db"}},
        ]
        columns_by_id = {
            1: [
                {"column_name": "amount", "type": "FLOAT", "is_dttm": False},
                {"column_name": "date", "type": "DATE", "is_dttm": True},
            ],
        }
        loader = _make_mock_loader(datasets=datasets, columns_by_id=columns_by_id)
        tables = loader.list_tables()
        entry = [t for t in tables if t.get("table_key") == "uuid-1"][0]
        assert entry["metadata"]["source_metadata_status"] == "synced"
        assert len(entry["metadata"]["columns"]) == 2
        assert entry["metadata"]["columns"][0]["name"] == "amount"

    def test_list_tables_column_failure_marks_unavailable(self):
        datasets = [
            {"id": 2, "table_name": "broken", "uuid": "uuid-2",
             "database": {"database_name": "db"}},
        ]
        loader = _make_mock_loader(datasets=datasets)
        loader._client.get_dataset_columns.side_effect = Exception("timeout")
        tables = loader.list_tables()
        entry = [t for t in tables if t.get("table_key") == "uuid-2"][0]
        assert entry["metadata"]["source_metadata_status"] == "unavailable"


# ── _build_column_entry: extra JSON flattening ────────────────────────

class TestBuildColumnEntryExtra:
    """_build_column_entry should flatten the extra JSON blob into description."""

    def test_certification_extra(self):
        col = {
            "column_name": "revenue",
            "type": "FLOAT",
            "is_dttm": False,
            "verbose_name": "Revenue",
            "extra": '{"certification": {"certified_by": "Data Team", "details": "Single source of truth"}}',
        }
        entry = SupersetLoader._build_column_entry(col)
        assert "certification" in entry["description"]
        assert "certified_by: Data Team" in entry["description"]
        assert "details: Single source of truth" in entry["description"]

    def test_warning_markdown_extra(self):
        col = {
            "column_name": "status",
            "type": "VARCHAR",
            "is_dttm": False,
            "extra": '{"warning_markdown": "Data has 24h delay"}',
        }
        entry = SupersetLoader._build_column_entry(col)
        assert "warning_markdown: Data has 24h delay" in entry["description"]

    def test_empty_extra_no_effect(self):
        col = {
            "column_name": "id",
            "type": "INTEGER",
            "is_dttm": False,
            "verbose_name": "ID",
        }
        entry = SupersetLoader._build_column_entry(col)
        assert entry["description"] == "ID"

    def test_null_extra_no_effect(self):
        col = {
            "column_name": "id",
            "type": "INTEGER",
            "is_dttm": False,
            "extra": None,
        }
        entry = SupersetLoader._build_column_entry(col)
        assert entry["description"] is None

    def test_invalid_json_extra_no_crash(self):
        col = {
            "column_name": "name",
            "type": "VARCHAR",
            "is_dttm": False,
            "verbose_name": "Name",
            "extra": "{broken json",
        }
        entry = SupersetLoader._build_column_entry(col)
        assert entry["description"] == "Name"
        assert entry["name"] == "name"

    def test_extra_combined_with_other_fields(self):
        col = {
            "column_name": "amount",
            "type": "FLOAT",
            "is_dttm": False,
            "verbose_name": "Total Amount",
            "description": "Sum of line items",
            "expression": "SUM(line_total)",
            "extra": '{"certification": {"details": "Verified metric"}}',
        }
        entry = SupersetLoader._build_column_entry(col)
        desc = entry["description"]
        assert "Total Amount" in desc
        assert "Sum of line items" in desc
        assert "expr: SUM(line_total)" in desc
        assert "Verified metric" in desc
