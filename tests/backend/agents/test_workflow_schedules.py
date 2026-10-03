from datetime import datetime, timedelta, timezone
import json

import pytest

from data_formulator.workflows.scheduling import ScheduleStore, next_occurrence


CONFIG = {"name": "Daily report", "workflow": "report.yaml", "model_id": "server-model",
          "time": "09:00", "timezone": "America/New_York", "weekdays": [0, 1, 2, 3, 4]}
NOW = datetime(2026, 9, 30, 12, tzinfo=timezone.utc)


def test_clock_and_timezone():
    assert next_occurrence(CONFIG, NOW) == "2026-09-30T13:00:00+00:00"
    assert next_occurrence(CONFIG, datetime(2026, 11, 2, 12, tzinfo=timezone.utc)) == "2026-11-02T14:00:00+00:00"
    assert next_occurrence(CONFIG, datetime(2026, 10, 2, 14, tzinfo=timezone.utc)) == "2026-10-05T13:00:00+00:00"


@pytest.mark.parametrize("change", [{"timezone": "invalid"}, {"weekdays": []}, {"time": "25:00"},
                                    {"api_key": "secret"}, {"max_retries": 4}, {"weekdays": [False]}])
def test_invalid_schedule_rejected(change):
    with pytest.raises(ValueError):
        next_occurrence({**CONFIG, **change}, NOW)


def test_durable_claim_is_unique(tmp_path):
    first = ScheduleStore(tmp_path)
    saved = first.save("local:test", CONFIG, now=NOW)
    second = ScheduleStore(tmp_path)
    due = NOW + timedelta(hours=1)
    claimed = first.claim_due(due)
    assert len(claimed) == 1
    assert second.claim_due(due) == []
    assert second.history(saved["id"])[0]["id"] == claimed[0]["id"]
    assert saved["config"] == CONFIG


