from flask import Blueprint, request
from urllib.parse import urlsplit

from data_formulator.auth.identity import get_identity_id, is_local_mode
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.routes.configurations import can_configure
from data_formulator.workflows.scheduler import schedule_store, scheduling_available

schedule_bp = Blueprint("schedules", __name__, url_prefix="/api/schedules")


def schedule_owner():
    if not scheduling_available():
        raise AppError(ErrorCode.ACCESS_DENIED, "Scheduling requires persistent storage; hosted scheduling must be enabled by the operator.")
    if is_local_mode():
        return get_identity_id()
    if not can_configure():
        raise AppError(ErrorCode.ACCESS_DENIED, "Only administrators can manage hosted schedules.")
    return "admin"


@schedule_bp.route("", methods=["GET"])
def list_schedules():
    allowed = scheduling_available() and (is_local_mode() or can_configure())
    if not allowed:
        return json_ok({"available": False, "schedules": []})
    store = schedule_store()
    schedules = [{**schedule, "history": store.history(schedule["id"])} for schedule in store.list(schedule_owner())]
    if is_local_mode():
        reconcile_resumed_runs(store, schedules)
    return json_ok({"available": True, "hosted": not is_local_mode(), "schedules": schedules})


def reconcile_resumed_runs(store, schedules: list[dict]):
    """Local run sessions are authoritative: drop runs whose session was deleted and resolve runs completed after resuming."""
    from data_formulator.routes.sessions import scheduled_checkpoint
    from data_formulator.workflows.scheduler import execution_identity
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


@schedule_bp.route("", methods=["POST"])
def save_schedule():
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.model_registry import model_registry
    from data_formulator.workflows.instances import WorkflowStore, parse_definition, resolve_setup
    from data_formulator.workflows.scheduling import schedule_trigger

    owner = schedule_owner()
    body = request.get_json() or {}
    if not isinstance(body, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "Provide a schedule object.")
    origin = request.headers.get("Origin")
    if request.headers.get("Sec-Fetch-Site") == "cross-site" or (
        is_local_mode() and origin and urlsplit(origin).hostname not in {"localhost", "127.0.0.1", "::1"}
    ):
        raise AppError(ErrorCode.ACCESS_DENIED, "Schedules must be managed from the application.")
    config = body.get("config")
    try:
        schedule_trigger(config)
        if owner == "admin" and not config["workflow"].startswith(("demo/", "server/")):
            raise ValueError("Hosted schedules require an installation workflow.")
        if config.get("enabled", True):
            if model_registry.get_config(config["model_id"]) is None:
                raise ValueError("Choose a server-configured model connection.")
            workflow = parse_definition(WorkflowStore(get_user_home(get_identity_id())).read(config["workflow"]))
            resolve_setup(workflow, config.get("setup"))
        saved = schedule_store().save(owner, config, identifier=body.get("id"))
    except (ValueError, TypeError, FileNotFoundError) as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    return json_ok({"schedule": saved})


@schedule_bp.route("/<identifier>", methods=["DELETE"])
def delete_schedule(identifier: str):
    owner = schedule_owner()
    if request.headers.get("Sec-Fetch-Site") == "cross-site":
        raise AppError(ErrorCode.ACCESS_DENIED, "Schedules must be managed from the application.")
    try:
        schedule_store().delete(owner, identifier)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    return json_ok({"id": identifier})


@schedule_bp.route("/<identifier>/publication", methods=["DELETE"])
def withdraw_publication(identifier: str):
    owner = schedule_owner()
    if request.headers.get("Sec-Fetch-Site") == "cross-site":
        raise AppError(ErrorCode.ACCESS_DENIED, "Schedules must be managed from the application.")
    try:
        schedule_store().withdraw(owner, identifier)
    except ValueError as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, str(exc)) from exc
    return json_ok({"id": identifier})