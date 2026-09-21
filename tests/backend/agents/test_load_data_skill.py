from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pyarrow as pa
import pytest

from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.workspace_inputs import (
    WorkspaceInputManifest,
    WorkspaceInputRef,
)
from data_formulator.data_operations import DataOperationRepository
from data_formulator.datalake.catalog_cache import save_catalog
from data_formulator.datalake.workspace import Workspace
from data_formulator.security.path_safety import ConfinedDir

pytestmark = [pytest.mark.backend]


class _Workspace:
    def __init__(self, user_home: Path):
        self.user_home = user_home

    def get_metadata(self):
        return None

    @property
    def confined_root(self):
        return ConfinedDir(self.user_home)

    @property
    def confined_scratch(self):
        return ConfinedDir(self.user_home / "scratch")


class _Loader:
    def __init__(self):
        self.calls: list[tuple[list[str], dict]] = []

    def probe(self, path, query):
        self.calls.append((path, query))
        return {"rows": [{"n": 1}], "columns": ["n"], "exact": True}


def _context(
    workspace: _Workspace,
    skill_state: dict | None = None,
    narration: str = "",
) -> SkillContext:
    return SkillContext(
        client=None,
        workspace=workspace,
        payload={
            "skill_state": skill_state if skill_state is not None else {},
            "conversation_id": "conversation-1",
            "action_narration": narration,
        },
    )


def _save_orders_catalog(user_home: Path) -> None:
    save_catalog(user_home, "warehouse", [{
        "name": "Recent orders",
        "table_key": "public.orders",
        "path": ["public", "orders"],
        "metadata": {"_source_name": "public.orders"},
    }])


def test_workspace_owns_discovery_and_loading_without_an_extra_skill_gate() -> None:
    registry = build_registry()

    assert not registry.has("load-data")
    assert not registry.has("load")
    assert not registry.has("data-loading")
    assert not registry.has("data_loading")
    assert not registry.has("sources")
    assert "delegate" not in registry.metas["meta"].action_names
    meta = registry.metas["workspace"]
    assert meta.always_on is False
    assert meta.action_names == ("propose_data_operation", "propose_connection", "update_connector_form")
    assert set(meta.tool_names) == {
        "create_file", "edit_file", "create_data", "update_data", "list_workspace_items",
        "read_workspace_item", "search_workspace_items",
        "summarize_data_sources", "list_data", "find_data", "describe_data", "probe_data",
        "list_connectors", "describe_connector", "read_connector_form",
    }
    assert registry.tools_for(["meta"]) == registry.tools_for(["meta", "workspace"])
    assert {
        spec["function"]["name"]
        for spec in registry.tools_for(["workspace"])
    } == set(meta.tool_names)
    assert {
        spec["function"]["name"]
        for spec in registry.action_tools_for(["workspace"])
    } == set(meta.action_names)


def test_workspace_uses_one_canonical_skill_directory() -> None:
    registry = build_registry()

    assert registry.canonical_name("workspace") == "workspace"
    assert registry._doc_paths["workspace"].parent.name == "workspace"
    assert "load-data" not in registry.gated_skill_names()


def test_workspace_baseline_includes_loading_guidance(tmp_path: Path) -> None:
    from data_formulator.analyst.agent import AnalystAgent

    agent = AnalystAgent(client=None, workspace=_Workspace(tmp_path))
    empty_inputs = WorkspaceInputManifest(inputs=())
    data_inputs = WorkspaceInputManifest(inputs=(
        WorkspaceInputRef(
            id="data:orders",
            kind="data",
            display_name="orders",
            media_type="application/vnd.data-formulator.table",
            size_bytes=None,
            content_hash=None,
            capabilities=("read",),
        ),
    ))
    agent._loaded_skills = agent._initial_loaded_skills(empty_inputs)

    prompt = agent._build_system_prompt()

    assert agent._loaded_skills == {"meta"}
    assert agent._initial_loaded_skills(data_inputs) == {"meta"}
    assert prompt.count("# Workspace\n") == 1
    assert "load-data" not in prompt
    assert "## Read Available Data" in prompt
    assert "## Create or Revise Workspace Outputs" in prompt
    assert "## Bring In Missing Data" in prompt
    assert "## Common Workflows" in prompt
    assert "## Data Boundaries" in prompt
    assert "files need no promotion or another upload to be read" in prompt
    assert prompt.count("## Data Access Paths") == 1
    assert "Continue to the requested answer or chart\nin the same run" in prompt
    assert "Clear single-option imports may execute automatically" in prompt
    assert "coverage contains the request" in prompt
    assert "Retaining useful columns\nor finer detail" in prompt
    assert "are the only data that can be read directly" not in prompt
    assert "propose_data_operation" in agent._legal_actions()
    assert "`summarize_data_sources({})` across connected sources" in prompt
    assert "Do not ask which source to inspect for a broad availability question" in prompt


