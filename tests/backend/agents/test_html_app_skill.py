from __future__ import annotations

import json

import pandas as pd
import pytest

from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.html_app.skill import (
    ALLOWED_IMPORTS,
    MANIFEST_ID,
    MAX_HTML_BYTES,
    inject_manifest,
    lint_html,
    lint_react_app,
    react_imports,
    stamp_react_manifest,
    validate_react_app,
)
from data_formulator.datalake.workspace import Workspace


pytestmark = [pytest.mark.backend]

APP = """<!doctype html>
<html><head><title>Sales</title></head>
<body><main class="df-app"><div class="df-chart" id="chart"></div></main>
<script>DF.ready.then(() => DF.query('sales', {columns: ['region'], aggregates: [{op: 'sum', field: 'amount'}]}))
  .then(({rows}) => DF.chart('#chart', {mark: 'bar', data: {values: rows}, encoding: {}}));</script>
</body></html>"""


@pytest.fixture
def workspace(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"region": ["a", "b"], "amount": [1, 2]}), "sales")
    return workspace


def _run(workspace, spec, payload=None, action="write_html_app"):
    skill = build_registry().get_skill("html_app")
    ctx = SkillContext(client=None, workspace=workspace, payload=payload if payload is not None else {"input_tables": []})
    generator = skill.handle_action(action, spec, ctx)
    events = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        return events, stop.value, ctx


def _spec(**overrides):
    return {"filename": "sales_app.html", "title": "Sales explorer", "tables": ["sales"], "html": APP, **overrides}


def test_registry_exposes_gated_app_actions() -> None:
    registry = build_registry()
    assert registry.action_owner("write_app") == "html_app"
    assert registry.action_owner("write_html_app") == "html_app"
    assert "html_app" in registry.gated_skill_names()
    schemas = {tool["function"]["name"]: tool["function"] for tool in registry.action_tools_for(["html_app"])}
    # filename (new app) or path + expected_content_hash (rewrite in place); the handler enforces one.
    assert set(schemas["write_app"]["parameters"]["required"]) == {"title", "tables", "code"}
    assert set(schemas["write_html_app"]["parameters"]["required"]) == {"title", "tables", "html"}
    assert {"filename", "path", "expected_content_hash"} <= set(schemas["write_app"]["parameters"]["properties"])
    body = registry.load_body("html_app")
    assert "useQuery" in body and "FlintChart" in body and "edit_file" in body and "no network" in body
    assert "DF.query" in body and "df-card" in body
    assert "call `write_app`" in registry.load_body("meta")


def test_write_html_app_saves_agent_managed_file_with_manifest(workspace) -> None:
    events, observation, ctx = _run(workspace, _spec())

    assert [event["type"] for event in events] == ["action"]
    file = events[0]["file"]
    assert events[0]["action"] == "write_html_app"
    assert file["path"] == "files/sales_app.html" and file["display_name"] == "Sales explorer"
    metadata, content = workspace.read_workspace_file("sales_app.html")
    assert metadata.media_type == "text/html"
    assert (metadata.origin, metadata.edit_policy) == ("agent", "agent_editable")
    assert metadata.content_hash == file["content_hash"]
    text = content.decode("utf-8")
    assert text.count(f'id="{MANIFEST_ID}"') == 1
    assert text.index(MANIFEST_ID) < text.index("<title>")
    manifest = json.loads(text.split(f'id="{MANIFEST_ID}">', 1)[1].split("</script>", 1)[0])
    assert manifest == {"version": 1, "title": "Sales explorer", "tables": ["sales"]}

    result = json.loads(observation)
    assert result["status"] == "delivered"
    assert result["content_hash"] == metadata.content_hash
    assert result["warnings"] == []
    assert any(item.display_name == "sales_app.html" and item.kind == "file"
               for item in ctx.payload["workspace_inputs"].inputs)


