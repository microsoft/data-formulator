from __future__ import annotations

from typing import Any, Generator

from data_formulator.agents.agent_utils import generate_data_summary
from data_formulator.analyst.input_provenance import normalize_input_sources
from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.security.code_signing import sign_result


class VisualizationSkill:
    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        return ToolResult(text=f"visualization has no tool '{name}'.")

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action == "visualize":
            return (yield from self._handle_visualize(spec, ctx))
        yield {
            "type": "error",
            "message": f"visualization cannot handle action '{action}'.",
            "message_code": "agent.unknownAction",
        }
        return f"visualization cannot handle action '{action}'."

    def _handle_visualize(
        self, action: dict[str, Any], ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        code = action.get("code", "")
        output_variable = action.get("output_variable", "result_df")
        chart_spec = action.get("chart", {})
        field_metadata = action.get("field_metadata", {})
        field_display_names = action.get("field_display_names", {})
        display_instruction = action.get("display_instruction", "")
        title = action.get("title", "")
        subtitle = action.get("subtitle", "")
        step_index = int((ctx.payload or {}).get("completed_step_count", 0)) + 1

        try:
            input_sources = normalize_input_sources(
                action,
                (ctx.payload or {}).get("workspace_inputs"),
            )
        except ValueError as exc:
            message = str(exc)
            yield {
                "type": "error",
                "message": message,
                "message_code": "agent.parseActionFailed",
            }
            return f"[OBSERVATION – Step {step_index} FAILED]\n\nError: {message}"

        yield {
            "type": "action",
            "action": "visualize",
            "display_instruction": display_instruction,
            "input_sources": input_sources,
            "input_tables": [
                source["display_name"]
                for source in input_sources
                if source["kind"] == "data"
            ],
        }

        viz_result = ctx.runtime.run_visualize_code(
            code=code,
            output_variable=output_variable,
            chart_spec=chart_spec,
            field_metadata=field_metadata,
            field_display_names=field_display_names,
            display_instruction=display_instruction,
            title=title,
            subtitle=subtitle,
            messages=ctx.trajectory,
        )

        if viz_result["status"] != "ok":
            error_msg = viz_result.get("error_message", "Unknown error")
            observation = (
                f"[OBSERVATION – Step {step_index} FAILED]\n\nError: {error_msg}"
            )
            yield {
                "type": "error",
                "message": error_msg,
                "display_instruction": display_instruction,
            }
            return observation

        transform_result = viz_result["transform_result"]
        sign_result(transform_result)
        transformed_data = transform_result["content"]
        ctx.runtime.register_run_chart(transform_result, chart_spec)

        yield {
            "type": "result",
            "status": "success",
            "content": {
                "question": display_instruction,
                "result": transform_result,
            },
        }

        return self._format_observation(
            step_index=step_index,
            display_instruction=display_instruction,
            code=transform_result.get("code", ""),
            data=transformed_data,
            chart_id=transform_result.get("chart_id"),
            workspace=ctx.workspace,
        )

    @staticmethod
    def _format_observation(
        step_index: int,
        display_instruction: str,
        code: str,
        data: dict[str, Any],
        workspace: Any,
        chart_id: str | None = None,
    ) -> str:
        data_summary = generate_data_summary(
            [{
                "name": data.get("virtual", {}).get("table_name", f"step_{step_index}"),
                "rows": data["rows"],
            }],
            workspace=workspace,
        )
        chart_ref = ""
        if chart_id:
            chart_ref = (
                f"\n\n**Chart id**: `{chart_id}` — to embed this chart in a report, "
                f"write `![caption](chart://{chart_id})`; to read it again, pass this "
                f"id to `inspect_chart`."
            )
        return (
            f"[OBSERVATION – Step {step_index}]\n\n"
            f"**Visualization**: {display_instruction}\n\n"
            f"**Code**:\n```python\n{code}\n```\n\n"
            f"**Transformed Data**:\n{data_summary}"
            f"{chart_ref}"
        )


def get_skill() -> VisualizationSkill:
    return VisualizationSkill()