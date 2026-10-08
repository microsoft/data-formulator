"""Visualize observations must show small results in full."""
from __future__ import annotations

from unittest.mock import MagicMock

from data_formulator.analyst.skills.visualization.skill import VisualizationSkill


def _observation(rows):
    workspace = MagicMock()
    workspace.read_data_as_df = MagicMock(side_effect=FileNotFoundError)
    workspace.get_relative_data_file_path = MagicMock(side_effect=FileNotFoundError)
    return VisualizationSkill._format_observation(
        step_index=1, display_instruction="Top prices", code="out = df",
        data={"rows": rows, "virtual": {"table_name": "d_out"}}, workspace=workspace,
    )


def test_small_results_list_every_row():
    rows = [{"Subcategory": f"Sub {i}", "Unit Price": float(i)} for i in range(10)]
    text = _observation(rows)
    assert "Sub 0" in text and "Sub 9" in text


def test_large_results_keep_a_short_sample():
    rows = [{"Subcategory": f"Sub {i:03d}", "Unit Price": float(i)} for i in range(100)]
    text = _observation(rows)
    assert "Sub 004" in text and "Sub 050" not in text.split("Sample Data")[-1]


def test_dataframe_hash_accepts_non_string_column_labels():
    import pandas as pd

    from data_formulator.datalake.parquet_utils import compute_dataframe_hash

    assert compute_dataframe_hash(pd.DataFrame({"country": ["A"], 1950: [40.0], 2021.0: [70.0]}))
