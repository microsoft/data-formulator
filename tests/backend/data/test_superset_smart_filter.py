# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for SupersetLoader smart filter features.

Covers:
- _normalize_column_type classification
- _build_chart_data_filters / _build_chart_data_orderby conversion
- get_column_types (with mocked SupersetClient)
- get_column_values three-tier fallback (with mocked SupersetClient)
- fetch_data_as_arrow via Chart Data API
- URL resolution (params → env fallback)
- Unified validate_params / ConnectorParamError
"""
from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from data_formulator.data_connector import classify_and_raise_connector_error
from data_formulator.data_loader.superset_data_loader import SupersetLoader

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


# ==================================================================
# _normalize_column_type
# ==================================================================

class TestNormalizeColumnType:

    @pytest.mark.parametrize("column,expected", [
        ({"is_dttm": True, "type": "VARCHAR"}, "TEMPORAL"),
        ({"type": "TIMESTAMP"}, "TEMPORAL"),
        ({"type": "DATE"}, "TEMPORAL"),
        ({"type": "DATETIME"}, "TEMPORAL"),
        ({"type_generic": "TEMPORAL"}, "TEMPORAL"),
        ({"type": "BIGINT"}, "NUMERIC"),
        ({"type": "FLOAT"}, "NUMERIC"),
        ({"type": "DOUBLE PRECISION"}, "NUMERIC"),
        ({"type": "NUMERIC(10,2)"}, "NUMERIC"),
        ({"type": "DECIMAL"}, "NUMERIC"),
        ({"type": "INT"}, "NUMERIC"),
        ({"type": "NUMBER"}, "NUMERIC"),
        ({"type": "BOOLEAN"}, "BOOLEAN"),
        ({"type": "BOOL"}, "BOOLEAN"),
        ({"type": "VARCHAR"}, "STRING"),
        ({"type": "TEXT"}, "STRING"),
        ({"type": "CHAR(50)"}, "STRING"),
        ({}, "STRING"),
        (None, "STRING"),
    ])
    def test_classification(self, column, expected):
        assert SupersetLoader._normalize_column_type(column) == expected

    def test_is_dttm_takes_precedence(self):
        """is_dttm flag overrides the raw type string."""
        col = {"is_dttm": True, "type": "INT"}
        assert SupersetLoader._normalize_column_type(col) == "TEMPORAL"


# ==================================================================
# _build_chart_data_filters
# ==================================================================

class TestBuildChartDataFilters:

    def test_empty_filters(self):
        assert SupersetLoader._build_chart_data_filters(None) == []
        assert SupersetLoader._build_chart_data_filters([]) == []

    def test_eq_filter(self):
        filters = [{"column": "status", "operator": "EQ", "value": "active"}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert result == [{"col": "status", "op": "==", "val": "active"}]

    def test_neq_filter(self):
        filters = [{"column": "status", "operator": "NEQ", "value": "deleted"}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert result == [{"col": "status", "op": "!=", "val": "deleted"}]

    def test_comparison_operators(self):
        for df_op, api_op in [("GT", ">"), ("GTE", ">="), ("LT", "<"), ("LTE", "<=")]:
            filters = [{"column": "age", "operator": df_op, "value": 18}]
            result = SupersetLoader._build_chart_data_filters(filters)
            assert result == [{"col": "age", "op": api_op, "val": 18}]

    def test_in_filter(self):
        filters = [{"column": "id", "operator": "IN", "value": [1, 2, 3]}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert result == [{"col": "id", "op": "IN", "val": [1, 2, 3]}]

    def test_not_in_filter(self):
        filters = [{"column": "id", "operator": "NOT_IN", "value": [4, 5]}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert result == [{"col": "id", "op": "NOT IN", "val": [4, 5]}]

    def test_between_splits_into_two(self):
        filters = [{"column": "age", "operator": "BETWEEN", "value": [18, 65]}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert len(result) == 2
        assert result[0] == {"col": "age", "op": ">=", "val": 18}
        assert result[1] == {"col": "age", "op": "<=", "val": 65}

    def test_is_null_filter(self):
        filters = [{"column": "email", "operator": "IS_NULL", "value": None}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert result == [{"col": "email", "op": "IS NULL", "val": None}]

    def test_is_not_null_filter(self):
        filters = [{"column": "email", "operator": "IS_NOT_NULL", "value": None}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert result == [{"col": "email", "op": "IS NOT NULL", "val": None}]

    def test_like_filter(self):
        filters = [{"column": "name", "operator": "LIKE", "value": "%alice%"}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert result == [{"col": "name", "op": "LIKE", "val": "%alice%"}]

    def test_ilike_filter(self):
        filters = [{"column": "name", "operator": "ILIKE", "value": "%alice%"}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert result == [{"col": "name", "op": "ILIKE", "val": "%alice%"}]

    def test_invalid_operator_skipped(self):
        filters = [{"column": "x", "operator": "DROP TABLE", "value": "1"}]
        assert SupersetLoader._build_chart_data_filters(filters) == []

    def test_missing_column_skipped(self):
        filters = [{"operator": "EQ", "value": "1"}]
        assert SupersetLoader._build_chart_data_filters(filters) == []

    def test_in_with_empty_list_skipped(self):
        filters = [{"column": "x", "operator": "IN", "value": []}]
        assert SupersetLoader._build_chart_data_filters(filters) == []

    def test_between_with_wrong_length_skipped(self):
        filters = [{"column": "x", "operator": "BETWEEN", "value": [1]}]
        assert SupersetLoader._build_chart_data_filters(filters) == []

    def test_multiple_filters(self):
        filters = [
            {"column": "status", "operator": "EQ", "value": "active"},
            {"column": "age", "operator": "GTE", "value": 18},
        ]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert len(result) == 2
        assert result[0]["col"] == "status"
        assert result[1]["col"] == "age"

    def test_non_dict_filter_skipped(self):
        filters = ["not-a-dict", {"column": "x", "operator": "EQ", "value": 1}]
        result = SupersetLoader._build_chart_data_filters(filters)
        assert len(result) == 1


# ==================================================================
# _build_chart_data_orderby
# ==================================================================

class TestBuildChartDataOrderby:

    def test_empty_sort_columns(self):
        assert SupersetLoader._build_chart_data_orderby(None) == []
        assert SupersetLoader._build_chart_data_orderby([]) == []

    def test_ascending(self):
        result = SupersetLoader._build_chart_data_orderby(["id"], "asc")
        assert result == [["id", True]]

    def test_descending(self):
        result = SupersetLoader._build_chart_data_orderby(["id"], "desc")
        assert result == [["id", False]]

    def test_defaults_to_ascending(self):
        result = SupersetLoader._build_chart_data_orderby(["id"], "UNKNOWN")
        assert result == [["id", True]]

    def test_multiple_columns(self):
        result = SupersetLoader._build_chart_data_orderby(["name", "age"], "desc")
        assert result == [["name", False], ["age", False]]

    def test_skips_invalid_columns(self):
        result = SupersetLoader._build_chart_data_orderby(["", None, "id"], "asc")
        assert result == [["id", True]]


# ==================================================================
# get_column_types (mocked client)
# ==================================================================

def _make_mock_loader():
    """Create a SupersetLoader with mocked auth (no real Superset).

    Patches _ensure_token to bypass JWT expiry checks.
    """
    with patch.object(SupersetLoader, "__init__", lambda self, params: None):
        sl = SupersetLoader.__new__(SupersetLoader)
        sl.params = {"url": "http://superset.test"}
        sl.url = "http://superset.test"
        sl._client = MagicMock()
        sl._bridge = MagicMock()
        sl._access_token = "fake-token"
        sl._refresh_token = None
        sl.username = ""
        sl.password = ""
        sl._ensure_token = MagicMock(return_value="fake-token")
        return sl


class TestGetColumnTypes:

    @pytest.fixture
    def loader(self):
        return _make_mock_loader()

    def test_returns_normalized_types(self, loader):
        loader._client.get_dataset_detail.return_value = {
            "columns": [
                {"column_name": "id", "type": "BIGINT", "is_dttm": False},
                {"column_name": "created", "type": "TIMESTAMP", "is_dttm": True},
                {"column_name": "active", "type": "BOOLEAN", "is_dttm": False},
                {"column_name": "name", "type": "VARCHAR", "is_dttm": False},
            ],
        }
        result = loader.get_column_types("42")
        cols = {c["name"]: c for c in result["columns"]}
        assert cols["id"]["type"] == "NUMERIC"
        assert cols["created"]["type"] == "TEMPORAL"
        assert cols["active"]["type"] == "BOOLEAN"
        assert cols["name"]["type"] == "STRING"

    def test_invalid_source_table(self, loader):
        assert loader.get_column_types("not-a-number") == {}

    def test_api_failure_returns_empty(self, loader):
        loader._client.get_dataset_detail.side_effect = Exception("API error")
        assert loader.get_column_types("42") == {}


# ==================================================================
# get_column_values (mocked client, three-tier fallback)
# ==================================================================

class TestGetColumnValues:

    @pytest.fixture
    def loader(self):
        return _make_mock_loader()

    def test_tier1_datasource_api(self, loader):
        """First tier: /api/v1/datasource/table/{id}/column/{col}/values/"""
        loader._client.get_datasource_column_values.return_value = {
            "result": [{"value": "alice"}, {"value": "bob"}, {"value": "carol"}],
        }
        result = loader.get_column_values("42", "name", limit=10)
        assert len(result["options"]) == 3
        assert result["options"][0]["value"] == "alice"
        assert result["has_more"] is False

    def test_tier2_dataset_distinct(self, loader):
        """Second tier: /api/v1/dataset/distinct/{col}"""
        loader._client.get_datasource_column_values.side_effect = Exception("404")
        loader._client.get_dataset_distinct_values.return_value = {
            "result": [{"value": "x"}, {"value": "y"}],
        }
        result = loader.get_column_values("42", "status", limit=10)
        assert len(result["options"]) == 2

    def test_tier3_chart_data_fallback(self, loader):
        """Third tier: Chart Data API with columns aggregation (GROUP BY)"""
        loader._client.get_datasource_column_values.side_effect = Exception("404")
        loader._client.get_dataset_distinct_values.side_effect = Exception("404")
        loader._client.post_chart_data.return_value = {
            "result": [{
                "data": [{"name": "alice"}, {"name": "bob"}],
                "colnames": ["name"],
            }],
        }
        result = loader.get_column_values("42", "name", limit=10)
        assert len(result["options"]) == 2
        assert result["options"][0]["value"] == "alice"
        assert result["options"][1]["value"] == "bob"

    def test_invalid_source_table(self, loader):
        result = loader.get_column_values("not-a-number", "col")
        assert result["options"] == []
        assert result["has_more"] is False

    def test_keyword_filtering(self, loader):
        loader._client.get_datasource_column_values.return_value = {
            "result": [
                {"value": "alice"},
                {"value": "bob"},
                {"value": "alex"},
            ],
        }
        result = loader.get_column_values("42", "name", keyword="al", limit=10)
        assert all("al" in o["value"].lower() for o in result["options"])

    def test_has_more_pagination(self, loader):
        values = [{"value": f"val_{i}"} for i in range(12)]
        loader._client.get_datasource_column_values.return_value = {"result": values}
        result = loader.get_column_values("42", "col", limit=5)
        assert len(result["options"]) == 5
        assert result["has_more"] is True

    def test_limit_clamped(self, loader):
        """Limit should be clamped to [1, 200]."""
        loader._client.get_datasource_column_values.return_value = {"result": []}
        loader.get_column_values("42", "col", limit=0)
        loader.get_column_values("42", "col", limit=999)

    def test_deduplication(self, loader):
        loader._client.get_datasource_column_values.return_value = {
            "result": [{"value": "a"}, {"value": "a"}, {"value": "b"}],
        }
        result = loader.get_column_values("42", "col", limit=10)
        values = [o["value"] for o in result["options"]]
        assert values == ["a", "b"]

    def test_all_tiers_fail_returns_empty(self, loader):
        loader._client.get_datasource_column_values.side_effect = Exception("err")
        loader._client.get_dataset_distinct_values.side_effect = Exception("err")
        loader._client.post_chart_data.side_effect = Exception("err")
        result = loader.get_column_values("42", "col")
        assert result["options"] == []
        assert result["has_more"] is False


# ==================================================================
# fetch_data_as_arrow (Chart Data API)
# ==================================================================

class TestFetchDataAsArrow:

    @pytest.fixture
    def loader(self):
        return _make_mock_loader()

    def test_passes_sort_to_chart_data_api(self, loader):
        loader._client.post_chart_data.return_value = {
            "result": [{
                "data": [{"id": 2}, {"id": 1}],
                "colnames": ["id"],
            }],
        }

        loader.fetch_data_as_arrow(
            "42",
            {"size": 10, "sort_columns": ["id"], "sort_order": "desc"},
        )

        call_args = loader._client.post_chart_data.call_args
        query = call_args.args[2][0]
        assert query["row_limit"] == 10
        assert query["orderby"] == [["id", False]]

    def test_passes_filters_and_sort(self, loader):
        loader._client.post_chart_data.return_value = {
            "result": [{
                "data": [{"id": 2, "status": "active"}],
                "colnames": ["id", "status"],
            }],
        }

        loader.fetch_data_as_arrow(
            "42",
            {
                "size": 10,
                "source_filters": [{"column": "status", "operator": "EQ", "value": "active"}],
                "sort_columns": ["id"],
                "sort_order": "desc",
            },
        )

        call_args = loader._client.post_chart_data.call_args
        query = call_args.args[2][0]
        assert query["filters"] == [{"col": "status", "op": "==", "val": "active"}]
        assert query["orderby"] == [["id", False]]
        assert query["row_limit"] == 10

    def test_empty_result_returns_column_schema(self, loader):
        loader._client.post_chart_data.return_value = {
            "result": [{
                "data": [],
                "colnames": ["id", "name"],
            }],
        }
        table = loader.fetch_data_as_arrow("42")
        assert table.num_rows == 0
        assert table.column_names == ["id", "name"]

    def test_empty_result_fallback_to_metadata(self, loader):
        loader._client.post_chart_data.return_value = {"result": []}
        loader._client.get_dataset_detail.return_value = {
            "columns": [
                {"column_name": "id"},
                {"column_name": "name"},
            ],
        }
        table = loader.fetch_data_as_arrow("42")
        assert table.num_rows == 0
        assert table.column_names == ["id", "name"]

    def test_invalid_source_table_raises(self, loader):
        with pytest.raises(ValueError, match="numeric dataset ID"):
            loader.fetch_data_as_arrow("not-a-number")


# ==================================================================
# SupersetLoader __init__ — URL resolution & param validation
# ==================================================================

class TestSupersetURLResolution:
    """Verify Superset URL comes from params or PLG_SUPERSET_URL env fallback."""

    def test_url_from_params(self):
        with patch.object(SupersetLoader, "_do_login"):
            loader = SupersetLoader({
                "url": "http://superset.test",
                "username": "admin",
                "password": "pass",
            })
        assert loader.url == "http://superset.test"

    def test_url_from_env_fallback(self):
        with patch.dict("os.environ", {"PLG_SUPERSET_URL": "http://env-superset.test"}):
            with patch.object(SupersetLoader, "_do_login"):
                loader = SupersetLoader({
                    "username": "admin",
                    "password": "pass",
                })
            assert loader.url == "http://env-superset.test"

    def test_url_missing_raises(self):
        with patch.dict("os.environ", {"PLG_SUPERSET_URL": ""}, clear=False):
            with pytest.raises(ValueError, match="URL is required"):
                SupersetLoader({"username": "admin", "password": "pass"})

    def test_sso_token_with_env_url(self):
        """SSO flow: url from env, access_token from SSO popup."""
        with patch.dict("os.environ", {"PLG_SUPERSET_URL": "http://sso-superset.test"}):
            loader = SupersetLoader({
                "access_token": "eyJfake",
            })
        assert loader.url == "http://sso-superset.test"
        assert loader._access_token == "eyJfake"


class TestValidateParams:
    """Test the unified validate_params classmethod."""

    def test_all_required_present_passes(self):
        SupersetLoader.validate_params({"url": "http://x"}, skip_auth_tier=True)

    def test_missing_required_raises_with_names(self):
        from data_formulator.data_loader.external_data_loader import ConnectorParamError
        with pytest.raises(ConnectorParamError) as exc_info:
            SupersetLoader.validate_params({}, skip_auth_tier=True)
        assert "url" in exc_info.value.missing

    def test_skip_auth_tier_ignores_auth_params(self):
        """In SSO mode, auth-tier params should not be required."""
        SupersetLoader.validate_params(
            {"url": "http://x", "access_token": "tok"},
            skip_auth_tier=True,
        )

    def test_empty_string_treated_as_missing(self):
        from data_formulator.data_loader.external_data_loader import ConnectorParamError
        with pytest.raises(ConnectorParamError) as exc_info:
            SupersetLoader.validate_params({"url": "  "}, skip_auth_tier=True)
        assert "url" in exc_info.value.missing


class TestClassifyConnectorError:
    """Verify classify_and_raise_connector_error passes through descriptive messages."""

    def test_connector_param_error_preserves_message(self):
        from data_formulator.data_loader.external_data_loader import ConnectorParamError
        from data_formulator.errors import AppError
        err = ConnectorParamError(["url", "host"], "TestLoader")
        with pytest.raises(AppError) as exc_info:
            classify_and_raise_connector_error(err)
        assert "url" in str(exc_info.value)
        assert "host" in str(exc_info.value)

    def test_generic_required_error_passes_detail(self):
        from data_formulator.errors import AppError
        err = ValueError("database name is required")
        with pytest.raises(AppError) as exc_info:
            classify_and_raise_connector_error(err)
        assert exc_info.value.status_code == 200
        assert exc_info.value.get_http_status() == 200