@pytest.mark.parametrize("has_charts", [False, True])
def test_baseline_prioritizes_informative_charts_for_comparative_answers(tmp_path: Path, has_charts: bool) -> None:
    from data_formulator.analyst.agent import AnalystAgent

    agent = AnalystAgent(client=None, workspace=_Workspace(tmp_path))
    agent._loaded_skills = {"meta"}
    prompt = " ".join(agent._build_system_prompt(has_charts=has_charts).split())

    assert "use `visualize` by default for comparisons, rankings, trends, distributions, and relationships" in prompt
    assert "call `visualize` before ending the run" in prompt
    assert "do not merely offer to make a chart" in prompt
    assert "Reuse an existing chart if it already answers the question" in prompt
    assert "unique source-destination IP pairs can still be ranked by bytes transferred" in prompt
    assert "Answer single-value lookups, definitions, and procedural questions directly" in prompt
    assert "Respect an explicit text-only request" in prompt
    assert "Do not invent values or infer full-population rankings from a preview sample" in prompt
    assert "visualize" in agent._legal_actions()


def test_workflow_guidance_matches_tool_effects(tmp_path: Path) -> None:
    from data_formulator.analyst.agent import AnalystAgent

    agent = AnalystAgent(client=None, workspace=_Workspace(tmp_path))
    agent._loaded_skills = {"meta"}
    prompt = " ".join(agent._build_system_prompt(has_charts=True).split())
    for rule in (
        "File and data tools also return results, but create or revise durable workspace outputs",
        "all sibling calls, including non-action tools, are discarded",
        "Plain text with no tool calls ends the run",
        "The namespace persists within an inspection cycle",
        "Visualization code must be standalone",
        "Discovery does not load data or make catalog paths readable",
        "Host commands require explicit approval",
        "Never write directly to `data/`, `files/`, `memory/`, or hidden runtime files",
    ):
        assert rule in prompt
    assert "Each call has a fresh namespace" not in prompt
    report = " ".join(agent.registry.load_body("report").split())
    assert "returns an observation; it does not end the run" in report
    assert "delivered as-is and the run ends" not in report
    report_tool = next(spec["function"] for spec in agent.registry.action_tools_for(["report"])
                       if spec["function"]["name"] == "write_report")
    assert "return an observation" in report_tool["description"]
    assert "end the run" not in report_tool["description"]
    assert "An ordinary summary can be answered directly without report delivery" in prompt
    assert "write up / summarize / report" not in prompt
    assert "successful `visualize` result" in report
    assert "other threads only when relevant" in report
    assert "Reuse verified findings and charts" in report
    assert "Embed every chart you discuss" not in report
    assert "make the one `write_report` call" not in report


def test_meta_profile_expands_runtime_capabilities_without_expanding_loaded_names(
    tmp_path: Path,
) -> None:
    from data_formulator.analyst.agent import AnalystAgent
    from data_formulator.analyst.skills.analysis.skill import AnalysisSkill
    from data_formulator.analyst.skills.workspace.skill import WorkspaceSkill

    agent = AnalystAgent(client=None, workspace=_Workspace(tmp_path))
    agent._loaded_skills = {"meta"}

    assert agent._loaded_skills == {"meta"}
    assert agent._legal_actions() == frozenset({
        "visualize", "ask_user", "long_response",
        "propose_data_operation", "propose_connection", "update_connector_form",
    })
    handlers = agent._loaded_skill_tool_map()
    assert isinstance(handlers["execute_python_script"], AnalysisSkill)
    assert isinstance(handlers["list_workspace_items"], WorkspaceSkill)
    assert handlers["find_data"] is handlers["list_workspace_items"]
    assert handlers["read_connector_form"] is handlers["list_workspace_items"]
    prompt = agent._build_system_prompt()
    assert "[SKILL: meta] Always-on baseline" in prompt
    assert "# Analysis" in prompt
    assert "# Workspace" in prompt
    assert "# Visualization" in prompt


