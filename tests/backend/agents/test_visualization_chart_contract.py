from __future__ import annotations

from unittest.mock import MagicMock, patch

import pyarrow as pa

import pytest

from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.agent import _missing_action_fields
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.visualization.skill import VisualizationSkill
from data_formulator.analyst.workspace_inputs import (
    WorkspaceInputManifest,
    WorkspaceInputRef,
)


pytestmark = [pytest.mark.backend]


def test_visualize_schema_requires_generalized_input_sources():
    registry = build_registry()
    visualize = next(
        spec for spec in registry.action_tools_for(["meta"])
        if spec["function"]["name"] == "visualize"
    )
    parameters = visualize["function"]["parameters"]

    assert "workspace Data Access Paths" in visualize["function"]["description"]
    assert "one-off chart path" in parameters["properties"]["connector_inputs"]["description"]
    load = next(spec for spec in registry.action_tools_for(["meta"])
                if spec["function"]["name"] == "propose_data_operation")
    assert "workspace Data Access Paths" in load["function"]["description"]
    assert "user_review_needed=false executes automatically" in load["function"]["description"]
    loading_query = load["function"]["parameters"]["properties"]["options"]["items"]["properties"]["tables"]["items"]["properties"]["query"]
    assert loading_query["properties"]["native"]["properties"]["language"]["enum"] == ["kql"]
    assert loading_query["properties"]["native"]["additionalProperties"] is False
    assert "local Python" in loading_query["description"]

    assert "title" in parameters["required"]
    assert "display_name" in parameters["required"]
    assert "input_sources" in parameters["required"]
    assert "input_tables" not in parameters["required"]
    assert parameters["properties"]["input_sources"]["items"]["properties"]["kind"]["enum"] == ["data", "file"]
    assert "subtitle" in parameters["properties"]
    connector_schema = parameters["properties"]["connector_inputs"]
    assert connector_schema["items"]["required"] == ["alias", "source_id", "table_key"]
    assert "aggregates" in connector_schema["items"]["properties"]["query"]["properties"]
    subtitle_description = parameters["properties"]["subtitle"]["description"]
    assert "at most 16 words" in subtitle_description
    assert "Do not restate the measure or analytical lens" in subtitle_description


