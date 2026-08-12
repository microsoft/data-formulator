from __future__ import annotations

import json
from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.data_operations import (
    ConnectorQueryStep,
    DataDiscoveryService,
    DataOperation,
    DataOperationExecutor,
    DataOperationPlan,
    DataOperationRepository,
    LoadQuery,
    ProbeBudget,
)

_PROBE_BUDGET_KEY = "data_loading.probe_budget"


class DataLoadingSkill:
    """Read-only connected-source discovery for the unified analyst."""

    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        service = DataDiscoveryService(ctx.workspace)
        if name == "list_data":
            result = service.list_data(args)
        elif name == "find_data":
            result = service.find_data(args)
        elif name == "describe_data":
            result = service.describe_data(args)
        elif name == "probe_data":
            result = service.probe_data(args, self._probe_budget(ctx))
        else:
            result = {"error": f"data_loading has no tool '{name}'."}
        return ToolResult(text=json.dumps(result, ensure_ascii=False, default=str))

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action == "propose_data_operation":
            return (yield from self._propose_data_operation(spec, ctx))
        message = f"data_loading has no committing action '{action}' in this phase."
        yield {
            "type": "error",
            "message": message,
            "message_code": "agent.unknownAction",
        }
        return message

    @staticmethod
    def _already_loaded_tables(steps: tuple[ConnectorQueryStep, ...], workspace) -> list[str]:
        metadata = workspace.get_metadata()
        if metadata is None:
            return []
        loaded: list[str] = []
        for step in steps:
            expected_options = DataOperationExecutor._build_import_options(step)
            for table_name, table_metadata in metadata.tables.items():
                if table_metadata.source_table != step.source_table:
                    continue
                import_options = dict(table_metadata.import_options or {})
                provenance = import_options.pop("data_operation", {})
                same_source = not provenance or (
                    provenance.get("source_id") in (None, step.source_id)
                    and provenance.get("table_key") in (None, step.table_key)
                )
                if same_source and import_options == expected_options:
                    loaded.append(table_name)
                    break
        return loaded

    @staticmethod
    def _propose_data_operation(
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        try:
            raw_plans = spec.get("options")
            if not isinstance(raw_plans, list) or not 1 <= len(raw_plans) <= 3:
                raise ValueError("propose_data_operation requires one to three options")
            discovery = DataDiscoveryService(ctx.workspace)
            resolved_plans: list[DataOperationPlan] = []
            for raw_plan in raw_plans:
                raw_steps = raw_plan.get("tables")
                if not isinstance(raw_steps, list) or not raw_steps:
                    raise ValueError("Each loading option requires at least one table")
                steps: list[ConnectorQueryStep] = []
                for raw_step in raw_steps:
                    source_id = str(raw_step["source_id"])
                    table_key = str(raw_step["table_key"])
                    if not _source_is_available(source_id):
                        raise ValueError(
                            f"source {source_id!r} is not connected, so it cannot be loaded from. "
                            "Propose data from a connected source, or tell the user to reconnect it first."
                        )
                    resolved = discovery.resolve_load_table(source_id, table_key)
                    if resolved is None:
                        raise ValueError(
                            f"table_key {table_key!r} was not found in source {source_id!r}"
                        )
                    steps.append(ConnectorQueryStep(
                        source_id=source_id,
                        table_key=table_key,
                        display_name=str(resolved["display_name"]),
                        source_table=str(resolved["source_table"]),
                        source_table_name=(
                            str(resolved["source_table_name"])
                            if resolved.get("source_table_name") is not None
                            else None
                        ),
                        query=LoadQuery.from_dict(raw_step.get("query")),
                    ))
                resolved_plans.append(DataOperationPlan(
                    label=str(raw_plan["label"]).strip(),
                    summary="",
                    steps=tuple(steps),
                ))
            plans = tuple(
                resolved_plans
            )
            # The agent's own prose is the answer; `response` is only a fallback
            # for models that emit a bare tool call with no accompanying text.
            narration = str(ctx.payload.get("action_narration") or "").strip()
            response = narration or str(spec.get("response", "")).strip()
            operation = DataOperation(
                reason="",
                plans=plans,
                description=response,
            )
            if not operation.description or any(not plan.label for plan in plans):
                raise ValueError(
                    "say what you found and why in your reply text, and give each option a label"
                )
            conversation_id = str(ctx.payload.get("conversation_id", "")).strip()
            loaded_tables = DataLoadingSkill._already_loaded_tables(
                tuple(step for plan in plans for step in plan.steps),
                ctx.workspace,
            )
            if loaded_tables:
                names = ", ".join(dict.fromkeys(loaded_tables))
                raise ValueError(
                    f"This proposal duplicates data already loaded in the workspace: {names}. "
                    "Use those workspace tables directly, explain their relevance, or propose only missing data."
                )
            DataOperationRepository.for_workspace(ctx.workspace).create(
                operation,
                conversation_id=conversation_id,
            )
        except (KeyError, TypeError, ValueError) as exc:
            message = str(exc)
            yield {
                "type": "error",
                "message": message,
                "message_code": "agent.invalidDataOperation",
            }
            return message

        yield {
            "type": "interact",
            "thought": spec.get("thought", ""),
            "data_operation": operation.to_public_dict(),
            "questions": [{
                "text": operation.description,
                "responseType": "single_choice",
                "required": True,
                "options": [
                    {"label": plan.label, "value": plan.id}
                    for plan in operation.plans
                ],
            }],
        }
        return None

    @staticmethod
    def _probe_budget(ctx: SkillContext) -> ProbeBudget:
        state = ctx.payload.get("skill_state")
        if not isinstance(state, dict):
            state = {}
            ctx.payload["skill_state"] = state
        budget = state.get(_PROBE_BUDGET_KEY)
        if not isinstance(budget, ProbeBudget):
            budget = ProbeBudget()
            state[_PROBE_BUDGET_KEY] = budget
        return budget


def _source_is_available(source_id: str) -> bool:
    """Only False when we can positively tell the source is unreachable."""
    try:
        from data_formulator.data_connector import connector_is_available
        return connector_is_available(source_id) is not False
    except Exception:
        return True


def get_skill() -> DataLoadingSkill:
    return DataLoadingSkill()