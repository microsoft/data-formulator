from __future__ import annotations

import json

import pandas as pd
import pytest

from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.html_app.skill import (
    MANIFEST_ID,
    MAX_HTML_BYTES,
    inject_manifest,
    lint_html,
)
from data_formulator.datalake.workspace import Workspace


pytestmark = [pytest.mark.backend]

APP = """<!doctype html>
<html><head><title>Sales</title></head>
<body><div id="chart"></div>
<script>DF.ready.then(() => DF.query('sales', {columns: ['region'], aggregates: [{op: 'sum', field: 'amount'}]}))
  .then(({rows}) => DF.chart('#chart', {mark: 'bar', data: {values: rows}, encoding: {}}));</script>
</body></html>"""


@pytest.fixture
def workspace(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.write_parquet(pd.DataFrame({"region": ["a", "b"], "amount": [1, 2]}), "sales")
    return workspace


def _run(workspace, spec, payload=None):
    skill = build_registry().get_skill("html_app")
    ctx = SkillContext(client=None, workspace=workspace, payload=payload if payload is not None else {"input_tables": []})
    generator = skill.handle_action("write_html_app", spec, ctx)
    events = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        return events, stop.value, ctx


def _spec(**overrides):
    return {"filename": "sales_app.html", "title": "Sales explorer", "tables": ["sales"], "html": APP, **overrides}


def test_registry_exposes_gated_write_html_app_action() -> None:
    registry = build_registry()
    assert registry.action_owner("write_html_app") == "html_app"
    assert "html_app" in registry.gated_skill_names()
    schema = registry.action_tools_for(["html_app"])[0]["function"]
    assert schema["name"] == "write_html_app"
    assert set(schema["parameters"]["required"]) == {"filename", "title", "tables", "html"}
    body = registry.load_body("html_app")
    assert "DF.query" in body and "edit_file" in body and "No network access" in body
    assert "Load `html_app`" in registry.load_body("meta")


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
    ({"filename": "nested/app.html"}, "without directories"),
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


def test_write_html_app_refuses_to_overwrite_and_points_to_edit_file(workspace) -> None:
    _run(workspace, _spec())
    _, observation, _ = _run(workspace, _spec(html="<p>replacement</p>"))
    assert "use edit_file" in observation
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
