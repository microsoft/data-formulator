from __future__ import annotations

import json
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
            display_name = action.get("display_name")
            if display_name is not None:
                if (not isinstance(display_name, str) or not display_name.strip() or len(display_name) > 80
                        or any(ord(character) < 32 or ord(character) == 127 for character in display_name)):
                    raise ValueError("display_name must be a non-empty single-line table title of at most 80 characters")
                display_name = display_name.strip()
            input_sources = normalize_input_sources(
                action,
                (ctx.payload or {}).get("workspace_inputs"),
            )
            if action.get("connector_inputs"):
                bindings = yield from self._load_connector_inputs(action["connector_inputs"], ctx)
                code = "connector_inputs = " + repr({item["alias"]: item["path"] for item in bindings}) + "\n" + code
                input_sources = normalize_input_sources({"input_sources": [
                    *input_sources, *({"id": item["id"], "kind": "data"} for item in bindings),
                ]}, ctx.payload["workspace_inputs"])
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
            if action.get("connector_inputs"):
                observation += "\nLoaded inputs remain available; retry Python/chart without reloading:\n" + json.dumps(bindings)
            yield {
                "type": "error",
                "message": error_msg,
                "display_instruction": display_instruction,
            }
            return observation

        transform_result = viz_result["transform_result"]
        if display_name is not None:
            transform_result.setdefault("refined_goal", {})["display_name"] = display_name
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
    def _load_connector_inputs(raw_inputs, ctx: SkillContext):
        from data_formulator.analyst.skills.workspace.data_loading import WorkspaceDataLoading, _source_is_available
        from data_formulator.analyst.workspace_inputs import WorkspaceInputEngine
        from data_formulator.data_operations import ConnectorQueryStep, DataDiscoveryService, LoadQuery

        if not isinstance(raw_inputs, list) or not 1 <= len(raw_inputs) <= 8:
            raise ValueError("connector_inputs must contain one to eight input queries")
        discovery = DataDiscoveryService(ctx.workspace)
        resolved_inputs = []
        aliases = set()
        for raw in raw_inputs:
            if not isinstance(raw, dict) or set(raw) - {"alias", "source_id", "table_key", "query"}:
                raise ValueError("Each connector input requires alias, source_id, table_key, and optional query")
            alias = raw.get("alias")
            if not isinstance(alias, str) or not alias.isidentifier() or alias in aliases:
                raise ValueError("Connector input aliases must be unique Python identifiers")
            aliases.add(alias)
            source_id, table_key = raw.get("source_id"), raw.get("table_key")
            if not isinstance(source_id, str) or not source_id or not isinstance(table_key, str) or not table_key:
                raise ValueError("Connector inputs require source_id and table_key")
            if not _source_is_available(source_id):
                raise ValueError(f"Source {source_id!r} is not connected")
            resolved = discovery.resolve_load_table(source_id, table_key)
            if resolved is None:
                raise ValueError(f"Unknown connector table: {table_key}")
            query = raw.get("query")
            if query is not None and not isinstance(query, dict):
                raise ValueError("Connector input query must be an object")
            step = ConnectorQueryStep(
                source_id=source_id, table_key=table_key, display_name=alias,
                source_table=str(resolved["source_table"]), query=LoadQuery.from_dict(query),
            )
            resolved_inputs.append((raw, step))

        bindings = []
        for raw, step in resolved_inputs:
            existing = WorkspaceDataLoading._already_loaded_tables((step,), ctx.workspace, require_provenance=True)
            if existing:
                table_name = existing[0]
                input_tables = ctx.payload.setdefault("input_tables", [])
                if not any(item["name"] == table_name for item in input_tables):
                    input_tables.append({"name": table_name, "rows": [], "virtual": True})
                ctx.payload["workspace_inputs"] = WorkspaceInputEngine(ctx.workspace, input_tables).manifest
                item = next(item for item in ctx.payload["workspace_inputs"].data if item.display_name == table_name)
                binding = {"id": item.id, "path": item.path, "display_name": item.display_name}
            else:
                ctx.payload.pop("last_data_operation_result", None)
                observation = yield from WorkspaceDataLoading._propose_data_operation({
                    "user_review_needed": False,
                    "options": [{"label": step.display_name, "tables": [{
                        "source_id": step.source_id, "table_key": step.table_key,
                        "display_name": step.display_name, "query": step.query.to_dict(),
                    }]}],
                }, ctx)
                result = ctx.payload.get("last_data_operation_result") or {}
                loaded = result.get("workspace_inputs") or []
                if not loaded or result.get("failed_steps"):
                    raise ValueError("Connector load failed; visualization was not executed. " + str(observation))
                binding = loaded[0]
            if not binding.get("path"):
                raise ValueError("Loaded connector input has no readable workspace path")
            bindings.append({**binding, "alias": raw["alias"]})
        return bindings

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