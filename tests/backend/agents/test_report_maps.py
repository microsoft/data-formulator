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
    text = "# R\n\n![Spend by country](files/spend.map.json)\n\n![Trend](chart://c1)\n"
    assert report_map_paths(text) == {"files/spend.map.json"}


def test_only_map_files_count_as_embeddable_maps(workspace) -> None:
    assert workspace_map_paths(_ctx(workspace)) == {"files/spend.map.json"}
    assert workspace_map_paths(SkillContext(client=None, workspace=None, payload={})) is None


def test_an_edited_report_must_refer_to_what_the_session_has(workspace) -> None:
    from data_formulator.analyst import references
    known = references.known_names(None, workspace)
    validate_report("![Spend](files/spend.map.json)\n\n![Old form](map://files/spend.map.json)", known)
    with pytest.raises(ValueError, match=r"1 reference does not resolve: `files/other.map.json` \(did you mean `files/spend.map.json`"):
        validate_report("![Other](files/other.map.json)\n\n[notes](files/notes.md)", known)


def test_only_references_an_edit_adds_block_it(workspace) -> None:
    from data_formulator.analyst import references
    known = references.known_names(None, workspace)
    before = "# R\n\n[gone](session://tables/gone)\n"
    note = validate_report(before + "\n[notes](files/notes.md)\n", known, before)
    assert note and "`session://tables/gone`" in note and "Still unresolved from before this edit" in note
    with pytest.raises(ValueError, match="`files/other.md`"):
        validate_report(before + "\n[other](files/other.md)\n", known, before)


def test_write_report_lists_every_unresolved_reference_for_the_agent_to_patch(workspace) -> None:
    observation = _write(workspace, "# R\n\n![Spend](files/spend.map.json)\n\n![Gone](files/gone.map.json)\n\n"
                                    "[the chart](session://charts/chart-9)\n")
    assert observation.startswith("[REPORT DELIVERED] The report session://reports/report-")
    assert "2 references do not resolve: `files/gone.map.json`" in observation
    assert "`session://charts/chart-9`" in observation and "`files/spend.map.json`" in observation.split("did you mean")[1]
    assert "patch them with edit_file on session://reports/report-" in observation


def test_write_report_with_every_reference_present_has_no_note(workspace) -> None:
    observation = _write(workspace, "# R\n\n![Spend](files/spend.map.json)\n\n[notes](files/notes.md)\n")
    assert observation.startswith("[REPORT DELIVERED] The report session://reports/report-")
    assert observation.endswith("was written and shown to the user.")


def test_a_delivered_report_can_be_patched_by_its_name_in_the_same_run(workspace) -> None:
    from data_formulator.analyst.session_files import SessionFiles, content_hash
    from data_formulator.analyst.session_edits import edit_session_file
    ctx = _ctx(workspace)
    gen = build_registry().get_skill("report").handle_action(
        "write_report", {"report": "# R\n\n![Gone](files/gone.map.json)\n", "report_id": "report-abc"}, ctx)
    events = []
    try:
        while True:
            events.append(next(gen))
    except StopIteration as stop:
        observation = stop.value
    assert events[0]["report_id"] == "report-abc" and "session://reports/report-abc" in observation
    current = SessionFiles(ctx).text("session://reports/report-abc")
    result = edit_session_file({"path": "session://reports/report-abc", "expected_content_hash": content_hash(current),
                                "replacements": [{"old_text": "files/gone.map.json", "new_text": "files/spend.map.json"}]}, ctx)
    assert result["session_update"]["id"] == "report-abc"
    assert "files/spend.map.json" in result["session_update"]["content"]
