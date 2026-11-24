from __future__ import annotations

import json
import logging
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from data_formulator.security.path_safety import ConfinedDir

logger = logging.getLogger(__name__)


_TEXT_SCHEMA = {"type": "string", "minLength": 1, "pattern": r"\S"}
_SOURCE_SCHEMA = {"anyOf": [_TEXT_SCHEMA, {"type": "object", "minProperties": 1}]}
WORKFLOW_STEP_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["id", "description", "instructions"],
    "properties": {
        "id": {**_TEXT_SCHEMA, "description": "Stable step identifier, unique within the workflow."},
        "description": {**_TEXT_SCHEMA, "description": "The analytical goal of this step."},
        "instructions": {**_TEXT_SCHEMA, "description": "Inputs, work to perform, and inspectable results."},
        "next": {**_TEXT_SCHEMA, "description": "Optional existing step ID to visit next."},
        "checkers": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["id", "condition"],
            "properties": {
                "id": {**_TEXT_SCHEMA, "description": "Unique checker ID across the workflow."},
                "condition": {**_TEXT_SCHEMA, "description": "Observable acceptance criterion."},
                "when": {"type": "string", "enum": ["before", "during", "after"], "default": "after"},
                "on_fail": {**_TEXT_SCHEMA, "description": "Existing step ID to revisit on failure."},
            },
        }},
    },
}
WORKFLOW_PARAMETER_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["name", "label"],
    "properties": {
        "name": {"type": "string", "pattern": r"^[A-Za-z][A-Za-z0-9_]{0,63}$"},
        "label": _TEXT_SCHEMA,
        "type": {"type": "string", "enum": ["text", "number", "boolean", "select"], "default": "text"},
        "required": {"type": "boolean"},
        "default": {"type": ["string", "number", "boolean", "null"]},
        "description": {"type": "string"},
        "options": {"type": "array", "minItems": 1, "maxItems": 50, "uniqueItems": True, "items": _TEXT_SCHEMA},
        "allow_custom": {"type": "boolean"},
    },
}
# A workflow's schedule (design-docs/78): when and how the local scheduler runs it unattended. Kept in the
# workflow file; the scheduler's index (scheduling.ScheduleStore) is built from it.
SCHEDULE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["time", "weekdays", "timezone", "model_id"],
    "properties": {
        "time": {"type": "string", "pattern": r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$", "description": "24-hour HH:MM."},
        "weekdays": {"type": "array", "minItems": 1, "uniqueItems": True, "description": "0 = Monday ... 6 = Sunday.",
                     "items": {"type": "integer", "minimum": 0, "maximum": 6}},
        "timezone": {"type": "string", "minLength": 1, "description": "IANA timezone."},
        "model_id": {"type": "string", "minLength": 1, "description": "Server model connection ID."},
        "setup": {"type": "object", "additionalProperties": False, "description": "The inputs a scheduled run uses.",
                  "properties": {"parameters": {"type": "object"}, "instructions": {"type": "string"}}},
        "enabled": {"type": "boolean", "description": "false pauses the schedule."},
        "auto_approve": {"type": "boolean", "description": "true: unattended runs approve commands and take the first "
                         "loading option; otherwise they decline them and continue."},
        "max_retries": {"type": "integer", "minimum": 0, "maximum": 3},
        "language": {"type": "string", "pattern": r"^[a-z]{2,3}$", "description": "Set from the app's language when saved."},
    },
}
# Keys schedules once had and no longer use (a late run now always catches up); reading or writing a workflow drops them.
RETIRED_SCHEDULE_KEYS = ("catch_up",)
# An agent's proposal may leave the machine's values out; the form fills them in before the file is saved.
AUTHORED_SCHEDULE_REQUIRED = ["time", "weekdays"]