def test_discovery_to_import_policy_preserves_confirmation_and_optional_questions(tmp_path: Path) -> None:
    from data_formulator.analyst.agent import AnalystAgent

    agent = AnalystAgent(client=None, workspace=_Workspace(tmp_path))
    agent._loaded_skills = {"meta"}
    prompt = agent._build_system_prompt()
    assert "search connected catalogs with `find_data` before asking the user" in prompt
    assert "need not block a bounded catalog search" in prompt
    assert "Use one option with `user_review_needed: false` for a clear load" in prompt
    assert "multiple alternatives always require review" in prompt
    assert "A discovery-only request does not require loading" in prompt
    assert "A statement of intended\nwork is not completion" in prompt
    assert "Prefer `ask_user`" in prompt
    assert "a preference, not a requirement" in prompt
    specs = {
        spec["function"]["name"]: spec["function"]
        for spec in agent.registry.tools_for(["meta"]) + agent.registry.action_tools_for(["meta"])
    }
    assert "Search results are not loaded data" in specs["find_data"]["description"]
    assert "workspace Data Access Paths" in specs["propose_data_operation"]["description"]
    assert "user_review_needed=false" in specs["propose_data_operation"]["description"]
    assert "user_review_needed" not in specs["propose_data_operation"]["parameters"]["required"]
    assert "user_review_needed" not in agent.registry.action_required_fields("propose_data_operation")


def test_tool_progress_args_are_useful_and_credential_safe() -> None:
    from data_formulator.analyst.agent import _tool_progress_args

    assert _tool_progress_args("find_data", {
        "query": "orders",
        "source_id": "warehouse",
        "path": ["public"],
        "password": "secret",
    }) == {
        "query": "orders",
        "source_id": "warehouse",
        "path": ["public"],
    }
    assert _tool_progress_args("describe_connector", {
        "source_type": "databricks",
        "prefilled": {"token": "secret"},
    }) == {"source_type": "databricks"}
    probe_progress = _tool_progress_args("probe_data", {
        "source_id": "warehouse",
        "table_key": "orders",
        "query": {
            "aggregates": [{"op": "sum", "column": "revenue"}],
            "filters": [{"column": "customer", "op": "EQ", "value": "Secret Corp"}],
            "limit": 20,
        },
    })
    assert probe_progress["query"] == {
        "aggregates": [{"op": "sum", "column": "revenue"}],
        "limit": 20,
        "filter_count": 1,
    }
    assert "Secret Corp" not in json.dumps(probe_progress)
    assert _tool_progress_args("unknown_tool", {"token": "secret"}) == {}


@pytest.mark.parametrize("legacy_body", [
    "",
    "[SKILL LOADED: load-data]\nLegacy discovery guidance",
    "[SKILL: load-data] Preloaded for this run\nLegacy discovery guidance",
])
def test_resume_keeps_workspace_loading_available_without_a_separate_gate(tmp_path: Path, legacy_body: str) -> None:
    from data_formulator.analyst.agent import AnalystAgent

    agent = AnalystAgent(client=None, workspace=_Workspace(tmp_path))
    agent._loaded_skills = agent._initial_loaded_skills(
        WorkspaceInputManifest(inputs=()),
    )
    system_prompt = agent._build_system_prompt()
    agent._loaded_skills = {"meta"}

    agent._rehydrate_loaded_skills([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": legacy_body},
    ])

    assert agent._loaded_skills == {"meta"}
    assert "propose_data_operation" in agent._legal_actions()
    assert "find_data" in agent._loaded_skill_tool_map()


