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
_CONNECTORS_LISTED_KEY = "data_loading.connectors_listed"
_CONNECTORS_DISABLED_NOTE = (
    "External data connectors are disabled in this deployment. Use file upload "
    "or built-in sample datasets instead."
)


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
        elif name == "list_connectors":
            result = self._list_connectors(ctx)
        elif name == "describe_connector":
            result = self._describe_connector(args)
        else:
            result = {"error": f"data-loading has no tool '{name}'."}
        return ToolResult(text=json.dumps(result, ensure_ascii=False, default=str))

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action == "propose_data_operation":
            return (yield from self._propose_data_operation(spec, ctx))
        if action == "propose_connection":
            return (yield from self._propose_connection(spec, ctx))
        message = f"data-loading has no committing action '{action}' in this phase."
        yield {
            "type": "error",
            "message": message,
            "message_code": "agent.unknownAction",
        }
        return message

    @staticmethod
    def _connectors_disabled() -> bool:
        try:
            from flask import current_app
            return bool(current_app.config.get("CLI_ARGS", {}).get("disable_data_connectors"))
        except Exception:
            return False

    @staticmethod
    def _skill_state(ctx: SkillContext) -> dict[str, Any]:
        state = ctx.payload.get("skill_state")
        if not isinstance(state, dict):
            state = {}
            ctx.payload["skill_state"] = state
        return state

    def _list_connectors(self, ctx: SkillContext) -> dict[str, Any]:
        self._skill_state(ctx)[_CONNECTORS_LISTED_KEY] = True
        if self._connectors_disabled():
            return {"connectors": [], "unavailable": [], "note": _CONNECTORS_DISABLED_NOTE}

        from data_formulator.data_loader import DATA_LOADERS, DISABLED_LOADERS

        connectors = []
        for key, loader_class in DATA_LOADERS.items():
            if key == "sample_datasets":
                continue
            try:
                auth_mode = loader_class.auth_mode()
            except Exception:
                auth_mode = None
            connectors.append({
                "type": key,
                "name": loader_class.DISPLAY_NAME or key.replace("_", " ").title(),
                "summary": loader_class.DESCRIPTION or "",
                "auth_mode": auth_mode,
                "available": True,
            })
        return {
            "connectors": connectors,
            "unavailable": [
                {
                    "type": key,
                    "name": key.replace("_", " ").title(),
                    "install_hint": hint,
                }
                for key, hint in DISABLED_LOADERS.items()
                if key != "sample_datasets"
            ],
            "next_action": (
                "If the user requested one of these connector types, call "
                "propose_connection now. Do not end the turn by saying you will open a form."
            ),
        }

    def _describe_connector(self, args: dict[str, Any]) -> dict[str, Any]:
        if self._connectors_disabled():
            return {"error": _CONNECTORS_DISABLED_NOTE}

        from data_formulator.data_loader import DATA_LOADERS, DISABLED_LOADERS

        source_type = str(args.get("source_type") or "").strip()
        loader_class = DATA_LOADERS.get(source_type)
        if loader_class is None:
            hint = DISABLED_LOADERS.get(source_type)
            detail = f" (needs: {hint})" if hint else ""
            return {"error": f"Connector {source_type!r} is unavailable{detail}. Call list_connectors."}

        def safe(callable_):
            try:
                return callable_()
            except Exception:
                return None

        return {
            "type": source_type,
            "name": loader_class.DISPLAY_NAME or source_type.replace("_", " ").title(),
            "summary": loader_class.DESCRIPTION or "",
            "auth_mode": safe(loader_class.auth_mode),
            "auth_paths": safe(loader_class.auth_paths),
            "auth_instructions": safe(loader_class.auth_instructions),
            "params": [
                {
                    "name": param.get("name"),
                    "required": bool(param.get("required")),
                    "tier": param.get("tier"),
                    "sensitive": bool(param.get("sensitive") or param.get("type") == "password"),
                    "description": param.get("description"),
                }
                for param in (safe(loader_class.list_params) or [])
                if isinstance(param, dict)
            ],
            "next_action": (
                "Call propose_connection now to open this form. Describing the "
                "requirements in text does not open it."
            ),
        }

    def _propose_connection(
        self,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if self._connectors_disabled():
            yield {"type": "error", "message": _CONNECTORS_DISABLED_NOTE, "message_code": "agent.connectorsDisabled"}
            return _CONNECTORS_DISABLED_NOTE
        if not self._skill_state(ctx).get(_CONNECTORS_LISTED_KEY):
            message = "Call list_connectors before propose_connection."
            yield {"type": "error", "message": message, "message_code": "agent.invalidConnector"}
            return message

        from data_formulator.data_loader import DATA_LOADERS, DISABLED_LOADERS

        source_type = str(spec.get("source_type") or "").strip()
        if source_type not in DATA_LOADERS or source_type == "sample_datasets":
            hint = DISABLED_LOADERS.get(source_type)
            message = f"Connector {source_type!r} is unavailable" + (f" (needs: {hint})." if hint else ".")
            yield {"type": "error", "message": message, "message_code": "agent.invalidConnector"}
            return message

        prefilled_raw = spec.get("prefilled") or {}
        prefilled = {}
        if isinstance(prefilled_raw, dict):
            prefilled = {
                str(key): str(value)
                for key, value in prefilled_raw.items()
                if value not in (None, "")
            }
        display_name = DATA_LOADERS[source_type].DISPLAY_NAME or source_type
        response = str(ctx.payload.get("action_narration") or "").strip()
        yield {
            "type": "interact",
            "thought": spec.get("thought", ""),
            "form": {
                "kind": "connector",
            "title": f"Connect to {display_name}",
            "response": response or f"Complete the {display_name} connection form to add this data source.",
                "connector": {
                    "source_type": source_type,
                    "prefilled": prefilled,
                },
            },
        }
        return None

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