from __future__ import annotations

import pytest

from data_formulator.data_loader.external_data_loader import sanitize_table_name


pytestmark = [pytest.mark.backend]


def test_external_loader_sanitize_rejects_empty_name() -> None:
    with pytest.raises(ValueError, match="Table name cannot be empty"):
        sanitize_table_name("")


def test_external_loader_sanitize_prefixes_sql_keywords() -> None:
    assert sanitize_table_name("select") == "_select"


def test_external_loader_sanitize_truncates_overlong_names() -> None:
    raw_name = "a" * 80
    sanitized = sanitize_table_name(raw_name)
    assert len(sanitized) == 63
    assert sanitized == "a" * 63


def test_external_loader_sanitize_preserves_pure_chinese_name() -> None:
    assert sanitize_table_name("客户表") == "客户表"


def test_external_loader_sanitize_normalizes_mixed_unicode_name() -> None:
    assert sanitize_table_name("客户-订单 明细") == "客户_订单_明细"


def test_external_loader_sanitize_applies_safe_prefix_without_losing_unicode() -> None:
    assert sanitize_table_name("2024客户") == "_2024客户"
