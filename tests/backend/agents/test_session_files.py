from __future__ import annotations

import json

import pytest

from data_formulator.analyst.session_edits import chart_text
from data_formulator.analyst.session_files import SessionFiles, content_hash, render_session_notes
from data_formulator.analyst.session_layer import SessionLayer
from data_formulator.analyst.skills import SkillContext, build_registry
from data_formulator.datalake.text_edit import TextEditConflictError
from data_formulator.datalake.workspace import Workspace
from data_formulator.sandbox.local_sandbox import LocalSandbox

pytestmark = pytest.mark.backend

CHART = {"chart_type": "Bar Chart", "table": "d_sales", "title": "Sales by region",
         "encodings": {"x": {"field": "region"}, "y": {"field": "sales", "aggregate": "sum"}}}


def _state(code: str = "df = sales.groupby('region')", **extra):
    return {
        "derivedTables": [{"kind": "table", "id": "t-sales", "displayId": "Sales", "names": ["region", "sales", "month"],
                           "metadata": {}, "virtual": {"tableId": "d_sales", "rowCount": 3}, "parentNodeId": "ask", "createdAt": 2,
                           "derive": {"source": [], "code": code, "trigger": {"tableId": "conversation-root:c"}}, **extra}],
        "charts": [{"id": "chart-1", "chartType": "Bar Chart", "tableRef": "t-sales", "title": "Sales by region",
                    "encodingMap": {"x": {"fieldID": "f-region"}, "y": {"fieldID": "f-sales", "aggregate": "sum"}}}],
        "conceptShelfItems": [{"id": "f-region", "name": "region"}, {"id": "f-sales", "name": "sales"}, {"id": "f-month", "name": "month"}],
        "generatedReports": [{"id": "report-1", "title": "Findings", "content": "# Findings\n\n![Sales](chart://chart-1)\n",
                              "parentNodeId": "t-sales", "createdAt": 3}],
        "textTurns": [{"id": "ask", "prompt": "compare regions", "parentNodeId": "conversation-root:c", "createdAt": 1}],
    }


@pytest.fixture()
def workspace(tmp_path):
    return Workspace("test-user", root_dir=tmp_path)


def _ctx(workspace, state=None, **payload):
    return SkillContext(client=None, workspace=workspace,
                        payload={"session_layer": SessionLayer(state or _state(), workspace), **payload})


def _tool(name, args, ctx):
    return json.loads(build_registry().get_skill("workspace").handle_tool(name, args, ctx).text)


def test_session_views_are_listed_and_only_charts_and_reports_are_editable(workspace) -> None:
    listed = {item["path"]: item for item in _tool("list_files", {"path": "session/"}, _ctx(workspace))["files"]}
    assert set(listed) == {"session/index.md", "session/charts/chart-1.json", "session/reports/report-1.md",
                           "session/tables/d_sales.json", "session/threads/1.md"}
    assert listed["session/charts/chart-1.json"].get("editable") and not listed["session/tables/d_sales.json"].get("editable")


def test_list_read_and_search_span_files_session_and_scratch(workspace) -> None:
    workspace.save_workspace_file(b"# Plan\nCompare regions by month\n", "notes/plan.md", "text/markdown", agent_managed=True)
    workspace.save_scratch_file("probe.txt", b"region totals\n")
    ctx = _ctx(workspace)
    listed = _tool("list_files", {}, ctx)
    paths = [item["path"] for item in listed["files"]]
    assert {"files/notes/plan.md", "session/charts/chart-1.json", "session/threads/1.md", "scratch/probe.txt"} <= set(paths)
    assert [item["path"] for item in _tool("list_files", {"path": "files/notes"}, ctx)["files"]] == ["files/notes/plan.md"]

    read = _tool("read_file", {"files": [{"path": "files/notes/plan.md", "offset": 2, "limit": 1}]}, ctx)["files"][0]
    assert read["content"] == "Compare regions by month\n" and read["total_lines"] == 2 and read["editable"] is True
    assert read["content_hash"] == workspace.get_metadata().files["notes/plan.md"].content_hash
    chart = _tool("read_file", {"files": [{"path": "session/charts/chart-1.json"}]}, ctx)["files"][0]
    assert json.loads(chart["content"]) == CHART and chart["content_hash"] == content_hash(chart["content"])
    assert chart["name"] == "Sales by region"
    # Older conversations call read_file with path/offset/limit.
    legacy = _tool("read_file", {"path": "files/notes/plan.md", "offset": 2, "limit": 1}, ctx)["files"][0]
    assert legacy["content"] == "Compare regions by month\n"

    skill = build_registry().get_skill("workspace")
    found = skill.handle_tool("search", {"query": "region"}, ctx).text
    for path in ("files/notes/plan.md", "session/charts/chart-1.json", "session/tables/d_sales.json",
                 "session/threads/1.md", "scratch/probe.txt"):
        assert f"## {path}" in found
    # A table's code is searched with it.
    regex = skill.handle_tool("search", {"query": r"groupby\('(\w+)'\)", "regex": True, "path": ["session/"]}, ctx).text
    assert "## session/tables/d_sales.json" in regex and "code line 1:" in regex
    assert "## session/charts/" not in regex
    with pytest.raises(ValueError, match="not a session file"):
        SessionFiles(ctx).read("../etc/passwd")


