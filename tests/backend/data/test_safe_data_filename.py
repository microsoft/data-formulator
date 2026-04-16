"""Unit tests for safe_data_filename (P1: Unicode filename preservation).

Regression: werkzeug.secure_filename stripped Chinese characters,
causing FileNotFoundError for files like query_业务员业绩.xlsx.
"""
from __future__ import annotations

import pytest

from data_formulator.datalake.parquet_utils import safe_data_filename

pytestmark = [pytest.mark.backend]


def test_chinese_filename_preserves_unicode() -> None:
    """The original bug: Chinese filenames must not be stripped."""
    assert safe_data_filename("query_业务员业绩.xlsx") == "query_业务员业绩.xlsx"


def test_path_traversal_strips_directory_components() -> None:
    """Directory traversal is neutralised by extracting the basename."""
    assert safe_data_filename("../../etc/passwd") == "passwd"


def test_empty_filename_raises_valueerror() -> None:
    with pytest.raises(ValueError):
        safe_data_filename("")
