"""Connection setup for the configure skill: connector discovery and forms."""

from __future__ import annotations

from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext

from .forms import form_event

CONNECTORS_DISABLED_NOTE = (
    "User-created connections are disabled in this deployment. Use administrator-configured "
    "sources, file upload, or built-in sample datasets instead."
)


def connectors_disabled() -> bool:
    from data_formulator.configuration import user_connectors_disabled
    return user_connectors_disabled()


def list_connectors() -> dict[str, Any]:
    if connectors_disabled():
        return {"connectors": [], "unavailable": [], "note": CONNECTORS_DISABLED_NOTE}

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
            {"type": key, "name": key.replace("_", " ").title(), "install_hint": hint}
            for key, hint in DISABLED_LOADERS.items()
            if key != "sample_datasets"
        ],
        "next_action": (
            "If the user requested one of these connector types, call "
            "propose_connection now. Do not end the turn by saying you will open a form."
        ),
    }


def describe_connector(args: dict[str, Any]) -> dict[str, Any]:
    if connectors_disabled():
        return {"error": CONNECTORS_DISABLED_NOTE}

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


def read_connector_form(ctx: SkillContext) -> dict[str, Any]:
    if connectors_disabled():
        return {"error": CONNECTORS_DISABLED_NOTE}
    snapshot = ctx.payload.get("connector_form")
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("form_id"), str):
        return {"error": "No connector form is currently targeted. Use propose_connection to open one."}
    schema = describe_connector({"source_type": snapshot.get("source_type")})
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


def update_connector_form(spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
    current = read_connector_form(ctx)
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


def propose_connection(spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
    if connectors_disabled():
        yield {"type": "error", "message": CONNECTORS_DISABLED_NOTE, "message_code": "agent.connectorsDisabled"}
        return CONNECTORS_DISABLED_NOTE
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
        prefilled = {str(key): str(value) for key, value in prefilled_raw.items() if value not in (None, "")}
    display_name = (DATA_LOADERS[source_type].DISPLAY_NAME or source_type) if source_type else None
    yield form_event(
        "connector", ctx,
        title=f"Connect to {display_name}" if display_name else "Connect a data source",
        body={"source_type": source_type, "prefilled": prefilled if source_type else {}},
        # Connecting opens a server-side network connection, so the user always
        # confirms it; agent output alone (possibly injected) never connects.
        default_response="Choose a connector and review the connection details before connecting.",
        thought=str(spec.get("thought") or ""),
        **({"form_id": current_form["form_id"], "revision": current_form["revision"]} if reuse_form else {}),
    )
    return None