def test_several_files_are_read_in_one_call(workspace, monkeypatch) -> None:
    import data_formulator.analyst.session_files as session_files
    workspace.save_workspace_file(b"# Plan\n", "notes/plan.md", "text/markdown", agent_managed=True)
    ctx = _ctx(workspace)
    read = _tool("read_file", {"files": [{"path": "files/notes/plan.md"}, {"path": "session/charts/*"},
                                         {"path": "session/tables/d_sales.json"}, {"path": "session/charts/chart-1.json"},
                                         {"path": "files/missing.md"}, {"path": "session/apps/*"}]}, ctx)
    files = {item["path"]: item for item in read["files"]}
    assert list(files) == ["files/notes/plan.md", "session/charts/chart-1.json", "session/tables/d_sales.json",
                           "files/missing.md"]
    assert json.loads(files["session/charts/chart-1.json"]["content"]) == CHART
    assert files["session/charts/chart-1.json"]["editable"] and files["session/tables/d_sales.json"]["content_hash"]
    assert "does not exist" in files["files/missing.md"]["error"] and read["no_match"] == ["session/apps/*"]
    monkeypatch.setattr(session_files, "MAX_BATCH_CHARS", 10)
    over = _tool("read_file", {"files": [{"path": "session/charts/chart-1.json"},
                                         {"path": "session/tables/d_sales.json"}]}, ctx)["files"]
    assert "content" in over[0] and "size budget" in over[1]["not_read"]


def _edit_chart(ctx, change):
    current = SessionFiles(ctx).text("session/charts/chart-1.json")
    spec = {**json.loads(current), **change}
    return _tool("edit_file", {"path": "session/charts/chart-1.json", "content": json.dumps(spec),
                               "expected_content_hash": content_hash(current)}, ctx)


def test_a_valid_chart_edit_lands_and_is_returned_for_the_application(workspace) -> None:
    ctx = _ctx(workspace)
    result = _edit_chart(ctx, {"chart_type": "Line Chart", "theme": "economist",
                               "encodings": {"x": "month", "y": {"field": "sales", "aggregate": "mean"}, "color": {"field": "region"}},
                               "config": {"interpolate": "monotone"}})
    spec = result["session_update"]["spec"]
    assert result["session_update"]["kind"] == "chart" and result["session_update"]["id"] == "chart-1"
    assert spec["encodings"] == {"x": {"field": "month"}, "y": {"field": "sales", "aggregate": "average"},
                                 "color": {"field": "region"}}
    assert spec["chart_type"] == "Line Chart" and spec["theme"] == "economist"
    # The application skips an edit to a chart the user changed meanwhile; it gets what the edit was made against.
    assert result["session_update"]["base"] == CHART
    # Later reads see the edit; a patch against it works.
    current = SessionFiles(ctx).text("session/charts/chart-1.json")
    assert json.loads(current) == spec and result["content_hash"] == content_hash(current)
    patched = _tool("edit_file", {"path": "session/charts/chart-1.json", "expected_content_hash": content_hash(current),
                                  "replacements": [{"old_text": '"Sales by region"', "new_text": '"Monthly sales"'}]}, ctx)
    assert patched["session_update"]["spec"]["title"] == "Monthly sales"