WORKFLOW_DEFINITION_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["version", "name", "overview", "deliverables", "steps"],
    "properties": {
        "version": {"type": "integer", "enum": [1]},
        "name": _TEXT_SCHEMA,
        "overview": {**_TEXT_SCHEMA, "description": "Reusable library summary, not execution history."},
        "prompt": {**_TEXT_SCHEMA, "description": "Cross-step scope, constraints, and analytical intent."},
        "source": {"description": "Grounded input guidance, not executable configuration or credentials.",
                   "anyOf": [*_SOURCE_SCHEMA["anyOf"], {"type": "array", "minItems": 1, "items": _SOURCE_SCHEMA}]},
        "parameters": {"type": "array", "maxItems": 20, "items": WORKFLOW_PARAMETER_SCHEMA,
                       "description": "Meaningful inputs that may vary between runs; omit for fixed-input work."},
        "deliverables": {"type": "array", "minItems": 1, "items": _TEXT_SCHEMA,
                         "description": "Concrete outputs the user can inspect."},
        "steps": {"type": "array", "minItems": 1, "maxItems": 30, "items": WORKFLOW_STEP_SCHEMA},
        "schedule": {**SCHEDULE_SCHEMA, "description": "Optional: run this workflow unattended on a schedule "
                     "(local app only). Omit to leave it unscheduled."},
    },
}
# Display text by language code. Kept out of the authoring schema: agents read and write the base language.
WORKFLOW_TRANSLATIONS_SCHEMA = {
    "type": "object", "propertyNames": {"pattern": r"^[a-z]{2,3}$"},
    "additionalProperties": {
        "type": "object", "additionalProperties": False,
        "properties": {
            "name": _TEXT_SCHEMA,
            "overview": _TEXT_SCHEMA,
            "parameters": {"type": "object", "additionalProperties": {
                "type": "object", "additionalProperties": False,
                "properties": {"label": _TEXT_SCHEMA, "description": {"type": "string"}, "default": {"type": "string"},
                               "options": {"type": "array", "minItems": 1, "items": _TEXT_SCHEMA}},
            }},
            "steps": {"type": "object", "additionalProperties": _TEXT_SCHEMA},
        },
    },
}


def _validate_translations(workflow: dict, translations: Any) -> None:
    error = next(Draft202012Validator(WORKFLOW_TRANSLATIONS_SCHEMA).iter_errors(translations), None)
    if error:
        location = ".".join(str(part) for part in error.absolute_path)
        raise ValueError(f"Invalid workflow i18n{'.' + location if location else ''}: {error.message}")
    parameters = {parameter["name"]: parameter for parameter in workflow.get("parameters", [])}
    step_ids = {step["id"] for step in workflow.get("steps", [])}
    for language, overlay in translations.items():
        if set(overlay.get("steps", {})) - step_ids:
            raise ValueError(f"Workflow i18n.{language} translates an unknown step.")
        for name, translated in overlay.get("parameters", {}).items():
            parameter = parameters.get(name)
            if parameter is None:
                raise ValueError(f"Workflow i18n.{language} translates an unknown parameter.")
            # Translated values reach the run, so only free-text inputs may translate them.
            free_text = parameter.get("type", "text") == "text" or parameter.get("allow_custom")
            if {"options", "default"} & set(translated) and not free_text:
                raise ValueError(f"Workflow i18n.{language}.parameters.{name} can only translate values of custom inputs.")
            if "options" in translated and len(translated["options"]) != len(parameter.get("options", [])):
                raise ValueError(f"Workflow i18n.{language}.parameters.{name} must translate every option.")


def localize_definition(workflow: dict, language: str = "en") -> dict:
    """Apply the display translations for *language* and drop the translation table."""
    localized = {key: deepcopy(value) for key, value in workflow.items() if key != "i18n"}
    overlay = (workflow.get("i18n") or {}).get(language)
    if not overlay:
        return localized
    localized.update({key: overlay[key] for key in ("name", "overview") if key in overlay})
    for parameter in localized.get("parameters", []):
        parameter.update(deepcopy(overlay.get("parameters", {}).get(parameter["name"], {})))
    for step in localized.get("steps", []):
        if step["id"] in overlay.get("steps", {}):
            step["description"] = overlay["steps"][step["id"]]
    return localized


