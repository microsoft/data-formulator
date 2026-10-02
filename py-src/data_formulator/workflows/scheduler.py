from __future__ import annotations

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from filelock import FileLock, Timeout

from data_formulator.auth.identity import _scheduled_identity, is_local_mode
from data_formulator.configuration import configuration_path, is_managed_mode
from data_formulator.workflows.scheduling import ScheduleStore

logger = logging.getLogger(__name__)
_startup_lock = threading.Lock()
RUN_TIME_LIMIT = timedelta(hours=2)
PAUSE_GRACE_SECONDS = 60


def scheduling_available() -> bool:
    from data_formulator.workspace_factory import _get_backend
    return (_get_backend() != "ephemeral" and (is_local_mode() or
            is_managed_mode() and os.environ.get("DF_SCHEDULER_ENABLED") == "1"))


def schedule_store() -> ScheduleStore:
    return ScheduleStore(configuration_path().parent)


def execution_identity(schedule: dict) -> str:
    return schedule["owner"] if schedule["owner"].startswith("local:") else "schedule:" + schedule["id"]


def schedule_model_id(config: dict) -> str:
    """The schedule's model, or the server's default model when that one was removed or disabled."""
    from data_formulator.model_registry import model_registry
    if model_registry.get_config(config["model_id"]) is not None:
        return config["model_id"]
    available = model_registry.list_public()
    if not available:
        raise ValueError("No server-configured model is available.")
    logger.warning("Schedule model %s is unavailable; using %s", config["model_id"], available[0]["id"])
    return available[0]["id"]


def materialize_session(schedule: dict, occurrence: dict, state: dict, workspace, *, read_only: bool) -> dict:
    def rows(table_name: str) -> list:
        frame = workspace.read_data_as_df(table_name)
        if len(frame) > 100000:
            raise ValueError("Scheduled snapshots support at most 100,000 rows per table.")
        return json.loads(frame.to_json(orient="records", date_format="iso"))

    # Mirrors the outputs a live run adds to the thread, with rows inline so shared copies need no workspace.
    artifacts = []
    for output in state.get("outputs", []):
        if output["type"] == "report":
            artifacts.append({"kind": "report", "content": output["content"]})
        elif output["type"] == "tool_result" and output.get("tool") in ("create_data", "update_data"):
            metadata = json.loads(output.get("stdout") or "{}")
            if metadata.get("table_name"):
                artifacts.append({"kind": "data", "tableId": metadata["table_name"], "rows": rows(metadata["table_name"]),
                                  "displayName": metadata.get("display_name") or metadata["table_name"]})
        elif output["type"] == "result":
            result = output["content"]["result"]
            table_name = result["content"]["virtual"]["table_name"]
            goal = result["refined_goal"]
            artifacts.append({"kind": "chart", "id": result["chart_id"], "tableId": table_name, "rows": rows(table_name),
                              "question": output["content"].get("question"), "inputSources": output.get("input_sources", []),
                              "code": result.get("code"),
                              "goal": {key: goal[key] for key in ("chart", "title", "subtitle", "display_name", "output_variable") if key in goal}})
    provenance = {"scheduleId": schedule["id"], "scheduleName": schedule["config"]["name"],
                  "scheduledFor": occurrence["scheduled_for"]}
    local = datetime.fromisoformat(occurrence["scheduled_for"]).astimezone(ZoneInfo(schedule["config"]["timezone"]))
    title = f"{schedule['config']['name']} ({local:%b} {local.day}, {local:%H:%M})"
    return {"activeWorkspace": {"id": "scheduled-" + occurrence["id"], "displayName": title,
                                "scheduledRun": provenance, "readOnly": read_only},
            "scheduledArtifacts": artifacts,
            "textTurns": [{"id": "scheduled-summary-" + occurrence["id"], "kind": "text", "textKind": "explain",
                           "displayId": schedule["config"]["name"], "content": state.get("message") or "Scheduled run: " + state["status"],
                           "createdAt": int(datetime.fromisoformat(occurrence["scheduled_for"]).timestamp() * 1000)}]}


def run_finished(path, deadline: float) -> bool:
    try:
        with FileLock(str(path) + ".lock", timeout=max(0.0, deadline - time.monotonic())):
            return True
    except Timeout:
        return False


