# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Theme skill: author chart themes (Flint ThemeSpecs) and keep them in the user's theme library."""

from __future__ import annotations

import json
from typing import Any

from data_formulator.analyst.session_edits import chart_catalog
from data_formulator.analyst.skills.base import SkillContext, ToolResult
from data_formulator.knowledge.themes import ThemeStore


def _store(ctx: SkillContext) -> ThemeStore:
    user_home = getattr(ctx.workspace, "user_home", None)
    if not user_home:
        raise ValueError("The theme library is not available in this deployment.")
    return ThemeStore(user_home)


class ThemeSkill:
    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        presets = list(chart_catalog()["themes"])
        try:
            if name == "list_themes":
                result: dict[str, Any] = {"presets": presets, "saved": _store(ctx).list()}
            elif name == "save_theme":
                theme, new = _store(ctx).save((args or {}).get("theme"), presets)
                result = {"saved": theme["id"], "new": new, "theme": theme,
                          "use": f"Use \"{theme['id']}\" wherever a theme id goes: a chart file's \"theme\", "
                                 f"a map's view.theme, <Page theme=\"{theme['id']}\"> in an app."}
            else:
                result = {"error": f"theme has no tool '{name}'."}
        except ValueError as exc:
            result = {"error": str(exc)}
        return ToolResult(text=json.dumps(result, ensure_ascii=False))

    def handle_action(self, action: str, spec: dict[str, Any], ctx: SkillContext):
        message = f"theme has no action '{action}'."
        yield {"type": "error", "message": message, "message_code": "agent.unknownAction"}
        return message


def get_skill() -> ThemeSkill:
    return ThemeSkill()