@pytest.mark.parametrize("has_system_prompt", [True, False])
def test_resume_preserves_existing_instructions_and_conversation(tmp_path: Path, has_system_prompt: bool) -> None:
    from data_formulator.analyst.agent import AnalystAgent

    workspace = Workspace("test-user", root_dir=tmp_path)
    client = MagicMock()
    client.model = "test-model"
    agent = AnalystAgent(client=client, workspace=workspace)
    history = [
        {"role": "user", "content": "I want consumer price data"},
        {"role": "assistant", "content": None, "tool_calls": [{
            "id": "load-report", "type": "function",
            "function": {"name": "load_skill", "arguments": '{"name":"report"}'},
        }]},
        {"role": "tool", "tool_call_id": "load-report", "content": "Skill loaded"},
        {"role": "user", "content": "[SKILL LOADED: report]\nSTALE REPORT INSTRUCTIONS"},
        {"role": "user", "content": "[SKILL LOADED: load-data]\nSTALE LOADING INSTRUCTIONS"},
        {"role": "system", "content": "Preserve this unrelated run instruction"},
        {"role": "user", "content": "Please find available data first"},
    ]
    trajectory = ([{"role": "system", "content": "STALE BASELINE INSTRUCTIONS"}] if has_system_prompt else []) + history
    original_trajectory = list(trajectory)
    agent._build_system_prompt = MagicMock(side_effect=AssertionError("Resume must not rebuild instructions"))
    observed = []

    def next_action(messages, *args, **kwargs):
        observed.extend(messages)
        yield {"type": "agent_action", "final_text": "Ready"}

    agent._get_next_action = next_action
    reference = {"kind": "external-table-reference", "id": "external:warehouse:reviews",
                 "connectorId": "warehouse", "tableKey": "reviews", "displayName": "Reviews",
                 "summary": {"columns": []}}
    events = list(agent.run([], "Please find available data first", trajectory=trajectory,
                           external_references=[reference], focused_external_reference=reference["id"]))
    assert events[-1]["type"] == "completion"
    assert observed[:-2] == original_trajectory
    assert observed[-2]["content"].startswith("[CURRENT WORKSPACE FILE CONTEXT]")
    assert observed[-1]["content"].startswith("[EXTERNAL TABLE REFERENCES]")
    assert json.loads(observed[-1]["content"].splitlines()[-1])["focused_reference"] == reference["id"]
    assert agent._run_payload["external_references"] == [reference]
    agent._build_system_prompt.assert_not_called()
    assert agent._loaded_skills == {"meta", "report"}
    assert "find_data" in agent._loaded_skill_tool_map()
    assert "write_report" in agent._legal_actions()


def test_proposal_persists_executable_plan_and_emits_display_only_pause(tmp_path: Path) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("workspace")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
            "user_review_needed": True,
            "response": "I found a bounded recent-orders dataset that matches the demand analysis request.",
            "options": [{
                "label": "Recent orders",
                "tables": [{
                    "source_id": "warehouse",
                    "table_key": "public.orders",
                    "query": {
                        "limit": 1000,
                        "filters": [{
                            "column": "created_at",
                            "op": "GTE",
                            "value": "2025-01-01",
                        }],
                    },
                }],
            }],
        },
        _context(_Workspace(tmp_path)),
    ))

    assert len(events) == 1
    event = events[0]
    assert event["type"] == "interact"
    public_step = event["data_operation"]["plans"][0]["steps"][0]
    assert public_step == {
        "kind": "connector_query",
        "display_name": "Recent orders",
    }
    assert event["questions"][0]["options"][0]["value"]
    persisted = json.loads(
        (tmp_path / "scratch" / "data_operations" / "data_operations.json").read_text()
    )
    stored_step = persisted["operations"][0]["operation"]["plans"][0]["steps"][0]
    assert stored_step["source_id"] == "warehouse"
    assert stored_step["query"]["limit"] == 1000
    assert stored_step["query"]["filters"][0] == {
        "column": "created_at",
        "op": "GTE",
        "value": "2025-01-01",
    }


