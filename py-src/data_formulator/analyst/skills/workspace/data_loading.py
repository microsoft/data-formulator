from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.analyst.workspace_inputs import WorkspaceInputEngine
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
_CONNECTORS_LISTED_KEY = "workspace.connectors_listed"
_CONNECTORS_DISABLED_NOTE = (
    "User-created connections are disabled in this deployment. Use administrator-configured "
    "sources, file upload, or built-in sample datasets instead."
)


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
        elif name == "list_connectors":
            result = self._list_connectors(ctx)
        elif name == "describe_connector":
            result = self._describe_connector(args)
        elif name == "read_connector_form":
            result = self._read_connector_form(ctx)
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
        if action == "propose_connection":
            return (yield from self._propose_connection(spec, ctx))
        if action == "update_connector_form":
            return (yield from self._update_connector_form(spec, ctx))
        message = f"workspace has no data-loading action '{action}'."
        yield {
            "type": "error",
            "message": message,
            "message_code": "agent.unknownAction",
        }
        return message

    @staticmethod
    def _connectors_disabled() -> bool:
        from data_formulator.configuration import user_connectors_disabled
        return user_connectors_disabled()

    def _read_connector_form(self, ctx: SkillContext) -> dict[str, Any]:
        if self._connectors_disabled():
            return {"error": _CONNECTORS_DISABLED_NOTE}
        snapshot = ctx.payload.get("connector_form")
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("form_id"), str):
            return {"error": "No connector form is currently targeted. Use propose_connection to open one."}
        schema = self._describe_connector({"source_type": snapshot.get("source_type")})
        if "error" in schema:
            return schema
        revision = snapshot.get("revision")
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
            return {"error": "The form has no valid revision. Reopen it before editing."}
        values = snapshot.get("values") or {}
        if not isinstance(values, dict):
            return {"error": "Invalid form values."}
        fields = [param for param in schema["params"] if not param["sensitive"]]
        return {"form_id": snapshot["form_id"], "source_type": schema["type"], "revision": revision,
                "status": snapshot.get("status", "pending"), "fields": fields,
                "values": {param["name"]: values[param["name"]] for param in fields
                           if isinstance(values.get(param["name"]), str)},
                "credential_fields": [param["name"] for param in schema["params"] if param["sensitive"]]}

    def _update_connector_form(self, spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
        current = self._read_connector_form(ctx)
        if "error" in current:
            return current["error"]
        if (spec.get("form_id") != current["form_id"] or spec.get("revision") != current["revision"]
                or current["status"] == "connected"):
            return "The form is changed, connected, or not targeted. Read the current form before editing."
        changes = spec.get("values")
        allowed = {param["name"] for param in current["fields"]}
        if not isinstance(changes, dict) or not changes or any(
                name not in allowed or not isinstance(value, str) for name, value in changes.items()):
            return "Only known non-sensitive form fields can be edited. Enter credentials directly in the form."
        yield {"type": "interact", "form": {
            "kind": "connector", "form_id": current["form_id"], "revision": current["revision"],
            "patch": changes,
            "response": str(ctx.payload.get("action_narration") or "Review the updated connection form before connecting."),
        }}
        return None

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
        from data_formulator.data_loader import DATA_LOADERS, DISABLED_LOADERS

        current_form = ctx.payload.get("connector_form") or {}
        reuse_form = isinstance(current_form, dict) and current_form.get("status") == "pending" and bool(current_form.get("form_id"))
        source_type = str(spec.get("source_type") or (current_form.get("source_type") if reuse_form else "") or "").strip()
        if source_type and (source_type not in DATA_LOADERS or source_type == "sample_datasets"):
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
        display_name = (DATA_LOADERS[source_type].DISPLAY_NAME or source_type) if source_type else None
        response = str(ctx.payload.get("action_narration") or "").strip()
        yield {
            "type": "interact",
            "thought": spec.get("thought", ""),
            "form": {
                "kind": "connector",
                **({"form_id": current_form["form_id"], "revision": current_form["revision"]} if reuse_form else {}),
                "title": f"Connect to {display_name}" if display_name else "Connect a data source",
                "response": response or "Choose a connector and review the connection details before connecting.",
                "connector": {
                    "source_type": source_type,
                    "prefilled": prefilled if source_type else {},
                },
            },
        }
        return None

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
                result = DataOperationExecutor(ctx.workspace).execute(selected)
                completed = repository.finish(operation.id, result.result_table_ids, result.failed_steps)
            except QueryCancelled:
                repository.fail(operation.id, OperationError(code="CANCELLED", message="Loading cancelled."))
                raise
            except Exception as exc:
                completed = repository.fail(operation.id, OperationError(code="IMPORT_FAILED", message=str(exc)))
            input_tables = ctx.payload.setdefault("input_tables", [])
            existing_names = {table["name"] for table in input_tables}
            input_tables.extend({"name": name, "rows": [], "virtual": True}
                                for name in completed.result_table_ids if name not in existing_names)
            ctx.payload["workspace_inputs"] = WorkspaceInputEngine(ctx.workspace, input_tables).manifest
            yield {"type": "tool_result", "tool": "load_data",
                   "status": "ok" if completed.result_table_ids and not completed.failed_steps else "error"}
            yield {"type": "data_operation_result", "operation": completed.to_public_dict()}
            result_payload = completed.to_public_dict()
            result_payload["workspace_inputs"] = []
            for item in ctx.payload["workspace_inputs"].data:
                if item.display_name not in completed.result_table_ids:
                    continue
                metadata = ctx.workspace.get_table_metadata(item.display_name)
                result_payload["workspace_inputs"].append({
                    **asdict(item),
                    "row_count": metadata.row_count,
                    "columns": [column.to_dict() for column in metadata.columns or []],
                    "scope": metadata.import_options or {},
                    "description": metadata.description,
                })
            ctx.payload["last_data_operation_result"] = result_payload
            return "Connected-data loading finished. Use the returned input IDs and paths directly:\n" + json.dumps(result_payload)

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

