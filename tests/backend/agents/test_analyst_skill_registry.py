from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_formulator.analyst.skills import build_registry


pytestmark = [pytest.mark.backend]


def test_builtin_meta_bundle_has_concrete_hidden_owners() -> None:
    registry = build_registry()

    assert registry.expanded_names(["meta"]) == [
        "meta", "analysis", "workspace", "visualization",
    ]
    assert registry.gated_skill_names() == ["report", "terminal"]
    assert registry.get_skill("meta") is not None
    assert not registry.has("interaction")
    assert registry.action_owner("visualize") == "visualization"
    assert registry.action_owner("ask_user") == "meta"
    assert {
        spec["function"]["name"] for spec in registry.tools_for(["meta"])
    } == {
        "execute_python_script",
        "inspect_source_data",
        "create_file",
        "edit_file",
        "create_data",
        "update_data",
        "list_workspace_items",
        "read_workspace_item",
        "search_workspace_items",
        "summarize_data_sources", "list_data", "find_data", "describe_data", "probe_data",
        "list_connectors", "describe_connector", "read_connector_form",
    }
    assert {
        spec["function"]["name"] for spec in registry.action_tools_for(["meta"])
    } == {
        "visualize", "ask_user", "long_response",
        "propose_data_operation", "propose_connection", "update_connector_form", "propose_workflow",
    }
    assert registry.action_owner("long_response") == "meta"


def test_baseline_guides_progressive_visual_analysis() -> None:
    registry = build_registry()
    baseline = registry.load_body("meta")
    visualization = registry.load_body("visualization")
    assert baseline.count(visualization) == 1
    assert baseline.count("## Progressive Visual Analysis") == 1
    assert baseline.count("## Define Workflows In Conversation") == 1
    assert "## Define Workflows In Conversation" not in registry.load_body("workspace")
    assert "propose_workflow" in registry.action_names()
    assert "use the latest relevant complete definition" in baseline
    assert "actual steps and instructions, not only the summary" in baseline
    assert "near-identical proposal as an update" in baseline
    assert "complete structured definition" in baseline
    assert "Organize steps around analytical goals" in baseline
    assert "Expose meaningful rerun inputs as parameters" in baseline
    assert "Prefer text parameters for everyday descriptions, with boolean or select inputs" in baseline
    assert "Do not require ISO dates or other machine formats" in baseline
    assert "keep fixed requirements in the definition" in baseline
    assert "Preserve user acceptance criteria" in baseline
    assert "each phase combines its analysis" in baseline
    assert "before proposing, unless the user requests a draft" in baseline
    assert "Failed prerequisites" in baseline
    assert "pickup_datetime" not in baseline
    assert "explicit\nnonvisual requests" in visualization
    assert "Verify numerical claims independently" in visualization
    workspace = registry.load_body("workspace")
    assert "Omit `query` to add a source" in workspace
    assert "`compute_ready: false`" in workspace
    assert "Concrete queries never silently fall back to references" in workspace
    assert "Do not make a separate preparation call" in workspace
    assert "Use that dataset directly" in workspace
    assert "Virtual load outcomes are not local chart inputs" in visualization


def test_long_response_emits_terminal_completion_and_rejects_empty_content() -> None:
    from data_formulator.analyst.skills.base import SkillContext

    skill = build_registry().get_skill("meta")
    ctx = SkillContext(client=None, workspace=None, payload={"completed_step_count": 2})
    assert list(skill.handle_action("long_response", {"content": "# Expanded answer\n\nDetails."}, ctx)) == [{
        "type": "completion", "status": "success",
        "content": {"summary": "# Expanded answer\n\nDetails.", "presentation": "long_response", "total_steps": 2},
    }]
    for content in [None, "", "   ", 42]:
        events = skill.handle_action("long_response", {"content": content}, ctx)
        with pytest.raises(StopIteration) as stopped:
            next(events)
        assert "non-empty" in stopped.value.value


def test_connector_actions_are_registered_as_actions_not_read_only_tools() -> None:
    registry = build_registry()
    action_names = {spec["function"]["name"] for spec in registry.action_tools_for(["workspace"])}
    tool_names = {spec["function"]["name"] for spec in registry.tools_for(["workspace"])}

    assert action_names == {"propose_data_operation", "propose_connection", "update_connector_form", "propose_workflow"}
    for action_name in action_names:
        assert registry.action_owner(action_name) == "workspace"
        assert action_name not in tool_names
    assert {"list_connectors", "describe_connector", "read_connector_form"} <= tool_names


def test_meta_preserves_questions_and_options_beyond_three() -> None:
    from data_formulator.analyst.skills.base import SkillContext

    options = ["North", "South", "East", "West", "Central"]
    questions = [{"text": "Choose a region", "responseType": "single_choice", "options": options}] * 4
    events = list(build_registry().get_skill("meta").handle_action(
        "ask_user", {"questions": questions}, SkillContext(client=None, workspace=None, payload={}),
    ))
    assert len(events[0]["questions"]) == 4
    assert events[0]["questions"][0]["responseType"] == "single_choice"
    assert [option["label"] for option in events[0]["questions"][0]["options"]] == options


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