@pytest.mark.parametrize("through_agent", [False, True])
@pytest.mark.parametrize("include_review_flag", [False, True])
def test_unambiguous_load_executes_without_review_or_narration(
    tmp_path: Path, through_agent: bool, include_review_flag: bool,
) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    _save_orders_catalog(workspace.user_home)
    loader = MagicMock()
    loader.fetch_data_as_arrow.return_value = pa.table({"amount": [10.0, 20.0]})
    loader.get_safe_params.return_value = {}
    skill = build_registry().get_skill("workspace")
    spec = {"user_review_needed": False,
            "options": [{"label": "Recent orders", "tables": [{"source_id": "warehouse", "table_key": "public.orders"}]}]}
    if not include_review_flag:
        spec.pop("user_review_needed")
    with patch("data_formulator.data_connector.resolve_live_loader", return_value=loader):
        if through_agent:
            from data_formulator.analyst.agent import AnalystAgent
            analyst = AnalystAgent(client=None, workspace=workspace)
            analyst._run_payload = {"input_tables": [], "conversation_id": "conversation-1"}
            generator = analyst._dispatch_skill_action("workspace", "propose_data_operation", spec, [], 1, [])
            events = [next(generator) for _ in range(3)]
            with pytest.raises(StopIteration) as stopped:
                next(generator)
            assert stopped.value.value
            observation = json.loads(stopped.value.value.split("\n", 1)[1])
            loaded_input = observation["workspace_inputs"][0]
            assert loaded_input["path"].startswith("data/")
            assert loaded_input["row_count"] == 2
            assert loaded_input["columns"][0]["name"] == "amount"
            assert analyst._run_payload["input_tables"]
            assert analyst._run_payload["workspace_inputs"].inputs
        else:
            events = list(skill.handle_action("propose_data_operation", spec, _context(workspace)))
    assert [event["type"] for event in events] == ["tool_start", "tool_result", "data_operation_result"]
    operation = events[-1]["operation"]
    assert operation["status"] == "loaded"
    assert operation["result_table_ids"]
    assert workspace.list_tables()
    loader.fetch_data_as_arrow.assert_called_once()


@pytest.mark.parametrize("include_review_flag", [False, True])
def test_multiple_load_options_still_require_review(tmp_path: Path, include_review_flag: bool) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("workspace")
    option = {"label": "Recent orders", "tables": [{"source_id": "warehouse", "table_key": "public.orders"}]}
    spec = {"response": "Which scope should I use?", "options": [option, option]}
    if include_review_flag:
        spec["user_review_needed"] = False
    with patch("data_formulator.data_connector.resolve_live_loader") as loader:
        events = list(skill.handle_action("propose_data_operation", spec, _context(_Workspace(tmp_path))))
    assert events[0]["type"] == "interact"
    loader.assert_not_called()


