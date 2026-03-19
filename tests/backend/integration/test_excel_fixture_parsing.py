from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest


pytestmark = [pytest.mark.backend]


def test_manual_xls_fixture_can_be_parsed() -> None:
    fixture_path = (
        Path(__file__).resolve().parents[1]
        / "fixtures"
        / "excel"
        / "test_cn.xls"
    )
    assert fixture_path.exists()

    df = pd.read_excel(fixture_path)

    assert not df.empty