def authored_definition_schema() -> dict:
    """The definition an agent proposes: its schedule may leave out the machine's values (``timezone``,
    ``model_id``), which the proposal form fills in before the file is saved."""
    schema = deepcopy(WORKFLOW_DEFINITION_SCHEMA)
    schedule = schema["properties"]["schedule"]
    schedule["required"] = AUTHORED_SCHEDULE_REQUIRED
    schedule["properties"]["timezone"]["description"] = "IANA timezone. Omit to use the user's."
    schedule["properties"]["model_id"]["description"] = ("Server model connection ID. Omit unless the user names one "
                                                         "(keep an existing schedule's value); the form fills it in.")
    schedule["properties"]["auto_approve"]["description"] = ("Whether unattended runs approve commands and take the first "
                                                             "data-loading option (the form's default); false declines them.")
    return schema


def validate_workflow_definition(workflow: Any, *, authored: bool = False) -> dict[str, Any]:
    try:
        json.dumps(workflow, allow_nan=False)
    except (ValueError, TypeError, RecursionError) as exc:
        raise ValueError("Workflow must contain JSON-compatible values; quote dates.") from exc
    schema = deepcopy(WORKFLOW_DEFINITION_SCHEMA) if not authored else authored_definition_schema()
    if not authored:
        schema["properties"]["steps"]["items"]["required"].remove("description")
    translations = workflow.get("i18n") if isinstance(workflow, dict) and not authored else None
    base = {key: value for key, value in workflow.items() if key != "i18n"} if translations is not None else workflow
    error = next(Draft202012Validator(schema).iter_errors(base), None)
    if error:
        location = ".".join(str(part) for part in error.absolute_path) or "definition"
        raise ValueError(f"Invalid workflow {location}: {error.message}")
    resolve_setup(workflow, require_values=False)
    step_ids = [step["id"] for step in workflow["steps"]]
    if len(set(step_ids)) != len(step_ids):
        raise ValueError("Step IDs must be unique.")
    check_ids = [check["id"] for step in workflow["steps"] for check in step.get("checkers", [])]
    if len(set(check_ids)) != len(check_ids):
        raise ValueError("Checker IDs must be unique across the workflow.")
    for step in workflow["steps"]:
        targets = [step.get("next")] + [check.get("on_fail") for check in step.get("checkers", [])]
        if any(target is not None and target not in step_ids for target in targets):
            raise ValueError("Transition targets must refer to existing step IDs.")
    if translations is not None:
        _validate_translations(workflow, translations)
    if not authored and "schedule" in workflow:
        problem = next(iter(schedule_problems(workflow)), None)
        if problem:
            raise ValueError(f"Invalid workflow schedule: {problem}")
    return workflow


def schedule_problems(workflow: dict) -> list[str]:
    """What keeps the workflow's ``schedule`` from running: an unknown timezone, or input values that do not fit. Inputs
    it leaves out are not a problem: its instructions say what to use, and the agent asks or chooses at run time.
    Whether its model is configured on this server is the caller's check (it depends on the machine)."""
    from zoneinfo import ZoneInfo

    schedule = workflow.get("schedule")
    if not isinstance(schedule, dict):
        return []
    problems = []
    if schedule.get("timezone"):
        try:
            ZoneInfo(str(schedule["timezone"]))
        except (KeyError, ValueError):
            problems.append(f"Unknown timezone {schedule['timezone']!r}; choose an IANA timezone.")
    try:
        resolve_setup(workflow, schedule.get("setup"), require_values=False)
    except ValueError as exc:
        problems.append(str(exc))
    return problems


_TOP_LEVEL_KEY = re.compile(r"^([A-Za-z_][\w-]*|'[^']*'|\"[^\"]*\")\s*:")


