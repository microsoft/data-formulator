from __future__ import annotations

import pandas as pd
import pytest

from data_formulator.agents.agent_utils_sql import (
    create_duckdb_conn_with_parquet_views,
    sanitize_table_name,
)


pytestmark = [pytest.mark.backend]


def test_sql_sanitize_preserves_safe_ascii_symbols() -> None:
    assert sanitize_table_name("sales.report$2024") == "sales.report$2024"


def test_sql_sanitize_replaces_spaces_and_hyphens_for_ascii_names() -> None:
    assert sanitize_table_name("sales report-2024") == "sales_report_2024"


def test_sql_sanitize_preserves_unicode_identifier() -> None:
    assert sanitize_table_name("客户表-明细") == "客户表_明细"


def test_create_duckdb_views_supports_unicode_view_names(tmp_path) -> None:
    table_name = "客户表-明细"
    expected_view_name = "客户表_明细"

    df = pd.DataFrame([{"金额": 100, "数量": 2}])
    parquet_path = tmp_path / "orders.parquet"
    df.to_parquet(parquet_path, index=False)

    class FakeWorkspace:
        def get_parquet_path(self, name: str):
            assert name == table_name
            return parquet_path

    conn = create_duckdb_conn_with_parquet_views(
        FakeWorkspace(),
        [{"name": table_name}],
    )
    try:
        result = conn.execute(f'SELECT "金额" FROM "{expected_view_name}"').fetchall()
        assert result == [(100,)]
    finally:
        conn.close()
