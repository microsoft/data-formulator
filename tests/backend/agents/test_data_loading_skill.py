from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pyarrow as pa
import pytest

from data_formulator.agents.agent_data_loading_chat import TOOLS
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


def test_registry_exposes_discovery_tools_only_after_skill_load() -> None:
    registry = build_registry()

    assert registry.has("data-loading")
    assert registry.has("data_loading")  # legacy persisted trajectories
    assert "delegate" not in registry.metas["core"].action_names
    meta = registry.metas["data-loading"]
    assert meta.always_on is False
    assert meta.action_names == ("propose_data_operation", "propose_connection")
    assert meta.tool_names == (
        "summarize_data_sources", "list_data", "find_data", "describe_data", "probe_data",
        "list_connectors", "describe_connector",
    )
    assert registry.tools_for(["core"]) != registry.tools_for(["core", "data-loading"])
    assert {
        spec["function"]["name"]
        for spec in registry.tools_for(["data-loading"])
    } == set(meta.tool_names)
    assert {
        spec["function"]["name"]
        for spec in registry.action_tools_for(["data-loading"])
    } == set(meta.action_names)


def test_data_loading_uses_one_canonical_skill_directory() -> None:
    registry = build_registry()

    assert registry.canonical_name("data_loading") == "data-loading"
    assert registry._doc_paths["data-loading"].parent.name == "data-loading"


def test_empty_workspace_preloads_data_loading_guidance(tmp_path: Path) -> None:
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

    assert agent._loaded_skills == {"core", "data-loading"}
    assert agent._initial_loaded_skills(data_inputs) == {"core"}
    assert "[SKILL: data-loading] Preloaded for this run" in prompt
    assert "When nothing is loaded yet" in prompt
    assert "Call `summarize_data_sources({})`" in prompt
    assert "Never use `ask_user` to ask which connected source" in prompt
    assert "Summarize them all with one bounded call" in prompt


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


def test_resume_rehydrates_preloaded_data_loading_skill(tmp_path: Path) -> None:
    from data_formulator.analyst.agent import AnalystAgent

    agent = AnalystAgent(client=None, workspace=_Workspace(tmp_path))
    agent._loaded_skills = agent._initial_loaded_skills(
        WorkspaceInputManifest(inputs=()),
    )
    system_prompt = agent._build_system_prompt()
    agent._loaded_skills = {"core"}

    agent._rehydrate_loaded_skills([{"role": "system", "content": system_prompt}])

    assert agent._loaded_skills == {"core", "data-loading"}


def test_proposal_persists_executable_plan_and_emits_display_only_pause(tmp_path: Path) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("data-loading")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
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


def test_narration_is_the_response_shown_to_the_user(tmp_path: Path) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("data-loading")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
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
    skill = build_registry().get_skill("data-loading")
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
    skill = build_registry().get_skill("data-loading")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
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
    skill = build_registry().get_skill("data-loading")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
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
    assert step.display_name == "Orders"
    assert step.source_table == "public.orders"
    assert step.query.limit == 500


def test_canonical_proposal_does_not_add_canvas_prose(tmp_path: Path) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("data-loading")
    assert skill is not None

    events = list(skill.handle_action(
        "propose_data_operation",
        {
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
    skill = build_registry().get_skill("data-loading")
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


def test_discovery_parameter_contract_matches_standalone_agent() -> None:
    def executable_schema(value):
        if isinstance(value, dict):
            return {
                key: executable_schema(item)
                for key, item in value.items()
                if key != "description"
            }
        if isinstance(value, list):
            return [executable_schema(item) for item in value]
        return value

    registry = build_registry()
    skill_specs = {
        spec["function"]["name"]: executable_schema(spec["function"]["parameters"])
        for spec in registry.tools_for(["data-loading"])
    }
    standalone_specs = {
        spec["function"]["name"]: executable_schema(spec["function"]["parameters"])
        for spec in TOOLS
        if spec["function"]["name"] in skill_specs
    }

    assert skill_specs == standalone_specs


def test_skill_uses_shared_catalog_discovery(tmp_path: Path) -> None:
    save_catalog(tmp_path, "warehouse", [{
        "name": "orders",
        "table_key": "public.orders",
        "path": ["public", "orders"],
        "metadata": {"description": "Customer orders"},
    }])
    skill = build_registry().get_skill("data-loading")
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
    skill = build_registry().get_skill("data-loading")
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