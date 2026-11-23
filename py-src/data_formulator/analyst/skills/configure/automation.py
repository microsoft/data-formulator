"""Workflow and schedule setup for the configure skill."""

from __future__ import annotations

from typing import Any, Generator

from data_formulator.analyst import names
from data_formulator.analyst.skills.base import Event, SkillContext

from .forms import form_payload, identity_of

WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def workflows_unavailable() -> str | None:
    from data_formulator.auth.identity import is_local_mode
    from data_formulator.configuration import is_managed_mode

    if is_local_mode() or is_managed_mode():
        return None
    return "Workflows require local or managed mode."


def workflow_store(ctx: SkillContext):
    from data_formulator.datalake.workspace import get_user_home
    from data_formulator.workflows.instances import WorkflowStore

    return WorkflowStore(get_user_home(identity_of(ctx)))


def store_path(path: Any) -> Any:
    """A workflow path as the store and schedules know it: ``workflows://demo/x.yaml`` (or the older
    ``workflows/demo/x.yaml``) -> ``demo/x.yaml``."""
    if not isinstance(path, str):
        return path
    path = names.canonical(path)
    return path[len(names.WORKFLOWS):] if path.startswith(names.WORKFLOWS) else path


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
        replaces = store_path(spec["replaces"])
        saved = next((item for item in workflow_store(ctx).list_all()
                      if item["path"] == replaces and item.get("origin") == "user"), None)
        if saved is None:
            return (f"Workflow {spec['replaces']!r} is not one of the user's saved workflows. "
                    "List workflows:// with list_files, or omit replaces to propose a new workflow.")
        body["target"] = {"id": saved["path"], "name": saved.get("name") or saved["path"],
                          **({"schedule": saved["schedule"]} if saved.get("schedule") else {})}
    if "schedule" in definition:
        issues, error = _schedule_issues(definition)
        if error:
            return error
        body["schedule_issues"] = issues
    yield {"type": "completion", "status": "success", "content": {
        "summary": spec.get("summary") or f"Proposed workflow: {definition['name']}",
        "form": form_payload("workflow", title=definition["name"], body=body),
        "total_steps": ctx.payload.get("completed_step_count", 0),
    }}
    return None


def _schedule_issues(definition: dict[str, Any]) -> tuple[list[str], str | None]:
    """What the user must fix in the proposed schedule before saving, or an error when this app cannot schedule."""
    from data_formulator.model_registry import model_registry
    from data_formulator.workflows.instances import schedule_problems
    from data_formulator.workflows.scheduler import SCHEDULING_LOCAL_ONLY, scheduling_available

    if not scheduling_available():
        return [], f"{SCHEDULING_LOCAL_ONLY} Propose the workflow without a schedule and tell the user why."
    issues = schedule_problems(definition)
    model_id = definition["schedule"].get("model_id")
    if model_id and model_registry.get_config(str(model_id)) is None:
        issues.append("Choose a server-configured model connection.")
    return issues, None


def cadence(config: dict[str, Any]) -> str:
    days = sorted(config.get("weekdays") or [])
    label = ("Daily" if len(days) == 7 else "Weekdays" if days == [0, 1, 2, 3, 4]
             else ", ".join(WEEKDAY_NAMES[day] for day in days if 0 <= day <= 6))
    return f"{label} at {config.get('time', '?')} ({config.get('timezone', 'local time')})"


def schedule_states(ctx: SkillContext) -> dict[str, dict[str, Any]]:
    """Each scheduled workflow's state in the scheduler, by store path: next run (None when paused) and the latest
    runs. Empty where scheduling is unavailable."""
    from data_formulator.spaces import current_space
    from data_formulator.workflows.scheduler import schedule_store, scheduling_available

    if not scheduling_available():
        return {}
    store = schedule_store()
    return {row["workflow"]: {
        "next_at": row["next_at"] if row["enabled"] else None,
        "recent_runs": [run["status"] for run in store.history(row["id"]) if run["status"] != "skipped"][:3],
    } for row in store.list(identity_of(ctx), current_space()) if row["scheduled"]}