@pytest.mark.parametrize(("overrides", "message"), [
    ({"filename": "app.htm"}, "must end with .html"),
    ({"filename": "nested/../app.html"}, "visible file name"),
    ({"title": ""}, "title"),
    ({"title": "x" * 81}, "title"),
    ({"html": "   "}, "non-empty"),
    ({"tables": ["missing"]}, "Unknown workspace tables: missing"),
    ({"tables": "sales"}, "list of workspace table names"),
    ({"html": "<p>" + "x" * MAX_HTML_BYTES + "</p>"}, "keep it under"),
])
def test_write_html_app_rejects_invalid_requests_without_writing(workspace, overrides, message) -> None:
    events, observation, _ = _run(workspace, _spec(**overrides))
    assert observation.startswith("[HTML APP NOT CREATED]")
    assert message in observation
    assert [event["type"] for event in events] == ["error"]
    assert workspace.list_workspace_files() == []


def test_write_html_app_refuses_to_overwrite_and_points_to_revisions(workspace) -> None:
    _run(workspace, _spec())
    _, observation, _ = _run(workspace, _spec(html="<p>replacement</p>"))
    assert 'path="files/sales_app.html"' in observation and "edit_file" in observation
    assert b"replacement" not in workspace.read_workspace_file("sales_app.html")[1]


def test_inject_manifest_replaces_existing_manifest_and_escapes_script_end() -> None:
    html = f'<html><head><script type="application/json" id="{MANIFEST_ID}">{{"tables":["old"]}}</script></head></html>'
    updated = inject_manifest(html, {"version": 1, "title": "</script><script>x()</script>", "tables": ["new"]})
    assert updated.count(MANIFEST_ID) == 1
    assert '"old"' not in updated and '"new"' in updated
    assert "</script><script>x()" not in updated
    assert inject_manifest("<p>fragment</p>", {"tables": []}).startswith(f'<script type="application/json" id="{MANIFEST_ID}">')
    assert "<head>" in inject_manifest("<html><body></body></html>", {"tables": []})


def test_lint_warns_about_code_that_cannot_work_in_the_sandbox() -> None:
    warnings = lint_html(
        '<script src="https://cdn.example.com/lib.js"></script>'
        '<script>fetch("/api"); localStorage.x = 1; alert("hi")</script>',
        ["sales"],
    )
    joined = " ".join(warnings)
    assert "External scripts" in joined
    assert "Network requests are blocked" in joined
    assert "Browser storage" in joined
    assert "Dialogs" in joined
    assert "never calls the DF runtime" in joined
    assert lint_html(APP, ["sales"]) == []


def test_lint_steers_styling_toward_the_df_app_kit() -> None:
    styled = (
        '<html><head><style>body{font-family:Georgia;color:#111}.a{background:#fafafa;border:1px solid rgb(0, 0, 0)}'
        '.b{color:#0067b8}</style></head><body><div style="color:#ff0000">x</div>'
        '<script>DF.query("sales")</script></body></html>'
    )
    joined = " ".join(lint_html(styled, ["sales"]))
    assert "hardcodes 5 colors" in joined
    assert "font-family" in joined
    assert "DF app kit" in joined

    themed = (
        '<style>.x{color:var(--df-muted);font-family:var(--df-font-mono)}.y{font-family:inherit}</style>'
        '<main class="df-app"></main><script>DF.chart("#c", {mark: {color: "#4c78a8"}})</script>'
    )
    assert lint_html(themed, ["sales"]) == []


REACT_APP = """import { useState } from 'react';
import {
  Page,
  Select,
} from '@df/ui';
import { useQuery, useDistinct } from '@df/data';
import { FlintChart } from '@df/chart';

export default function App() {
  const [region, setRegion] = useState('');
  const regions = useDistinct('sales', 'region');
  const totals = useQuery('sales', { columns: ['region'], aggregates: [{ op: 'sum', field: 'amount' }] });
  return <Page title="Sales"><Select label="Region" value={region} onChange={setRegion} options={regions.values} />
    <FlintChart chartType="Bar Chart" query={totals} encodings={{ x: 'region', y: 'amount_sum' }} /></Page>;
}
"""


