from __future__ import annotations

import json

import pandas as pd
import pytest

from data_formulator.analyst.deletion import plan_deletion
from data_formulator.analyst.session_layer import SessionLayer
from data_formulator.analyst.skills import SkillContext, build_registry
from data_formulator.datalake.workspace import Workspace

pytestmark = pytest.mark.backend


def _state(with_report: bool = True):
    # sales (loaded) -> By region (derived, chart-region) -> Top regions (derived, chart-top)
    # Mix (derived from the Users reference) has two charts; the report "Findings" shows chart-top.
    def derived(node_id, name, display, source, **extra):
        return {"kind": "table", "id": node_id, "displayId": display, "names": ["a"], "metadata": {},
                "virtual": {"tableId": name, "rowCount": 1},
                "derive": {"source": source, "code": "", "trigger": {"tableId": source[0] if source else "conversation-root:x", **extra}}}

    def chart(chart_id, table, title):
        return {"id": chart_id, "chartType": "Bar Chart", "tableRef": table, "title": title, "encodingMap": {}}

    return {
        "inputTables": [{"kind": "input-table", "id": "table-sales", "displayId": "Sales",
                         "source": {"kind": "workspace", "tableId": "sales"}, "snapshot": {"columns": [], "rowCount": 3}}],
        "derivedTables": [derived("table-region", "d_region", "By region", ["table-sales"]),
                          derived("table-top", "d_top", "Top regions", ["table-region"]),
                          derived("table-mix", "d_mix", "Mix", [], externalReferenceId="ref-users")],
        "charts": [chart("chart-sales", "table-sales", "Bar of Sales"), chart("chart-region", "table-region", "Sales by region"),
                   chart("chart-top", "table-top", "Top regions"), chart("chart-mix-1", "table-mix", "Mix 1"),
                   chart("chart-mix-2", "table-mix", "Mix 2")],
        "externalTableReferences": [{"id": "ref-orders", "displayName": "Orders"}, {"id": "ref-users", "displayName": "Users"}],
        "generatedReports": [{"id": "r1", "title": "Findings", "content": "![top](chart://chart-top)"}] if with_report else [],
    }


def _ctx(workspace=None, state=None, **payload):
    return SkillContext(client=None, workspace=workspace,
                        payload={"session_layer": SessionLayer(state or _state(), workspace), **payload})


def test_a_chart_goes_alone_while_its_table_keeps_another_chart() -> None:
    plan = plan_deletion(["chart-mix-1"], _ctx())
    assert plan == {"tables": [], "charts": [{"id": "chart-mix-1", "name": "Mix 1", "table": "table-mix"}], "references": [], "files": []}


def test_a_derived_table_goes_with_its_last_chart() -> None:
    plan = plan_deletion(["chart-mix-1", "chart-mix-2"], _ctx())
    assert [table["node_id"] for table in plan["tables"]] == ["table-mix"]
    assert plan["tables"][0]["because"] == "nothing is left built on it"


def test_a_derived_table_with_a_table_computed_from_it_stays_when_its_last_chart_goes() -> None:
    plan = plan_deletion(["chart-region"], _ctx())
    assert plan["tables"] == [] and [chart["id"] for chart in plan["charts"]] == ["chart-region"]


def test_a_table_takes_its_charts_by_name_or_id() -> None:
    plan = plan_deletion(["Mix"], _ctx())
    assert [table["id"] for table in plan["tables"]] == ["d_mix"]
    assert {chart["id"] for chart in plan["charts"]} == {"chart-mix-1", "chart-mix-2"}
    assert all(chart["because"] == "chart of Mix" for chart in plan["charts"])


@pytest.mark.parametrize("targets, message", [
    (["sales"], "the table By region was computed from Sales"),
    (["chart-top"], "the report Findings shows the chart Top regions"),
    (["d_top"], "the report Findings uses Top regions"),
    (["ref-users"], "the table Mix was computed from Users"),
])
def test_refuses_what_would_leave_a_dependent_broken(targets, message) -> None:
    with pytest.raises(ValueError, match="Nothing was deleted: .*" + message):
        plan_deletion(targets, _ctx())