def execute_occurrence(app, store: ScheduleStore, occurrence: dict):
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.errors import AppError
    from data_formulator.routes.workflows import EXECUTOR_BUSY, _cancellations, _lock, run_instance, run_path, save_run
    from data_formulator.workflows.agent import new_run
    from data_formulator.workflows.instances import WorkflowStore, parse_definition
    from data_formulator.workspace_factory import get_workspace_manager

    with app.app_context():
        schedule = store.get(occurrence["schedule_id"])
        config = schedule["config"]
        identity = execution_identity(schedule)
        workspace_id = "scheduled-" + occurrence["id"]
        token = _scheduled_identity.set(identity)
        deadline = time.monotonic() + RUN_TIME_LIMIT.total_seconds()
        manager = workspace = state = snapshot = None

        def persist(read_only: bool):
            nonlocal snapshot
            snapshot = materialize_session(schedule, occurrence, state, workspace, read_only=read_only)
            manager.save_session_state(workspace_id, snapshot)

        def retry_later(message: str, delay_seconds: float) -> bool:
            if occurrence["attempts"] >= config.get("max_retries", 2):
                return False
            retry_at = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
            store.finish(occurrence, "retry", message, retry_at=retry_at.isoformat())
            return True

        try:
            if not scheduling_available() or not schedule["enabled"]:
                raise ValueError("Scheduling is disabled.")
            model_id = schedule_model_id(config)
            manager = get_workspace_manager(identity)
            if not manager.workspace_exists(workspace_id):
                manager.create_workspace(workspace_id)
            workspace = manager.open_workspace(workspace_id, identity)
            path = run_path(workspace, occurrence["id"])
            if not path.exists():
                if occurrence["attempts"]:
                    raise ValueError("Retry checkpoint is unavailable; inspect prior effects before restarting.")
                workflow = parse_definition(WorkflowStore(get_user_home(identity)).read(config["workflow"]))
                state = new_run(workflow, occurrence["id"], config.get("setup"))
                state["workflow_path"] = config["workflow"]
                save_run(path, state)
            state = json.loads(path.read_text())
            persist(read_only=True)
            response_body = {}
            while True:
                body = {"run_id": occurrence["id"], "model": {"id": model_id, "is_global": True}, **response_body}
                error = None
                with app.test_request_context("/api/workflows/run", method="POST", json=body,
                        base_url="http://localhost", headers={"X-Workspace-Id": workspace_id, "Origin": "http://localhost"},
                        environ_base={"REMOTE_ADDR": "127.0.0.1"}):
                    try:
                        response = run_instance()
                    except AppError as exc:
                        if exc.code != EXECUTOR_BUSY:
                            raise
                        if not retry_later("Workflow executor busy", 60):
                            persist(read_only=False)
                            store.finish(occurrence, "needs_attention", "The workflow executor was busy; run it manually or wait for the next occurrence.")
                        return
                    try:
                        for line in response.response:
                            event = json.loads(line)
                            if event.get("type") == "error":
                                error = event.get("error", {})
                            if time.monotonic() > deadline:
                                break
                    finally:
                        response.close()
                # The update stream can end early for slow readers; the run lock marks true completion.
                if not run_finished(path, deadline):
                    with _lock:
                        cancellation = _cancellations.get(str(path))
                        if cancellation:
                            cancellation.set()
                    path.with_suffix(".pause").touch()
                    run_finished(path, time.monotonic() + PAUSE_GRACE_SECONDS)
                    state = json.loads(path.read_text())
                    persist(read_only=False)
                    store.finish(occurrence, "needs_attention", "The run exceeded its time limit and was paused.")
                    return
                state = json.loads(path.read_text())
                if state["status"] == "completed":
                    persist(read_only=False)
                    if config.get("publish"):
                        shared = json.loads(json.dumps(snapshot))
                        shared["activeWorkspace"].update(id="shared-" + schedule["id"], readOnly=True, displayName=config["name"])
                        shared["textTurns"][0]["content"] = "Scheduled run: completed"
                        store.publish(schedule["id"], shared)
                    store.finish(occurrence, "completed")
                    return
                if error:
                    retryable = error.get("retry") and not state.get("terminal_request") and not state.get("interaction")
                    if retryable and occurrence["attempts"] < config.get("max_retries", 2):
                        persist(read_only=True)
                        retry_later("Transient model error", 30 * 2 ** occurrence["attempts"])
                    else:
                        persist(read_only=False)
                        store.finish(occurrence, "needs_attention", "Model execution needs attention.")
                    return
                response_body = automatic_response(state, config)
                if not response_body or path.with_suffix(".pause").exists():
                    persist(read_only=False)
                    store.finish(occurrence, "needs_attention", "Open the private run session to review the checkpoint.")
                    return
                persist(read_only=True)
        except Exception:
            logger.exception("Scheduled occurrence %s needs attention", occurrence["id"])
            if snapshot is not None:
                try:
                    snapshot["activeWorkspace"]["readOnly"] = False
                    manager.save_session_state(workspace_id, snapshot)
                except Exception:
                    logger.exception("Could not unlock scheduled session %s", workspace_id)
            store.finish(occurrence, "needs_attention", "Check model, workflow, source access, and output limits.")
        finally:
            _scheduled_identity.reset(token)


def automatic_response(state: dict, config: dict) -> dict:
    if not config.get("auto_approve"):
        return {}
    terminal = state.get("terminal_request")
    if terminal and is_local_mode() and not terminal.get("execution_started"):
        return {"terminal_response": {"request_id": terminal["id"], "decision": "approve"}}
    operation = (state.get("interaction") or {}).get("data_operation") or {}
    plans = operation.get("plans", [])
    if len(plans) == 1 and operation.get("id"):
        return {"interaction_response": {"operation_id": operation["id"], "plan_id": plans[0]["id"]}}
    return {}


def start_scheduler(app):
    with _startup_lock, app.app_context():
        if not scheduling_available() or "workflow_scheduler" in app.extensions:
            return
        store = schedule_store()
        lease = FileLock(str(store.root / "dispatcher.lock"), thread_local=False)
        try:
            lease.acquire(timeout=0)
        except Timeout:
            return
        store.recover()
        executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="workflow-schedule")
        scheduler = BackgroundScheduler(timezone="UTC", daemon=True)

        def tick():
            with app.app_context():
                if not scheduling_available():
                    return
                for occurrence in store.claim_due(datetime.now(timezone.utc)):
                    executor.submit(execute_occurrence, app, store, occurrence)

        scheduler.add_job(tick, "interval", seconds=10, max_instances=1, coalesce=True)
        app.extensions["workflow_scheduler"] = (scheduler, lease, executor)
        scheduler.start()


def stop_scheduler(app):
    from data_formulator.routes.workflows import _cancellations, _lock
    with _lock:
        for cancellation in _cancellations.values():
            cancellation.set()
    service = app.extensions.get("workflow_scheduler")
    if service is None:
        return
    scheduler, _, executor = service
    scheduler.shutdown(wait=False)
    executor.shutdown(wait=False, cancel_futures=True)