def _react_spec(**overrides):
    return {"filename": "sales.app.jsx", "title": "Sales explorer", "tables": ["sales"], "code": REACT_APP, **overrides}


def test_write_app_saves_react_app_with_manifest_header(workspace) -> None:
    events, observation, _ = _run(workspace, _react_spec(code="// @df-app {\"stale\": true}\n" + REACT_APP), action="write_app")

    assert [event["type"] for event in events] == ["action"]
    assert events[0]["action"] == "write_app"
    assert events[0]["file"]["path"] == "files/sales.app.jsx"
    metadata, content = workspace.read_workspace_file("sales.app.jsx")
    assert metadata.media_type == "text/jsx"
    assert (metadata.origin, metadata.edit_policy) == ("agent", "agent_editable")
    text = content.decode("utf-8")
    first, rest = text.split("\n", 1)
    assert first == '// @df-app {"version": 2, "title": "Sales explorer", "tables": ["sales"]}'
    assert "@df-app" not in rest and rest.startswith("import { useState }")
    result = json.loads(observation)
    assert result["warnings"] == []
    assert "// @df-app" in result["revise_with"]


@pytest.mark.parametrize(("overrides", "message"), [
    ({"filename": "sales.jsx"}, "must end with .app.jsx"),
    ({"code": "import moment from 'moment';\nexport default () => null;"}, "Cannot import moment"),
    ({"code": "export default () => import('https://example.com/x.js');"}, "Cannot import https://example.com/x.js"),
    ({"code": "function App() { return null; }"}, "export default"),
    ({"code": "  "}, "complete app source"),
    ({"tables": ["missing"]}, "Unknown workspace tables: missing"),
])
def test_write_app_rejects_code_the_runtime_cannot_run(workspace, overrides, message) -> None:
    events, observation, _ = _run(workspace, _react_spec(**overrides), action="write_app")
    assert observation.startswith("[APP NOT CREATED]")
    assert message in observation
    assert [event["type"] for event in events] == ["error"]
    assert workspace.list_workspace_files() == []


def test_react_app_text_stays_readable_after_agent_edits(workspace) -> None:
    from data_formulator.datalake.workspace_file_content import read_workspace_file_text

    _run(workspace, _react_spec(), action="write_app")
    # edit_file re-saves with mimetypes.guess_type, which does not know .jsx.
    workspace.save_workspace_file(b"export default () => null;\n", "sales.app.jsx", None,
                                  expected_content_hash=workspace.read_workspace_file("sales.app.jsx")[0].content_hash,
                                  agent_managed=True)
    assert read_workspace_file_text(workspace, "sales.app.jsx").content.startswith("export default")


def test_react_lint_and_import_helpers() -> None:
    assert react_imports(REACT_APP) == ["react", "@df/ui", "@df/data", "@df/chart"]
    validate_react_app(REACT_APP)
    assert lint_react_app(REACT_APP, ["sales"]) == []
    warnings = " ".join(lint_react_app(
        "export default () => { fetch('/x'); localStorage.a = 1; return <div style={{ color: '#111', background: '#222', "
        "borderColor: '#333', outlineColor: '#444' }} />; }", ["sales"]))
    assert "Network requests are blocked" in warnings and "Browser storage" in warnings
    assert "never reads them" in warnings and "hardcodes 4 colors" in warnings
    stamped = stamp_react_manifest("// @df-app {}\r\n\nexport default 1", {"version": 2})
    assert stamped == '// @df-app {"version": 2}\nexport default 1'


def test_skill_starter_app_is_valid_and_lint_clean() -> None:
    body = build_registry().load_body("html_app")
    starter = body.split("```jsx", 1)[1].split("```", 1)[0]
    validate_react_app(starter)
    assert set(react_imports(starter)) <= set(ALLOWED_IMPORTS)
    assert lint_react_app(starter, ["sales"]) == []


def _hash(workspace, name):
    return workspace.read_workspace_file(name)[0].content_hash


