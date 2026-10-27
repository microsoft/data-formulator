from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_formulator.analyst.session_layer.graph import ThreadGraph, build_threads

pytestmark = pytest.mark.backend

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "session_layer"


@pytest.mark.parametrize("case", json.loads((FIXTURES / "threads.json").read_text())["cases"], ids=lambda case: case["name"])
def test_thread_graph_matches_the_typescript_one(case) -> None:
    source = case["input"]
    graph = ThreadGraph(tables=source.get("tables"), turns=source.get("turns"), drafts=source.get("drafts"),
                        loaded_nodes=source.get("loadedNodes"), file_nodes=source.get("fileNodes"),
                        reports=source.get("reports"), artifact_sets=source.get("artifactSets"))
    threads = [{"key": thread.key, "rootId": thread.root_id, "branchFromId": thread.branch_from_id, "nodeIds": thread.node_ids}
               for thread in build_threads(graph)]
    queries = {id: {"ancestors": graph.ancestors(id), "tableOf": graph.table_of(id), "nearestItem": graph.nearest_item(id)}
               for id in case["queries"]}
    assert {"threads": threads, "queries": queries} == case["expected"]


def _layer_state():
    """A loaded table, a derived table with a chart and a report, a reference, a branch, and a set."""
    return {
        "inputTables": [{"kind": "input-table", "id": "table-sales", "displayId": "Sales",
                         "source": {"kind": "workspace", "tableId": "sales"},
                         "snapshot": {"columns": [{"name": "region", "type": "string", "description": "Sales region"},
                                                  {"name": "amount", "type": "number"}], "rowCount": 120}}],
        "derivedTables": [{"kind": "table", "id": "t-region", "displayId": "By region", "names": ["region", "total"],
                           "metadata": {"region": {"type": "string"}, "total": {"type": "number"}}, "rows": [{"region": "N"}],
                           "virtual": {"tableId": "d_by_region", "rowCount": 4}, "parentNodeId": "ask", "createdAt": 2,
                           "derive": {"source": ["table-sales"], "code": "import lib.clean\ndf = sales",
                                      "trigger": {"tableId": "table-sales"}}}],
        "tableSemantics": [{"tableId": "t-region", "fields": {"total": {"semanticType": "Revenue", "unit": "USD"}}}],
        "charts": [{"id": "chart-1", "chartType": "Bar Chart", "tableRef": "t-region", "title": "Totals",
                    "encodingMap": {"x": {"fieldID": "f1"}, "y": {"fieldID": "f2", "aggregate": "sum"}}},
                   {"id": "chart-auto", "chartType": "Auto", "tableRef": "t-region", "encodingMap": {}}],
        "conceptShelfItems": [{"id": "f1", "name": "region"}, {"id": "f2", "name": "total"}],
        "textTurns": [{"id": "ask", "prompt": "Totals by region", "parentNodeId": "table-sales", "createdAt": 1},
                      {"id": "ans", "content": "North leads.", "parentNodeId": "t-region", "createdAt": 3},
                      {"id": "other", "prompt": "Check the orders source", "parentNodeId": "t-region", "createdAt": 5,
                       "attachments": ["data:image/png;base64," + "A" * 4000]}],
        "generatedReports": [{"id": "r1", "title": "Findings", "content": "# Findings\n![x](chart://chart-1)",
                              "parentNodeId": "ans", "createdAt": 4},
                             {"id": "r-draft", "content": "", "status": "generating", "parentNodeId": "ans", "createdAt": 6}],
        "externalTableReferences": [{"id": "ref-orders", "displayName": "Orders", "connectorId": "pg", "tableKey": "public.orders",
                                     "summary": {"columns": [{"name": "id"}]}}],
        "focusedId": {"type": "chart", "chartId": "chart-1"},
        "activeWorkspace": {"id": "w1", "displayName": "Sales study", "provisional": True},
        "models": [{"id": "m", "api_key": "secret"}],
        "viewMode": "report",
    }


def test_state_keeps_only_the_allow_list_without_rows_or_images() -> None:
    from data_formulator.analyst.session_layer import normalize_state
    state = normalize_state(_layer_state())
    assert "models" not in state and "viewMode" not in state
    assert "rows" not in state["derivedTables"][0]
    assert state["textTurns"][2]["attachments"] == ["<data:image/png;base64 omitted>"]
    assert state["activeWorkspace"] == {"id": "w1", "displayName": "Sales study"}


