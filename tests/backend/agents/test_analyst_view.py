from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from data_formulator.analyst.agent import AnalystAgent
from data_formulator.analyst.session_layer import SessionLayer
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill
from data_formulator.analyst.viewing import view_resume_message
from data_formulator.datalake.workspace import Workspace

pytestmark = [pytest.mark.backend]

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
PNG_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()


def _context(workspace: Workspace) -> SkillContext:
    state = {
        "derivedTables": [{"kind": "table", "id": "t-region", "displayId": "By region", "names": ["region", "total"],
                           "metadata": {"region": {"type": "string"}, "total": {"type": "number"}},
                           "rows": [{"region": "N", "total": 1}], "virtual": {"tableId": "d_by_region", "rowCount": 1},
                           "derive": {"source": [], "code": "df = df"}}],
        "charts": [{"id": "chart-1", "chartType": "Bar Chart", "tableRef": "t-region",
                    "encodingMap": {"x": {"fieldID": "f1"}, "y": {"fieldID": "f2"}}}],
        "conceptShelfItems": [{"id": "f1", "name": "region"}, {"id": "f2", "name": "total"}],
    }
    return SkillContext(client=None, workspace=workspace, payload={"session_layer": SessionLayer(state, workspace)})


def _run(generator):
    events = []
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        return events, stop.value


def test_read_file_shows_an_image_file_as_a_picture(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(PNG, "plot.png", "image/png")

    result = WorkspaceSkill().handle_tool("read_file", {"files": [{"path": "files/plot.png"}]}, _context(workspace))

    assert result.images == (PNG_URL,)
    read = json.loads(result.text)["files"][0]
    assert read["kind"] == "image" and "base64" not in result.text


def test_view_pauses_for_the_browser_to_draw_charts_maps_and_apps(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(b"export default function App() {}", "sales.app.jsx", "text/plain")
    workspace.save_workspace_file(b"{}", "stores.map.json", "application/json")

    events, observation = _run(WorkspaceSkill().handle_action("view", {"paths": [
        "session://charts/chart-1", "files/sales.app.jsx", "files/stores.map.json", "session://charts/gone",
    ]}, _context(workspace)))

    assert observation is None
    request = events[-1]["view_request"]
    assert events[-1]["type"] == "interact" and request["id"]
    assert request["targets"] == [
        {"path": "session://charts/chart-1", "kind": "chart", "id": "chart-1"},
        {"path": "files/sales.app.jsx", "kind": "app", "name": "sales.app.jsx"},
        {"path": "files/stores.map.json", "kind": "map", "name": "stores.map.json"},
    ]
    assert request["problems"] == ["session://charts/gone: no such chart; list_files session://charts shows them."]


def test_view_with_nothing_to_draw_answers_without_pausing(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(PNG, "plot.png", "image/png")

    events, observation = _run(WorkspaceSkill().handle_action("view", {"paths": ["files/plot.png"]}, _context(workspace)))

    assert observation.startswith("[ERROR] Nothing to draw.") and "read_file shows it" in observation
    assert all(event["type"] != "interact" for event in events)


def test_the_browser_pictures_resume_the_run_as_one_message() -> None:
    message = view_resume_message({"results": [
        {"path": "session://charts/chart-1", "image": PNG_URL},
        {"path": "files/sales.app.jsx", "error": "the app did not finish loading"},
    ], "problems": ["session://charts/gone: no such chart"]}, [{"role": "user", "content": "q"}])

    text, *images = message["content"]
    assert "- session://charts/chart-1: picture 1 below" in text["text"]
    assert "- files/sales.app.jsx: not drawn (the app did not finish loading)" in text["text"]
    assert "- session://charts/gone: no such chart" in text["text"]
    assert images == [{"type": "image_url", "image_url": {"url": PNG_URL, "detail": "high"}}]


@pytest.mark.parametrize("response", [
    {"results": []},
    {"results": [{"image": PNG_URL}]},
    {"results": [{"path": f"session://charts/{index}"} for index in range(5)]},
])
def test_a_malformed_view_response_is_refused(response) -> None:
    with pytest.raises(ValueError):
        view_resume_message(response, [{"role": "user", "content": "q"}])


def test_a_picture_that_is_not_an_image_is_dropped() -> None:
    message = view_resume_message({"results": [{"path": "files/a.app.jsx", "image": "data:text/html;base64,PGI+"}]},
                                  [{"role": "user", "content": "q"}])
    assert len(message["content"]) == 1 and "not drawn" in message["content"][0]["text"]


def test_runs_without_a_browser_cannot_view(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    assert "view" not in AnalystAgent(client=None, workspace=workspace).registry.metas["workspace"].action_names
    assert "view" in AnalystAgent(client=None, workspace=workspace, mcp=True).registry.metas["workspace"].action_names