def test_write_app_rewrites_an_app_in_place(workspace) -> None:
    workspace.write_parquet(pd.DataFrame({"region": ["a"], "units": [3]}), "units")
    _run(workspace, _react_spec(), action="write_app")
    code = REACT_APP.replace("'sales'", "'units'").replace("amount", "units")
    events, observation, _ = _run(workspace, {
        "path": "files/sales.app.jsx", "expected_content_hash": _hash(workspace, "sales.app.jsx"),
        "title": "Units explorer", "tables": ["units"], "code": code,
    }, action="write_app")

    # Editing an app rewrites it under the same filename (design-docs/58, rule 8).
    assert [event["type"] for event in events] == ["action"]
    assert events[0]["updated"] is True and events[0]["file"]["path"] == "files/sales.app.jsx"
    result = json.loads(observation)
    assert result["status"] == "updated" and result["path"] == "files/sales.app.jsx"
    assert [item.name for item in workspace.list_workspace_files() if item.name.endswith(".app.jsx")] == ["sales.app.jsx"]
    metadata, content = workspace.read_workspace_file("sales.app.jsx")
    assert metadata.display_name == "Units explorer"
    assert content.decode().startswith('// @df-app {"version": 2, "title": "Units explorer", "tables": ["units"]}\n')


@pytest.mark.parametrize(("spec", "message"), [
    ({"expected_content_hash": "0" * 64}, "File changed"),
    ({"expected_content_hash": "abc"}, "current SHA-256"),
    ({"filename": "other.app.jsx"}, "not both"),
    ({"path": "files/missing.app.jsx"}, "does not exist"),
    ({"path": "sales.app.jsx"}, "files/... path"),
    ({"code": "import x from 'moment';\nexport default () => null;"}, "Cannot import moment"),
])
def test_write_app_rewrite_errors_keep_the_previous_version(workspace, spec, message) -> None:
    _run(workspace, _react_spec(), action="write_app")
    before = workspace.read_workspace_file("sales.app.jsx")[1]
    base = {"path": "files/sales.app.jsx", "expected_content_hash": _hash(workspace, "sales.app.jsx"),
            "title": "Sales", "tables": ["sales"], "code": REACT_APP}
    events, observation, _ = _run(workspace, {**base, **spec}, action="write_app")
    assert observation.startswith("[APP NOT UPDATED]")
    assert message in observation
    assert [event["type"] for event in events] == ["error"]
    assert workspace.read_workspace_file("sales.app.jsx")[1] == before


def test_write_app_cannot_rewrite_user_files(workspace) -> None:
    workspace.save_workspace_file(REACT_APP.encode(), "mine.app.jsx", "text/jsx")
    _, observation, _ = _run(workspace, {
        "path": "files/mine.app.jsx", "expected_content_hash": _hash(workspace, "mine.app.jsx"),
        "title": "Mine", "tables": ["sales"], "code": REACT_APP,
    }, action="write_app")
    assert observation.startswith("[APP NOT UPDATED]") and "protected" in observation


def _edit(workspace, **args):
    from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
    ctx = SkillContext(client=None, workspace=workspace, payload={"input_tables": []})
    return WorkspaceSkill().handle_tool("edit_file", {
        "path": "files/sales.app.jsx", "expected_content_hash": _hash(workspace, "sales.app.jsx"), **args,
    }, ctx)


