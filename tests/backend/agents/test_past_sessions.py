from __future__ import annotations

import json

import pandas as pd
import pytest

from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.past_sessions.skill import PastSessionsSkill
from data_formulator.datalake.workspace_manager import WorkspaceManager

pytestmark = pytest.mark.backend

IDENTITY = "local:tester"


def _state(name: str) -> dict:
    return {
        "activeWorkspace": {"id": "x", "displayName": name},
        "derivedTables": [{"kind": "table", "id": "t-snow", "displayId": "Snowfall by phase", "names": ["phase", "snow_in"],
                           "metadata": {}, "virtual": {"tableId": "snow_by_phase", "rowCount": 3}, "parentNodeId": "ask",
                           "derive": {"source": [], "code": "df = raw", "trigger": {"tableId": "conversation-root:c"}}}],
        "charts": [{"id": "chart-1", "chartType": "Bar Chart", "tableRef": "t-snow", "title": "Snow by ENSO phase",
                    "encodingMap": {"x": {"fieldID": "f-phase"}, "y": {"fieldID": "f-snow"}}}],
        "conceptShelfItems": [{"id": "f-phase", "name": "phase"}, {"id": "f-snow", "name": "snow_in"}],
        "generatedReports": [{"id": "report-1", "title": "ENSO and snow",
                              "content": "# ENSO\n\n![Snow](session://charts/chart-1)\n", "parentNodeId": "t-snow"}],
        "textTurns": [{"id": "ask", "prompt": "secret question about la nina", "parentNodeId": "conversation-root:c"}],
    }


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    manager = WorkspaceManager(tmp_path / "workspaces")
    monkeypatch.setattr("data_formulator.workspace_factory.get_workspace_manager", lambda identity: manager)
    for workspace_id, name in (("session_enso", "ENSO snowfall"), ("session_enso_2", "ENSO rain"),
                               ("session_current", "Current work")):
        manager.create_workspace(workspace_id)
        manager.save_session_state(workspace_id, _state(name))
    past = manager.open_workspace("session_enso", IDENTITY)
    past.save_agent_data(pd.DataFrame({"phase": ["El Nino", "La Nina", "Neutral"], "snow_in": [310, 520, 430]}),
                         "snow_by_phase", input_sources=[])
    past.save_workspace_file(b"station,id\nParadise,1\n", "stations.csv", "text/csv")
    past.save_workspace_file(b"private working note", "notes/plan.md", "text/markdown")
    return manager


def _call(args: dict, manager: WorkspaceManager) -> dict:
    ctx = SkillContext(client=None, workspace=manager.open_workspace("session_current", IDENTITY),
                       payload={"identity_id": IDENTITY, "workspace_id": "session_current"})
    return json.loads(PastSessionsSkill().handle_tool("past_sessions", args, ctx).text)


def test_finds_other_sessions_by_titles_but_never_by_or_with_their_requests(sessions) -> None:
    found = {session["session"]: session for session in _call({"query": "snow phase"}, sessions)["sessions"]}
    assert set(found) == {"session_enso", "session_enso_2"}
    assert found["session_enso"]["charts"] == ["Snow by ENSO phase"] and found["session_enso"]["reports"] == ["ENSO and snow"]
    assert _call({"query": "secret"}, sessions)["sessions"] == []
    assert "session_current" not in json.dumps(_call({}, sessions)["sessions"])
    # A loose name that fits two sessions asks which.
    assert {item["session"] for item in _call({"session": "enso"}, sessions)["candidates"]} == {"session_enso", "session_enso_2"}


def test_reads_results_in_that_sessions_names_and_keeps_its_conversation_and_notes_out(sessions) -> None:
    listed = _call({"session": "ENSO snowfall"}, sessions)
    assert [table["item"] for table in listed["tables"]] == ["tables/snow_by_phase"]
    assert [file["item"] for file in listed["files"]] == ["files/stations.csv"]
    read = _call({"session": "session_enso", "item": ["tables/snow_by_phase", "reports/report-1", "threads/1",
                                                     "files/notes/plan.md"], "rows": "1-2"}, sessions)
    rows, report, thread, note = read["items"]
    assert "La Nina" in json.dumps(rows) and "Neutral" not in json.dumps(rows)
    assert "![Snow](charts/chart-1)" in report["content"]
    assert "not the conversation" in thread["error"] and "not notes" in note["error"]
    assert "secret" not in json.dumps(listed) + json.dumps(read)


def test_copies_tables_files_and_charts_here_with_provenance_and_reuses_a_copy(sessions) -> None:
    copied = _call({"session": "session_enso", "item": ["tables/snow_by_phase", "files/stations.csv"],
                    "copy": "session"}, sessions)["copied"]
    assert [entry["kind"] for entry in copied] == ["table", "file"] and copied[1]["path"] == "files/stations.csv"
    current = sessions.open_workspace("session_current", IDENTITY)
    table = current.get_table_metadata(copied[0]["table_name"])
    assert table.import_options["acquisition"]["source"] == 'Data Formulator session "ENSO snowfall" (session_enso)'
    assert table.input_sources[0]["id"] == "scratch/past/session_enso/snow_by_phase.parquet"
    assert list(current.read_data_as_df(table.name)["snow_in"]) == [310, 520, 430]

    chart = _call({"session": "session_enso", "item": "charts/chart-1", "copy": "session"}, sessions)
    assert chart["copied"][0]["reused"] is True and chart["items"][0]["chart"]["table"] == table.name
    report = _call({"session": "session_enso", "item": "reports/report-1", "copy": "session"}, sessions)
    assert "not copied" in report["items"][0]["error"]
    scratch = _call({"session": "session_enso", "item": "files/stations.csv", "copy": "scratch"}, sessions)
    assert scratch["items"][0]["scratch"] == "scratch/past/session_enso/stations.csv"
    assert current.resolve_scratch_file("past/session_enso/stations.csv").read_bytes().startswith(b"station,id")