def test_visualize_schema_accepts_flint_encoding_objects_and_string_shorthand():
    registry = build_registry()
    visualize = next(
        spec for spec in registry.action_tools_for(["meta"])
        if spec["function"]["name"] == "visualize"
    )
    chart_schema = visualize["function"]["parameters"]["properties"]["chart"]
    encoding_options = chart_schema["properties"]["encodings"]["additionalProperties"]["oneOf"]

    assert chart_schema["required"] == ["chart_type", "encodings"]
    assert {option["type"] for option in encoding_options} == {"string", "object"}
    object_option = next(option for option in encoding_options if option["type"] == "object")
    assert object_option["required"] == ["field"]
    assert object_option["properties"]["type"]["enum"] == [
        "quantitative", "nominal", "ordinal", "temporal",
    ]


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

    list(VisualizationSkill()._handle_visualize({
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


def test_visualize_loads_connector_input_and_reuses_it_after_code_failure(tmp_path):
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.datalake.catalog_cache import save_catalog

    workspace = Workspace("test-user", root_dir=tmp_path)
    save_catalog(workspace.user_home, "warehouse", [{"name": "Orders", "table_key": "orders",
                                                  "path": ["orders"]}])
    loader = MagicMock()
    loader.fetch_data_as_arrow.return_value = pa.table({"amount": [10, 20]})
    loader.get_safe_params.return_value = {}
    runtime = MagicMock()
    runtime.run_visualize_code.return_value = {"status": "error", "error_message": "fix chart"}
    ctx = SkillContext(client=None, workspace=workspace, runtime=runtime,
                       payload={"input_tables": [], "conversation_id": "conversation-1"})
    action = _action(input_sources=[], connector_inputs=[{
        "alias": "orders", "source_id": "warehouse", "table_key": "orders", "query": {"limit": 20},
    }])
    action["code"] = "import pandas as pd\nresult_df = pd.read_parquet(connector_inputs['orders'])"
    with patch("data_formulator.data_connector.resolve_live_loader", return_value=loader):
        for attempt in range(2):
            generator = VisualizationSkill()._handle_visualize(action, ctx)
            events = []
            while True:
                try:
                    events.append(next(generator))
                except StopIteration as stopped:
                    assert "Loaded inputs remain available" in stopped.value
                    break
            event = next(item for item in events if item["type"] == "action")
            assert event["input_sources"][0]["kind"] == "data"
            assert "connector_inputs = {'orders': 'data/" in runtime.run_visualize_code.call_args.kwargs["code"]
    loader.fetch_data_as_arrow.assert_called_once()
    assert len(workspace.list_tables()) == 1


def test_visualize_validates_all_connector_aliases_before_loading():
    runtime = MagicMock()
    ctx = SkillContext(client=None, workspace=MagicMock(), runtime=runtime)
    with patch("data_formulator.data_connector.connector_is_available", return_value=True), \
         patch("data_formulator.data_operations.DataDiscoveryService.resolve_load_table",
               return_value={"source_table": "orders"}), \
         patch("data_formulator.analyst.skills.workspace.data_loading.WorkspaceDataLoading._propose_data_operation") as load:
        events = list(VisualizationSkill()._handle_visualize(_action(input_sources=[], connector_inputs=[
            {"alias": "orders", "source_id": "warehouse", "table_key": "orders"},
            {"alias": "orders", "source_id": "warehouse", "table_key": "orders"},
        ]), ctx))
    assert events[-1]["type"] == "error"
    load.assert_not_called()
    runtime.run_visualize_code.assert_not_called()


def test_connector_aggregate_visualization_runs_real_python_without_intermediate_read(tmp_path):
    import pandas as pd
    from data_formulator.analyst.agent import AnalystAgent
    from data_formulator.data_loader.kusto_data_loader import KustoDataLoader
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.datalake.catalog_cache import save_catalog

    workspace = Workspace("test-user", root_dir=tmp_path)
    save_catalog(workspace.user_home, "adx", [{"name": "Events", "table_key": "Events", "path": ["Events"]}])
    loader = object.__new__(KustoDataLoader)
    loader.kusto_database = "analytics"
    loader.query = MagicMock(return_value=pd.DataFrame({"region": ["west", "east"], "total": [30, 20]}))
    loader.get_safe_params = MagicMock(return_value={})
    agent = AnalystAgent(client=None, workspace=workspace)
    agent._run_payload = {"input_tables": [], "conversation_id": "conversation-1"}
    action = _action(input_sources=[], connector_inputs=[{
        "alias": "totals", "source_id": "adx", "table_key": "Events",
        "query": {"group_by": ["region"], "aggregates": [{"op": "sum", "column": "amount", "as": "total"}]},
    }])
    action["code"] = "import pandas as pd\nresult_df = pd.read_parquet(connector_inputs['totals'])"
    action["chart"] = {"chart_type": "Bar Chart", "encodings": {"x": "region", "y": "total"}}
    with patch("data_formulator.data_connector.resolve_live_loader", return_value=loader):
        events = list(agent._dispatch_skill_action("visualization", "visualize", action, [], 1, []))
    assert not [event for event in events if event["type"] == "error"]
    result = next(event for event in events if event["type"] == "result")
    assert result["content"]["result"]["content"]["rows"] == [
        {"region": "west", "total": 30}, {"region": "east", "total": 20},
    ]
    assert len(workspace.list_tables()) == 2
    assert agent._run_payload["workspace_inputs"].data[0].path
    loader.query.assert_called_once()
    assert "summarize ['total']=sum(['amount']) by ['region']" in loader.query.call_args.args[0]


def test_failed_connector_load_prevents_python_and_chart(tmp_path):
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.datalake.catalog_cache import save_catalog

    workspace = Workspace("test-user", root_dir=tmp_path)
    save_catalog(workspace.user_home, "warehouse", [{"name": "Orders", "table_key": "orders", "path": ["orders"]}])
    loader = MagicMock()
    loader.fetch_data_as_arrow.side_effect = RuntimeError("unavailable")
    runtime = MagicMock()
    ctx = SkillContext(client=None, workspace=workspace, runtime=runtime, payload={"input_tables": []})
    with patch("data_formulator.data_connector.resolve_live_loader", return_value=loader):
        events = list(VisualizationSkill()._handle_visualize(_action(input_sources=[], connector_inputs=[{
            "alias": "orders", "source_id": "warehouse", "table_key": "orders",
        }]), ctx))
    assert events[-1]["type"] == "error"
    assert "visualization was not executed" in events[-1]["message"]
    runtime.run_visualize_code.assert_not_called()
    assert workspace.list_tables() == []


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

    events = list(VisualizationSkill()._handle_visualize(_action(input_sources=[
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

    events = list(VisualizationSkill()._handle_visualize(
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

    events = list(VisualizationSkill()._handle_visualize(_action(input_sources=[
        {"id": "file:missing:unknown.docx", "kind": "file"},
    ]), ctx))

    assert events[0]["type"] == "error"
    assert "Unknown or mismatched input source" in events[0]["message"]
    runtime.run_visualize_code.assert_not_called()