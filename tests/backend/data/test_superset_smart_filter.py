# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for SupersetLoader smart filter features.

Covers:
- _normalize_column_type classification
- _build_source_filter_clauses SQL generation
- get_column_types (with mocked SupersetClient)
- get_column_values three-tier fallback (with mocked SupersetClient)
- SQL helper functions (_detect_quote_char, _sql_literal, etc.)
- URL resolution (params → env fallback)
- Unified validate_params / ConnectorParamError
"""
from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from data_formulator.data_connector import classify_and_raise_connector_error
from data_formulator.data_loader.superset_data_loader import (
    SupersetLoader,
    _detect_quote_char,
    _quote_identifier,
    _column_ref,
    _sql_literal,
)

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
# _build_source_filter_clauses
# ==================================================================

class TestBuildSourceFilterClauses:

    def test_empty_filters(self):
        assert SupersetLoader._build_source_filter_clauses(None) == []
        assert SupersetLoader._build_source_filter_clauses([]) == []

    def test_eq_filter(self):
        filters = [{"column": "status", "operator": "EQ", "value": "active"}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert len(clauses) == 1
        assert "status = 'active'" in clauses[0]

    def test_in_filter(self):
        filters = [{"column": "id", "operator": "IN", "value": [1, 2, 3]}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert "IN (1, 2, 3)" in clauses[0]

    def test_not_in_filter(self):
        filters = [{"column": "id", "operator": "NOT_IN", "value": [4, 5]}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert "NOT IN" in clauses[0]

    def test_between_filter(self):
        filters = [{"column": "age", "operator": "BETWEEN", "value": [18, 65]}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert "BETWEEN 18 AND 65" in clauses[0]

    def test_is_null_filter(self):
        filters = [{"column": "email", "operator": "IS_NULL", "value": None}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert "IS NULL" in clauses[0]

    def test_is_not_null_filter(self):
        filters = [{"column": "email", "operator": "IS_NOT_NULL", "value": None}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert "IS NOT NULL" in clauses[0]

    def test_like_filter(self):
        filters = [{"column": "name", "operator": "LIKE", "value": "%alice%"}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert "LIKE" in clauses[0]

    def test_invalid_operator_skipped(self):
        filters = [{"column": "x", "operator": "DROP TABLE", "value": "1"}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert clauses == []

    def test_missing_column_skipped(self):
        filters = [{"operator": "EQ", "value": "1"}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert clauses == []

    def test_in_with_empty_list_skipped(self):
        filters = [{"column": "x", "operator": "IN", "value": []}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert clauses == []

    def test_between_with_wrong_length_skipped(self):
        filters = [{"column": "x", "operator": "BETWEEN", "value": [1]}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert clauses == []

    def test_multiple_filters_combined(self):
        filters = [
            {"column": "status", "operator": "EQ", "value": "active"},
            {"column": "age", "operator": "GTE", "value": 18},
        ]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert len(clauses) == 2

    def test_backtick_quote_char(self):
        filters = [{"column": "my col", "operator": "EQ", "value": "x"}]
        clauses = SupersetLoader._build_source_filter_clauses(filters, quote_char="`")
        assert "`my col`" in clauses[0]

    def test_boolean_value_literal(self):
        filters = [{"column": "active", "operator": "EQ", "value": True}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert "TRUE" in clauses[0]

    def test_non_dict_filter_skipped(self):
        filters = ["not-a-dict", {"column": "x", "operator": "EQ", "value": 1}]
        clauses = SupersetLoader._build_source_filter_clauses(filters)
        assert len(clauses) == 1


# ==================================================================
# _build_sort_clause
# ==================================================================

class TestBuildSortClause:

    def test_empty_sort_columns(self):
        assert SupersetLoader._build_sort_clause(None) == ""
        assert SupersetLoader._build_sort_clause([]) == ""

    def test_desc_sort_clause(self):
        clause = SupersetLoader._build_sort_clause(["id"], "desc")
        assert clause == "ORDER BY id DESC"

    def test_defaults_to_ascending_for_unknown_order(self):
        clause = SupersetLoader._build_sort_clause(["id"], "DROP TABLE")
        assert clause == "ORDER BY id ASC"

    def test_quotes_special_column_names(self):
        clause = SupersetLoader._build_sort_clause(["order amount"], "asc", quote_char="`")
        assert clause == "ORDER BY `order amount` ASC"

    def test_skips_invalid_columns(self):
        clause = SupersetLoader._build_sort_clause(["", None, "id"], "asc")
        assert clause == "ORDER BY id ASC"


# ==================================================================
# SQL helpers
# ==================================================================

class TestSQLHelpers:

    def test_detect_quote_char_mysql(self):
        assert _detect_quote_char({"database": {"backend": "mysql"}}) == "`"
        assert _detect_quote_char({"database": {"backend": "MariaDB"}}) == "`"

    def test_detect_quote_char_postgres(self):
        assert _detect_quote_char({"database": {"backend": "postgresql"}}) == '"'

    def test_detect_quote_char_missing_backend(self):
        assert _detect_quote_char({}) == '"'

    def test_quote_identifier(self):
        assert _quote_identifier("users") == '"users"'
        assert _quote_identifier('col"name') == '"col""name"'

    def test_column_ref_simple(self):
        assert _column_ref("status") == "status"

    def test_column_ref_with_spaces(self):
        assert _column_ref("my column") == '"my column"'

    def test_sql_literal_string(self):
        assert _sql_literal("hello") == "'hello'"
        assert _sql_literal("it's") == "'it''s'"

    def test_sql_literal_number(self):
        assert _sql_literal(42) == "42"
        assert _sql_literal(3.14) == "3.14"

    def test_sql_literal_bool(self):
        assert _sql_literal(True) == "TRUE"
        assert _sql_literal(False) == "FALSE"

    def test_sql_literal_none(self):
        assert _sql_literal(None) == "NULL"


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

    def test_tier3_sql_fallback(self, loader):
        """Third tier: SQL SELECT DISTINCT via SQL Lab"""
        loader._client.get_datasource_column_values.side_effect = Exception("404")
        loader._client.get_dataset_distinct_values.side_effect = Exception("404")
        loader._client.get_dataset_detail.return_value = {
            "table_name": "users",
            "database": {"id": 1, "backend": "postgresql"},
            "schema": "public",
        }
        mock_session = MagicMock()
        loader._client.create_sql_session.return_value = mock_session
        loader._client.execute_sql_with_session.return_value = {
            "data": [{"name": "alice"}, {"name": "bob"}],
            "columns": [{"column_name": "name"}],
        }
        result = loader.get_column_values("42", "name", limit=10)
        assert len(result["options"]) == 2

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
        loader._client.get_dataset_detail.side_effect = Exception("err")
        result = loader.get_column_values("42", "col")
        assert result["options"] == []
        assert result["has_more"] is False


# ==================================================================
# fetch_data_as_arrow SQL generation
# ==================================================================

class TestFetchDataAsArrow:

    @pytest.fixture
    def loader(self):
        return _make_mock_loader()

    def test_applies_sort_options_to_sql(self, loader):
        loader._client.get_dataset_detail.return_value = {
            "table_name": "orders",
            "database": {"id": 1, "backend": "postgresql"},
            "schema": "public",
        }
        loader._client.create_sql_session.return_value = MagicMock()
        loader._client.execute_sql_with_session.return_value = {
            "data": [{"id": 2}, {"id": 1}],
            "columns": [{"column_name": "id"}],
            "status": "success",
        }

        loader.fetch_data_as_arrow(
            "42",
            {"size": 10, "sort_columns": ["id"], "sort_order": "desc"},
        )

        sql = loader._client.execute_sql_with_session.call_args.args[2]
        assert "ORDER BY id DESC LIMIT 10" in sql

    def test_applies_filters_before_sort(self, loader):
        loader._client.get_dataset_detail.return_value = {
            "table_name": "orders",
            "database": {"id": 1, "backend": "postgresql"},
            "schema": "public",
        }
        loader._client.create_sql_session.return_value = MagicMock()
        loader._client.execute_sql_with_session.return_value = {
            "data": [{"id": 2, "status": "active"}],
            "columns": [{"column_name": "id"}, {"column_name": "status"}],
            "status": "success",
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

        sql = loader._client.execute_sql_with_session.call_args.args[2]
        assert "WHERE status = 'active' ORDER BY id DESC LIMIT 10" in sql


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
