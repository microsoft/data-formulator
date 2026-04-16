from __future__ import annotations

import pytest

from data_formulator.datalake.file_manager import sanitize_table_name


pytestmark = [pytest.mark.backend]


# ---- Unicode preservation ----

def test_preserves_pure_chinese_name() -> None:
    assert sanitize_table_name("订单明细.csv") == "订单明细"


def test_preserves_japanese_name() -> None:
    assert sanitize_table_name("売上データ.xlsx") == "売上データ"


def test_preserves_korean_name() -> None:
    assert sanitize_table_name("고객목록.csv") == "고객목록"


def test_preserves_cyrillic_name() -> None:
    assert sanitize_table_name("отчёт.csv") == "отчёт"


def test_preserves_mixed_unicode_and_ascii() -> None:
    assert sanitize_table_name("2024年销售report.csv") == "_2024年销售report"


# ---- Separator normalization ----

def test_collapses_consecutive_underscores() -> None:
    result = sanitize_table_name("a---b___c.csv")
    assert "__" not in result
    assert result == "a_b_c"


def test_normalizes_spaces_and_hyphens() -> None:
    assert sanitize_table_name("sales report-2024.csv") == "sales_report_2024"


def test_normalizes_special_chars_to_single_underscore() -> None:
    result = sanitize_table_name("file@#$%name.csv")
    assert "__" not in result


# ---- Edge cases ----

def test_strips_file_extension() -> None:
    assert sanitize_table_name("data.xlsx") == "data"


def test_empty_name_returns_unnamed() -> None:
    assert sanitize_table_name("") == "_unnamed"


def test_dotfile_name_treated_as_stem() -> None:
    """Path('.csv').stem is '.csv' (dotfile), not empty."""
    assert sanitize_table_name(".csv") == "csv"


def test_only_special_chars_returns_unnamed() -> None:
    assert sanitize_table_name("@#$.csv") == "_unnamed"


def test_digit_prefix_gets_underscore() -> None:
    result = sanitize_table_name("123data.csv")
    assert result[0] == "_"
    assert result == "_123data"


def test_result_is_lowercase() -> None:
    assert sanitize_table_name("Sales_Report.CSV") == "sales_report"


def test_no_leading_trailing_underscores() -> None:
    result = sanitize_table_name("__test__.csv")
    assert not result.startswith("_") or result == "_unnamed"
    assert not result.endswith("_")
