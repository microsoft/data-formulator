from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.agent import _missing_action_fields
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.core.skill import CoreSkill
from data_formulator.analyst.workspace_inputs import (
    WorkspaceInputManifest,
    WorkspaceInputRef,
)


pytestmark = [pytest.mark.backend]


def test_visualize_schema_requires_generalized_input_sources():
    registry = build_registry()
    visualize = next(
        spec for spec in registry.action_tools_for(["core"])
        if spec["function"]["name"] == "visualize"
    )
    parameters = visualize["function"]["parameters"]

    assert "title" in parameters["required"]
    assert "input_sources" in parameters["required"]
    assert "input_tables" not in parameters["required"]
    assert parameters["properties"]["input_sources"]["items"]["properties"]["kind"]["enum"] == ["data", "file"]
    assert "subtitle" in parameters["properties"]
    subtitle_description = parameters["properties"]["subtitle"]["description"]
    assert "at most 16 words" in subtitle_description
    assert "Do not restate the measure or analytical lens" in subtitle_description


def test_visualize_required_fields_allow_empty_sources_and_legacy_tables():
    required = ["title", "input_sources", "code"]

    assert _missing_action_fields(required, {
        "title": "Result", "input_sources": [], "code": "result_df = source",
    }) == []
    assert _missing_action_fields(required, {
        "title": "Result", "input_tables": ["orders"], "code": "result_df = source",
    }) == []
    assert _missing_action_fields(required, {
        "title": "Result", "code": "result_df = source",
    }) == ["input_sources"]


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
        "input_sources": [],
        "code": "result_df = source",
        "output_variable": "result_df",
        "chart": {"chart_type": "Line Chart", "encodings": {}},
    }, ctx))

    runtime.run_visualize_code.assert_called_once()
    kwargs = runtime.run_visualize_code.call_args.kwargs
    assert kwargs["title"] == "Growth Accelerated After 2020"
    assert kwargs["subtitle"] == "US monthly index, January 2006 = 100"


def _manifest() -> WorkspaceInputManifest:
    return WorkspaceInputManifest(inputs=(
        WorkspaceInputRef(
            id="data:hash:orders",
            kind="data",
            display_name="orders",
            media_type="application/vnd.data-formulator.table",
            size_bytes=10,
            content_hash="hash",
            capabilities=("python",),
        ),
        WorkspaceInputRef(
            id="file:hash:notes.docx",
            kind="file",
            display_name="notes.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size_bytes=20,
            content_hash="hash",
            capabilities=("python", "read"),
        ),
    ))


def _action(**provenance):
    return {
        "title": "Result",
        "code": "result_df = source",
        "output_variable": "result_df",
        "chart": {"chart_type": "Table", "encodings": {}},
        **provenance,
    }


def test_visualize_emits_manifest_normalized_file_source():
    runtime = MagicMock()
    runtime.run_visualize_code.return_value = {"status": "error", "error_message": "stop"}
    ctx = SkillContext(
        client=None,
        workspace=MagicMock(),
        runtime=runtime,
        payload={"workspace_inputs": _manifest()},
    )

    events = list(CoreSkill()._handle_visualize(_action(input_sources=[
        {"id": "file:hash:notes.docx", "kind": "file"},
        {"id": "file:hash:notes.docx", "kind": "file"},
    ]), ctx))

    assert events[0]["input_sources"] == [{
        "id": "file:hash:notes.docx",
        "kind": "file",
        "display_name": "notes.docx",
    }]
    assert events[0]["input_tables"] == []


def test_visualize_translates_legacy_table_names_to_stable_sources():
    runtime = MagicMock()
    runtime.run_visualize_code.return_value = {"status": "error", "error_message": "stop"}
    ctx = SkillContext(
        client=None,
        workspace=MagicMock(),
        runtime=runtime,
        payload={"workspace_inputs": _manifest()},
    )

    events = list(CoreSkill()._handle_visualize(
        _action(input_tables=["orders"]), ctx,
    ))

    assert events[0]["input_sources"][0]["id"] == "data:hash:orders"
    assert events[0]["input_tables"] == ["orders"]


def test_visualize_rejects_unknown_input_source_before_execution():
    runtime = MagicMock()
    ctx = SkillContext(
        client=None,
        workspace=MagicMock(),
        runtime=runtime,
        payload={"workspace_inputs": _manifest()},
    )

    events = list(CoreSkill()._handle_visualize(_action(input_sources=[
        {"id": "file:missing:unknown.docx", "kind": "file"},
    ]), ctx))

    assert events[0]["type"] == "error"
    assert "Unknown or mismatched input source" in events[0]["message"]
    runtime.run_visualize_code.assert_not_called()