def test_edit_file_validates_app_revisions(workspace) -> None:
    _run(workspace, _react_spec(), action="write_app")
    original = workspace.read_workspace_file("sales.app.jsx")[1].decode()
    manifest_line = original.split("\n", 1)[0]
    for replacements, message in [
        ([{"old_text": manifest_line + "\n", "new_text": ""}], "first-line `// @df-app"),
        ([{"old_text": "import { useState } from 'react';", "new_text": "import moment from 'moment';"}], "Cannot import moment"),
        ([{"old_text": "export default function App", "new_text": "function App"}], "export default"),
        ([{"old_text": '"tables": ["sales"]', "new_text": '"tables": ["nope"]'}], "Unknown workspace tables: nope"),
    ]:
        with pytest.raises(ValueError, match=r"\[APP NOT UPDATED\]") as error:
            _edit(workspace, replacements=replacements)
        assert message in str(error.value)
        assert workspace.read_workspace_file("sales.app.jsx")[1].decode() == original

    result = json.loads(_edit(workspace, replacements=[
        {"old_text": '"title": "Sales explorer"', "new_text": '"title": "Regional sales"'},
        {"old_text": "<Page title=\"Sales\">", "new_text": "<Page title=\"Regional sales\">"},
    ]).text)
    assert result["app"] is True and result["tables"] == ["sales"] and result["warnings"] == []
    assert result["display_name"] == "Regional sales"
    # The edit rewrites the app in place.
    assert result["path"] == "files/sales.app.jsx"
    assert [item.name for item in workspace.list_workspace_files()] == ["sales.app.jsx"]
    metadata, content = workspace.read_workspace_file("sales.app.jsx")
    assert (metadata.media_type, metadata.display_name) == ("text/jsx", "Regional sales")
    assert '<Page title="Regional sales">' in content.decode()


def test_edit_file_keeps_html_app_manifest_and_ignores_plain_files(workspace) -> None:
    from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
    _run(workspace, _spec())
    ctx = SkillContext(client=None, workspace=workspace, payload={"input_tables": []})
    with pytest.raises(ValueError, match="df-app-manifest"):
        WorkspaceSkill().handle_tool("edit_file", {
            "path": "files/sales_app.html", "expected_content_hash": _hash(workspace, "sales_app.html"),
            "content": "<p>no manifest</p>",
        }, ctx)
    plain = json.loads(WorkspaceSkill().handle_tool("create_file", {"filename": "notes.html", "content": "<p>a</p>"}, ctx).text)
    edited = json.loads(WorkspaceSkill().handle_tool("edit_file", {
        "path": plain["path"], "expected_content_hash": plain["content_hash"], "content": "<p>b</p>",
    }, ctx).text)
    assert "app" not in edited


def test_create_file_points_apps_to_write_app(workspace) -> None:
    from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
    ctx = SkillContext(client=None, workspace=workspace, payload={"input_tables": []})
    with pytest.raises(ValueError, match="write_app"):
        WorkspaceSkill().handle_tool("create_file", {"filename": "x.app.jsx", "content": REACT_APP}, ctx)


def test_file_listing_marks_agent_editable_files(workspace) -> None:
    from data_formulator.analyst.session_files import SessionFiles
    _run(workspace, _react_spec(), action="write_app")
    workspace.save_workspace_file(b"user notes", "notes.md")
    listed = {item["path"]: item for item in SessionFiles(SkillContext(client=None, workspace=workspace, payload={})).list("files/")["files"]}
    assert listed["files/sales.app.jsx"].get("editable") is True
    assert "editable" not in listed["files/notes.md"]


def test_replacing_an_app_rewrites_it_in_place(workspace) -> None:
    _run(workspace, _react_spec(), action="write_app")
    listed = [{"id": "files/sales.app.jsx", "node_id": "file-sales.app.jsx", "kind": "file", "name": "Sales explorer"}]
    run = {"input_tables": [], "replaceable_artifacts": listed, "run_artifacts": {}}
    events, observation, _ = _run(workspace, {
        "path": "files/sales.app.jsx", "expected_content_hash": _hash(workspace, "sales.app.jsx"),
        "title": "Sales explorer", "tables": ["sales"], "code": REACT_APP.replace("Sales", "Fixed sales"),
        "replaces": "files/sales.app.jsx",
    }, payload=run, action="write_app")
    # The fix keeps the filename, and the event tells the app which node it replaced.
    assert events[0]["file"]["path"] == "files/sales.app.jsx" and events[0]["updated"] is True
    assert events[0]["replaces"] == {"id": "files/sales.app.jsx", "node_id": "file-sales.app.jsx", "kind": "file", "name": "Sales explorer"}
    assert json.loads(observation)["status"] == "updated"
    assert [item.name for item in workspace.list_workspace_files()] == ["sales.app.jsx"]
    assert "Fixed sales" in workspace.read_workspace_file("sales.app.jsx")[1].decode()

    # replaces must name the file being revised, and only listed (or this run's) files qualify.
    events, observation, _ = _run(workspace, {
        "path": "files/sales.app.jsx", "expected_content_hash": _hash(workspace, "sales.app.jsx"),
        "title": "Sales explorer", "tables": ["sales"], "code": REACT_APP, "replaces": "files/other.app.jsx",
    }, payload={**run, "replaceable_artifacts": []}, action="write_app")
    assert events[0]["type"] == "error" and "Cannot replace 'files/other.app.jsx'" in observation


