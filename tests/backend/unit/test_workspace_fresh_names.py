from __future__ import annotations

import pytest

from data_formulator.datalake.workspace import Workspace


pytestmark = [pytest.mark.backend]


def test_workspace_get_fresh_name_appends_numeric_suffix_for_ascii_name(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.list_tables = lambda: ["sales_data", "sales_data_2"]  # type: ignore[method-assign]

    assert workspace.get_fresh_name("sales_data") == "sales_data_3"


@pytest.mark.xfail(
    reason="Known issue: workspace fresh-name generation still depends on parquet sanitization that drops Chinese names",
    strict=False,
)
def test_workspace_get_fresh_name_preserves_unicode_and_suffixes(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.list_tables = lambda: ["销售数据", "销售数据_2"]  # type: ignore[method-assign]

    assert workspace.get_fresh_name("销售数据") == "销售数据_3"


@pytest.mark.xfail(
    reason="Known issue: workspace fresh-name generation still loses Unicode for digit-prefixed names",
    strict=False,
)
def test_workspace_get_fresh_name_applies_safe_prefix_without_losing_unicode(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.list_tables = lambda: []  # type: ignore[method-assign]

    assert workspace.get_fresh_name("2024订单") == "table_2024订单"
