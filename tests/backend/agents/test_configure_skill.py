from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.configure.skill import ConfigureSkill
from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.workflows.scheduling import ScheduleStore

pytestmark = pytest.mark.backend

IDENTITY = "local:tester"


def _context(**payload) -> SkillContext:
    return SkillContext(client=None, workspace=SimpleNamespace(),
                        payload={"identity_id": IDENTITY, "workspace_id": "session_current", **payload})


def _workflow_files(ctx: SkillContext | None = None) -> dict[str, dict]:
    from data_formulator.analyst.session_files import SessionFiles
    return {item["path"]: item for item in SessionFiles(ctx or _context()).list("workflows://")["files"]}


def _action(name: str, spec: dict, ctx: SkillContext | None = None) -> tuple[list[dict], str | None]:
    events, generator = [], ConfigureSkill().handle_action(name, spec, ctx or _context())
    try:
        while True:
            events.append(next(generator))
    except StopIteration as stop:
        return events, stop.value


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    manager = WorkspaceManager(tmp_path / "workspaces")
    monkeypatch.setattr("data_formulator.workspace_factory.get_workspace_manager", lambda identity: manager)
    for workspace_id, name, prompt in (("session_gas", "Untitled Session", "Compare regional gas prices"),
                                       ("session_movies", "Movies", "Which genres earn the most?"),
                                       ("session_current", "Current work", "Explore")):
        manager.create_workspace(workspace_id)
        manager.save_session_state(workspace_id, {
            "activeWorkspace": {"id": workspace_id, "displayName": name},
            "inputTables": [{"id": f"{workspace_id}_table", "displayId": name + " data"}],
            "textTurns": [{"id": "turn", "prompt": prompt}],
            "charts": [{"id": "chart"}],
        })
    return manager