def test_edit_file_replacing_an_app_fixes_it_in_place(workspace) -> None:
    from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
    _run(workspace, _react_spec(), action="write_app")
    ctx = SkillContext(client=None, workspace=workspace, payload={"input_tables": [], "run_artifacts": {},
        "replaceable_artifacts": [{"id": "files/sales.app.jsx", "node_id": "file-sales.app.jsx", "kind": "file", "name": "Sales explorer"}]})
    result = json.loads(WorkspaceSkill().handle_tool("edit_file", {
        "path": "files/sales.app.jsx", "expected_content_hash": _hash(workspace, "sales.app.jsx"), "replaces": "files/sales.app.jsx",
        "replacements": [{"old_text": "<Page title=\"Sales\">", "new_text": "<Page title=\"Fixed\">"}],
    }, ctx).text)
    assert result["path"] == "files/sales.app.jsx" and result["replaces"]["node_id"] == "file-sales.app.jsx"
    assert [item.name for item in workspace.list_workspace_files()] == ["sales.app.jsx"]
    with pytest.raises(ValueError, match="revise it with edit_file"):
        WorkspaceSkill().handle_tool("create_file", {"filename": "notes.md", "content": "x", "replaces": "files/sales.app.jsx"}, ctx)


def test_app_code_is_saved_as_written_and_errors_show_when_it_renders(workspace) -> None:
    # The server does not parse app code: a syntax error shows when the app renders, and
    # the user can ask the agent to fix it from there.
    broken = REACT_APP.replace("</Page>", "</Pag")
    events, observation, _ = _run(workspace, _react_spec(code=broken), action="write_app")
    assert events[0]["type"] == "action", observation
    assert workspace.read_workspace_file("sales.app.jsx")[1].decode().endswith(broken)
    edited = json.loads(_edit(workspace, replacements=[{"old_text": "</Pag", "new_text": "</Page>"}]).text)
    assert edited["path"] == "files/sales.app.jsx"


def test_write_app_declares_live_sources_and_optional_modules(workspace) -> None:
    reference = {"kind": "external-table-reference", "id": "external:kusto:Events", "connectorId": "kusto",
                 "tableKey": "Events", "displayName": "Events"}
    code = ("import _ from 'lodash';\nimport * as d3 from 'd3';\nimport { countries } from '@df/geo';\n"
            + REACT_APP.replace("export default function App() {",
                                "export default function App() {\n  const count = _.size(countries()) + d3.max([1]);"))
    events, observation, _ = _run(workspace, _react_spec(code=code, sources=["external:kusto:Events"]),
                                  payload={"input_tables": [], "external_references": [reference]}, action="write_app")
    assert events[0]["type"] == "action", observation
    header = workspace.read_workspace_file("sales.app.jsx")[1].decode().split("\n", 1)[0]
    assert '"sources": ["external:kusto:Events"]' in header

    # A source must be one of the session's connected-source references.
    events, observation, _ = _run(workspace, _react_spec(filename="other.app.jsx", sources=["external:kusto:Nope"]),
                                  payload={"input_tables": [], "external_references": [reference]}, action="write_app")
    assert events[0]["type"] == "error" and "Unknown sources: external:kusto:Nope" in observation