def set_schedule(content: str, schedule: dict | None) -> str:
    """The workflow YAML with its top-level ``schedule:`` block replaced by ``schedule`` (None removes it).

    Edits the text so the rest of the file (comments, order, quoting) stays as written."""
    if schedule is not None:
        schedule = {key: value for key, value in schedule.items() if key not in RETIRED_SCHEDULE_KEYS}
    lines = content.splitlines(keepends=True)
    kept, skipping = [], False
    for line in lines:
        match = _TOP_LEVEL_KEY.match(line)
        if match:
            skipping = match.group(1).strip("'\"") == "schedule"
        elif skipping and line.strip() and not line[0].isspace() and not line.lstrip().startswith("#"):
            skipping = False
        if not skipping:
            kept.append(line)
    text = "".join(kept).rstrip("\n") + "\n"
    if schedule is not None:
        text += yaml.safe_dump({"schedule": schedule}, sort_keys=False, allow_unicode=True, default_flow_style=None)
    before, after = load_workflow_yaml(content), load_workflow_yaml(text)
    if not isinstance(before, dict) or not isinstance(after, dict) or (
            {key: value for key, value in before.items() if key != "schedule"}
            != {key: value for key, value in after.items() if key != "schedule"}) or after.get("schedule") != schedule:
        raise ValueError("Could not update this workflow's schedule; edit the schedule block in its YAML.")
    return text


