from __future__ import annotations

import pytest

from data_formulator.agents.agent_utils_sql import sanitize_table_name as sql_sanitize
from data_formulator.data_loader.external_data_loader import (
    sanitize_table_name as external_loader_sanitize,
)
from data_formulator.datalake.parquet_utils import (
    sanitize_table_name as parquet_sanitize,
)


pytestmark = [pytest.mark.backend]


@pytest.mark.parametrize(
    ("raw_name", "expected"),
    [
        ("订单明细", "订单明细"),
        ("销售 区域", "销售_区域"),
        ("2024订单", "table_2024订单"),
    ],
)
def test_parquet_sanitize_table_name_should_preserve_unicode(raw_name: str, expected: str) -> None:
    assert parquet_sanitize(raw_name) == expected


@pytest.mark.parametrize(
    ("raw_name", "expected"),
    [
        ("客户表", "客户表"),
        ("客户-订单", "客户_订单"),
        ("2024客户", "_2024客户"),
    ],
)
def test_external_loader_sanitize_should_preserve_unicode(raw_name: str, expected: str) -> None:
    assert external_loader_sanitize(raw_name) == expected


@pytest.mark.parametrize(
    ("raw_name", "expected"),
    [
        ("客户表", "客户表"),
        ("客户表-明细", "客户表_明细"),
        ("金额(元)", "金额_元"),
    ],
)
def test_sql_sanitize_should_preserve_unicode_identifiers(raw_name: str, expected: str) -> None:
    assert sql_sanitize(raw_name) == expected
