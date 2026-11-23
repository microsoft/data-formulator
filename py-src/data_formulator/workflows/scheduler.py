from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from filelock import FileLock, Timeout

from data_formulator.auth.identity import _scheduled_identity, is_local_mode
from data_formulator.configuration import configuration_path
from data_formulator.spaces import in_scope
from data_formulator.workflows.scheduling import ScheduleStore

logger = logging.getLogger(__name__)
_startup_lock = threading.Lock()
RUN_TIME_LIMIT = timedelta(hours=2)
PAUSE_GRACE_SECONDS = 60
SCHEDULING_LOCAL_ONLY = ("Scheduling runs workflows unattended on your own machine, "
                         "so it is only available in the local Data Formulator app.")


def scheduling_available() -> bool:
    from data_formulator.workspace_factory import _get_backend
    return _get_backend() != "ephemeral" and is_local_mode()


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


def run_session_state(schedule: dict, occurrence: dict, state: dict, *, read_only: bool) -> dict:
    """The session a scheduled run saves; opening it rebuilds the run's outputs from its checkpoint, like a live run.
    It is named after the workflow (in the run's language)."""
    name = (state.get("instance") or {}).get("name") or Path(schedule["config"]["workflow"]).stem
    provenance = {"scheduleId": schedule["id"], "scheduleName": name, "workflow": schedule["config"]["workflow"],
                  "scheduledFor": occurrence["scheduled_for"]}
    local = datetime.fromisoformat(occurrence["scheduled_for"]).astimezone(ZoneInfo(schedule["config"]["timezone"]))
    title = f"{name} ({local:%b} {local.day}, {local:%H:%M})"
    return {"activeWorkspace": {"id": "scheduled-" + occurrence["id"], "displayName": title,
                                "scheduledRun": provenance, "readOnly": read_only},
            "textTurns": [{"id": "scheduled-summary-" + occurrence["id"], "kind": "text", "textKind": "explain",
                           "displayId": name, "content": state.get("message") or "Scheduled run: " + state["status"],
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
        # A schedule made in a space runs in the space's storage (its workflows and run sessions).
        scope = in_scope(config.get("site"))
        scope.__enter__()
        # A schedule stores its space as ``site`` (named before spaces were).
        space = {"X-DF-Space": config["site"]} if config.get("site") else {}
        identity = execution_identity(schedule)
        workspace_id = "scheduled-" + occurrence["id"]
        token = _scheduled_identity.set(identity)
        deadline = time.monotonic() + RUN_TIME_LIMIT.total_seconds()
        manager = workspace = state = snapshot = None

        def persist(read_only: bool):
            nonlocal snapshot
            snapshot = run_session_state(schedule, occurrence, state, read_only=read_only)
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
            workflow = None
            if not occurrence["attempts"]:
                # The workflow file is the schedule's definition: run what it says now, or not at all.
                try:
                    workflow = parse_definition(WorkflowStore(get_user_home(identity)).read(config["workflow"]))
                except (FileNotFoundError, ValueError):
                    workflow = {}
                block = workflow.get("schedule")
                if not block or not block.get("enabled", True):
                    store.sync(schedule["owner"], config.get("site"), config["workflow"], block)
                    store.finish(occurrence, "skipped", "The workflow is no longer scheduled.")
                    return
                if {**block, "workflow": config["workflow"], **({"site": config["site"]} if config.get("site") else {})} != config:
                    config = store.sync(schedule["owner"], config.get("site"), config["workflow"], block)["config"]
                    schedule = {**schedule, "config": config}
            model_id = schedule_model_id(config)
            manager = get_workspace_manager(identity)
            if not manager.workspace_exists(workspace_id):
                manager.create_workspace(workspace_id)
            workspace = manager.open_workspace(workspace_id, identity)
            path = run_path(workspace, occurrence["id"])
            if not path.exists():
                if occurrence["attempts"] or workflow is None:
                    raise ValueError("Retry checkpoint is unavailable; inspect prior effects before restarting.")
                state = new_run(workflow, occurrence["id"], config.get("setup"), config.get("language", "en"), require_values=False)
                state["workflow_path"] = config["workflow"]
                save_run(path, state)
            state = json.loads(path.read_text(encoding="utf-8"))
            persist(read_only=True)
            response_body = {}
            while True:
                body = {"run_id": occurrence["id"], "model": {"id": model_id, "is_global": True}, **response_body}
                error = None
                with app.test_request_context("/api/workflows/run", method="POST", json=body,
                        base_url="http://localhost", headers={"X-Workspace-Id": workspace_id, "Origin": "http://localhost", **space},
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
                    state = json.loads(path.read_text(encoding="utf-8"))
                    persist(read_only=False)
                    store.finish(occurrence, "needs_attention", "The run exceeded its time limit and was paused.")
                    return
                state = json.loads(path.read_text(encoding="utf-8"))
                if state["status"] == "completed":
                    persist(read_only=False)
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
            scope.__exit__(None, None, None)


DECLINED_LOADING = ("This is an unattended scheduled run and its schedule does not approve requests, so no loading option "
                    "was chosen and nothing was loaded. Continue without this data, or finish with what you have and say what was skipped.")


def automatic_response(state: dict, config: dict) -> dict:
    """How an unattended run answers a request for approval. With ``auto_approve`` it approves a command and takes the
    first loading option; without, it declines both so the run continues. Questions for the user, and a command that
    already started, wait for the user (empty response)."""
    approve = config.get("auto_approve") is True
    terminal = state.get("terminal_request")
    if terminal:
        if terminal.get("execution_started") or not is_local_mode():
            return {}
        return {"terminal_response": {"request_id": terminal["id"], "decision": "approve" if approve else "reject"}}
    operation = (state.get("interaction") or {}).get("data_operation") or {}
    plans = operation.get("plans", [])
    if operation.get("id") and plans:
        return {"interaction_response": {"operation_id": operation["id"], "plan_id": plans[0]["id"]}} if approve \
            else {"reply": DECLINED_LOADING}
    return {}


def reconcile_runs(store: ScheduleStore, schedules: list[dict]):
    """Local run sessions are authoritative: drop runs whose session was deleted and resolve runs completed after
    resuming. ``schedules`` are index rows with their ``history``, updated in place."""
    from data_formulator.routes.sessions import scheduled_checkpoint
    from data_formulator.workspace_factory import get_workspace_manager

    for schedule in schedules:
        finished = [occurrence for occurrence in schedule["history"] if occurrence["status"] in ("completed", "needs_attention", "failed")]
        if not finished:
            continue
        identity = execution_identity(schedule)
        manager = get_workspace_manager(identity)
        for occurrence in finished:
            workspace_id = "scheduled-" + occurrence["id"]
            if not manager.workspace_exists(workspace_id):
                store.forget(occurrence["id"])
                schedule["history"].remove(occurrence)
                continue
            if occurrence["status"] != "needs_attention":
                continue
            run = scheduled_checkpoint(manager, workspace_id, identity)
            if run and run.get("status") == "completed":
                store.resolve(occurrence["id"])
                occurrence.update(status="completed", message="Completed after resuming in the session.")


def _user_schedules(files) -> dict[str, dict | None]:
    return {item["path"]: item.get("schedule") for item in files.list_all()
            if item.get("origin") == "user" and "error" not in item}


def rebuild_index(store: ScheduleStore):
    """Sync the index with the workflow files of every scope that has schedules, and the local user's standard app
    (files may have been edited while the app was stopped). Other scopes sync when their workflows are listed."""
    from data_formulator.auth import identity as identities
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore

    scopes = set(store.scopes())
    if identities._localhost_identity:
        scopes.add((identities._localhost_identity, None))
    for owner, site in scopes:
        try:
            with in_scope(site):
                store.rebuild(owner, site, _user_schedules(WorkflowStore(get_user_home(owner))))
        except Exception:
            logger.exception("Could not sync the schedules of %s", site or "the standard app")


def _copy_name(files, workflow: str) -> str:
    stem = Path(workflow).name
    for suffix in (".workflow.yaml", ".workflow.yml", ".yaml", ".yml"):
        stem = stem.removesuffix(suffix)
    name, number = f"{stem}.workflow.yaml", 2
    while files.files.exists(name):
        name, number = f"{stem}-{number}.workflow.yaml", number + 1
    return name


def migrate_to_files(store: ScheduleStore):
    """Move schedules made before design-docs/78 into their workflow files, once. A workflow keeps one schedule (the
    enabled one that runs next); a demo or server workflow, or a workflow's other schedules, get a copy each."""
    import shutil
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore, parse_definition, set_schedule

    if store.moved_to_files():
        return
    rows = store.all_rows()
    if rows:
        shutil.copy2(store.path, store.path.with_name(store.path.name + ".bak-before-files"))
    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        groups.setdefault((row["owner"], row["site"] or None, row["workflow"]), []).append(row)
    for (owner, site, workflow), group in groups.items():
        group.sort(key=lambda row: (not row["enabled"], row["next_at"]))
        with in_scope(site):
            files = WorkflowStore(get_user_home(execution_identity(group[0])))
            for index, row in enumerate(group):
                block = {key: value for key, value in row["config"].items() if key not in ("name", "workflow", "site")}
                block["enabled"] = row["enabled"]
                try:
                    content = files.read(workflow)
                    in_place = index == 0 and not workflow.startswith(("demo/", "server/")) \
                        and parse_definition(content).get("schedule") is None
                    target = workflow if in_place else _copy_name(files, workflow)
                    files.save(target, set_schedule(content, block))
                    if target != workflow:
                        store.retarget(row["id"], target)
                    store.sync(owner, site, target, block)
                    logger.info("Moved schedule %r into workflow %s", row["config"].get("name"), target)
                except Exception:
                    logger.exception("Could not move schedule %r into a workflow file; it is off", row["config"].get("name"))
                    store.retarget(row["id"], workflow, scheduled=False)
    store.mark_moved_to_files()


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
        try:
            migrate_to_files(store)
        except Exception:
            logger.exception("Could not move schedules into workflow files")
        rebuild_index(store)
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
    service = app.extensions.pop("workflow_scheduler", None)
    if service is None:
        return
    scheduler, lease, executor = service
    scheduler.shutdown(wait=False)
    executor.shutdown(wait=False, cancel_futures=True)
    lease.release()