def test_large_source_load_returns_virtual_outcome_and_reuses_inventory(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    workspace = Workspace("test-user", root_dir=tmp_path)
    save_catalog(workspace.user_home, "warehouse", [{"name": "Orders", "table_key": "orders",
        "path": ["orders"], "metadata": {"row_count": 2000000, "columns": [{"name": "amount", "type": "number"}]}}])
    skill = build_registry().get_skill("workspace")
    context = _context(workspace)
    spec = {"options": [{"label": "Add orders", "tables": [{"source_id": "warehouse", "table_key": "orders"}]}]}
    with patch("data_formulator.data_connector.resolve_live_loader") as loader:
        for attempt in range(2):
            events = list(skill.handle_action("propose_data_operation", spec, context))
            assert events[-1]["operation"]["status"] == "loaded"
            assert events[1]["status"] == "ok"
            result = context.payload["last_data_operation_result"]
            assert result["workspace_inputs"] == []
            assert result["load_outcomes"][0]["availability"] == "virtual"
            assert result["load_outcomes"][0]["compute_ready"] is False
            assert "path" not in result["load_outcomes"][0]
            stored = DataOperationRepository.for_workspace(workspace).get(result["id"])
            assert stored.result_references[0]["tableKey"] == "orders"
        loader.assert_not_called()
    assert len(context.payload["external_references"]) == 1
    assert context.payload["input_tables"] == []
    assert workspace.list_tables() == []
    materialized_loader = MagicMock()
    materialized_loader.fetch_data_as_arrow.return_value = pa.table({"amount": [10.0]})
    materialized_loader.get_safe_params.return_value = {}
    spec["options"][0]["tables"][0]["query"] = {"limit": 10}
    with patch("data_formulator.data_connector.resolve_live_loader", return_value=materialized_loader):
        events = list(skill.handle_action("propose_data_operation", spec, context))
    result = context.payload["last_data_operation_result"]
    assert result["load_outcomes"][0]["availability"] == "materialized"
    assert result["load_outcomes"][0]["compute_ready"] is True
    assert result["workspace_inputs"][0]["path"].startswith("data/")
    assert len(context.payload["external_references"]) == 1
    materialized_loader.fetch_data_as_arrow.assert_called_once()


@pytest.mark.parametrize("flag", ["false", 0, None])
def test_review_flag_requires_a_boolean(tmp_path: Path, flag) -> None:
    skill = build_registry().get_skill("workspace")
    events = list(skill.handle_action("propose_data_operation", {"user_review_needed": flag}, _context(_Workspace(tmp_path))))
    assert events[0]["type"] == "error"
    assert "must be a boolean" in events[0]["message"]


@pytest.mark.parametrize("existing", [False, True])
@pytest.mark.parametrize("fails", [False, True])
def test_query_load_registers_only_missing_source_alongside_result(tmp_path, existing, fails):
    workspace = Workspace("test-user", root_dir=tmp_path)
    save_catalog(workspace.user_home, "warehouse", [{"name": "All orders", "table_key": "orders",
        "path": ["orders"], "metadata": {"row_count": 20}}])
    context = _context(workspace)
    reference = {"kind": "external-table-reference", "id": "external:warehouse:orders",
        "connectorId": "warehouse", "tableKey": "orders", "displayName": "My orders",
        "sourceTable": {"id": "orders", "name": "orders"}, "capturedAt": "original", "summary": {"columns": []}}
    if existing:
        context.payload["external_references"] = [reference]
    loader = MagicMock()
    loader.get_safe_params.return_value = {}
    if fails:
        loader.fetch_data_as_arrow.side_effect = ValueError("Query failed")
    else:
        loader.fetch_data_as_arrow.return_value = pa.table({"amount": [10.0]})
    spec = {"options": [{"label": "Recent orders", "tables": [{"source_id": "warehouse", "table_key": "orders",
        "display_name": "Recent orders", "query": {"limit": 10}}]}]}
    with patch("data_formulator.data_connector.resolve_live_loader", return_value=loader):
        events = list(build_registry().get_skill("workspace").handle_action("propose_data_operation", spec, context))
    result = context.payload["last_data_operation_result"]
    assert events[1]["status"] == ("error" if fails else "ok")
    assert bool(result.get("failed_steps")) is fails
    assert len(context.payload["external_references"]) == 1
    if existing:
        assert context.payload["external_references"] == [reference]
        assert not result.get("result_references")
    else:
        assert result["result_references"][0]["displayName"] == "All orders"
        assert result["load_outcomes"][0]["compute_ready"] is False
    if fails:
        assert result["workspace_inputs"] == []
        assert result["failed_steps"][0]["error"]["message"] == "Query failed"
    else:
        assert result["workspace_inputs"][0]["compute_ready"] is True
        assert result["workspace_inputs"][0]["path"].startswith("data/")
    loader.fetch_data_as_arrow.assert_called_once()


def test_narration_is_the_response_shown_to_the_user(tmp_path: Path) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("workspace")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
            "user_review_needed": True,
            "response": "terse fallback",
            "options": [{
                "label": "Recent orders",
                "tables": [{"source_id": "warehouse", "table_key": "public.orders"}],
            }],
        },
        _context(_Workspace(tmp_path), narration="Here is what I found and why it matters."),
    ))

    assert events[0]["data_operation"]["description"] == "Here is what I found and why it matters."


def test_invalid_proposal_returns_recoverable_observation(tmp_path: Path) -> None:
    skill = build_registry().get_skill("workspace")
    assert skill is not None
    generator = skill.handle_action(
        "propose_data_operation",
        {"response": "Choose data to load.", "options": []},
        _context(_Workspace(tmp_path)),
    )

    assert next(generator)["type"] == "error"
    with pytest.raises(StopIteration) as stopped:
        next(generator)
    assert "one to three options" in stopped.value.value


def test_proposal_does_not_require_plan_descriptions(tmp_path: Path) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("workspace")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
            "user_review_needed": True,
            "response": "I found recent orders that can support the requested analysis.",
            "options": [{
                "label": "Recent orders",
                "tables": [{
                    "source_id": "warehouse",
                    "table_key": "public.orders",
                }],
            }],
        },
        _context(_Workspace(tmp_path)),
    ))

    assert events[0]["type"] == "interact"


def test_minimal_proposal_resolves_table_fields_from_catalog(tmp_path: Path) -> None:
    save_catalog(tmp_path, "warehouse", [{
        "name": "Orders",
        "table_key": "public.orders",
        "path": ["public", "orders"],
        "metadata": {
            "_source_name": "public.orders",
            "row_count": 1200,
        },
    }])
    skill = build_registry().get_skill("workspace")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
            "user_review_needed": True,
            "response": "I found the orders table needed for this analysis.",
            "options": [{
                "label": "Load orders",
                "tables": [{
                    "source_id": "warehouse",
                    "table_key": "public.orders",
                    "query": {
                        "filters": [{"column": "region", "op": "EQ", "value": "west"}],
                        "limit": 500,
                    },
                }],
            }],
        },
        _context(_Workspace(tmp_path)),
    ))

    assert events[0]["type"] == "interact"
    stored = DataOperationRepository.for_workspace(_Workspace(tmp_path)).get(
        events[0]["data_operation"]["id"]
    )
    assert stored is not None
    step = stored.plans[0].steps[0]
    assert step.display_name == "Load orders"
    assert step.source_table == "public.orders"
    assert step.query.limit == 500


