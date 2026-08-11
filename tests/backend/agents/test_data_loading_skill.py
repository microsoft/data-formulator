from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pyarrow as pa
import pytest

from data_formulator.agents.agent_data_loading_chat import TOOLS
from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
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


def _context(workspace: _Workspace, skill_state: dict | None = None) -> SkillContext:
    return SkillContext(
        client=None,
        workspace=workspace,
        payload={
            "skill_state": skill_state if skill_state is not None else {},
            "conversation_id": "conversation-1",
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

    assert registry.has("data_loading")
    assert "delegate" not in registry.metas["core"].action_names
    meta = registry.metas["data_loading"]
    assert meta.always_on is False
    assert meta.action_names == ("propose_data_operation",)
    assert meta.tool_names == ("list_data", "find_data", "describe_data", "probe_data")
    assert registry.tools_for(["core"]) != registry.tools_for(["core", "data_loading"])
    assert {
        spec["function"]["name"]
        for spec in registry.tools_for(["data_loading"])
    } == set(meta.tool_names)
    assert {
        spec["function"]["name"]
        for spec in registry.action_tools_for(["data_loading"])
    } == set(meta.action_names)


def test_proposal_persists_executable_plan_and_emits_display_only_pause(tmp_path: Path) -> None:
    _save_orders_catalog(tmp_path)
    skill = build_registry().get_skill("data_loading")
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


def test_invalid_proposal_returns_recoverable_observation(tmp_path: Path) -> None:
    skill = build_registry().get_skill("data_loading")
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
    skill = build_registry().get_skill("data_loading")
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
    skill = build_registry().get_skill("data_loading")
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
    skill = build_registry().get_skill("data_loading")
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
    skill = build_registry().get_skill("data_loading")
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
        for spec in registry.tools_for(["data_loading"])
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
    skill = build_registry().get_skill("data_loading")
    assert skill is not None

    result = skill.handle_tool(
        "find_data",
        {"query": "orders", "scope": "connected"},
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
    skill = build_registry().get_skill("data_loading")
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