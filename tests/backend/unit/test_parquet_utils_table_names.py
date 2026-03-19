from __future__ import annotations

import pytest

from data_formulator.datalake.parquet_utils import sanitize_table_name


pytestmark = [pytest.mark.backend]


def test_parquet_sanitize_keeps_output_non_empty_for_dangerous_input() -> None:
    sanitized = sanitize_table_name("../..")
    assert sanitized
    assert "/" not in sanitized
    assert "\\" not in sanitized


def test_parquet_sanitize_keeps_ascii_names_lowercase() -> None:
    assert sanitize_table_name("Sales_Report") == "sales_report"


@pytest.mark.xfail(
    reason="Known issue: parquet table-name sanitization still converts pure Chinese names into placeholders",
    strict=False,
)
def test_parquet_sanitize_preserves_pure_chinese_table_name() -> None:
    assert sanitize_table_name("订单明细") == "订单明细"


@pytest.mark.xfail(
    reason="Known issue: parquet table-name sanitization still drops Chinese characters before applying a safe prefix",
    strict=False,
)
def test_parquet_sanitize_preserves_unicode_when_name_starts_with_digit() -> None:
    assert sanitize_table_name("2024订单") == "table_2024订单"


@pytest.mark.xfail(
    reason="Known issue: parquet table-name sanitization still drops Chinese characters around separators",
    strict=False,
)
def test_parquet_sanitize_normalizes_separators_without_losing_unicode() -> None:
    assert sanitize_table_name("销售-区域/汇总") == "销售_区域_汇总"