@pytest.fixture
def scheduling(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setattr("data_formulator.auth.identity._localhost_identity", "local:test")
    monkeypatch.setattr("data_formulator.workflows.scheduler.scheduling_available", lambda: True)
    store = ScheduleStore(tmp_path / "home")
    monkeypatch.setattr("data_formulator.workflows.scheduler.schedule_store", lambda: store)
    monkeypatch.setattr("data_formulator.model_registry.model_registry.get_config",
                        lambda model_id, **_: {"id": model_id} if model_id == "server-model" else None)
    monkeypatch.setattr("data_formulator.model_registry.model_registry.list_public",
                        lambda **_: [{"id": "server-model", "model": "gpt", "endpoint": "openai"}])
    return store


def test_list_sessions_searches_names_and_content(sessions) -> None:
    result = json.loads(ConfigureSkill().handle_tool("list_sessions", {"query": "gas prices"}, _context()).text)

    assert [session["id"] for session in result["sessions"]] == ["session_gas"]
    session = result["sessions"][0]
    assert "prompts" not in session
    assert session["data"] == ["Untitled Session data"]
    assert session["current"] is False
    everything = json.loads(ConfigureSkill().handle_tool("list_sessions", {}, _context()).text)
    assert everything["total_sessions"] == 3
    assert next(item for item in everything["sessions"] if item["id"] == "session_current")["current"] is True


def test_session_panel_lists_sessions_with_suggested_names(sessions) -> None:
    events, _ = _action("propose_session_changes", {
        "title": "Gas sessions",
        "sessions": [{"session_id": "session_gas", "display_name": "  Regional   gas prices ", "reason": "Gas prompts"},
                     {"session_id": "session_movies", "display_name": "Movies"}],
    })
    form = events[0]["form"]
    assert form["kind"] == "sessions" and form["title"] == "Gas sessions" and form["auto_submit"] is False
    gas, movies = form["sessions"]["items"]
    assert {key: gas[key] for key in ("session_id", "current_name", "suggested_name", "current", "reason")} == {
        "session_id": "session_gas", "current_name": "Untitled Session", "suggested_name": "Regional gas prices",
        "current": False, "reason": "Gas prompts"}
    assert "suggested_name" not in movies and "delete" not in movies

    events, _ = _action("propose_session_changes", {"open_session_id": "session_movies", "user_review_needed": False})
    assert events[0]["form"]["auto_submit"] is True and events[0]["form"]["title"] == "Open Movies"
    events, _ = _action("propose_session_changes", {"sessions": [{"session_id": "session_gas"}], "user_review_needed": False})
    assert events[0]["form"]["auto_submit"] is False


def test_session_panel_validates_sessions_and_names(sessions) -> None:
    events, observation = _action("propose_session_changes", {"sessions": [{"session_id": "missing"}]})
    assert events == [] and "Unknown session" in observation
    events, observation = _action("propose_session_changes", {"open_session_id": "session_current"})
    assert events == [] and "Nothing to show" in observation
    events, observation = _action("propose_session_changes", {"sessions": [{"session_id": "session_gas", "display_name": "Gas\x07"}]})
    assert events == [] and "single-line" in observation
    events, observation = _action("propose_session_changes", {"sessions": [{"session_id": "session_gas", "delete": True}]})
    assert events[0]["form"]["sessions"]["items"][0].get("delete") is None


def test_list_sessions_can_find_every_empty_session(sessions) -> None:
    sessions.create_workspace("session_blank")
    sessions.save_session_state("session_blank", {"activeWorkspace": {"id": "session_blank", "displayName": "Blank"}})
    result = json.loads(ConfigureSkill().handle_tool("list_sessions", {"empty": True}, _context()).text)
    assert "session_blank" in {item["id"] for item in result["sessions"]}


def test_ask_user_keeps_multi_choice_only_with_options() -> None:
    from data_formulator.analyst.skills.meta.skill import MetaSkill

    questions = MetaSkill._normalize_interact_action({"questions": [
        {"text": "Which columns?", "responseType": "multi_choice", "options": ["Price", "Region"]},
        {"text": "Anything else?", "responseType": "multi_choice"},
    ]})["questions"]
    assert [question["responseType"] for question in questions] == ["multi_choice", "free_text"]


def test_ask_user_keeps_known_option_icons_only() -> None:
    from data_formulator.analyst.skills.meta.skill import MetaSkill

    options = MetaSkill._normalize_interact_action({"questions": [
        {"text": "Where should the data come from?", "options": [
            {"label": "Find CPI data online", "icon": "search_web"},
            {"label": "Connect a data source", "icon": "connect"},
            {"label": "Upload a file", "icon": "rocket"},
            "Something else",
        ]},
    ]})["questions"][0]["options"]
    assert options == [
        {"label": "Find CPI data online", "icon": "search_web"},
        {"label": "Connect a data source", "icon": "connect"},
        {"label": "Upload a file"},
        {"label": "Something else"},
    ]


def test_workflow_revision_targets_only_saved_user_workflows(scheduling) -> None:
    import yaml
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore

    definition = {"version": 1, "name": "Fuel", "overview": "Weekly fuel review", "deliverables": ["Report"],
                  "steps": [{"id": "work", "description": "Review prices.", "instructions": "Compare prices."}]}
    WorkflowStore(get_user_home(IDENTITY)).save("fuel.workflow.yaml", yaml.safe_dump(definition))

    listed = _workflow_files()
    assert listed["workflows://fuel.workflow.yaml"]["detail"] == "saved by the user"
    from data_formulator.analyst.session_files import SessionFiles
    read = SessionFiles(_context()).read("workflows://fuel.workflow.yaml")
    assert yaml.safe_load(read["content"]) == definition and 'replaces="workflows://fuel.workflow.yaml"' in read["note"]

    events, _ = _action("propose_workflow", {"definition": definition, "summary": "Revised",
                                             "replaces": "workflows://fuel.workflow.yaml"})
    form = events[0]["content"]["form"]
    assert events[0]["type"] == "completion" and form["kind"] == "workflow" and form["title"] == "Fuel"
    assert form["workflow"]["definition"] == definition
    assert form["workflow"]["target"] == {"id": "fuel.workflow.yaml", "name": "Fuel"}

    events, observation = _action("propose_workflow", {"definition": definition, "summary": "Revised",
                                                        "replaces": "demo/gas-price-review.yaml"})
    assert events == [] and "not one of the user's saved workflows" in observation


def test_analyst_gates_setup_actions_until_configure_loads_and_streams_the_form(tmp_path, sessions) -> None:
    from unittest.mock import MagicMock
    from data_formulator.analyst.agent import AnalystAgent
    from data_formulator.datalake.workspace import Workspace

    client = MagicMock()
    client.model = "test-model"
    import pandas as pd
    workspace = Workspace(IDENTITY, root_dir=tmp_path / "ws")
    # A session with data: setup guidance loads on demand (an empty session starts with it).
    workspace.write_parquet(pd.DataFrame({"title": ["Heat"]}), "movies")
    agent = AnalystAgent(client=client, workspace=workspace, identity_id=IDENTITY, workspace_id="session_current")
    assert agent._initial_loaded_skills(None) == {"meta"}
    assert "configure" in agent._initial_loaded_skills(None, {"form_id": "form-1"})
    observations = []

    def next_action(messages, *args, **kwargs):
        observations.append(messages[-1]["content"] if messages[-1]["role"] == "tool" else "")
        if len(observations) > 1:
            agent._load_skill_into_context("configure", messages)
        messages.append({"role": "assistant", "content": None, "tool_calls": [{"id": f"call-{len(observations)}", "type": "function",
            "function": {"name": "propose_session_changes", "arguments": "{}"}}]})
        messages.append({"role": "tool", "tool_call_id": f"call-{len(observations)}", "content": ""})
        yield {"type": "agent_action", "tool_call_id": f"call-{len(observations)}", "narration": "Opening it now.",
               "action_data": {"action": "propose_session_changes", "open_session_id": "session_movies", "user_review_needed": False}}

    agent._get_next_action = next_action
    events = list(agent.run([{"name": "movies", "rows": []}], "Open my movies session"))

    assert any("[GATED]" in message and "configure" in message for message in observations)
    interact = next(event for event in events if event["type"] == "interact")
    assert interact["form"] == {"kind": "sessions", "title": "Open Movies", "response": "Opening it now.", "auto_submit": True,
                                "sessions": {"items": [], "open": {"session_id": "session_movies", "display_name": "Movies"}}}
    assert interact["trajectory"]


def test_setup_tools_fall_back_to_the_workspace_owner(sessions) -> None:
    ctx = SkillContext(client=None, workspace=SimpleNamespace(identity_id=IDENTITY), payload={})
    result = json.loads(ConfigureSkill().handle_tool("list_sessions", {}, ctx).text)
    assert result["total_sessions"] == 3

    anonymous = SkillContext(client=None, workspace=SimpleNamespace(), payload={})
    assert "identity" in json.loads(ConfigureSkill().handle_tool("list_sessions", {}, anonymous).text)["error"]


def test_setup_identity_comes_from_the_app_and_must_own_the_workspace(sessions, monkeypatch) -> None:
    import flask

    app = flask.Flask("configure-test")
    monkeypatch.setattr("data_formulator.auth.identity.get_identity_id", lambda: IDENTITY)
    with app.test_request_context():
        ctx = SkillContext(client=None, workspace=SimpleNamespace(identity_id=IDENTITY), payload={"identity_id": "local:stale"})
        assert json.loads(ConfigureSkill().handle_tool("list_sessions", {}, ctx).text)["total_sessions"] == 3

        foreign = SkillContext(client=None, workspace=SimpleNamespace(identity_id="user:other"), payload={})
        assert "does not belong" in json.loads(ConfigureSkill().handle_tool("list_sessions", {}, foreign).text)["error"]
        events, observation = _action("propose_session_changes", {"open_session_id": "session_gas"}, foreign)
        assert events == [] and "does not belong" in observation


QUAKES = {"version": 1, "name": "Quakes", "overview": "Daily earthquake review", "deliverables": ["Report"],
          "parameters": [{"name": "min_magnitude", "label": "Minimum magnitude", "type": "number", "required": True}],
          "steps": [{"id": "work", "description": "Review quakes.", "instructions": "Map recent quakes."}]}


def test_workflow_listing_shows_its_schedule(scheduling) -> None:
    import yaml
    from data_formulator.analyst.session_files import SessionFiles
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore

    block = {"time": "08:00", "weekdays": [0], "timezone": "UTC", "model_id": "server-model",
             "setup": {"parameters": {"min_magnitude": 2.5}}}
    WorkflowStore(get_user_home(IDENTITY)).save("quakes.workflow.yaml", yaml.safe_dump({**QUAKES, "schedule": block}))
    row = scheduling.sync(IDENTITY, None, "quakes.workflow.yaml", block)
    listed = _workflow_files()
    assert "workflows://schedules.json" not in listed
    assert f"scheduled: Mon at 08:00 (UTC), next {row['next_at']}" in listed["workflows://quakes.workflow.yaml"]["detail"]
    assert all("scheduled" not in item.get("detail", "") for path, item in listed.items() if path != "workflows://quakes.workflow.yaml")
    read = SessionFiles(_context()).read("workflows://quakes.workflow.yaml")
    assert yaml.safe_load(read["content"])["schedule"] == block and "including its schedule" in read["note"]

    events, _ = _action("propose_workflow", {"definition": {**QUAKES, "schedule": {**block, "enabled": False}}, "summary": "Pause",
                                             "replaces": "workflows://quakes.workflow.yaml"})
    form = events[0]["content"]["form"]["workflow"]
    assert form["target"] == {"id": "quakes.workflow.yaml", "name": "Quakes", "schedule": block}
    assert form["definition"]["schedule"]["enabled"] is False and form["schedule_issues"] == []


def test_workflow_proposal_carries_its_schedule(scheduling) -> None:
    schedule = {"time": "08:00", "weekdays": [6, 0, 1, 2, 3, 4, 5], "setup": {"parameters": {"min_magnitude": 2.5}}}
    events, _ = _action("propose_workflow", {"definition": {**QUAKES, "schedule": schedule}, "summary": "Daily quakes"})
    form = events[0]["content"]["form"]["workflow"]
    # The machine's values (timezone, model) are left for the form to fill in.
    assert form["definition"]["schedule"] == schedule and form["schedule_issues"] == []
    assert "schedule:" in form["content"]

    events, _ = _action("propose_workflow", {"definition": {**QUAKES, "schedule": {
        "time": "08:00", "weekdays": [0], "timezone": "Mars/Base", "model_id": "gone"}}, "summary": "Daily quakes"})
    issues = events[0]["content"]["form"]["workflow"]["schedule_issues"]
    # A schedule may leave required inputs to its instructions; an unknown timezone is still a problem.
    assert any("timezone" in issue for issue in issues) and not any("Minimum magnitude" in issue for issue in issues)
    assert "Choose a server-configured model connection." in issues
    events, observation = _action("propose_workflow", {"definition": {**QUAKES, "schedule": {"time": "8am", "weekdays": [0]}},
                                                       "summary": "Daily quakes"})
    assert events == [] and "schedule.time" in observation


def test_workflow_proposal_reports_unavailable_scheduling(scheduling, monkeypatch) -> None:
    monkeypatch.setattr("data_formulator.workflows.scheduler.scheduling_available", lambda: False)
    events, observation = _action("propose_workflow", {"definition": {**QUAKES, "schedule": {"time": "08:00", "weekdays": [0]}},
                                                       "summary": "Daily"})
    assert events == [] and "without a schedule" in observation
    assert len(_workflow_files()) > 1