@pytest.mark.parametrize("change, messages", [
    ({"chart_type": "Bar Chrt"}, ["'Bar Chrt' is not a chart type (did you mean 'Bar Chart'?)"]),
    ({"encodings": {"x": {"field": "regoin"}, "size": {"field": "sales"}}},
     ["encodings.x.field 'regoin' is not a column of d_sales (did you mean 'region'?)", "Bar Chart has no channel 'size'"]),
    ({"encodings": {"x": {"field": "region", "aggregate": "median", "colour": "red"}}},
     ["aggregate must be one of count, sum, average", "unknown 'colour'"]),
    ({"config": {"cornerRadius": 99, "showValueLabels": "yes", "wiggle": 1}},
     ["config.cornerRadius must be a number from 0 to 15", "config.showValueLabels must be true or false",
      "Bar Chart has no option 'wiggle'"]),
    ({"table": "d_other", "theme": "neon", "legend": True},
     ["table cannot change", "theme 'neon' is not a theme", "unknown key 'legend'"]),
])
def test_an_invalid_chart_edit_is_rejected_with_every_problem_and_changes_nothing(workspace, change, messages) -> None:
    ctx = _ctx(workspace)
    before = SessionFiles(ctx).text("session/charts/chart-1.json")
    with pytest.raises(ValueError) as error:
        _edit_chart(ctx, change)
    assert str(error.value).startswith("Chart not changed: ")
    for message in messages:
        assert message in str(error.value)
    assert SessionFiles(ctx).text("session/charts/chart-1.json") == before


def test_chart_edits_need_json_and_the_current_hash(workspace) -> None:
    ctx = _ctx(workspace)
    current = SessionFiles(ctx).text("session/charts/chart-1.json")
    with pytest.raises(ValueError, match="not valid JSON"):
        _tool("edit_file", {"path": "session/charts/chart-1.json", "content": "{", "expected_content_hash": content_hash(current)}, ctx)
    with pytest.raises(TextEditConflictError):
        _tool("edit_file", {"path": "session/charts/chart-1.json", "content": current, "expected_content_hash": "0" * 64}, ctx)
    with pytest.raises(ValueError, match="read-only"):
        _tool("edit_file", {"path": "session/tables/d_sales.json", "content": "{}", "expected_content_hash": "x"}, ctx)


def test_report_edits_must_embed_session_charts(workspace) -> None:
    ctx = _ctx(workspace)
    current = SessionFiles(ctx).text("session/reports/report-1.md")
    with pytest.raises(ValueError, match="embeds charts that are not in the session: chart-9"):
        _tool("edit_file", {"path": "session/reports/report-1.md", "expected_content_hash": content_hash(current),
                            "append_text": "\n![More](chart://chart-9)\n"}, ctx)
    result = _tool("edit_file", {"path": "session/reports/report-1.md", "expected_content_hash": content_hash(current),
                                 "replacements": [{"old_text": "# Findings", "new_text": "# Regional findings"}]}, ctx)
    assert result["session_update"] == {"kind": "report", "id": "report-1",
                                        "content": "# Regional findings\n\n![Sales](chart://chart-1)\n", "base": current}


@pytest.mark.slow
def test_helpers_the_agent_writes_are_importable_and_moves_keep_them(workspace) -> None:
    ctx = _ctx(workspace, input_tables=[])
    written = _tool("create_file", {"filename": "lib/cleaning.py", "display_name": "Cleaning",
                                     "content": "def double(df):\n    return df.assign(b=df.a * 2)\n"}, ctx)
    assert written["importable_as"] == "lib.cleaning"
    assert _tool("create_file", {"filename": "json.py", "display_name": "Shadow", "content": "X = 1\n"}, ctx)["helper_warnings"]
    code = "import pandas as pd\nfrom lib.cleaning import double\nresult = double(pd.DataFrame({'a': [1, 2]}))\n"
    ran = LocalSandbox().run_python_code(code, workspace, "result")
    assert ran["status"] == "ok" and ran["content"]["b"].tolist() == [2, 4]

    # A table's code imports it, so it stays where it is.
    ctx = _ctx(workspace, _state(code="from lib.cleaning import double\ndf = double(sales)"), input_tables=[])
    with pytest.raises(ValueError, match="The code of Sales imports files/lib/cleaning.py"):
        _tool("move_file", {"path": "files/lib/cleaning.py", "new_path": "files/util/cleaning.py"}, ctx)
    with pytest.raises(ValueError, match="the code of the table Sales imports files/lib/cleaning.py"):
        _tool("delete_items", {"items": ["files/lib"]}, ctx)
    ctx = _ctx(workspace, input_tables=[])
    moved = _tool("move_file", {"path": "files/lib/cleaning.py", "new_path": "files/util/cleaning.py"}, ctx)
    assert moved["moved"] == {"from": "files/lib/cleaning.py", "to": "files/util/cleaning.py"}
    assert moved["importable_as"] == "util.cleaning"
    ran = LocalSandbox().run_python_code(code.replace("lib.cleaning", "util.cleaning"), workspace, "result")
    assert ran["status"] == "ok"