def test_index_lists_each_item_once_with_focus_and_flags(tmp_path) -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    from data_formulator.datalake.workspace import Workspace
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(b"# plan", "notes/plan.md", "text/markdown", agent_managed=True)
    workspace.save_workspace_file(b'// @df-app {"version": 2, "title": "D", "tables": ["d_by_region"]}\nexport default () => null;\n',
                                  "dash.app.jsx", "text/jsx", agent_managed=True)
    index = SessionLayer(_layer_state(), workspace).index()
    assert index.startswith("# Session: Sales study")
    assert "Focus: `session/charts/chart-1.json` is on the canvas, the user is working in `session/threads/1.md`" in index
    assert ('- `session/tables/d_by_region.json` "By region" — derived from sales · 4 rows: region, total · 2 charts · '
            'used by a report · read by an app #') in index
    assert ('- `session/charts/chart-1.json` "Totals" — Bar Chart, of d_by_region, in a report, '
            'cannot replace: another chart was made from it [on canvas] #') in index
    # Placeholder charts and reports still being written are not listed; each item appears once.
    assert "chart-auto" not in index and "r-draft" not in index
    assert index.count("session/charts/chart-1.json") == 2  # the focus line and its own line
    assert '- `session/references/ref-orders.json` "Orders" — pg: public.orders #' in index
    assert "- `files/dash.app.jsx` — app #" in index and "- `files/notes/` (1 file) #" in index


def test_resumed_runs_hear_what_changed_since_their_last_look() -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    from data_formulator.analyst.session_layer.layer import seen_versions
    before = SessionLayer(_layer_state())
    trajectory = [{"role": "user", "content": "[SESSION INDEX]\n" + before.index() + "\n[SESSION NOTES]\n- `x` #ffffff"}]
    seen = seen_versions(trajectory)
    assert seen["session/charts/chart-1.json"] == before.versions["session/charts/chart-1.json"]
    assert "x" not in seen  # lines of other sections are not versions
    assert SessionLayer(_layer_state()).changes(seen) == "[SESSION CHANGES]\nNothing in the session changed since your last look."

    state = _layer_state()
    state["charts"][0]["title"] = "Totals, revised"
    state["generatedReports"] = state["generatedReports"][1:]
    state["externalTableReferences"].append({"id": "ref-users", "displayName": "Users", "connectorId": "pg", "tableKey": "users"})
    state["focusedId"] = {"type": "table", "tableId": "table-sales"}
    changes = SessionLayer(state).changes(seen)
    assert changes.startswith("[SESSION CHANGES]\nSince your last look")
    assert "Focus: `session/tables/sales.json` is now on the canvas" in changes
    assert "- changed `session/charts/chart-1.json` #" in changes
    assert "- removed `session/reports/r1.md`" in changes
    assert "- added `session/references/ref-users.json` #" in changes
    # A later run builds on what it was told: the changes message updates what it has seen.
    trajectory.append({"role": "user", "content": changes})
    assert SessionLayer(state).changes(seen_versions(trajectory)).endswith("Nothing in the session changed since your last look.")


def test_a_request_shows_the_session_as_files_with_the_question_last(tmp_path) -> None:
    from types import SimpleNamespace
    from data_formulator.analyst.session_files import render_session_context
    from data_formulator.analyst.session_layer import SessionLayer
    from data_formulator.datalake.workspace import Workspace
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(b"# Plan\n- by month", "notes/plan.md", "text/markdown", agent_managed=True)
    state = _layer_state()
    state["textTurns"] += [{"id": f"t{index}", "content": "x" * 400, "parentNodeId": f"t{index - 1}" if index else "r1",
                            "createdAt": 10 + index} for index in range(30)]
    context = render_session_context(SimpleNamespace(workspace=workspace, payload={"session_layer": SessionLayer(state, workspace)}))
    assert context.startswith("[SESSION INDEX]\n# Session: Sales study")
    assert "[SESSION NOTES]" in context and "- by month" in context
    assert "[ON THE CANVAS] `session/charts/chart-1.json` (content_hash " in context and "you can edit it" in context
    assert '"chart_type": "Bar Chart"' in context
    # The chart's table and the table it was computed from come with it, nearest first.
    assert context.index("[ITS DATA] `session/tables/d_by_region.json`") < context.index("[ITS DATA] `session/tables/sales.json`")
    assert context.index("[ON THE CANVAS]") < context.index("[ITS DATA]") < context.index("[THE THREAD YOU ARE CONTINUING]")
    thread = context[context.index("[THE THREAD YOU ARE CONTINUING] `session/threads/1.md`"):]
    # A long thread shows its latest steps, and says where the rest is.
    assert "… (earlier steps: read_file session/threads/1.md)" in thread and len(thread) < 7000
    assert thread.rstrip().endswith("x" * 400)


