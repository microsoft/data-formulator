from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.analyst.workspace_inputs import WorkspaceInputEngine, normalize_external_references
from data_formulator.datalake.workspace import Workspace
from data_formulator.data_operations import (
    ConnectorQueryStep,
    DataDiscoveryService,
    DataOperation,
    DataOperationExecutor,
    DataOperationPlan,
    DataOperationRepository,
    LoadQuery,
    OperationError,
    ProbeBudget,
)

_PROBE_BUDGET_KEY = "workspace.probe_budget"


class WorkspaceDataLoading:
    """Connected-source discovery and confirmed imports for the workspace skill."""

    def handle_tool(
        self,
        name: str,
        args: dict[str, Any],
        ctx: SkillContext,
    ) -> ToolResult:
        service = DataDiscoveryService(ctx.workspace)
        if name == "summarize_data_sources":
            result = service.summarize_data_sources(args)
        elif name == "list_data":
            result = service.list_data(args)
        elif name == "find_data":
            result = service.find_data(args)
        elif name == "describe_data":
            result = service.describe_data(args)
        elif name == "probe_data":
            result = service.probe_data(args, self._probe_budget(ctx))
        else:
            result = {"error": f"workspace has no data-loading tool '{name}'."}
        return ToolResult(text=json.dumps(result, ensure_ascii=False, default=str))

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action == "propose_data_operation":
            return (yield from self._propose_data_operation(spec, ctx))
        message = f"workspace has no data-loading action '{action}'."
        yield {
            "type": "error",
            "message": message,
            "message_code": "agent.unknownAction",
        }
        return message

    @staticmethod
    def _already_loaded_tables(steps: tuple[ConnectorQueryStep, ...], workspace, *, require_provenance: bool = False) -> list[str]:
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
                same_source = (
                    provenance.get("source_id") == step.source_id
                    and provenance.get("table_key") == step.table_key
                )
                if not require_provenance:
                    same_source = not provenance or (
                        provenance.get("source_id") in (None, step.source_id)
                        and provenance.get("table_key") in (None, step.table_key)
                    )
                if same_source and not table_metadata.stale and import_options == expected_options:
                    loaded.append(table_name)
                    break
        return loaded

    @staticmethod
    def _propose_data_operation(
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        try:
            user_review_needed = spec.get("user_review_needed", False)
            if not isinstance(user_review_needed, bool):
                raise ValueError("user_review_needed must be a boolean")
            raw_plans = spec.get("options")
            if not isinstance(raw_plans, list) or not 1 <= len(raw_plans) <= 3:
                raise ValueError("propose_data_operation requires one to three options")
            user_review_needed = user_review_needed or len(raw_plans) > 1
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
                        display_name=(str(raw_step.get("display_name") or "").strip()
                                      or (str(raw_plan["label"]).strip() if raw_step.get("query") and len(raw_steps) == 1
                                          else str(resolved["display_name"]))),
                        source_table=str(resolved["source_table"]),
                        source_table_name=(
                            str(resolved["source_table_name"])
                            if resolved.get("source_table_name") is not None
                            else None
                        ),
                        query=LoadQuery.from_dict(raw_step.get("query")),
                        materialize=raw_step.get("query") is not None,
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
            if not response and not user_review_needed:
                response = plans[0].label
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
            loaded_tables = WorkspaceDataLoading._already_loaded_tables(
                tuple(step for plan in plans for step in plan.steps),
                ctx.workspace,
            )
            if loaded_tables:
                names = ", ".join(dict.fromkeys(loaded_tables))
                raise ValueError(
                    f"This proposal duplicates data already loaded in the workspace: {names}. "
                    "Use those analysis input tables directly, explain their relevance, "
                    "or propose only missing data."
                )
            repository = DataOperationRepository.for_workspace(ctx.workspace)
            repository.create(
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

        if not user_review_needed:
            from data_formulator.data_loader.query_runtime import QueryCancelled
            selected = repository.select(operation.id, operation.plans[0].id)
            yield {"type": "tool_start", "tool": "load_data", "args": {
                "tables": [step.source_table_name for step in operation.plans[0].steps],
            }}
            try:
                result = DataOperationExecutor(
                    ctx.workspace, external_references=normalize_external_references(ctx.payload.get("external_references")),
                ).execute(selected)
                completed = repository.finish(operation.id, result.result_table_ids, result.failed_steps, result.result_references)
            except QueryCancelled:
                repository.fail(operation.id, OperationError(code="CANCELLED", message="Loading cancelled."))
                raise
            except Exception as exc:
                completed = repository.fail(operation.id, OperationError(code="IMPORT_FAILED", message=str(exc)))
            observation = record_data_operation_result(ctx.workspace, ctx.payload, completed)
            yield {"type": "tool_result", "tool": "load_data",
                   "status": "ok" if (completed.result_table_ids or completed.result_references) and not completed.failed_steps else "error"}
            yield {"type": "data_operation_result", "operation": completed.to_public_dict()}
            return observation

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


def record_data_operation_result(
    workspace: Workspace,
    payload: dict[str, Any],
    completed: DataOperation,
) -> str:
    references = {item["id"]: item for item in normalize_external_references(payload.get("external_references"))}
    references.update({item["id"]: item for item in completed.result_references})
    payload["external_references"] = list(references.values())
    input_tables = payload.setdefault("input_tables", [])
    existing_names = {table["name"] for table in input_tables}
    input_tables.extend({"name": name, "rows": [], "virtual": True}
                        for name in completed.result_table_ids if name not in existing_names)
    payload["workspace_inputs"] = WorkspaceInputEngine(workspace, input_tables).manifest
    result_payload = completed.to_public_dict()
    result_payload["workspace_inputs"] = []
    result_payload["load_outcomes"] = [{
        "id": reference["id"], "availability": "virtual", "compute_ready": False,
        "source_id": reference["connectorId"], "table_key": reference["tableKey"],
        "summary": reference.get("summary", {}),
        "next_step": "Use this reference for future source queries, not Python. Use a suitable materialized outcome from this call directly; only refine loading if no suitable local result exists.",
    } for reference in completed.result_references]
    for item in payload["workspace_inputs"].data:
        if item.display_name not in completed.result_table_ids:
            continue
        metadata = workspace.get_table_metadata(item.display_name)
        result_payload["workspace_inputs"].append({
            **asdict(item),
            "availability": "materialized", "compute_ready": True,
            "row_count": metadata.row_count,
            "columns": [column.to_dict() for column in metadata.columns or []],
            "scope": metadata.import_options or {},
            "description": metadata.description,
        })
        result_payload["load_outcomes"].append(result_payload["workspace_inputs"][-1])
    payload["last_data_operation_result"] = result_payload
    return "Workspace loading finished. Check load_outcomes and failed_steps. Use compute-ready input paths directly; an accompanying virtual source reference does not require another load or imply query success.\n" + json.dumps(result_payload)


def _source_is_available(source_id: str) -> bool:
    """Only False when we can positively tell the source is unreachable."""
    try:
        from data_formulator.data_connector import connector_is_available
        return connector_is_available(source_id) is not False
    except Exception:
        return True

