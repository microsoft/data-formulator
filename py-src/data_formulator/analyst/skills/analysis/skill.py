from __future__ import annotations

from typing import Any, Generator

from data_formulator.agents.context import handle_inspect_source_data
from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult


class AnalysisSkill:
    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        input_tables = (ctx.payload or {}).get("input_tables") or []
        if name == "execute_python_script":
            result = ctx.runtime.run_explore_code(args.get("code", ""), input_tables)
            text = result.get("stdout", "")
            if result.get("error"):
                text += f"\n\nError: {result['error']}"
            return ToolResult(text=text)
        if name == "inspect_source_data":
            return ToolResult(text=handle_inspect_source_data(
                args.get("table_names", []), input_tables, ctx.workspace,
            ))
        return ToolResult(text=f"analysis has no tool '{name}'.")

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        yield {"type": "error", "message": f"analysis has no action '{action}'."}
        return f"analysis has no action '{action}'."


def get_skill() -> AnalysisSkill:
    return AnalysisSkill()