def test_skip_missed_and_overlap(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = store.save("local:test", CONFIG, now=NOW)
    assert store.claim_due(NOW + timedelta(days=1)) == []
    assert store.history(saved["id"])[0]["message"] == "Missed occurrence"
    assert len(store.claim_due(NOW + timedelta(days=1, hours=1))) == 1
    assert store.claim_due(NOW + timedelta(days=2, hours=1)) == []
    assert store.history(saved["id"])[0]["message"] == "Overlapping run"


def test_catchup_coalesces_and_retry_retains_id(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = store.save("local:test", {**CONFIG, "catch_up": True}, now=NOW)
    due = NOW + timedelta(days=7)
    occurrence, = store.claim_due(due)
    assert store.claim_due(due) == []
    retry_at = due + timedelta(seconds=30)
    store.finish(occurrence, "retry", retry_at=retry_at.isoformat())
    assert store.claim_due(due) == []
    retry, = store.claim_due(retry_at)
    assert retry["id"] == occurrence["id"]
    assert retry["attempts"] == 1
    store.finish(retry, "completed")
    assert len(store.history(saved["id"])) == 1


def test_ownership_disable_and_crash_recovery(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = store.save("local:test", CONFIG, now=NOW)
    with pytest.raises(ValueError):
        store.save("user:other", CONFIG, identifier=saved["id"], now=NOW)
    assert store.list("user:other") == []
    occurrence, = store.claim_due(NOW + timedelta(hours=1))
    store.recover()
    assert store.history(saved["id"])[0]["status"] == "needs_attention"
    store.resolve(occurrence["id"])
    assert store.history(saved["id"])[0]["status"] == "completed"
    store.finish(occurrence, "failed")
    store.resolve(occurrence["id"])
    assert store.history(saved["id"])[0]["status"] == "failed"
    store.save("local:test", {**CONFIG, "enabled": False}, identifier=saved["id"], now=NOW)
    assert store.claim_due(NOW + timedelta(days=1, hours=1)) == []
    with pytest.raises(ValueError):
        store.delete("user:other", saved["id"])
    store.delete("local:test", saved["id"])
    assert store.list("local:test") == []
    assert store.history(saved["id"]) == []


def test_auto_approval_preserves_questions_and_choices(monkeypatch):
    from data_formulator.workflows.scheduler import automatic_response
    monkeypatch.setattr("data_formulator.workflows.scheduler.is_local_mode", lambda: False)
    config = {"auto_approve": True}
    assert automatic_response({"terminal_request": {"id": "command"}}, config) == {}
    assert automatic_response({"interaction": {"questions": ["Which source?"]}}, config) == {}
    interaction = {"interaction": {"data_operation": {"id": "op", "plans": [{"id": "one"}, {"id": "two"}]}}}
    assert automatic_response(interaction, config) == {}
    interaction["interaction"]["data_operation"]["plans"].pop()
    assert automatic_response(interaction, config) == {"interaction_response": {"operation_id": "op", "plan_id": "one"}}
    assert automatic_response(interaction, {}) == {}


def test_run_session_holds_only_provenance_and_summary():
    from data_formulator.workflows.scheduler import run_session_state
    schedule = {"id": "schedule", "config": CONFIG}
    occurrence = {"id": "run", "scheduled_for": "2026-09-30T13:00:00+00:00"}
    state = {"status": "completed", "message": "Done", "trajectory": [{"content": "secret"}],
             "outputs": [{"type": "report", "content": "Final report"}]}
    session = run_session_state(schedule, occurrence, state, read_only=False)
    assert set(session) == {"activeWorkspace", "textTurns"}
    assert session["activeWorkspace"] == {"id": "scheduled-run", "displayName": "Daily report (Sep 30, 09:00)", "readOnly": False,
        "scheduledRun": {"scheduleId": "schedule", "scheduleName": "Daily report", "scheduledFor": occurrence["scheduled_for"]}}
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


@pytest.fixture
def execution_context(tmp_path, monkeypatch):
    from flask import Flask
    from data_formulator.auth import identity
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.model_registry import model_registry
    from data_formulator.workflows.instances import WorkflowStore
    from data_formulator.routes.sessions import session_bp
    from data_formulator.routes.schedules import schedule_bp
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config.update(TESTING=True, CLI_ARGS={"data_dir": str(tmp_path), "workspace_backend": "local", "managed": True})
    app.register_blueprint(session_bp)
    app.register_blueprint(schedule_bp)
    register_error_handlers(app)
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    monkeypatch.setattr(identity, "_provider", None)
    monkeypatch.setattr(identity, "_localhost_identity", "local:test")
    monkeypatch.setattr(model_registry, "get_config", lambda *args, **kwargs: {"id": "server-model"})
    monkeypatch.setattr("data_formulator.routes.agents.get_client", lambda *args, **kwargs: object())
    with app.app_context():
        WorkflowStore(get_user_home("local:test")).save("report.yaml", """
version: 1
name: Report
overview: A scheduled report
deliverables: [A report]
steps:
  - id: report
    description: Write a report
    instructions: Report the result
""")
    store = ScheduleStore(tmp_path)
    schedule = store.save("local:test", CONFIG, now=NOW)
    occurrence, = store.claim_due(NOW + timedelta(hours=1))
    return app, store, schedule, occurrence


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
        assert manager.list_workspaces()[0]["scheduled_run"]["scheduledFor"] == occurrence["scheduled_for"]
    client = app.test_client()
    assert saved["activeWorkspace"]["readOnly"] is False
    private = client.post("/api/sessions/load", json={"id": "scheduled-" + occurrence["id"]}).get_json()["data"]
    assert private["workflow_run"]["id"] == occurrence["id"]
    assert private["workflow_run"]["workflow_path"] == CONFIG["workflow"]
    assert "trajectory" not in private["workflow_run"]


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
    listed = client.get("/api/schedules").get_json()["data"]["schedules"]
    assert listed[0]["history"][0]["status"] == "needs_attention"
    with app.app_context():
        workspace = get_workspace_manager("local:test").open_workspace("scheduled-" + occurrence["id"], "local:test")
        path = run_path(workspace, occurrence["id"])
        path.write_text(json.dumps({**json.loads(path.read_text()), "status": "completed"}))
    listed = client.get("/api/schedules").get_json()["data"]["schedules"]
    assert listed[0]["history"][0]["status"] == "completed"
    assert store.history(schedule["id"])[0]["status"] == "completed"
    with app.app_context():
        get_workspace_manager("local:test").delete_workspace("scheduled-" + occurrence["id"])
    assert client.get("/api/schedules").get_json()["data"]["schedules"][0]["history"] == []
    assert store.history(schedule["id"]) == []


def test_runner_retries_same_checkpoint_and_does_not_publish_failure(execution_context, monkeypatch):
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
    assert store.history(schedule["id"])[0]["status"] == "completed"
    assert store.history(schedule["id"])[0]["attempts"] == 2
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
    client = app.test_client()
    viewer = {"X-Identity-Id": "browser:viewer"}
    listed = client.get("/api/schedules", headers=viewer).get_json()["data"]
    assert listed["available"] is False and "only available in the local" in listed["reason"]
    response = client.post("/api/schedules", json={"config": CONFIG}, headers=viewer)
    assert response.get_json()["error"]["code"] == "ACCESS_DENIED"


def test_schedule_write_rejects_cross_site_requests(execution_context):
    app, _, _, _ = execution_context
    response = app.test_client().post("/api/schedules", json={"config": CONFIG},
                                      headers={"Origin": "https://untrusted.example", "Sec-Fetch-Site": "cross-site"})
    assert response.get_json()["error"]["code"] == "ACCESS_DENIED"


def test_clock_adjustment_does_not_reclaim_completed_occurrence(tmp_path):
    store = ScheduleStore(tmp_path)
    saved = store.save("local:test", CONFIG, now=NOW)
    occurrence, = store.claim_due(NOW + timedelta(hours=1))
    store.finish(occurrence, "completed")
    store.save("local:test", CONFIG, identifier=saved["id"], now=NOW)
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


def test_admin_publishes_example_sessions_for_everyone_to_import(execution_context, monkeypatch):
    import io
    import zipfile
    from data_formulator.workspace_factory import get_workspace_manager
    app, _, _, _ = execution_context
    with app.app_context():
        manager = get_workspace_manager("local:test")
        manager.create_workspace("session_demo")
        manager.save_session_state("session_demo", {"activeWorkspace": {"id": "session_demo", "displayName": "Price review"}, "textTurns": []})
    client = app.test_client()
    published = client.post("/api/sessions/examples", json={"workspace_id": "session_demo"}).get_json()["data"]["example"]
    assert published["title"] == "Price review"
    assert client.get("/api/sessions/examples").get_json()["data"]["examples"] == [published]
    archive = client.get(f"/api/sessions/examples/{published['id']}")
    assert archive.status_code == 200 and zipfile.is_zipfile(io.BytesIO(archive.data))
    assert client.get("/api/sessions/examples/../index").status_code == 404

    monkeypatch.setattr("data_formulator.routes.configurations.can_configure", lambda: False)
    assert client.post("/api/sessions/examples", json={"workspace_id": "session_demo"}).get_json()["error"]["code"] == "ACCESS_DENIED"
    assert client.delete(f"/api/sessions/examples/{published['id']}").get_json()["error"]["code"] == "ACCESS_DENIED"
    monkeypatch.setattr("data_formulator.routes.configurations.can_configure", lambda: True)
    client.delete(f"/api/sessions/examples/{published['id']}")
    assert client.get("/api/sessions/examples").get_json()["data"]["examples"] == []
    assert client.get(f"/api/sessions/examples/{published['id']}").get_json()["error"]["code"] == "TABLE_NOT_FOUND"