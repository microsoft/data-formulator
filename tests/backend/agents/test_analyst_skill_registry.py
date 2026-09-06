from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_formulator.analyst.skills import build_registry


pytestmark = [pytest.mark.backend]


def test_builtin_meta_bundle_has_concrete_hidden_owners() -> None:
    registry = build_registry()

    assert registry.expanded_names(["meta"]) == [
        "meta", "analysis", "workspace", "visualization", "interaction",
    ]
    assert registry.gated_skill_names() == ["load-data", "report"]
    assert registry.get_skill("meta") is None
    assert registry.action_owner("visualize") == "visualization"
    assert registry.action_owner("ask_user") == "interaction"
    assert {
        spec["function"]["name"] for spec in registry.tools_for(["meta"])
    } == {
        "execute_python_script",
        "inspect_source_data",
        "list_workspace_items",
        "read_workspace_item",
        "search_workspace_items",
        "manage_workspace_memory",
    }
    assert {
        spec["function"]["name"] for spec in registry.action_tools_for(["meta"])
    } == {"visualize", "ask_user"}


def _write_skill(
    root: Path,
    name: str,
    *,
    includes: tuple[str, ...] = (),
    tools: tuple[str, ...] = (),
    actions: tuple[str, ...] = (),
    always_on: bool = False,
) -> None:
    skill_dir = root / name
    skill_dir.mkdir()
    frontmatter = [
        "---",
        f"name: {name}",
        f"always_on: {str(always_on).lower()}",
        f"includes: [{', '.join(includes)}]",
        f"tools: [{', '.join(tools)}]",
        f"actions: [{', '.join(actions)}]",
        "---",
        f"# {name} body",
    ]
    (skill_dir / "SKILL.md").write_text("\n".join(frontmatter), encoding="utf-8")
    specs = [
        {
            "type": "function",
            "function": {
                "name": tool_name,
                "parameters": {"type": "object", "properties": {}},
            },
        }
        for tool_name in (*tools, *actions)
    ]
    (skill_dir / "tools.json").write_text(json.dumps(specs), encoding="utf-8")


def test_registry_expands_bundles_and_hides_implementation_members(tmp_path: Path) -> None:
    _write_skill(
        tmp_path,
        "meta",
        includes=("analysis", "workspace", "cycle-a"),
        always_on=True,
    )
    _write_skill(tmp_path, "analysis", tools=("inspect",))
    _write_skill(tmp_path, "workspace", includes=("analysis",), tools=("list_items",))
    _write_skill(tmp_path, "cycle-a", includes=("cycle-b",), actions=("visualize",))
    _write_skill(tmp_path, "cycle-b", includes=("cycle-a",))
    _write_skill(tmp_path, "load-data", tools=("find_data",), actions=("propose_load",))
    (tmp_path / "_private").mkdir()
    (tmp_path / "_private" / "SKILL.md").write_text("---\nname: _private\n---\n")

    registry = build_registry(tmp_path)

    assert registry.expanded_names(["meta"]) == [
        "meta", "analysis", "workspace", "cycle-a", "cycle-b",
    ]
    assert registry.gated_skill_names() == ["load-data"]
    assert [
        spec["function"]["name"] for spec in registry.tools_for(["meta", "analysis"])
    ] == ["inspect", "list_items"]
    assert [
        spec["function"]["name"] for spec in registry.action_tools_for(["meta"])
    ] == ["visualize"]
    assert registry.action_owner("visualize") == "cycle-a"
    assert registry.is_active({"meta"}, "cycle-a")
    assert "# meta body" in registry.load_body("meta")
    assert "# analysis body" in registry.load_body("meta")
    assert "_private" not in registry.names()