from __future__ import annotations

import pytest

from data_formulator.datalake.parquet_utils import sanitize_table_name as parquet_sanitize
from data_formulator.tables_routes import sanitize_table_name as route_sanitize


pytestmark = [pytest.mark.backend, pytest.mark.contract]


def test_route_sanitize_should_not_turn_pure_chinese_name_into_placeholder() -> None:
    sanitized = route_sanitize("订单明细")
    assert sanitized not in {"", "_unnamed", "unnamed", "table"}
    assert "订单" in sanitized


def test_route_sanitize_should_keep_unicode_and_apply_safe_prefix_if_needed() -> None:
    assert route_sanitize("2024销售订单") == "table_2024销售订单"


def test_route_sanitize_should_delegate_to_parquet_sanitizer_for_ascii_name() -> None:
    assert route_sanitize("Sales_Report") == parquet_sanitize("Sales_Report")
