# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for the unified error types (errors.py).

Verifies that AppError carries structured error information (code, message,
status_code, retry flag) and serialises correctly via to_dict().
"""
from __future__ import annotations

import pytest

from data_formulator.errors import AppError, ErrorCode

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# ErrorCode completeness
# ---------------------------------------------------------------------------

class TestErrorCode:

    _REQUIRED_CODES = [
        # Auth
        "AUTH_REQUIRED", "AUTH_EXPIRED", "ACCESS_DENIED",
        # Input / validation
        "INVALID_REQUEST", "TABLE_NOT_FOUND", "FILE_PARSE_ERROR",
        "FILE_TOO_LARGE", "VALIDATION_ERROR",
        # LLM / model
        "LLM_AUTH_FAILED", "LLM_RATE_LIMIT", "LLM_CONTEXT_TOO_LONG",
        "LLM_MODEL_NOT_FOUND", "LLM_TIMEOUT", "LLM_SERVICE_ERROR",
        "LLM_CONTENT_FILTERED", "LLM_UNKNOWN_ERROR",
        # Data / connector
        "DB_CONNECTION_FAILED", "DB_QUERY_ERROR", "DATA_LOAD_ERROR",
        "CONNECTOR_ERROR",
        # Execution
        "CODE_EXECUTION_ERROR", "AGENT_ERROR",
        # System
        "INTERNAL_ERROR", "SERVICE_UNAVAILABLE",
    ]

    @pytest.mark.parametrize("code_name", _REQUIRED_CODES)
    def test_error_code_exists(self, code_name: str) -> None:
        value = getattr(ErrorCode, code_name)
        assert value == code_name

    def test_code_values_are_strings(self) -> None:
        for attr in dir(ErrorCode):
            if attr.startswith("_"):
                continue
            assert isinstance(getattr(ErrorCode, attr), str)


# ---------------------------------------------------------------------------
# AppError construction
# ---------------------------------------------------------------------------

class TestAppErrorConstruction:

    def test_basic_construction(self) -> None:
        err = AppError(ErrorCode.TABLE_NOT_FOUND, "Table not found")
        assert err.code == "TABLE_NOT_FOUND"
        assert err.message == "Table not found"
        assert err.status_code == 500
        assert err.detail is None
        assert err.retry is False

    def test_custom_status_code(self) -> None:
        err = AppError(ErrorCode.INVALID_REQUEST, "Bad input", status_code=400)
        assert err.status_code == 400

    def test_detail_and_retry(self) -> None:
        err = AppError(
            ErrorCode.LLM_RATE_LIMIT, "Rate limited",
            status_code=429, detail="retry-after: 30s", retry=True,
        )
        assert err.detail == "retry-after: 30s"
        assert err.retry is True

    def test_inherits_from_exception(self) -> None:
        err = AppError(ErrorCode.INTERNAL_ERROR, "boom")
        assert isinstance(err, Exception)
        assert str(err) == "boom"

    def test_can_be_raised_and_caught(self) -> None:
        with pytest.raises(AppError) as exc_info:
            raise AppError(ErrorCode.ACCESS_DENIED, "No access", status_code=403)
        assert exc_info.value.code == "ACCESS_DENIED"
        assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# AppError.to_dict()
# ---------------------------------------------------------------------------

class TestAppErrorToDict:

    def test_to_dict_without_detail(self) -> None:
        err = AppError(ErrorCode.TABLE_NOT_FOUND, "Table not found", status_code=404)
        d = err.to_dict()
        assert d == {
            "code": "TABLE_NOT_FOUND",
            "message": "Table not found",
            "retry": False,
        }

    def test_to_dict_excludes_detail_by_default(self) -> None:
        err = AppError(
            ErrorCode.INTERNAL_ERROR, "Oops",
            detail="NullPointerException at line 42",
        )
        d = err.to_dict()
        assert "detail" not in d

    def test_to_dict_includes_detail_when_requested(self) -> None:
        err = AppError(
            ErrorCode.INTERNAL_ERROR, "Oops",
            detail="NullPointerException at line 42",
        )
        d = err.to_dict(include_detail=True)
        assert d["detail"] == "NullPointerException at line 42"

    def test_to_dict_include_detail_no_op_when_detail_is_none(self) -> None:
        err = AppError(ErrorCode.INTERNAL_ERROR, "Oops")
        d = err.to_dict(include_detail=True)
        assert "detail" not in d

    def test_to_dict_with_retry_true(self) -> None:
        err = AppError(ErrorCode.LLM_TIMEOUT, "Timeout", retry=True)
        assert err.to_dict()["retry"] is True


# ---------------------------------------------------------------------------
# Subclassing
# ---------------------------------------------------------------------------

class TestAppErrorSubclass:

    def test_subclass_preserves_interface(self) -> None:
        class DataError(AppError):
            def __init__(self, table_name: str):
                super().__init__(
                    ErrorCode.TABLE_NOT_FOUND,
                    f"Table '{table_name}' not found",
                    status_code=404,
                )
                self.table_name = table_name

        err = DataError("my_table")
        assert err.code == "TABLE_NOT_FOUND"
        assert err.table_name == "my_table"
        d = err.to_dict()
        assert d["code"] == "TABLE_NOT_FOUND"
        assert "my_table" in d["message"]

    def test_subclass_caught_as_app_error(self) -> None:
        class LLMError(AppError):
            pass

        with pytest.raises(AppError):
            raise LLMError(ErrorCode.LLM_TIMEOUT, "timeout", status_code=504)
