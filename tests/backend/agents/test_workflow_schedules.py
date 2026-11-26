from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import pytest

from data_formulator.workflows.scheduling import ScheduleStore, next_occurrence


# A workflow's ``schedule:`` block, and the index row the scheduler keeps for it.
BLOCK = {"model_id": "server-model", "time": "09:00", "timezone": "America/New_York", "weekdays": [0, 1, 2, 3, 4]}
CONFIG = {**BLOCK, "workflow": "report.yaml"}
NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)
REPORT = """
version: 1
name: Daily report
overview: A scheduled report
deliverables: [A report]
steps:
  - id: report
    description: Write a report
    instructions: Report the result
"""


def scheduled(store, block=BLOCK, *, site=None, workflow="report.yaml", owner="local:test"):
    return store.sync(owner, site, workflow, block, now=NOW)


def test_clock_and_timezone():
    assert next_occurrence(CONFIG, NOW) == "2026-09-30T13:00:00+00:00"
    assert next_occurrence(CONFIG, datetime(2026, 11, 2, 12, tzinfo=timezone.utc)) == "2026-11-02T14:00:00+00:00"
    assert next_occurrence(CONFIG, datetime(2026, 10, 2, 14, tzinfo=timezone.utc)) == "2026-10-05T13:00:00+00:00"


@pytest.mark.parametrize("change", [{"timezone": "invalid"}, {"weekdays": []}, {"time": "25:00"},
                                    {"api_key": "secret"}, {"max_retries": 4}, {"weekdays": [False]}])
def test_invalid_schedule_rejected(change):
    with pytest.raises(ValueError):
        next_occurrence({**BLOCK, **change}, NOW)


def test_durable_claim_is_unique(tmp_path):
    first = ScheduleStore(tmp_path)
    saved = scheduled(first)
    second = ScheduleStore(tmp_path)
    due = NOW + timedelta(hours=1)
    claimed = first.claim_due(due)
    assert len(claimed) == 1
    assert second.claim_due(due) == []
    assert second.history(saved["id"])[0]["id"] == claimed[0]["id"]
    assert saved["config"] == CONFIG