def test_views_link_to_each_other_and_read_table_rows_from_the_workspace(tmp_path) -> None:
    import pandas as pd
    from data_formulator.analyst.session_layer import SessionLayer
    from data_formulator.datalake.workspace import Workspace
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"region": ["N", "S"], "total": [5, 3]}), "d_by_region")
    layer = SessionLayer(_layer_state(), workspace)
    table = json.loads(layer.view("session/tables/d_by_region.json")["content"])
    assert table["rows"] == [{"region": "N", "total": 5}, {"region": "S", "total": 3}] and "sample_rows" not in table
    workspace.write_parquet(pd.DataFrame({"region": [f"r{i}" for i in range(26)], "total": range(26)}), "sales")
    assert len(json.loads(layer.view("session/tables/sales.json")["content"])["sample_rows"]) == 5
    assert table["columns"][1] == {"name": "total", "type": "number", "semantic_type": "Revenue", "unit": "USD",
                                   "values": "3, 5", "range": {"min": 3, "max": 5, "mean": 4.0}}
    assert table["derived_from"] == ["sales"] and table["charts"] == ["session/charts/chart-1.json", "chart-auto"]
    assert table["reports_using"] == ["Findings"] and table["thread"] == "session/threads/1.md"
    source = json.loads(layer.view("session/tables/sales.json")["content"])
    assert source["computed_into"] == ["d_by_region"] and source["columns"][0]["description"] == "Sales region"
    thread = layer.view("session/threads/1.md")["content"]
    assert "- **User:** Totals by region" in thread and "- **Report** session/reports/r1.md \"Findings\"" in thread
    state = _layer_state()
    state["textTurns"][0]["references"] = [{"kind": "chart", "id": "chart-1", "label": "Totals"}]
    assert "- **User:** Totals by region (about `session/charts/chart-1.json`)" in SessionLayer(state, workspace).view(
        "session/threads/1.md")["content"]
    assert layer.view("session/threads/2.md")["content"].startswith("# Thread 2 (from sales) — branches from table d_by_region")
    assert json.loads(layer.view("session/references/ref-orders.json")["content"])["tableKey"] == "public.orders"
    assert layer.view("session/charts/chart-auto.json") is None and layer.view("session/reports/r-draft.md") is None
    assert layer.items()["tables"][1]["imports"] == ["lib.clean"]


def test_charts_render_like_the_application_does() -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    fixture = json.loads((FIXTURES / "charts.json").read_text())
    layer = SessionLayer({"derivedTables": fixture["tables"], "charts": fixture["charts"], "conceptShelfItems": fixture["fields"]})
    assert {chart["id"]: layer.chart_spec(chart) for chart in layer.charts} == fixture["expected"]


@pytest.mark.parametrize("focus, path, thread", [
    ({"type": "table", "tableId": "t-region"}, "session/tables/d_by_region.json", 1),
    ({"type": "report", "reportId": "r1"}, "session/reports/r1.md", 1),
    ({"type": "external-table", "referenceId": "ref-orders"}, "session/references/ref-orders.json", None),
    ({"type": "text", "textId": "other"}, None, 2),
    ({"type": "file", "fileName": "dash.app.jsx"}, "files/dash.app.jsx", None),
])
def test_focus_resolves_to_a_view_and_a_thread(focus, path, thread) -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    assert SessionLayer({**_layer_state(), "focusedId": focus}).focus() == (path, thread)


