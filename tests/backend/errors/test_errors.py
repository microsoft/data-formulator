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
# AppError construction
# ---------------------------------------------------------------------------

class TestAppErrorConstruction:

    def test_basic_construction(self) -> None:
        err = AppError(ErrorCode.TABLE_NOT_FOUND, "Table not found")
        assert err.code == "TABLE_NOT_FOUND"
        assert err.message == "Table not found"
        assert err.status_code == 200
        assert err.detail is None
        assert err.retry is False

    def test_inherits_from_exception(self) -> None:
        err = AppError(ErrorCode.INTERNAL_ERROR, "boom")
        assert isinstance(err, Exception)
        assert str(err) == "boom"


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