def test_skip_missed_and_overlap(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = scheduled(store)
    assert store.claim_due(NOW + timedelta(days=1)) == []
    assert store.history(saved["id"])[0]["status"] == "missed"
    assert len(store.claim_due(NOW + timedelta(days=1, hours=1))) == 1
    assert store.claim_due(NOW + timedelta(days=2, hours=1)) == []
    assert store.history(saved["id"])[0]["message"] == "Overlapping run"


def test_a_late_run_catches_up_and_retry_retains_id(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = scheduled(store)
    # A week asleep: only the latest occurrence, five minutes late, runs; the first one passed by is missed.
    due = NOW + timedelta(days=7, hours=1, minutes=5)
    occurrence, = store.claim_due(due)
    assert occurrence["scheduled_for"] == "2026-10-07T13:00:00+00:00"
    assert store.claim_due(due) == []
    retry_at = due + timedelta(seconds=30)
    store.finish(occurrence, "retry", retry_at=retry_at.isoformat())
    assert store.claim_due(due) == []
    retry, = store.claim_due(retry_at)
    assert retry["id"] == occurrence["id"]
    assert retry["attempts"] == 1
    store.finish(retry, "completed")
    assert [run["status"] for run in store.history(saved["id"])] == ["completed"]


def test_a_missed_run_can_be_run_now(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = scheduled(store)
    later = NOW + timedelta(hours=14)
    assert store.claim_due(later) == []
    missed, = store.history(saved["id"])
    assert missed["status"] == "missed"
    store.run_missed("local:test", None, missed["id"], now=later)
    run, = store.claim_due(later)
    assert run["id"] == missed["id"] and run["attempts"] == 0
    with pytest.raises(ValueError):
        store.run_missed("local:test", None, missed["id"], now=later)


def test_a_run_clears_earlier_missed_runs_so_deleting_it_brings_none_back(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = scheduled(store)
    store.claim_due(NOW + timedelta(hours=14))
    store.claim_due(NOW + timedelta(days=1, hours=14))
    # Only the latest miss is kept.
    assert [(run["status"], run["scheduled_for"][:10]) for run in store.history(saved["id"])] == [("missed", "2026-10-01")]
    occurrence, = store.claim_due(NOW + timedelta(days=2, hours=1))
    store.finish(occurrence, "completed")
    store.forget(occurrence["id"])
    assert store.history(saved["id"]) == []


def test_ownership_pause_and_crash_recovery(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = scheduled(store)
    assert scheduled(store, owner="user:other")["id"] != saved["id"]
    assert [row["id"] for row in store.list("local:test")] == [saved["id"]]
    store.remove("user:other", None, "report.yaml")
    occurrence, = store.claim_due(NOW + timedelta(hours=1))
    store.recover()
    assert store.history(saved["id"])[0]["status"] == "needs_attention"
    store.resolve(occurrence["id"])
    assert store.history(saved["id"])[0]["status"] == "completed"
    store.finish(occurrence, "failed")
    store.resolve(occurrence["id"])
    assert store.history(saved["id"])[0]["status"] == "failed"
    paused = scheduled(store, {**BLOCK, "enabled": False})
    assert paused["id"] == saved["id"] and not paused["enabled"]
    assert store.claim_due(NOW + timedelta(days=1, hours=1)) == []
    assert store.remove("local:test", None, "report.yaml") == [occurrence["id"]]
    assert store.list("local:test") == []
    assert store.history(saved["id"]) == []


def test_removing_a_schedule_keeps_its_runs_and_resuming_it_reuses_them(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = scheduled(store)
    store.finish(store.claim_due(NOW + timedelta(hours=1))[0], "completed")
    assert store.sync("local:test", None, "report.yaml", None)["scheduled"] is False
    assert store.claim_due(NOW + timedelta(days=1, hours=1)) == []
    again = scheduled(store)
    assert again["id"] == saved["id"] and again["scheduled"] and len(store.history(saved["id"])) == 1
    store.sync("local:test", None, "unrun.yaml", BLOCK)
    assert store.sync("local:test", None, "unrun.yaml", None) is None
    assert [row["workflow"] for row in store.list("local:test")] == ["report.yaml"]


def test_only_timing_changes_move_the_next_run(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = scheduled(store)
    later = NOW + timedelta(minutes=30)
    assert store.sync("local:test", None, "report.yaml", {**BLOCK, "model_id": "other-model"}, now=later)["next_at"] == saved["next_at"]
    assert store.sync("local:test", None, "report.yaml", {**BLOCK, "time": "10:00"}, now=later)["next_at"] != saved["next_at"]


def test_rebuild_follows_the_files(tmp_path):
    store = ScheduleStore(tmp_path)
    scheduled(store)
    store.rebuild("local:test", None, {"report.yaml": None, "other.yaml": BLOCK, "broken.yaml": {**BLOCK, "time": "25:00"}}, now=NOW)
    assert [row["workflow"] for row in store.list("local:test")] == ["other.yaml"]
    store.rebuild("local:test", None, {}, now=NOW)
    assert store.list("local:test") == []


def test_unattended_runs_approve_or_decline_and_leave_questions_for_the_user(monkeypatch):
    from data_formulator.workflows.scheduler import DECLINED_LOADING, automatic_response
    monkeypatch.setattr("data_formulator.workflows.scheduler.is_local_mode", lambda: True)
    approve, decline = {"auto_approve": True}, {}
    command = {"terminal_request": {"id": "command"}}
    assert automatic_response(command, approve) == {"terminal_response": {"request_id": "command", "decision": "approve"}}
    assert automatic_response(command, decline) == {"terminal_response": {"request_id": "command", "decision": "reject"}}
    assert automatic_response({"terminal_request": {"id": "command", "execution_started": True}}, approve) == {}
    loading = {"interaction": {"data_operation": {"id": "op", "plans": [{"id": "one"}, {"id": "two"}]}}}
    assert automatic_response(loading, approve) == {"interaction_response": {"operation_id": "op", "plan_id": "one"}}
    assert automatic_response(loading, decline) == {"reply": DECLINED_LOADING}
    assert automatic_response({"interaction": {"questions": ["Which source?"]}}, approve) == {}
    monkeypatch.setattr("data_formulator.workflows.scheduler.is_local_mode", lambda: False)
    assert automatic_response(command, approve) == {}


def test_run_session_holds_only_provenance_and_summary():
    from data_formulator.workflows.scheduler import run_session_state
    schedule = {"id": "schedule", "config": CONFIG}
    occurrence = {"id": "run", "scheduled_for": "2026-09-30T13:00:00+00:00"}
    state = {"status": "completed", "message": "Done", "trajectory": [{"content": "secret"}], "instance": {"name": "Daily report"},
             "outputs": [{"type": "report", "content": "Final report"}]}
    session = run_session_state(schedule, occurrence, state, read_only=False)
    assert set(session) == {"activeWorkspace", "textTurns"}
    assert session["activeWorkspace"] == {"id": "scheduled-run", "displayName": "Daily report (Sep 30, 09:00)", "readOnly": False,
        "scheduledRun": {"scheduleId": "schedule", "scheduleName": "Daily report", "workflow": "report.yaml",
                         "scheduledFor": occurrence["scheduled_for"]}}
    assert session["textTurns"][0]["content"] == "Done"
    assert "secret" not in str(session) and "Final report" not in str(session)


def test_schedule_uses_default_model_when_its_model_is_gone(monkeypatch):
    from data_formulator.model_registry import model_registry
    from data_formulator.workflows.scheduler import schedule_model_id
    monkeypatch.setattr(model_registry, "get_config", lambda model_id, **kwargs: {"id": model_id} if model_id == "kept" else None)
    monkeypatch.setattr(model_registry, "list_public", lambda **kwargs: [{"id": "default"}, {"id": "other"}])
    assert schedule_model_id({"model_id": "kept"}) == "kept"
    assert schedule_model_id({"model_id": "removed"}) == "default"
    monkeypatch.setattr(model_registry, "list_public", lambda **kwargs: [])
    with pytest.raises(ValueError, match="No server-configured model"):
        schedule_model_id({"model_id": "removed"})


def test_scheduled_identity_cannot_be_supplied_by_header(monkeypatch):
    from flask import Flask
    from data_formulator.auth import identity
    monkeypatch.setattr(identity, "_provider", None)
    monkeypatch.setattr(identity, "_localhost_identity", None)
    monkeypatch.setattr(identity, "_allow_anonymous", True)
    with Flask(__name__).test_request_context(headers={"X-Identity-Id": "schedule:admin"}):
        assert identity.get_identity_id() == "browser:admin"
        token = identity._scheduled_identity.set("schedule:internal")
        try:
            assert identity.get_identity_id() == "schedule:internal"
        finally:
            identity._scheduled_identity.reset(token)
        assert identity.get_identity_id() == "browser:admin"


def write_report(app, block=BLOCK, headers=None):
    """Save report.yaml with ``block`` as its schedule, as the app does."""
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore, set_schedule
    with app.test_request_context(headers=headers or {}):
        WorkflowStore(get_user_home("local:test")).save("report.yaml", set_schedule(REPORT, block))


@pytest.fixture
def execution_context(tmp_path, monkeypatch):
    from flask import Flask
    from data_formulator.auth import identity
    from data_formulator.model_registry import model_registry
    from data_formulator.routes.sessions import session_bp
    from data_formulator.routes.workflows import workflow_bp
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config.update(TESTING=True, CLI_ARGS={"data_dir": str(tmp_path), "workspace_backend": "local", "managed": True})
    app.register_blueprint(session_bp)
    app.register_blueprint(workflow_bp)
    register_error_handlers(app)
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    monkeypatch.setattr(identity, "_provider", None)
    monkeypatch.setattr(identity, "_localhost_identity", "local:test")
    monkeypatch.setattr(model_registry, "get_config", lambda *args, **kwargs: {"id": "server-model"})
    monkeypatch.setattr("data_formulator.routes.agents.get_client", lambda *args, **kwargs: object())
    write_report(app)
    store = ScheduleStore(tmp_path)
    schedule = scheduled(store)
    occurrence, = store.claim_due(NOW + timedelta(hours=1))
    return app, store, schedule, occurrence


def listed_schedules(client, headers=None):
    return client.post("/api/workflows/list", json={}, headers=headers or {}).get_json()["data"]


@pytest.mark.slow
def test_runner_creates_private_session(execution_context, monkeypatch):
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workflows.agent import WorkflowAgent
    from data_formulator.workspace_factory import get_workspace_manager
    app, store, schedule, occurrence = execution_context

    def complete(agent):
        agent.state.update(status="completed", outputs=[{"id": "report", "type": "report", "content": "Final findings"}])
        agent.state["trajectory"].append({"role": "assistant", "content": "PRIVATE REASONING"})
        agent.checkpoint(agent.state)
        yield {"type": "workflow_state", "run": {"status": "completed"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", complete)
    execute_occurrence(app, store, occurrence)
    assert store.history(schedule["id"])[0]["status"] == "completed"
    with app.app_context():
        manager = get_workspace_manager("local:test")
        saved = manager.load_session_state("scheduled-" + occurrence["id"])
        assert saved["activeWorkspace"]["scheduledRun"]["scheduleId"] == schedule["id"]
        assert saved["activeWorkspace"]["displayName"] == "Daily report (Sep 30, 09:00)"
        assert saved["activeWorkspace"]["scheduledRun"]["scheduleName"] == "Daily report"
        assert manager.list_workspaces()[0]["scheduled_run"]["scheduledFor"] == occurrence["scheduled_for"]
    client = app.test_client()
    assert saved["activeWorkspace"]["readOnly"] is False
    private = client.post("/api/sessions/load", json={"id": "scheduled-" + occurrence["id"]}).get_json()["data"]
    assert private["workflow_run"]["id"] == occurrence["id"]
    assert private["workflow_run"]["workflow_path"] == CONFIG["workflow"]
    assert "trajectory" not in private["workflow_run"]


@pytest.mark.slow
def test_scheduled_run_writes_in_the_schedule_language(execution_context, monkeypatch):
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workflows.agent import WorkflowAgent
    app, store, schedule, occurrence = execution_context
    write_report(app, {**BLOCK, "language": "ja"})
    seen = {}

    def complete(agent):
        seen.update(language=agent.state["language"], prompt=agent._build_system_prompt())
        agent.state.update(status="completed")
        agent.checkpoint(agent.state)
        yield {"type": "workflow_state", "run": {"status": "completed"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", complete)
    execute_occurrence(app, store, occurrence)
    assert seen["language"] == "ja" and "[LANGUAGE INSTRUCTION]" in seen["prompt"]
    assert store.get(schedule["id"])["config"]["language"] == "ja"
    with pytest.raises(ValueError):
        next_occurrence({**BLOCK, "language": "Japanese"}, NOW)


def test_schedule_list_reflects_run_completed_after_resume(execution_context, monkeypatch):
    from data_formulator.routes.workflows import run_path
    from data_formulator.workflows.agent import WorkflowAgent
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workspace_factory import get_workspace_manager
    app, store, schedule, occurrence = execution_context

    def pause(agent):
        agent.state.update(status="paused", message="Needs a decision")
        agent.checkpoint(agent.state)
        yield {"type": "workflow_state", "run": {"status": "paused"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", pause)
    execute_occurrence(app, store, occurrence)
    client = app.test_client()
    listed = listed_schedules(client)["schedules"]
    assert listed["report.yaml"]["history"][0]["status"] == "needs_attention"
    with app.app_context():
        workspace = get_workspace_manager("local:test").open_workspace("scheduled-" + occurrence["id"], "local:test")
        path = run_path(workspace, occurrence["id"])
        path.write_text(json.dumps({**json.loads(path.read_text()), "status": "completed"}))
    listed = listed_schedules(client)["schedules"]
    assert listed["report.yaml"]["history"][0]["status"] == "completed"
    assert store.history(schedule["id"])[0]["status"] == "completed"
    with app.app_context():
        get_workspace_manager("local:test").delete_workspace("scheduled-" + occurrence["id"])
    assert listed_schedules(client)["schedules"]["report.yaml"]["history"] == []
    assert store.history(schedule["id"]) == []


@pytest.mark.slow
def test_runner_retries_same_checkpoint(execution_context, monkeypatch):
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workflows.agent import WorkflowAgent
    from data_formulator.workspace_factory import get_workspace_manager
    app, store, schedule, occurrence = execution_context

    def fail(agent):
        agent.state["calls"] += 1
        raise TimeoutError("model timed out")
        yield

    monkeypatch.setattr(WorkflowAgent, "run_workflow", fail)
    execute_occurrence(app, store, occurrence)
    history = store.history(schedule["id"])
    assert history[0]["status"] == "retry"
    with app.app_context():
        pending = get_workspace_manager("local:test").load_session_state("scheduled-" + occurrence["id"])
    assert pending["activeWorkspace"]["readOnly"] is True
    checkpoint = app.test_client().post("/api/sessions/load", json={"id": "scheduled-" + occurrence["id"]}).get_json()["data"]["workflow_run"]
    assert checkpoint["execution_error"]["retry"] is True
    assert "detail" not in checkpoint["execution_error"]
    assert checkpoint["message"] == checkpoint["execution_error"]["message"]
    retry, = store.claim_due(datetime.fromisoformat(history[0]["retry_at"]))

    def complete(agent):
        assert agent.state["calls"] == 1
        assert "execution_error" not in agent.state
        agent.state["status"] = "completed"
        agent.checkpoint(agent.state)
        yield {"type": "workflow_state", "run": {"status": "completed"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", complete)
    execute_occurrence(app, store, retry)
    # The real-clock retry time also passes later occurrences, which are recorded as missed.
    retried = next(item for item in store.history(schedule["id"]) if item["id"] == occurrence["id"])
    assert (retried["status"], retried["attempts"]) == ("completed", 2)
    with app.app_context():
        manager = get_workspace_manager("local:test")
        assert len(manager.list_workspaces()) == 1
        assert manager.load_session_state("scheduled-" + occurrence["id"])["activeWorkspace"]["readOnly"] is False


def test_busy_executor_defers_scheduled_run(execution_context, monkeypatch):
    import threading
    from data_formulator.routes import workflows
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workflows.agent import WorkflowAgent
    app, store, schedule, occurrence = execution_context
    slots = threading.BoundedSemaphore(1)
    slots.acquire()
    monkeypatch.setattr(workflows, "_execution_slots", slots)
    monkeypatch.setattr(WorkflowAgent, "run_workflow", lambda agent: pytest.fail("A busy executor must not run"))
    execute_occurrence(app, store, occurrence)
    history = store.history(schedule["id"])[0]
    assert (history["status"], history["message"]) == ("retry", "Workflow executor busy")


@pytest.mark.slow
def test_scheduled_run_time_limit_pauses_and_releases_occurrence(execution_context, monkeypatch):
    import time
    from data_formulator.workflows import scheduler
    from data_formulator.workflows.agent import WorkflowAgent
    from data_formulator.workspace_factory import get_workspace_manager
    app, store, schedule, occurrence = execution_context
    monkeypatch.setattr(scheduler, "RUN_TIME_LIMIT", timedelta(seconds=1))

    def stall(agent):
        while not agent.cancel.is_set():
            time.sleep(0.05)
            yield {"type": "activity", "message": "working"}
        agent.state.update(status="paused", message="Paused by time limit")
        agent.checkpoint(agent.state)

    monkeypatch.setattr(WorkflowAgent, "run_workflow", stall)
    started = time.monotonic()
    scheduler.execute_occurrence(app, store, occurrence)
    assert time.monotonic() - started < 10
    history = store.history(schedule["id"])[0]
    assert (history["status"], history["message"]) == ("needs_attention", "The run exceeded its time limit and was paused.")
    with app.app_context():
        saved = get_workspace_manager("local:test").load_session_state("scheduled-" + occurrence["id"])
    assert saved["activeWorkspace"]["readOnly"] is False
    assert saved["textTurns"][0]["content"] == "Paused by time limit"


@pytest.mark.slow
def test_runner_waits_for_run_when_update_stream_ends_early(execution_context, monkeypatch):
    import queue
    import time
    from data_formulator.routes import workflows
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workflows.agent import WorkflowAgent
    app, store, schedule, occurrence = execution_context
    monkeypatch.setattr(workflows, "Queue", lambda maxsize: queue.Queue(1))

    def slow_completion(agent):
        for sequence in range(50):
            yield {"type": "activity", "message": str(sequence)}
        time.sleep(2.5)
        agent.state["status"] = "completed"
        agent.checkpoint(agent.state)
        yield {"type": "workflow_state", "run": {"status": "completed"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", slow_completion)
    execute_occurrence(app, store, occurrence)
    assert store.history(schedule["id"])[0]["status"] == "completed"


def test_hosted_deployment_has_no_schedules(execution_context, monkeypatch):
    from data_formulator.auth import identity
    app, _, _, _ = execution_context
    monkeypatch.setattr(identity, "_localhost_identity", None)
    listed = listed_schedules(app.test_client(), {"X-Identity-Id": "browser:viewer"})
    assert listed["scheduling"] is False and listed["schedules"] == {}


def save(client, content, *, path="report.yaml", headers=None, **fields):
    current = client.post("/api/workflows/read", json={"path": path}, headers=headers or {}).get_json()
    content_hash = (current.get("data") or {}).get("content_hash")
    return client.post("/api/workflows/save", json={"path": path, "content": content, "content_hash": content_hash, **fields},
                       headers=headers or {}).get_json()


def test_schedule_write_rejects_cross_site_requests(execution_context):
    from data_formulator.workflows.instances import set_schedule
    app, store, schedule, _ = execution_context
    client = app.test_client()
    untrusted = {"Origin": "https://untrusted.example", "Sec-Fetch-Site": "cross-site"}
    changed = save(client, REPORT, schedule={**BLOCK, "auto_approve": True}, headers=untrusted)
    assert changed["error"]["code"] == "ACCESS_DENIED"
    assert store.get(schedule["id"])["config"] == CONFIG
    # Edits that leave the schedule as it is do not set up anything unattended.
    unchanged = save(client, set_schedule(REPORT.replace("A scheduled report", "Revised"), BLOCK), headers=untrusted)
    assert unchanged["status"] == "success"


def test_a_missed_run_is_listed_and_run_from_the_app(execution_context):
    app, store, schedule, occurrence = execution_context
    client = app.test_client()
    store.finish(occurrence, "completed")
    store.claim_due(NOW + timedelta(days=1, hours=15))
    missed = store.history(schedule["id"])[0]
    assert "missed" in [run["status"] for run in listed_schedules(client)["schedules"]["report.yaml"]["history"]]
    untrusted = {"Origin": "https://untrusted.example", "Sec-Fetch-Site": "cross-site"}
    run = lambda identifier, headers=None: client.post("/api/workflows/run-missed", json={"id": identifier}, headers=headers or {}).get_json()
    assert run(missed["id"], untrusted)["error"]["code"] == "ACCESS_DENIED"
    assert run("not-a-run")["status"] == "error"
    assert run(missed["id"])["status"] == "success"
    assert store.history(schedule["id"])[0]["status"] == "retry"


def test_running_a_workflow_by_hand_clears_its_missed_run(execution_context, monkeypatch):
    from data_formulator.workflows.agent import WorkflowAgent
    app, store, schedule, occurrence = execution_context
    store.finish(occurrence, "completed")
    store.claim_due(NOW + timedelta(days=1, hours=15))
    assert store.history(schedule["id"])[0]["status"] == "missed"

    def pause(agent):
        agent.state.update(status="paused")
        yield {"type": "workflow_state", "run": {"status": "paused"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", pause)
    response = app.test_client().post("/api/workflows/run", json={"path": "report.yaml", "model": {}}, headers={"X-Workspace-Id": "manual"})
    assert response.status_code == 200, response.get_json()
    assert [run["status"] for run in store.history(schedule["id"])] == ["completed"]


def test_saving_a_workflow_sets_its_schedule(execution_context, monkeypatch):
    from data_formulator.model_registry import model_registry
    app, store, schedule, _ = execution_context
    client = app.test_client()
    saved = save(client, REPORT, schedule={**BLOCK, "time": "10:30", "enabled": False})["data"]
    assert "time: '10:30'" in saved["content"] and "  - id: report" in saved["content"]
    row = store.get(schedule["id"])
    assert (row["config"]["time"], row["enabled"]) == ("10:30", False)
    assert listed_schedules(client)["schedules"]["report.yaml"]["next_at"] is None
    assert save(client, saved["content"], schedule=None)["status"] == "success"
    assert store.get(schedule["id"])["scheduled"] is False  # its run is kept
    monkeypatch.setattr(model_registry, "get_config", lambda *args, **kwargs: None)
    assert "server-configured model" in save(client, REPORT, schedule=BLOCK)["error"]["message"]
    bad = save(client, REPORT, schedule={**BLOCK, "timezone": "Mars/Base"})
    assert "Unknown timezone" in bad["error"]["message"]


def test_a_demo_copy_carries_its_schedule(execution_context):
    app, store, _, _ = execution_context
    client = app.test_client()
    demo = client.post("/api/workflows/list", json={}).get_json()["data"]["items"]
    source = next(item for item in demo if item["origin"] == "demo")
    content = client.post("/api/workflows/read", json={"path": source["path"]}).get_json()["data"]["content"]
    copied = client.post("/api/workflows/save", json={"path": "copy.workflow.yaml", "content": content,
                                                     "schedule": {**BLOCK, "setup": {"parameters": {}, "instructions": ""}}}).get_json()
    assert copied["status"] == "success", copied
    assert store.find("local:test", None, "copy.workflow.yaml")["scheduled"]


def test_deleting_a_workflow_removes_its_schedule_and_keeps_its_runs(execution_context, monkeypatch):
    from data_formulator.workflows.agent import WorkflowAgent
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workspace_factory import get_workspace_manager
    app, store, schedule, occurrence = execution_context

    def complete(agent):
        agent.state.update(status="completed")
        agent.checkpoint(agent.state)
        yield {"type": "workflow_state", "run": {"status": "completed"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", complete)
    execute_occurrence(app, store, occurrence)
    client = app.test_client()
    run = next(item for item in client.get("/api/sessions/list").get_json()["data"]["sessions"] if item.get("scheduled_run"))
    assert "workflowGone" not in run["scheduled_run"]
    client.post("/api/workflows/delete", json={"path": "report.yaml"})
    assert store.list("local:test") == []
    run = next(item for item in client.get("/api/sessions/list").get_json()["data"]["sessions"] if item.get("scheduled_run"))
    assert run["scheduled_run"]["workflowGone"] is True

    write_report(app)
    again = scheduled(store)
    second, = store.claim_due(NOW + timedelta(hours=1))
    execute_occurrence(app, store, second)
    client.post("/api/workflows/delete", json={"path": "report.yaml"})
    with app.app_context():
        manager = get_workspace_manager("local:test")
        assert manager.workspace_exists("scheduled-" + second["id"])
        assert manager.workspace_exists("scheduled-" + occurrence["id"])
    assert store.history(again["id"]) == []


def test_a_run_is_skipped_when_its_file_no_longer_schedules_it(execution_context, monkeypatch):
    from data_formulator.workflows.agent import WorkflowAgent
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workspace_factory import get_workspace_manager
    app, store, schedule, occurrence = execution_context
    write_report(app, None)  # edited outside the app
    monkeypatch.setattr(WorkflowAgent, "run_workflow", lambda agent: pytest.fail("An unscheduled workflow must not run"))
    execute_occurrence(app, store, occurrence)
    assert store.history(schedule["id"])[0]["status"] == "skipped"
    assert store.get(schedule["id"])["scheduled"] is False
    with app.app_context():
        assert not get_workspace_manager("local:test").workspace_exists("scheduled-" + occurrence["id"])


def test_a_run_uses_the_files_current_schedule(execution_context, monkeypatch):
    from data_formulator.workflows.agent import WorkflowAgent
    from data_formulator.workflows.scheduler import execute_occurrence
    app, store, schedule, occurrence = execution_context
    write_report(app, {**BLOCK, "language": "fr"})
    seen = {}

    def complete(agent):
        seen["language"] = agent.state["language"]
        assert "schedule" not in agent.state["definition"]
        agent.state.update(status="completed")
        agent.checkpoint(agent.state)
        yield {"type": "workflow_state", "run": {"status": "completed"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", complete)
    execute_occurrence(app, store, occurrence)
    assert seen["language"] == "fr" and store.get(schedule["id"])["config"]["language"] == "fr"


def test_clock_adjustment_does_not_reclaim_completed_occurrence(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = scheduled(store)
    occurrence, = store.claim_due(NOW + timedelta(hours=1))
    store.finish(occurrence, "completed")
    scheduled(store, {**BLOCK, "time": "10:00"})
    scheduled(store)
    assert store.claim_due(NOW + timedelta(hours=1)) == []
    assert store.history(saved["id"])[0]["status"] == "completed"


def test_missing_retry_checkpoint_never_starts_fresh(execution_context, monkeypatch):
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workflows.agent import WorkflowAgent
    app, store, schedule, occurrence = execution_context

    def unexpected_run(agent):
        pytest.fail("A missing checkpoint must not replay work")

    monkeypatch.setattr(WorkflowAgent, "run_workflow", unexpected_run)
    execute_occurrence(app, store, {**occurrence, "attempts": 1})
    assert store.history(schedule["id"])[0]["status"] == "needs_attention"


def test_published_example_sessions_can_be_imported_and_unpublished_by_admins(execution_context, monkeypatch):
    """Publishing is gone (sessions are shared by wormhole); examples published before stay listed until removed."""
    import io
    import zipfile
    from data_formulator.routes import sessions as session_routes
    app, _, _, _ = execution_context
    client = app.test_client()
    with app.app_context():
        published = {"id": "a" * 32, "title": "Price review", "description": "", "published_at": "2026-11-01T00:00:00Z"}
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("session_state.json", "{}")
        (session_routes._examples_dir() / f"{published['id']}.zip").write_bytes(buffer.getvalue())
        session_routes._write_examples([published])
    assert client.post("/api/sessions/examples", json={"workspace_id": "session_demo"}).status_code != 200
    assert client.get("/api/sessions/examples").get_json()["data"]["examples"] == [published]
    archive = client.get(f"/api/sessions/examples/{published['id']}")
    assert archive.status_code == 200 and zipfile.is_zipfile(io.BytesIO(archive.data))
    assert client.get("/api/sessions/examples/../index").status_code == 404

    monkeypatch.setattr("data_formulator.routes.configurations.can_configure", lambda: False)
    assert client.delete(f"/api/sessions/examples/{published['id']}").get_json()["error"]["code"] == "ACCESS_DENIED"
    monkeypatch.setattr("data_formulator.routes.configurations.can_configure", lambda: True)
    client.delete(f"/api/sessions/examples/{published['id']}")
    assert client.get("/api/sessions/examples").get_json()["data"]["examples"] == []
    assert client.get(f"/api/sessions/examples/{published['id']}").get_json()["error"]["code"] == "TABLE_NOT_FOUND"



DEMO = {"X-DF-Space": "demo"}


def _a_demo(monkeypatch):
    from data_formulator import spaces
    monkeypatch.setattr(spaces, "known_space_id", lambda space_id: space_id if space_id == "demo" else None)


def test_a_demo_lists_and_manages_only_its_own_schedules(execution_context, monkeypatch):
    _a_demo(monkeypatch)
    app, store, schedule, occurrence = execution_context
    client = app.test_client()
    # The standard app's schedule is not the demo's: not listed there, and its history is left alone.
    assert listed_schedules(client, DEMO)["schedules"] == {}
    assert len(store.history(schedule["id"])) == 1
    write_report(app, None, headers=DEMO)
    assert save(client, REPORT, schedule=BLOCK, headers=DEMO)["status"] == "success"
    made = store.find("local:test", "demo", "report.yaml")
    assert made["config"]["site"] == "demo" and made["id"] != schedule["id"]
    assert [item["id"] for item in listed_schedules(client, DEMO)["schedules"].values()] == [made["id"]]
    client.post("/api/workflows/delete", json={"path": "report.yaml"}, headers=DEMO)
    assert [item["id"] for item in listed_schedules(client)["schedules"].values()] == [schedule["id"]]


def test_a_demo_does_not_list_the_example_workflows(execution_context, monkeypatch):
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore
    _a_demo(monkeypatch)
    app = execution_context[0]
    with app.test_request_context():
        assert any(item["origin"] == "demo" for item in WorkflowStore(get_user_home("local:test")).list_all())
    with app.test_request_context(headers=DEMO):
        assert not any(item["origin"] == "demo" for item in WorkflowStore(get_user_home("local:test")).list_all())


@pytest.mark.slow
def test_a_demo_schedule_runs_in_the_demos_storage(execution_context, monkeypatch):
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.agent import WorkflowAgent
    from data_formulator.workflows.instances import WorkflowStore
    from data_formulator.workflows.scheduler import execute_occurrence
    from data_formulator.workspace_factory import get_workspace_manager
    _a_demo(monkeypatch)
    app, store, schedule, _ = execution_context
    write_report(app, headers=DEMO)
    made = scheduled(store, site="demo")
    store.remove("local:test", None, "report.yaml")
    occurrence, = store.claim_due(NOW + timedelta(hours=1))

    def complete(agent):
        agent.state.update(status="completed")
        agent.checkpoint(agent.state)
        yield {"type": "workflow_state", "run": {"status": "completed"}}

    monkeypatch.setattr(WorkflowAgent, "run_workflow", complete)
    execute_occurrence(app, store, occurrence)
    assert store.history(made["id"])[0]["status"] == "completed"
    with app.test_request_context(headers=DEMO):
        assert get_workspace_manager("local:test").workspace_exists("scheduled-" + occurrence["id"])
    with app.app_context():
        assert not get_workspace_manager("local:test").workspace_exists("scheduled-" + occurrence["id"])


def test_schedules_made_before_files_move_into_their_workflows(execution_context):
    import sqlite3
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore, parse_definition
    from data_formulator.workflows.scheduler import migrate_to_files
    app, _, _, _ = execution_context
    home = app.config["CLI_ARGS"]["data_dir"] + "/legacy"
    root = Path(home) / "scheduling"
    root.mkdir(parents=True)
    legacy = sqlite3.connect(root / "schedules.sqlite3")
    legacy.executescript("""CREATE TABLE schedules (id TEXT PRIMARY KEY, owner TEXT NOT NULL, config TEXT NOT NULL,
        next_at TEXT NOT NULL, enabled INTEGER NOT NULL);""")
    rows = [("a" * 32, "report.yaml", "Daily", "2026-10-01T13:00:00+00:00", 1),
            ("b" * 32, "report.yaml", "Weekly", "2026-10-02T13:00:00+00:00", 1),
            ("c" * 32, "demo/gas-price-review.yaml", "Fuel", "2026-10-01T13:00:00+00:00", 0),
            ("d" * 32, "missing.yaml", "Gone", "2026-10-01T13:00:00+00:00", 1)]
    for identifier, workflow, name, next_at, enabled in rows:
        legacy.execute("INSERT INTO schedules VALUES (?, 'local:test', ?, ?, ?)",
                       (identifier, json.dumps({**BLOCK, "name": name, "workflow": workflow, "enabled": bool(enabled)}), next_at, enabled))
    legacy.commit()
    legacy.close()
    write_report(app, None)
    store = ScheduleStore(Path(home))
    with app.app_context():
        migrate_to_files(store)
        files = WorkflowStore(get_user_home("local:test"))
        assert parse_definition(files.read("report.yaml"))["schedule"]["time"] == "09:00"
        weekly = store.get("b" * 32)["workflow"]
        assert weekly == "report.workflow.yaml" and parse_definition(files.read(weekly))["schedule"]
        fuel = store.get("c" * 32)
        assert fuel["workflow"] == "gas-price-review.workflow.yaml" and not fuel["enabled"]
        assert parse_definition(files.read(fuel["workflow"]))["schedule"]["enabled"] is False
    assert store.get("a" * 32)["workflow"] == "report.yaml" and "name" not in store.get("a" * 32)["config"]
    assert store.get("d" * 32)["scheduled"] is False
    assert store.moved_to_files() and (root / "schedules.sqlite3.bak-before-files").exists()


def test_set_schedule_edits_only_the_schedule_block():
    from data_formulator.workflows.instances import parse_definition, set_schedule
    content = "# My report\n" + REPORT.lstrip() + "schedule:\n  time: '07:00'\n  weekdays: [0]\n# trailing note\nprompt: Keep it short\n"
    changed = set_schedule(content, BLOCK)
    assert changed.startswith("# My report\nversion: 1") and "prompt: Keep it short" in changed and "07:00" not in changed
    assert parse_definition(changed)["schedule"] == BLOCK
    removed = set_schedule(changed, None)
    assert "schedule" not in parse_definition(removed) and removed.startswith("# My report\n")


@pytest.mark.parametrize("change, problem", [({"timezone": "Mars/Base"}, "Unknown timezone"),
                                             ({"setup": {"parameters": {"unknown": 1}}}, "Unknown workflow parameter")])
def test_a_saved_schedule_must_be_able_to_run(change, problem):
    from data_formulator.workflows.instances import parse_definition, set_schedule
    with pytest.raises(ValueError, match=problem):
        parse_definition(set_schedule(REPORT, {**BLOCK, **change}))
    with pytest.raises(ValueError, match="schedule"):
        parse_definition(set_schedule(REPORT, {"time": "07:00", "weekdays": [0]}))


def test_an_unquoted_schedule_time_reads_as_written():
    from data_formulator.workflows.instances import parse_definition
    assert parse_definition(REPORT + "schedule:\n  time: 10:30\n  weekdays: [0]\n  timezone: UTC\n  model_id: m\n")["schedule"]["time"] == "10:30"


def test_a_retired_catch_up_key_is_ignored():
    from data_formulator.workflows.instances import parse_definition, set_schedule
    block = "schedule:\n  time: '10:30'\n  weekdays: [0]\n  timezone: UTC\n  model_id: m\n  catch_up: false\n"
    assert "catch_up" not in parse_definition(REPORT + block)["schedule"]
    assert "catch_up" not in set_schedule(REPORT, {**BLOCK, "catch_up": True})
    assert next_occurrence({**CONFIG, "catch_up": False}, NOW) == next_occurrence(CONFIG, NOW)


def test_a_schedule_needs_no_inputs_its_instructions_can_name():
    from data_formulator.workflows.agent import new_run
    from data_formulator.workflows.instances import parse_definition, set_schedule
    with_input = REPORT.replace("deliverables:", "parameters:\n  - {name: region, label: Region, required: true}\ndeliverables:")
    workflow = parse_definition(set_schedule(with_input, {**BLOCK, "setup": {"parameters": {}, "instructions": "Use Europe."}}))
    run = new_run(workflow, "run", workflow["schedule"]["setup"], require_values=False)
    assert run["setup"] == {"parameters": {}, "instructions": "Use Europe."}
    with pytest.raises(ValueError, match="Region"):
        new_run(workflow, "run", {"parameters": {}, "instructions": ""})
