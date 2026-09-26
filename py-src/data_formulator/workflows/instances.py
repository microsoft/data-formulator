from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from data_formulator.security.path_safety import ConfinedDir


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
    },
}


def validate_workflow_definition(workflow: Any, *, authored: bool = False) -> dict[str, Any]:
    try:
        json.dumps(workflow, allow_nan=False)
    except (ValueError, TypeError, RecursionError) as exc:
        raise ValueError("Workflow must contain JSON-compatible values; quote dates.") from exc
    schema = deepcopy(WORKFLOW_DEFINITION_SCHEMA)
    if not authored:
        schema["properties"]["steps"]["items"]["required"].remove("description")
    error = next(Draft202012Validator(schema).iter_errors(workflow), None)
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
    return workflow


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


def parse_workflow(content: str) -> dict[str, Any]:
    if len(content) > 48000:
        raise ValueError("Workflow exceeds 48,000 characters.")
    try:
        workflow = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError("Invalid workflow YAML.") from exc
    return validate_workflow_definition(workflow)


def parse_definition(content: str) -> dict[str, Any]:
    if not isinstance(content, str) or len(content) > 48000:
        raise ValueError("Workflow definition must be YAML text under 48,000 characters.")
    try:
        definition = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError("Invalid workflow YAML.") from exc
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
            options = resource_options('workflows', name)
            if not options.get('enabled', True):
                raise ValueError('Workflow is not published.')
            return workflow_content(name, options)
        self.validate_name(name)
        return self.files.read_text(name)

    @staticmethod
    def validate_name(name: str) -> None:
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*(?:\.workflow)?\.ya?ml", name):
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

    def list_all(self) -> list[dict]:
        items = []
        sources = [(path, path.name, "user") for pattern in ("*.yaml", "*.yml") for path in sorted(self.files.rglob(pattern))]
        sources.extend((path, f"demo/{path.name}", "demo") for path in sorted(Path(__file__).parent.glob("*.yaml")))
        from data_formulator.configuration import read_configuration
        configured = read_configuration()['overrides'].get('workflows', {})
        sources.extend((Path(name), name, 'server') for name, options in configured.items()
                       if name.startswith('server/') and ('content' in options or 'file' in options))
        for path, name, origin in sources:
            if origin != 'user' and not configured.get(name, {}).get('enabled', True):
                continue
            try:
                workflow = parse_definition(self.read(name))
                items.append({"path": name, "name": workflow["name"], "overview": workflow["overview"], "origin": origin,
                              "parameters": workflow.get("parameters", [])})
            except (ValueError, OSError) as exc:
                items.append({"path": name, "name": path.stem, "error": str(exc), "origin": origin})
        return items