@pytest.mark.slow
def test_an_uploaded_or_user_edited_helper_is_not_importable(workspace) -> None:
    workspace.save_workspace_file(b"X = 1\n", "uploaded.py", "text/x-python")
    ctx = _ctx(workspace, input_tables=[])
    _tool("create_file", {"filename": "mine.py", "display_name": "Mine", "content": "X = 2\n"}, ctx)
    workspace.save_workspace_text_file("mine.py", "X = 3\n", workspace.get_metadata().files["mine.py"].content_hash)
    notes = {item["path"]: item.get("note") for item in _tool("list_files", {"path": "files/"}, ctx)["files"]}
    assert "not importable" in notes["files/uploaded.py"] and "not importable" in notes["files/mine.py"]
    for module in ("uploaded", "mine"):
        ran = LocalSandbox().run_python_code(f"import {module}\nimport pandas as pd\nresult = pd.DataFrame()", workspace, "result")
        assert ran["status"] == "error" and "No module named" in ran["content"]


def test_files_and_folders_can_be_deleted_unless_a_table_was_computed_from_them(workspace) -> None:
    workspace.save_workspace_file(b"a,b\n1,2\n", "raw/sales.csv", "text/csv")
    workspace.save_workspace_file(b"# old\n", "notes/old.md", "text/markdown", agent_managed=True)
    workspace.save_workspace_file(b"# older\n", "notes/older.md", "text/markdown", agent_managed=True)
    ctx = _ctx(workspace, _state(dataProvenance={"inputSources": [
        {"id": "file:workspace:raw%2Fsales.csv", "kind": "file", "displayName": "raw/sales.csv"}]}), input_tables=[])
    with pytest.raises(ValueError, match="the table Sales was computed from files/raw/sales.csv"):
        _tool("delete_items", {"items": ["files/raw/sales.csv"]}, ctx)
    deleted = _tool("delete_items", {"items": ["files/notes"]}, ctx)["deleted"]
    assert [item["path"] for item in deleted["files"]] == ["files/notes/old.md", "files/notes/older.md"]
    assert sorted(item.name for item in workspace.list_workspace_files()) == ["raw/sales.csv"]
    with pytest.raises(ValueError, match="files/missing.md is not a workspace file or folder"):
        _tool("delete_items", {"items": ["files/missing.md"]}, ctx)


def test_notes_are_shown_at_the_start_of_each_request(workspace) -> None:
    assert render_session_notes(workspace) == ""
    workspace.save_workspace_file(b"# Plan\n- compare regions\n", "notes/plan.md", "text/markdown", agent_managed=True)
    workspace.save_workspace_file(("x" * 5000).encode(), "notes/log.md", "text/markdown", agent_managed=True)
    workspace.save_workspace_file(b"not a note", "readme.md", "text/markdown")
    workspace.save_workspace_file(b"- prefers bars", "notes/mine.md", "text/markdown")
    block = render_session_notes(workspace)
    # The user's own notes are shown without a hash: the agent cannot edit them.
    assert "## files/notes/mine.md (written by the user; read-only to you" in block
    assert block.startswith("[SESSION NOTES]")
    plan_hash = workspace.get_metadata().files["notes/plan.md"].content_hash
    # The hash is there, so a note can be edited without reading it first.
    assert f"## files/notes/plan.md (content_hash {plan_hash})\n# Plan\n- compare regions" in block
    assert "## files/notes/log.md" in block and "1,000 more characters; read_file it" in block
    assert "readme" not in block


def test_new_files_may_sit_in_folders(workspace) -> None:
    ctx = _ctx(workspace, input_tables=[])
    created = _tool("create_file", {"filename": "notes/plan.md", "display_name": "Plan", "content": "# Plan\n"}, ctx)
    assert created["path"] == "files/notes/plan.md"
    for invalid in ("notes/../x.md", "_private/x.md", "notes/.hidden.md", "data_operations/x.md"):
        with pytest.raises(ValueError, match="visible file name"):
            _tool("create_file", {"filename": invalid, "display_name": "X", "content": "x"}, ctx)
