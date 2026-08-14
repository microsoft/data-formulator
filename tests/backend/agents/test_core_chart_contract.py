from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.core.skill import CoreSkill


pytestmark = [pytest.mark.backend]


def test_visualize_schema_requires_title_and_exposes_subtitle():
    registry = build_registry()
    visualize = next(
        spec for spec in registry.action_tools_for(["core"])
        if spec["function"]["name"] == "visualize"
    )
    parameters = visualize["function"]["parameters"]

    assert "title" in parameters["required"]
    assert "subtitle" in parameters["properties"]
    subtitle_description = parameters["properties"]["subtitle"]["description"]
    assert "at most 16 words" in subtitle_description
    assert "Do not restate the measure or analytical lens" in subtitle_description


def test_visualize_handler_forwards_title_and_subtitle():
    runtime = MagicMock()
    runtime.run_visualize_code.return_value = {
        "status": "error",
        "error_message": "stop after argument capture",
    }
    ctx = SkillContext(client=None, workspace=MagicMock(), runtime=runtime)

    list(CoreSkill()._handle_visualize({
        "title": "Growth Accelerated After 2020",
        "subtitle": "US monthly index, January 2006 = 100",
        "code": "result_df = source",
        "output_variable": "result_df",
        "chart": {"chart_type": "Line Chart", "encodings": {}},
    }, ctx))

    runtime.run_visualize_code.assert_called_once()
    kwargs = runtime.run_visualize_code.call_args.kwargs
    assert kwargs["title"] == "Growth Accelerated After 2020"
    assert kwargs["subtitle"] == "US monthly index, January 2006 = 100"