def test_edits_and_run_charts_are_seen_by_later_reads_and_deletions_leave(tmp_path) -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    layer = SessionLayer(_layer_state())
    layer.record_edit("session/charts/chart-1.json", '{"edited": true}\n')
    assert layer.view("session/charts/chart-1.json")["content"] == '{"edited": true}\n'
    assert layer.view("session/charts/chart-1.json")["editable"]
    layer.add_run_chart("chart-new", {"chart_type": "Line Chart", "table": "d_new", "encodings": {}}, ["a"])
    assert "session/charts/chart-new.json" in layer.paths()
    assert layer.view("session/charts/chart-new.json")["made_in_run"]
    layer.forget(tables={"t-region"})
    assert "session/tables/d_by_region.json" not in layer.paths()
    assert "session/charts/chart-1.json" not in layer.paths()
    assert "d_by_region" not in layer.index()


def test_runs_without_a_browser_use_the_saved_state(monkeypatch) -> None:
    from data_formulator.analyst.session_layer import SessionLayer, load_saved_state
    import data_formulator.workspace_factory as factory

    class Manager:
        def load_session_state(self, workspace_id):
            return _layer_state() if workspace_id == "w1" else None

    monkeypatch.setattr(factory, "get_workspace_manager", lambda identity_id: Manager())
    assert "Totals" in SessionLayer(load_saved_state("user", "w1")).index()
    assert load_saved_state("user", "missing") is None and load_saved_state(None, "w1") is None
    assert SessionLayer(None).index().endswith("The session is empty.\n")


def test_replaceable_artifacts_match_the_application() -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    fixture = json.loads((FIXTURES / "replaceable.json").read_text())
    source = fixture["input"]
    layer = SessionLayer({"derivedTables": source["tables"], "charts": source["charts"], "generatedReports": source["reports"],
                          "fileNodes": source["fileNodes"], "textTurns": source["turns"]})
    assert layer.replaceable(fixture["focusNodeId"]) == fixture["expected"]
    # The index tells the agent before it tries.
    assert '"Line Chart of D_RETITLED" — Line Chart, of d_retitled, cannot replace: the user edited its chart' in layer.index()


def test_table_views_carry_the_file_values_and_descriptions(tmp_path) -> None:
    import pandas as pd
    from data_formulator.analyst.session_layer import SessionLayer
    from data_formulator.datalake.workspace import Workspace
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"region": ["N", "S", "N"], "total": [5, 3, 1]}), "d_by_region")
    table = json.loads(SessionLayer(_layer_state(), workspace).view("session/tables/d_by_region.json")["content"])
    # Tables are cited by name or path; item ids stay internal (design-docs/65).
    assert "input_id" not in table
    assert table["file"].endswith("d_by_region.parquet")
    region, total = table["columns"]
    assert region["values"] == "N, S" and total["range"] == {"min": 1, "max": 5, "mean": 3.0}


def test_thread_views_tell_the_whole_conversation() -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    state = _layer_state()
    state["textTurns"][0]["progressSteps"] = [{"kind": "thought", "label": "Group by region."}, {"kind": "tool", "label": "x"}]
    state["textTurns"].append({"id": "ask2", "parentNodeId": "ans", "createdAt": 3.5, "content": "Proposed a workflow.",
                               "form": {"kind": "workflow", "workflow": {"content": "# Weekly review\nsteps…", "saved": {"path": "w.md"}}}})
    state["textTurns"].append({"id": "run", "parentNodeId": "ask2", "createdAt": 3.6, "outputIds": ["r1"],
                               "workflow": {"runId": "run-1", "status": "completed", "stepId": "s2",
                                            "steps": [{"id": "s1", "status": "passed"}], "checks": [{"id": "c1", "status": "passed"}]}})
    state["textTurns"].append({"id": "load", "parentNodeId": "run", "createdAt": 3.7, "content": "",
                               "dataOperation": {"status": "completed", "reason": "Need orders", "selectedPlanId": "p2",
                                                 "plans": [{"id": "p1", "label": "All"}, {"id": "p2", "label": "Last year"}],
                                                 "resultTableIds": ["table-sales"], "resultReferences": [{"id": "ref-orders"}]}})
    state["generatedReports"][0]["parentNodeId"] = "load"
    thread = SessionLayer(state).view("session/threads/1.md")["content"]
    assert "  - *Agent thinking:* Group by region." in thread
    assert "- **Workflow proposal** (saved as w.md):\n\n    # Weekly review" in thread
    assert "- **Workflow run** run-1: completed, at step s2; steps s1 (passed); checks c1: passed" in thread
    assert "  - outputs: session/reports/r1.md" in thread
    assert ("- **Data load** (completed): Need orders; options: All, Last year; chosen: Last year; "
            "loaded: session/tables/sales.json, session/references/ref-orders.json") in thread


