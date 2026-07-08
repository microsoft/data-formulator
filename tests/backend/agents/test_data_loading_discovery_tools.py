"""Tests for the data discovery tools on DataLoadingAgent.

Covers the navigation surface introduced by design-docs/32:
``list_data``, ``find_data``, ``describe_data``, and the existing
``propose_load_plan`` / ``_normalize_load_plan_filters`` helpers.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from data_formulator.agents.agent_data_loading_chat import DataLoadingAgent
from data_formulator.datalake.catalog_cache import CatalogSearchError, save_catalog

pytestmark = [pytest.mark.backend]


class _FakeWorkspace:
    """Minimal workspace stub for testing tool handlers."""

    def __init__(self, user_home=None):
        self._user_home = user_home

    @property
    def user_home(self):
        return self._user_home

    def list_tables(self):
        return []

    def get_metadata(self):
        return None


# ------------------------------------------------------------------
# list_data
# ------------------------------------------------------------------

_SAMPLE_TABLES = [
    {
        "name": "monthly_orders",
        "table_key": "k_orders",
        "path": ["Sales", "monthly_orders"],
        "metadata": {"description": "Monthly orders", "columns": []},
    },
    {
        "name": "monthly_returns",
        "table_key": "k_returns",
        "path": ["Sales", "monthly_returns"],
        "metadata": {"description": "Monthly returns", "columns": []},
    },
    {
        "name": "customers",
        "table_key": "k_customers",
        "path": ["customers"],
        "metadata": {"description": "Customer dimension", "columns": []},
    },
]


class TestListData:
    def test_no_args_returns_sources_summary(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        save_catalog(tmp_path, "flat_src", [{"name": "t1", "table_key": "k1", "metadata": {}}])

        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        result = agent._tool_list_data({})

        assert "sources" in result
        by_id = {s["source_id"]: s for s in result["sources"]}
        assert by_id["pg_prod"]["table_count"] == 3
        assert by_id["pg_prod"]["is_hierarchical"] is True
        assert by_id["flat_src"]["is_hierarchical"] is False

    def test_no_user_home_returns_empty_sources(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        assert agent._tool_list_data({}) == {"sources": []}

    def test_source_id_at_root(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_list_data({"source_id": "pg_prod"})

        assert result["source_id"] == "pg_prod"
        folder_names = {f["name"] for f in result["folders"]}
        table_names = {t["name"] for t in result["tables"]}
        assert "Sales" in folder_names
        assert "customers" in table_names

    def test_source_id_with_path_drills_into_folder(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_list_data({"source_id": "pg_prod", "path": ["Sales"]})

        assert result["folders"] == []
        table_names = {t["name"] for t in result["tables"]}
        assert table_names == {"monthly_orders", "monthly_returns"}

    def test_filter_narrows_tables(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_list_data({
            "source_id": "pg_prod",
            "path": ["Sales"],
            "filter": "orders",
        })

        table_names = {t["name"] for t in result["tables"]}
        assert table_names == {"monthly_orders"}

    def test_invalid_path_type_returns_error(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_list_data({"source_id": "pg_prod", "path": "Sales"})
        assert "error" in result


# ------------------------------------------------------------------
# find_data
# ------------------------------------------------------------------

class TestFindData:
    def test_empty_query_returns_error(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        result = agent._tool_find_data({"query": ""})
        assert "error" in result

    def test_searches_catalog_with_regex(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_find_data({
            "query": "monthly_(orders|returns)",
            "scope": "connected",
        })

        names = {r["name"] for r in result["results"]}
        assert names == {"monthly_orders", "monthly_returns"}
        for r in result["results"]:
            assert r["source_id"] == "pg_prod"
            assert r["status"] == "not imported"

    def test_scope_with_source_id(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        save_catalog(tmp_path, "other", [{
            "name": "monthly_orders",
            "table_key": "kx",
            "path": ["monthly_orders"],
            "metadata": {},
        }])
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_find_data({"query": "monthly", "scope": "pg_prod"})

        source_ids = {r["source_id"] for r in result["results"]}
        assert source_ids == {"pg_prod"}

    def test_scope_with_path_prefix(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_find_data({
            "query": "customers|monthly",
            "scope": "pg_prod:Sales",
        })

        names = {r["name"] for r in result["results"]}
        # ``customers`` lives at the root, not under Sales — must be excluded.
        assert "customers" not in names
        assert names == {"monthly_orders", "monthly_returns"}

    def test_scope_workspace_skips_catalog(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_find_data({"query": "monthly", "scope": "workspace"})
        # Workspace metadata is empty in the stub → no results, with a note.
        assert result["results"] == []
        assert "note" in result

    def test_bad_regex_returns_error(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_find_data({"query": "(", "scope": "connected"})
        assert "error" in result

    def test_no_match_returns_note_and_valid_sources(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_find_data({
            "query": "zzz_no_such_thing",
            "scope": "connected",
        })
        assert result["results"] == []
        assert "pg_prod" in result["valid_source_ids"]
        assert "note" in result


# ------------------------------------------------------------------
# describe_data
# ------------------------------------------------------------------

class TestDescribeData:
    def test_delegates_to_handle_read_catalog_metadata(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace("/tmp/home"))
        with patch(
            "data_formulator.agents.context.handle_read_catalog_metadata",
            return_value="## orders\nColumns (1):\n  - id (int)",
        ) as mock_read:
            result = agent._tool_describe_data({
                "source_id": "pg_prod",
                "table_key": "k_orders",
            })

        mock_read.assert_called_once_with("pg_prod", "k_orders", agent.workspace)
        assert "orders" in result["result"]

    def test_missing_params_still_calls_with_empty_strings(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        with patch(
            "data_formulator.agents.context.handle_read_catalog_metadata",
            return_value="Both source_id and table_key are required.",
        ) as mock_read:
            result = agent._tool_describe_data({})

        mock_read.assert_called_once_with("", "", agent.workspace)
        assert "required" in result["result"]


# ------------------------------------------------------------------
# propose_load_plan (unchanged behavior)
# ------------------------------------------------------------------

class TestProposeLoadPlan:
    def test_returns_load_plan_action(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", [
            {"name": "orders", "table_key": "public.orders", "metadata": {}},
            {"name": "customers", "table_key": "public.customers", "metadata": {}},
        ])
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        result = agent._tool_propose_load_plan({
            "candidates": [
                {
                    "source_id": "pg_prod",
                    "table_key": "public.orders",
                    "display_name": "orders",
                    "source_table": "public.orders",
                },
                {
                    "source_id": "pg_prod",
                    "table_key": "public.customers",
                    "display_name": "customers",
                    "source_table": "public.customers",
                },
            ],
            "reasoning": "Orders + customer dimension",
        })

        assert "actions" in result
        action = result["actions"][0]
        assert action["type"] == "load_plan"
        assert len(action["candidates"]) == 2
        assert action["reasoning"] == "Orders + customer dimension"

    def test_empty_candidates_returns_empty_action(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        result = agent._tool_propose_load_plan({"candidates": []})
        assert result["actions"][0]["type"] == "load_plan"
        assert result["actions"][0]["candidates"] == []

    def test_resolves_superset_dataset_id_from_catalog(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace("/tmp/home"))
        catalog = [{
            "name": "136:product_periodic_sales_trend",
            "table_key": "uuid-136",
            "metadata": {
                "dataset_id": 136,
                "_source_name": "product_periodic_sales_trend",
            },
        }]

        with patch(
            "data_formulator.datalake.catalog_cache.load_catalog",
            return_value=catalog,
        ):
            result = agent._tool_propose_load_plan({
                "candidates": [{
                    "source_id": "superset",
                    "table_key": "uuid-136",
                    "display_name": "product_periodic_sales_trend",
                    "source_table": "product_periodic_sales_trend",
                    "filters": [{"column": "brand", "operator": "=", "value": "Pantum"}],
                }],
            })

        candidate = result["actions"][0]["candidates"][0]
        assert candidate["source_table"] == "136"
        assert candidate["source_table_name"] == "product_periodic_sales_trend"
        assert candidate["filters"] == [
            {"column": "brand", "operator": "EQ", "value": "Pantum"},
        ]
        assert "row_limit" not in candidate


# ------------------------------------------------------------------
# _normalize_load_plan_filters (unchanged behavior)
# ------------------------------------------------------------------

class TestNormalizeLoadPlanFilters:
    def test_strips_wildcards_and_upgrades_eq_to_ilike(self) -> None:
        filters = [{"column": "brand", "operator": "EQ", "value": "%奔图%"}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == [{"column": "brand", "operator": "ILIKE", "value": "奔图"}]

    def test_strips_wildcards_from_like(self) -> None:
        filters = [{"column": "name", "operator": "LIKE", "value": "%printer%"}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == [{"column": "name", "operator": "ILIKE", "value": "printer"}]

    def test_like_without_wildcards_upgraded_to_ilike(self) -> None:
        filters = [{"column": "name", "operator": "LIKE", "value": "printer"}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == [{"column": "name", "operator": "ILIKE", "value": "printer"}]

    def test_eq_without_wildcards_stays_eq(self) -> None:
        filters = [{"column": "brand", "operator": "EQ", "value": "奔图"}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == [{"column": "brand", "operator": "EQ", "value": "奔图"}]

    def test_symbol_operators_mapped(self) -> None:
        filters = [
            {"column": "qty", "operator": ">=", "value": 10},
            {"column": "status", "operator": "!=", "value": "closed"},
        ]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result[0]["operator"] == "GTE"
        assert result[1]["operator"] == "NEQ"

    def test_contains_mapped_to_ilike(self) -> None:
        filters = [{"column": "name", "operator": "CONTAINS", "value": "printer"}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == [{"column": "name", "operator": "ILIKE", "value": "printer"}]

    def test_is_null_no_value(self) -> None:
        filters = [{"column": "deleted_at", "operator": "IS_NULL", "value": None}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == [{"column": "deleted_at", "operator": "IS_NULL"}]

    def test_empty_wildcard_only_value_skipped(self) -> None:
        filters = [{"column": "brand", "operator": "LIKE", "value": "%%"}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == []

    def test_invalid_operator_falls_back_to_eq(self) -> None:
        filters = [{"column": "x", "operator": "FUZZY", "value": "abc"}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == [{"column": "x", "operator": "EQ", "value": "abc"}]

    def test_non_list_returns_empty(self) -> None:
        assert DataLoadingAgent._normalize_load_plan_filters(None) == []
        assert DataLoadingAgent._normalize_load_plan_filters("bad") == []

    def test_missing_column_skipped(self) -> None:
        filters = [
            {"operator": "EQ", "value": "x"},
            {"column": "", "operator": "EQ", "value": "y"},
        ]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == []


# ------------------------------------------------------------------
# _build_system_prompt: connector summary block
# ------------------------------------------------------------------

class TestBuildSystemPromptConnectorSummary:
    def test_includes_connector_summary_when_sources_exist(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace("/tmp/home"))
        with patch(
            "data_formulator.datalake.catalog_cache.list_cached_sources",
            return_value=["pg_prod", "superset_prod"],
        ):
            prompt = agent._build_system_prompt("test query")

        assert "pg_prod" in prompt
        assert "superset_prod" in prompt

    def test_shows_none_when_no_sources(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace("/tmp/home"))
        with patch(
            "data_formulator.datalake.catalog_cache.list_cached_sources",
            return_value=[],
        ):
            prompt = agent._build_system_prompt("test query")

        assert "Connected data sources:\n  none" in prompt

    def test_graceful_when_user_home_missing(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        prompt = agent._build_system_prompt("test query")
        assert "Connected data sources:\n  none" in prompt

    def test_includes_current_date_and_time(self) -> None:
        from datetime import datetime

        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        prompt = agent._build_system_prompt("test query")

        now = datetime.now()
        assert f"Current date and time: {now.strftime('%Y-%m-%d')}" in prompt
        assert f"({now.strftime('%A')})" in prompt


# ------------------------------------------------------------------
# probe_data (design 37 §4.2 / §7)
# ------------------------------------------------------------------

class _StubLoader:
    """Records the probe call and returns a canned result."""

    def __init__(self, result=None):
        self.result = result if result is not None else {
            "rows": [{"n": 3}], "columns": ["n"], "row_count": 1, "exact": True,
        }
        self.calls = []

    def probe(self, path, query):
        self.calls.append((path, query))
        return self.result


class TestProbeData:
    def test_missing_ids_returns_error(self, tmp_path: Path) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        agent._probe_budget = 5
        assert "error" in agent._tool_probe_data({"table_key": "k_orders"})
        assert "error" in agent._tool_probe_data({"source_id": "pg_prod"})

    def test_unknown_table_key_returns_error(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        agent._probe_budget = 5

        result = agent._tool_probe_data({
            "source_id": "pg_prod", "table_key": "nope", "query": {},
        })
        assert "error" in result
        assert "not found" in result["error"]

    def test_budget_exhaustion_returns_error(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        agent._probe_budget = 0

        result = agent._tool_probe_data({
            "source_id": "pg_prod", "table_key": "k_orders", "query": {},
        })
        assert "error" in result
        assert "budget" in result["error"].lower()

    def test_resolves_path_and_delegates_to_loader(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        agent._probe_budget = 5
        stub = _StubLoader()

        with patch(
            "data_formulator.data_connector.resolve_live_loader",
            return_value=stub,
        ):
            result = agent._tool_probe_data({
                "source_id": "pg_prod",
                "table_key": "k_orders",
                "query": {"aggregates": [{"op": "count", "as": "n"}]},
            })

        # The model-facing table_key is mapped to the catalog path.
        assert stub.calls == [(["Sales", "monthly_orders"],
                               {"aggregates": [{"op": "count", "as": "n"}]})]
        assert result["rows"] == [{"n": 3}]
        assert "note" in result  # row-cap guidance attached
        assert agent._probe_budget == 4  # decremented once

    def test_not_connected_source_returns_error(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        agent._probe_budget = 5

        with patch(
            "data_formulator.data_connector.resolve_live_loader",
            side_effect=RuntimeError("no such connector"),
        ):
            result = agent._tool_probe_data({
                "source_id": "pg_prod", "table_key": "k_orders", "query": {},
            })
        assert "error" in result
        assert "not connected" in result["error"]
        # Budget is not consumed when the loader can't be resolved.
        assert agent._probe_budget == 5

    def test_loader_error_result_passes_through(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        agent._probe_budget = 5
        stub = _StubLoader(result={"error": "bad column"})

        with patch(
            "data_formulator.data_connector.resolve_live_loader",
            return_value=stub,
        ):
            result = agent._tool_probe_data({
                "source_id": "pg_prod", "table_key": "k_orders", "query": {},
            })
        assert result == {"error": "bad column"}
        assert "note" not in result  # no cap note on error results