def test_canonical_proposal_does_not_add_canvas_prose(tmp_path: Path) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("workspace")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
            "user_review_needed": True,
            "response": "I found recent orders that match the request.",
            "options": [{
                "label": "Recent orders",
                "tables": [{
                    "source_id": "warehouse",
                    "table_key": "public.orders",
                }],
            }],
        },
        _context(_Workspace(tmp_path)),
    ))

    assert events[0]["type"] == "interact"
    assert events[0]["data_operation"]["canvas_summary"] == ""


def test_proposal_rejects_exact_query_already_loaded_in_workspace(tmp_path: Path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    _save_orders_catalog(workspace.user_home)
    workspace.write_parquet_from_arrow(
        pa.table({"order_id": [1]}),
        "recent_orders",
        source_info={
            "loader_type": "WarehouseLoader",
            "loader_params": {},
            "source_table": "public.orders",
            "import_options": {
                "size": 1000,
                "source_filters": [{
                    "column": "created_at",
                    "operator": "GTE",
                    "value": "2025-01-01",
                }],
            },
        },
    )
    skill = build_registry().get_skill("workspace")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
            "response": "I found recent orders, but this exact dataset is already in the workspace.",
            "options": [{
                "label": "Recent orders",
                "tables": [{
                    "source_id": "warehouse",
                    "table_key": "public.orders",
                    "query": {
                        "limit": 1000,
                        "filters": [{
                            "column": "created_at",
                            "op": "GTE",
                            "value": "2025-01-01",
                        }],
                    },
                }],
            }],
        },
        _context(workspace),
    ))

    assert events[0]["type"] == "error"
    assert "already loaded" in events[0]["message"]
    assert "recent_orders" in events[0]["message"]


def test_skill_uses_shared_catalog_discovery(tmp_path: Path) -> None:
    save_catalog(tmp_path, "warehouse", [{
        "name": "orders",
        "table_key": "public.orders",
        "path": ["public", "orders"],
        "metadata": {"description": "Customer orders"},
    }])
    skill = build_registry().get_skill("workspace")
    assert skill is not None

    result = skill.handle_tool(
        "find_data",
        {"query": "orders", "source_id": "warehouse"},
        _context(_Workspace(tmp_path)),
    )

    payload = json.loads(result.text)
    assert payload["results"][0]["source_id"] == "warehouse"
    assert payload["results"][0]["table_key"] == "public.orders"


def test_probe_budget_is_shared_within_run_and_isolated_between_runs(tmp_path: Path) -> None:
    save_catalog(tmp_path, "warehouse", [{
        "name": "orders",
        "table_key": "public.orders",
        "path": ["public", "orders"],
        "metadata": {},
    }])
    skill = build_registry().get_skill("workspace")
    assert skill is not None
    loader = _Loader()
    shared_state: dict = {}
    first_context = _context(_Workspace(tmp_path), shared_state)
    second_context = _context(_Workspace(tmp_path), shared_state)

    with patch("data_formulator.data_connector.resolve_live_loader", return_value=loader):
        skill.handle_tool(
            "probe_data",
            {"source_id": "warehouse", "table_key": "public.orders", "query": {}},
            first_context,
        )
        first_budget = next(iter(shared_state.values()))
        assert first_budget.remaining == 19

        skill.handle_tool(
            "probe_data",
            {"source_id": "warehouse", "table_key": "public.orders", "query": {}},
            second_context,
        )
        assert first_budget.remaining == 18

        isolated_state: dict = {}
        skill.handle_tool(
            "probe_data",
            {"source_id": "warehouse", "table_key": "public.orders", "query": {}},
            _context(_Workspace(tmp_path), isolated_state),
        )
        isolated_budget = next(iter(isolated_state.values()))
        assert isolated_budget.remaining == 19