def test_saved_states_from_before_version_10_keep_the_users_replies_as_requests() -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    state = _layer_state()
    state["textTurns"][1]["answer"] = "Now split the totals\nby quarter."
    state["derivedTables"].append({"kind": "table", "id": "t-quarter", "displayId": "By quarter", "names": ["q"],
                                   "virtual": {"tableId": "d_by_quarter", "rowCount": 4}, "parentNodeId": "ans",
                                   "createdAt": 7, "derive": {"source": ["table-sales"], "trigger": {"tableId": "table-sales"}}})
    state["generatedReports"] = []
    layer = SessionLayer(state)
    assert "answer" not in str(layer.state["textTurns"])
    thread = layer.view("session/threads/1.md")["content"]
    assert ("- **Agent:** North leads.\n- **User:** Now split the totals\nby quarter.\n"
            "- **Table** session/tables/d_by_quarter.json") in thread
    # Titled by the thread's first request (not the first in the list), on one line.
    state["textTurns"].insert(0, {"id": "ask3", "prompt": "A later question", "parentNodeId": "t-quarter", "createdAt": 8})
    layer = SessionLayer(state)
    assert '`session/threads/1.md` from sales — "Totals by region" · 3 requests' in layer.index()
    state["textTurns"].reverse()
    state["textTurns"][0]["prompt"] = "Check the\norders source"
    assert '— "Check the orders source" · 1 request' in SessionLayer(state).index()


def test_tables_made_during_a_run_are_session_files_too(tmp_path) -> None:
    import pandas as pd
    from data_formulator.analyst.session_layer import SessionLayer
    from data_formulator.datalake.workspace import Workspace
    workspace = Workspace("test-user", root_dir=tmp_path)
    layer = SessionLayer(_layer_state(), workspace)
    assert layer.view("session/tables/fresh.json") is None
    workspace.write_parquet(pd.DataFrame({"region": ["N", "S"], "total": [5, 3]}), "fresh")
    assert "session/tables/fresh.json" in layer.paths()
    view = layer.view("session/tables/fresh.json")
    table = json.loads(view["content"])
    assert table["name"] == "fresh" and table["rows"] == [{"region": "N", "total": 5}, {"region": "S", "total": 3}]
    assert [column["name"] for column in table["columns"]] == ["region", "total"] and "does not show yet" in view["note"]


def test_focus_on_a_scratch_file_or_a_file_in_the_thread() -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    state = {**_layer_state(), "fileNodes": [{"id": "file-a", "path": "notes/a.md", "parentNodeId": "ans", "createdAt": 3.2}]}
    assert SessionLayer({**state, "focusedId": {"type": "file", "fileName": "scratch/probe.csv"}}).focus()[0] == "scratch/probe.csv"
    assert SessionLayer({**state, "focusedId": {"type": "reference", "referenceId": "file-a"}}).focus() == ("files/notes/a.md", 1)


def test_the_index_names_the_reference_a_conversation_is_about() -> None:
    from data_formulator.analyst.session_layer import SessionLayer
    state = _layer_state()
    state["textTurns"].append({"id": "ref-ask", "prompt": "Count orders", "externalReferenceId": "ref-orders",
                               "parentNodeId": "conversation-root:o", "createdAt": 7})
    state["derivedTables"].append({"kind": "table", "id": "t-orders", "displayId": "Orders by day", "names": ["day", "n"],
                                   "metadata": {}, "virtual": {"tableId": "d_orders", "rowCount": 3}, "parentNodeId": "ref-ask",
                                   "createdAt": 8, "derive": {"source": [], "code": "",
                                                              "trigger": {"tableId": "conversation-root:o", "externalReferenceId": "ref-orders"}}})
    # Focus on a table made from the reference: the conversation is still about it.
    index = SessionLayer({**state, "focusedId": {"type": "table", "tableId": "t-orders"}}).index()
    assert "about `session/references/ref-orders.json`" in index.splitlines()[2]
    # Once the reference is removed, it is no longer named.
    state["externalTableReferences"] = []
    assert "about `" not in SessionLayer({**state, "focusedId": {"type": "table", "tableId": "t-orders"}}).index()
