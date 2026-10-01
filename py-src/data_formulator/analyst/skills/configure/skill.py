"""Configure skill — set up and manage Data Formulator on the user's behalf.

Every capability follows one pattern: read-only inspection tools gather the
current setup, and each committing action publishes a prefilled setup form
artifact (see ``forms.py``) that the user reviews and submits, or that the
frontend submits automatically when the agent is certain and the change is
safe to apply directly.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Generator

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult

from . import automation, connections, sessions

_TOOLS: dict[str, Callable[[dict[str, Any], SkillContext], dict[str, Any]]] = {
    "list_connectors": lambda args, ctx: connections.list_connectors(),
    "describe_connector": lambda args, ctx: connections.describe_connector(args),
    "read_connector_form": lambda args, ctx: connections.read_connector_form(ctx),
    "list_workflows": lambda args, ctx: automation.list_workflows(ctx),
    "list_schedules": lambda args, ctx: automation.list_schedules(ctx),
    "list_sessions": sessions.list_sessions,
}

_ACTIONS: dict[str, Callable[[dict[str, Any], SkillContext], Generator[Event, None, str | None]]] = {
    "propose_connection": connections.propose_connection,
    "update_connector_form": connections.update_connector_form,
    "propose_workflow": automation.propose_workflow,
    "propose_schedule": automation.propose_schedule,
    "propose_session_changes": sessions.propose_session_changes,
}


class ConfigureSkill:
    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        handler = _TOOLS.get(name)
        if handler is None:
            result: dict[str, Any] = {"error": f"configure has no tool '{name}'."}
        else:
            try:
                result = handler(args or {}, ctx)
            except ValueError as exc:
                result = {"error": str(exc)}
        return ToolResult(text=json.dumps(result, ensure_ascii=False, default=str))

    def handle_action(self, action: str, spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
        handler = _ACTIONS.get(action)
        if handler is None:
            message = f"configure has no action '{action}'."
            yield {"type": "error", "message": message, "message_code": "agent.unknownAction"}
            return message
        try:
            return (yield from handler(spec or {}, ctx))
        except ValueError as exc:
            return f"{action} failed: {exc}"


def get_skill() -> ConfigureSkill:
    return ConfigureSkill()
