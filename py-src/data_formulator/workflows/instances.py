from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from data_formulator.security.path_safety import ConfinedDir


def parse_workflow(content: str) -> dict[str, Any]:
    if len(content) > 48000:
        raise ValueError("Workflow exceeds 48,000 characters.")
    try:
        workflow = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError("Invalid workflow YAML.") from exc
    if not isinstance(workflow, dict) or workflow.get("version") != 1:
        raise ValueError("Workflow must be a mapping with version: 1.")
    for field in ("name", "overview"):
        if not isinstance(workflow.get(field), str) or not workflow[field].strip():
            raise ValueError(f"Workflow requires {field}.")
    if "prompt" in workflow and (not isinstance(workflow["prompt"], str) or not workflow["prompt"].strip()):
        raise ValueError("Workflow prompt must be nonempty text.")
    if "source" in workflow:
        sources = workflow["source"] if isinstance(workflow["source"], list) else [workflow["source"]]
        if not sources or any(
            not isinstance(source, (str, dict)) or not source or (isinstance(source, str) and not source.strip())
            for source in sources
        ):
            raise ValueError("Workflow source must be nonempty text, a mapping, or a list of these.")
    deliverables = workflow.get("deliverables")
    if not isinstance(deliverables, list) or not deliverables or any(
        not isinstance(item, str) or not item.strip() for item in deliverables
    ):
        raise ValueError("Provide nonempty deliverables.")
    steps = workflow.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 30:
        raise ValueError("Provide 1-30 workflow steps.")
    step_ids: set[str] = set()
    check_ids: set[str] = set()
    for step in steps:
        if not isinstance(step, dict) or not isinstance(step.get("id"), str) or not step["id"].strip():
            raise ValueError("Each step needs an ID.")
        if step["id"] in step_ids:
            raise ValueError("Step IDs must be unique.")
        step_ids.add(step["id"])
        if not isinstance(step.get("instructions"), str) or not step["instructions"].strip():
            raise ValueError("Each step needs instructions.")
        if "description" in step and (not isinstance(step["description"], str) or not step["description"].strip()):
            raise ValueError("Step description must be nonempty text.")
        checks = step.get("checkers", [])
        if not isinstance(checks, list):
            raise ValueError("checkers must be a list.")
        for check in checks:
            if not isinstance(check, dict) or not isinstance(check.get("id"), str) or not check["id"].strip():
                raise ValueError("Each checker needs an ID.")
            if check["id"] in check_ids:
                raise ValueError("Checker IDs must be unique across the workflow.")
            check_ids.add(check["id"])
            if not isinstance(check.get("condition"), str) or not check["condition"].strip():
                raise ValueError("Each checker needs a condition.")
            if check.get("when", "after") not in ("before", "during", "after"):
                raise ValueError("Checker when must be before, during, or after.")
    for step in steps:
        targets = [step.get("next")] + [check.get("on_fail") for check in step.get("checkers", [])]
        if any(target is not None and (not isinstance(target, str) or target not in step_ids) for target in targets):
            raise ValueError("Transition targets must refer to existing step IDs.")
    try:
        json.dumps(workflow, allow_nan=False)
    except (ValueError, TypeError, RecursionError) as exc:
        raise ValueError("Workflow must contain JSON-compatible values; quote dates.") from exc
    return workflow


class WorkflowStore:
    def __init__(self, user_home: Path):
        self.files = ConfinedDir(Path(user_home) / "workflows", mkdir=True)

    def read(self, name: str) -> str:
        if isinstance(name, str) and name.startswith("demo/"):
            filename = name.removeprefix("demo/")
            self.validate_name(filename)
            path = Path(__file__).with_name(filename)
            if path.is_symlink():
                raise ValueError("Workflow files cannot be symlinks.")
            return path.read_text(encoding="utf-8")
        self.validate_name(name)
        return self.files.read_text(name)

    @staticmethod
    def validate_name(name: str) -> None:
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*\.yaml", name):
            raise ValueError("Use a simple .yaml filename.")

    def save(self, name: str, content: str) -> None:
        self.validate_name(name)
        parse_workflow(content)
        self.files.write_text(name, content)

    def delete(self, name: str) -> None:
        self.validate_name(name)
        if (self.files.root / name).is_symlink():
            raise ValueError("Workflow files cannot be symlinks.")
        self.files.unlink(name)

    def list_all(self) -> list[dict]:
        items = []
        sources = [(path, path.name, "user") for path in sorted(self.files.rglob("*.yaml"))]
        sources.extend((path, f"demo/{path.name}", "demo") for path in sorted(Path(__file__).parent.glob("*.yaml")))
        for path, name, origin in sources:
            try:
                workflow = parse_workflow(self.read(name))
                items.append({"path": name, "name": workflow["name"], "overview": workflow["overview"], "origin": origin})
            except (ValueError, OSError) as exc:
                items.append({"path": name, "name": path.stem, "error": str(exc), "origin": origin})
        return items