from __future__ import annotations

import pytest

from data_formulator.analyst.session_edits import report_map_paths, validate_report, workspace_map_paths
from data_formulator.analyst.session_layer import SessionLayer
from data_formulator.analyst.skills import SkillContext, build_registry
from data_formulator.datalake.workspace import Workspace

pytestmark = pytest.mark.backend

MAP = b'{"version": 1, "title": "Spend", "view": {}, "data": {}, "layers": []}'


@pytest.fixture()
def workspace(tmp_path):
    workspace = Workspace("test-user", root_dir=tmp_path)
    workspace.save_workspace_file(MAP, "spend.map.json", "application/json", agent_managed=True)
    workspace.save_workspace_file(b"# Notes", "notes.md", "text/markdown", agent_managed=True)
    return workspace


def _ctx(workspace):
    state = {"derivedTables": [], "charts": [], "conceptShelfItems": [], "generatedReports": [], "textTurns": []}
    return SkillContext(client=None, workspace=workspace, payload={"session_layer": SessionLayer(state, workspace)})


def _write(workspace, report: str) -> str:
    gen = build_registry().get_skill("report").handle_action("write_report", {"report": report}, _ctx(workspace))
    try:
        while True:
            next(gen)
    except StopIteration as stop:
        return stop.value


def test_a_report_names_the_maps_it_embeds() -> None:
    text = "# R\n\n![Spend by country](map://files/spend.map.json)\n\n![Trend](chart://c1)\n"
    assert report_map_paths(text) == {"files/spend.map.json"}


def test_only_map_files_count_as_embeddable_maps(workspace) -> None:
    assert workspace_map_paths(_ctx(workspace)) == {"files/spend.map.json"}
    assert workspace_map_paths(SkillContext(client=None, workspace=None, payload={})) is None


def test_an_edited_report_must_embed_maps_the_workspace_has() -> None:
    maps = {"files/spend.map.json"}
    validate_report("![Spend](map://files/spend.map.json)", set(), maps)
    with pytest.raises(ValueError, match="not in the workspace: files/other.map.json"):
        validate_report("![Other](map://files/other.map.json)", set(), maps)
    # Without the workspace's files to check against, maps are not checked.
    validate_report("![Other](map://files/other.map.json)", set(), None)


def test_write_report_tells_the_agent_about_a_missing_map(workspace) -> None:
    observation = _write(workspace, "# R\n\n![Spend](map://files/spend.map.json)\n\n![Gone](map://files/gone.map.json)\n")
    assert observation.startswith("[REPORT DELIVERED]")
    assert "files/gone.map.json" in observation and "files/spend.map.json" not in observation
    assert "write_map" in observation


def test_write_report_with_its_maps_present_has_no_note(workspace) -> None:
    assert _write(workspace, "# R\n\n![Spend](map://files/spend.map.json)\n") == (
        "[REPORT DELIVERED] The report was written and shown to the user.")