def test_a_chart_can_go_once_the_report_is_edited_in_the_same_run() -> None:
    ctx = _ctx()
    ctx.payload["session_layer"].record_edit("session/reports/r1.md", "# Findings\n\nNo chart any more.\n")
    plan = plan_deletion(["chart-top"], ctx)
    assert [chart["id"] for chart in plan["charts"]] == ["chart-top"]


def test_a_report_made_from_a_table_is_named_as_going_with_it() -> None:
    state = _state(with_report=False)
    state["generatedReports"] = [{"id": "r2", "title": "Mix notes", "content": "text", "triggerTableId": "table-mix"}]
    with pytest.raises(ValueError, match="the report Mix notes was made from Mix and would be deleted with it; "
                                         "Mix goes because nothing would be left built on it.*only the user"):
        plan_deletion(["chart-mix-1", "chart-mix-2"], _ctx(state=state))


def test_a_table_and_what_was_computed_from_it_can_go_together() -> None:
    plan = plan_deletion(["sales", "d_region", "d_top"], _ctx(state=_state(with_report=False)))
    assert [table["node_id"] for table in plan["tables"]] == ["table-sales", "table-region", "table-top"]


def test_unknown_items_list_the_session() -> None:
    with pytest.raises(ValueError, match=r"(?s)Not in this session: 'd_new'.*- sales \(table\): Sales.*- ref-orders \(connected-source reference\): Orders"):
        plan_deletion(["d_new"], _ctx())
    with pytest.raises(ValueError, match="no session to delete from"):
        plan_deletion(["sales"], SkillContext(client=None, workspace=None, payload={}))


def test_refuses_a_table_or_reference_an_app_reads(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(
        b'// @df-app {"version": 2, "title": "T", "tables": ["d_mix"], "sources": ["ref-orders"]}\n'
        b'export default function App() { return null; }\n', "mix.app.jsx", "text/jsx", agent_managed=True)
    with pytest.raises(ValueError, match="the app files/mix.app.jsx reads Mix"):
        plan_deletion(["chart-mix-1", "chart-mix-2"], _ctx(workspace))
    with pytest.raises(ValueError, match="the app files/mix.app.jsx reads Orders"):
        plan_deletion(["ref-orders"], _ctx(workspace))


def test_delete_items_tool_returns_the_plan_and_drops_the_items_from_the_run(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"a": [1]}), "d_mix")
    skill = build_registry().get_skill("workspace")
    layer = SessionLayer(_state(), workspace)
    payload = {
        "session_layer": layer,
        "input_tables": [{"name": "d_mix"}, {"name": "sales"}],
        "charts": [{"chart_id": "chart-mix-1"}, {"chart_id": "chart-sales"}],
        "external_references": [{"id": "ref-orders"}],
        "replaceable_artifacts": [{"id": "d_mix", "node_id": "table-mix", "kind": "table"}],
    }
    ctx = SkillContext(client=None, workspace=workspace, payload=dict(payload))
    result = json.loads(skill.handle_tool("delete_items", {"items": ["d_mix", "ref-orders"]}, ctx).text)
    assert [table["id"] for table in result["deleted"]["tables"]] == ["d_mix"]
    assert [reference["id"] for reference in result["deleted"]["references"]] == ["ref-orders"]
    # Later steps of the run no longer see them; the run shares these lists with the context.
    assert payload["input_tables"] == [{"name": "sales"}]
    assert payload["charts"] == [{"chart_id": "chart-sales"}]
    assert payload["external_references"] == [] and payload["replaceable_artifacts"] == []
    assert "table-mix" not in {table["node_id"] for table in layer.items()["tables"]}
    assert "session/charts/chart-mix-1.json" not in layer.paths()
    with pytest.raises(ValueError, match="Not in this session: 'd_mix'"):
        skill.handle_tool("delete_items", {"items": ["d_mix"]}, ctx)