def resolve_setup(workflow: dict, setup: Any = None, *, require_values: bool = True) -> dict:
    if setup is None:
        setup = {}
    if not isinstance(setup, dict) or set(setup) - {"parameters", "instructions"}:
        raise ValueError("Setup must contain parameters and optional instructions.")
    values = setup.get("parameters", {})
    instructions = setup.get("instructions", "")
    if not isinstance(values, dict) or not isinstance(instructions, str) or len(instructions) > 8000:
        raise ValueError("Setup requires parameter values and instructions of at most 8,000 characters.")
    parameters = workflow.get("parameters", [])
    error = next(Draft202012Validator(WORKFLOW_DEFINITION_SCHEMA["properties"]["parameters"]).iter_errors(parameters), None)
    if error:
        location = ".".join(str(part) for part in error.absolute_path)
        raise ValueError(f"Invalid workflow parameters{'.' + location if location else ''}: {error.message}")
    names = set()
    resolved = {}
    for parameter in parameters:
        name = parameter["name"]
        if name in names:
            raise ValueError("Parameter names must be unique.")
        names.add(name)
        kind = parameter.get("type", "text")
        options = parameter.get("options", [])
        if kind == "select" and not options:
            raise ValueError("Select parameters need options.")
        value = values.get(name, parameter.get("default"))
        if value is None or (isinstance(value, str) and not value.strip()):
            if require_values and parameter.get("required"):
                raise ValueError(f"Provide {parameter['label']}.")
            continue
        valid = (isinstance(value, bool) if kind == "boolean" else
                 type(value) in (int, float) if kind == "number" else
                 isinstance(value, str) and len(value) <= 4000)
        if not valid or (kind == "select" and not parameter.get("allow_custom") and value not in options):
            raise ValueError(f"Invalid value for {parameter['label']}.")
        resolved[name] = value
    if set(values) - names:
        raise ValueError("Unknown workflow parameter.")
    try:
        json.dumps(resolved, allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise ValueError("Parameter values must be finite JSON values.") from exc
    return {"parameters": resolved, "instructions": instructions.strip()}


def load_workflow_yaml(content: str) -> Any:
    """The workflow YAML as data. An unquoted schedule time such as ``10:30`` reads as a YAML 1.1 base-60 number
    (630); it is read back as the time it was written as."""
    try:
        workflow = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError("Invalid workflow YAML.") from exc
    schedule = workflow.get("schedule") if isinstance(workflow, dict) else None
    if isinstance(schedule, dict):
        for key in RETIRED_SCHEDULE_KEYS:
            schedule.pop(key, None)
        if type(schedule.get("time")) is int and 0 <= schedule["time"] < 24 * 60:
            schedule["time"] = f"{schedule['time'] // 60:02d}:{schedule['time'] % 60:02d}"
    return workflow


def parse_workflow(content: str) -> dict[str, Any]:
    if len(content) > 48000:
        raise ValueError("Workflow exceeds 48,000 characters.")
    return validate_workflow_definition(load_workflow_yaml(content))


def parse_definition(content: str) -> dict[str, Any]:
    if not isinstance(content, str) or len(content) > 48000:
        raise ValueError("Workflow definition must be YAML text under 48,000 characters.")
    definition = load_workflow_yaml(content)
    if not isinstance(definition, dict):
        raise ValueError("Workflow definition must be a mapping.")
    if "steps" in definition:
        return parse_workflow(content)
    validated = parse_workflow(yaml.safe_dump({**definition, "steps": initial_steps()}))
    validated.pop("steps")
    return validated


def initial_steps() -> list[dict]:
    return [{"id": "plan", "instructions": "Inspect the workflow definition and available inputs. Ask about material unknowns, then use adapt_plan to establish execution steps and meaningful verification for the deliverables."}]


class WorkflowStore:
    def __init__(self, user_home: Path):
        self.files = ConfinedDir(Path(user_home) / "workflows", mkdir=True)

    def read(self, name: str) -> str:
        if isinstance(name, str) and name.startswith(('demo/', 'server/')):
            from data_formulator.configuration import resource_options, workflow_content
            from data_formulator.spaces import current_space_workflows
            offered = current_space_workflows()
            if offered is not None and name not in offered:
                raise ValueError('Workflow is not published.')
            options = resource_options('workflows', name)
            if not options.get('enabled', True):
                raise ValueError('Workflow is not published.')
            return workflow_content(name, options)
        self.validate_name(name)
        return self.files.read_text(name)

    @staticmethod
    def validate_name(name: str) -> None:
        if (not isinstance(name, str) or len(name) > 200
                or not re.match(r"\A[A-Za-z0-9][A-Za-z0-9_-]*(?:\.workflow)?\.ya?ml\Z", name)):
            raise ValueError("Use a simple .yaml filename.")

    def save(self, name: str, content: str) -> None:
        self.validate_name(name)
        parse_definition(content)
        self.files.write_text(name, content)

    def delete(self, name: str) -> None:
        self.validate_name(name)
        if (self.files.root / name).is_symlink():
            raise ValueError("Workflow files cannot be symlinks.")
        self.files.unlink(name)

    def list_all(self, language: str = "en") -> list[dict]:
        items = []
        sources = [(path, path.name, "user") for pattern in ("*.yaml", "*.yml") for path in sorted(self.files.rglob(pattern))]
        from data_formulator.spaces import current_space_workflows
        # A space offers its visitors' own workflows and the server workflows it lists; Data Formulator's example
        # workflows are the standard app's.
        offered = current_space_workflows()
        if offered is None:
            sources.extend((path, f"demo/{path.name}", "demo") for path in sorted(Path(__file__).parent.glob("*.yaml")))
        from data_formulator.configuration import read_configuration
        configured = read_configuration()['overrides'].get('workflows', {})
        sources.extend((Path(name), name, 'server') for name, options in configured.items()
                       if name.startswith('server/') and ('content' in options or 'file' in options)
                       and (offered is None or name in offered))
        for path, name, origin in sources:
            if origin != 'user' and not configured.get(name, {}).get('enabled', True):
                continue
            try:
                workflow = localize_definition(parse_definition(self.read(name)), language)
                items.append({"path": name, "name": workflow["name"], "overview": workflow["overview"], "origin": origin,
                              "parameters": workflow.get("parameters", []),
                              **({"schedule": workflow["schedule"]} if origin == "user" and "schedule" in workflow else {})})
            except ValueError as exc:
                items.append({"path": name, "name": path.stem, "error": str(exc), "origin": origin})
            except OSError:
                # An OSError names the file; server workflows may live anywhere on the server.
                logger.warning("Could not read workflow %s", name, exc_info=True)
                items.append({"path": name, "name": path.stem, "error": "Could not read this workflow file.", "origin": origin})
        return items