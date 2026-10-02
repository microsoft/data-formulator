"""Workflow and schedule setup for the configure skill."""

from __future__ import annotations

import re
from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext

from .forms import form_event, form_payload, identity_of, review_requested

WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_SCHEDULE_OPTIONS = ("enabled", "catch_up", "auto_approve", "publish")


def workflows_unavailable() -> str | None:
    from data_formulator.auth.identity import is_local_mode
    from data_formulator.configuration import is_managed_mode

    if is_local_mode() or is_managed_mode():
        return None
    return "Workflows require local or managed mode."


def _workflow_store(ctx: SkillContext):
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore

    return WorkflowStore(get_user_home(identity_of(ctx)))


def list_workflows(ctx: SkillContext) -> dict[str, Any]:
    if error := workflows_unavailable():
        return {"error": error}
    items = _workflow_store(ctx).list_all()
    return {
        "workflows": [
            {key: item[key] for key in ("path", "name", "overview", "origin", "parameters", "error") if key in item}
            for item in items
        ],
        "note": "Schedules and runs reference a workflow by its path. Built-in examples use demo/ paths.",
    }


def propose_workflow(spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
    import yaml
    from data_formulator.workflows.instances import validate_workflow_definition

    if workflows_unavailable():
        return "Workflow authoring requires local or managed mode."
    try:
        definition = validate_workflow_definition(spec.get("definition"), authored=True)
        content = yaml.safe_dump(definition, sort_keys=False, allow_unicode=True)
        if len(content) > 48000:
            raise ValueError("Workflow exceeds 48,000 characters.")
    except ValueError as exc:
        return f"Invalid workflow definition: {exc}. Revise the complete proposal."
    body: dict[str, Any] = {"content": content, "definition": definition}
    if spec.get("replaces"):
        saved = next((item for item in _workflow_store(ctx).list_all()
                      if item["path"] == spec["replaces"] and item.get("origin") == "user"), None)
        if saved is None:
            return (f"Workflow {spec['replaces']!r} is not one of the user's saved workflows. "
                    "Call list_workflows, or omit replaces to propose a new workflow.")
        body["target"] = {"id": saved["path"], "name": saved.get("name") or saved["path"]}
    yield {"type": "completion", "status": "success", "content": {
        "summary": spec.get("summary") or f"Proposed workflow: {definition['name']}",
        "form": form_payload("workflow", title=definition["name"], body=body),
        "total_steps": ctx.payload.get("completed_step_count", 0),
    }}
    return None


def _schedule_scope(ctx: SkillContext) -> tuple[str | None, bool, str | None]:
    """Return ``(owner, hosted, error)`` using the schedule routes' access policy."""
    from data_formulator.auth.identity import is_local_mode
    from data_formulator.workflows.scheduler import scheduling_available

    if not scheduling_available():
        return None, False, ("Scheduling is unavailable: it requires persistent storage, "
                             "and hosted scheduling must be enabled by the operator.")
    if is_local_mode():
        return identity_of(ctx), False, None
    from data_formulator.routes.configurations import can_configure
    if not can_configure():
        return None, True, "Only administrators can manage hosted schedules."
    return "admin", True, None


def cadence(config: dict[str, Any]) -> str:
    days = sorted(config.get("weekdays") or [])
    label = ("Daily" if len(days) == 7 else "Weekdays" if days == [0, 1, 2, 3, 4]
             else ", ".join(WEEKDAY_NAMES[day] for day in days if 0 <= day <= 6))
    return f"{label} at {config.get('time', '?')} ({config.get('timezone', 'local time')})"


def _server_models() -> list[dict[str, Any]]:
    from data_formulator.model_registry import model_registry

    return [{"id": model["id"], "model": model.get("model"), "provider": model.get("provider_display") or model.get("endpoint")}
            for model in model_registry.list_public()]


def list_schedules(ctx: SkillContext) -> dict[str, Any]:
    from data_formulator.workflows.scheduler import schedule_store

    owner, hosted, error = _schedule_scope(ctx)
    if error:
        return {"available": False, "error": error}
    store = schedule_store()
    schedules = []
    for schedule in store.list(owner):
        config = schedule["config"]
        runs = [run for run in store.history(schedule["id"]) if run["status"] != "skipped"][:3]
        schedules.append({
            "id": schedule["id"], "name": config["name"], "workflow": config["workflow"],
            "cadence": cadence(config), "time": config["time"], "weekdays": config["weekdays"],
            "timezone": config["timezone"], "model_id": config["model_id"],
            "enabled": schedule["enabled"], "next_at": schedule["next_at"] if schedule["enabled"] else None,
            "options": {key: bool(config.get(key, key == "enabled")) for key in _SCHEDULE_OPTIONS},
            "recent_runs": [{"scheduled_for": run["scheduled_for"], "status": run["status"], "message": run["message"]}
                            for run in runs],
        })
    return {
        "available": True, "hosted": hosted, "schedules": schedules,
        "server_models": _server_models(),
        "weekdays": "0=Mon … 6=Sun",
        "note": ("Hosted schedules must use built-in or server workflows and publish results."
                 if hosted else "Schedules run saved workflows unattended in new sessions."),
    }


def _schedule_changes(spec: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Validate the provided schedule fields; return ``(config_patch, issues)``.

    Structural errors raise ``ValueError``; missing or unverifiable values become
    ``issues`` the user resolves in the form.
    """
    from zoneinfo import ZoneInfo

    patch: dict[str, Any] = {}
    issues: list[str] = []
    for key in ("name", "workflow"):
        if key in spec:
            value = spec[key]
            if not isinstance(value, str) or not value.strip() or len(value) > 200:
                raise ValueError(f"{key} must be a non-empty string of at most 200 characters")
            patch[key] = value.strip()
    if "time" in spec:
        if not isinstance(spec["time"], str) or not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", spec["time"]):
            raise ValueError("time must use 24-hour HH:MM")
        patch["time"] = spec["time"]
    if "weekdays" in spec:
        days = spec["weekdays"]
        if (not isinstance(days, list) or not days or len(set(days)) != len(days)
                or any(not isinstance(day, int) or isinstance(day, bool) or not 0 <= day <= 6 for day in days)):
            raise ValueError("weekdays must be unique integers from 0 (Monday) to 6 (Sunday)")
        patch["weekdays"] = sorted(days)
    if spec.get("timezone"):
        try:
            ZoneInfo(str(spec["timezone"]))
            patch["timezone"] = str(spec["timezone"])
        except (KeyError, ValueError):
            issues.append(f"Unknown timezone {spec['timezone']!r}; choose an IANA timezone.")
    if spec.get("model_id"):
        from data_formulator.model_registry import model_registry
        if model_registry.get_config(str(spec["model_id"])) is None:
            issues.append("Choose a server-configured model connection.")
        else:
            patch["model_id"] = str(spec["model_id"])
    for key in _SCHEDULE_OPTIONS:
        if key in spec:
            if not isinstance(spec[key], bool):
                raise ValueError(f"{key} must be a boolean")
            patch[key] = spec[key]
    if "setup" in spec:
        setup = spec["setup"]
        if not isinstance(setup, dict) or set(setup) - {"parameters", "instructions"}:
            raise ValueError("setup must contain parameters and optional instructions")
        patch["setup"] = {"parameters": dict(setup.get("parameters") or {}),
                          "instructions": str(setup.get("instructions") or "")}
    return patch, issues


def propose_schedule(spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
    from data_formulator.workflows.instances import parse_definition, resolve_setup
    from data_formulator.workflows.scheduler import schedule_store

    owner, hosted, error = _schedule_scope(ctx)
    if error:
        return error
    try:
        review = review_requested(spec)
        patch, issues = _schedule_changes(spec)
    except ValueError as exc:
        return f"Invalid schedule proposal: {exc}."

    schedule_id = spec.get("schedule_id")
    config: dict[str, Any] = {}
    target = None
    if schedule_id:
        existing = next((item for item in schedule_store().list(owner) if item["id"] == schedule_id), None)
        if existing is None:
            return f"Schedule {schedule_id!r} was not found. Call list_schedules for current IDs."
        config = dict(existing["config"])
        target = {"id": schedule_id, "name": existing["config"].get("name") or schedule_id}
    config.update(patch)

    store = _workflow_store(ctx)
    workflows = {item["path"]: item for item in store.list_all() if "error" not in item}
    workflow = None
    if config.get("workflow"):
        workflow = workflows.get(config["workflow"])
        if workflow is None:
            return ("Unknown workflow path. Schedules run saved workflows: call list_workflows, or propose and "
                    "save a workflow before scheduling it.")
        if hosted and not config["workflow"].startswith(("demo/", "server/")):
            return "Hosted schedules require a built-in or server workflow."
        config.setdefault("name", workflow["name"])
        try:
            resolve_setup(parse_definition(store.read(config["workflow"])), config.get("setup"))
        except ValueError as exc:
            issues.append(str(exc))
    else:
        # The form lists saved workflows; the user picks one there.
        issues.append("Choose the saved workflow to run.")
    if hosted:
        config["publish"] = True
    # Unspecified timing falls back to the form's defaults, which the user confirms.
    complete = all(key in config for key in ("time", "weekdays"))
    elevated = bool(config.get("auto_approve") or config.get("publish"))
    auto_submit = not review and complete and not elevated and not issues
    body = {
        **({"target": target} if target else {}),
        "config": config,
        **({"workflow_name": workflow["name"]} if workflow else {}),
        "hosted": hosted,
        "issues": issues,
    }
    verb = "Update" if schedule_id else "Schedule"
    subject = workflow["name"] if workflow else "a workflow"
    yield form_event(
        "schedule", ctx,
        title=f"{verb} {config.get('name') or subject}",
        body=body,
        default_response=(
            f"Saving the schedule for {subject}." if auto_submit
            else f"Review the schedule for {subject} and save it to start unattended runs."
        ),
        auto_submit=auto_submit,
    )
    return None
