"""Tests for the data discovery tools added to DataLoadingAgent.

These tools (search_data_candidates, read_candidate_metadata, propose_load_plan)
enable the agent to find and recommend data from connected sources.
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

from data_formulator.agents.agent_data_loading_chat import DataLoadingAgent

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


class TestSearchDataCandidates:
    def test_delegates_to_handle_search_data_tables(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        with patch(
            "data_formulator.agents.context.handle_search_data_tables",
            return_value="Search results for 'orders' (2 matches):\n1. [workspace] orders\n2. [pg_prod] public.orders",
        ) as mock_search:
            result = agent._tool_search_data_candidates({"query": "orders", "scope": "all"})

        mock_search.assert_called_once_with("orders", "all", agent.workspace)
        assert "result" in result
        assert "orders" in result["result"]

    def test_default_scope_is_all(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        with patch(
            "data_formulator.agents.context.handle_search_data_tables",
            return_value="No tables found.",
        ) as mock_search:
            agent._tool_search_data_candidates({"query": "sales"})

        mock_search.assert_called_once_with("sales", "all", agent.workspace)

    def test_empty_query_passes_through(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        with patch(
            "data_formulator.agents.context.handle_search_data_tables",
            return_value="Please provide a search keyword.",
        ) as mock_search:
            result = agent._tool_search_data_candidates({"query": ""})

        assert "result" in result


class TestReadCandidateMetadata:
    def test_delegates_to_handle_read_catalog_metadata(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace("/tmp/home"))
        with patch(
            "data_formulator.agents.context.handle_read_catalog_metadata",
            return_value="## orders\nSource: pg_prod\nColumns (5):\n  - id (integer)\n  - amount (float)",
        ) as mock_read:
            result = agent._tool_read_candidate_metadata({
                "source_id": "pg_prod",
                "table_key": "public.orders",
            })

        mock_read.assert_called_once_with("pg_prod", "public.orders", agent.workspace)
        assert "result" in result
        assert "orders" in result["result"]

    def test_missing_params_still_calls(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        with patch(
            "data_formulator.agents.context.handle_read_catalog_metadata",
            return_value="Both source_id and table_key are required.",
        ) as mock_read:
            result = agent._tool_read_candidate_metadata({})

        mock_read.assert_called_once_with("", "", agent.workspace)
        assert "required" in result["result"]


class TestProposeLoadPlan:
    def test_returns_load_plan_action(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        result = agent._tool_propose_load_plan({
            "candidates": [
                {
                    "source_id": "pg_prod",
                    "table_key": "public.orders",
                    "display_name": "orders",
                    "source_table": "public.orders",
                    "row_limit": 50000,
                },
                {
                    "source_id": "pg_prod",
                    "table_key": "public.customers",
                    "display_name": "customers",
                    "source_table": "public.customers",
                },
            ],
            "reasoning": "Orders for last quarter + customer dimension",
        })

        assert "actions" in result
        assert len(result["actions"]) == 1
        action = result["actions"][0]
        assert action["type"] == "load_plan"
        assert len(action["candidates"]) == 2
        assert action["candidates"][0]["source_id"] == "pg_prod"
        assert action["candidates"][0]["row_limit"] == 50000
        assert action["reasoning"] == "Orders for last quarter + customer dimension"

    def test_empty_candidates_returns_empty_action(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        result = agent._tool_propose_load_plan({"candidates": []})

        assert result["actions"][0]["type"] == "load_plan"
        assert result["actions"][0]["candidates"] == []

    def test_action_flows_through_actions_pipeline(self) -> None:
        """Verify propose_load_plan output is structured for the actions pipeline."""
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        result = agent._tool_propose_load_plan({
            "candidates": [{"source_id": "s", "table_key": "k", "display_name": "n", "source_table": "t"}],
        })

        assert "actions" in result
        assert result["actions"][0]["type"] == "load_plan"

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

        with patch("data_formulator.datalake.catalog_cache.load_catalog", return_value=catalog):
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
        assert candidate["filters"] == [{"column": "brand", "operator": "EQ", "value": "Pantum"}]
        assert candidate["row_limit"] == 2_000_000


class TestNormalizeLoadPlanFilters:
    """Test _normalize_load_plan_filters sanitization logic."""

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
        assert result[0]["value"] == 10
        assert result[1]["operator"] == "NEQ"
        assert result[1]["value"] == "closed"

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
        filters = [{"operator": "EQ", "value": "x"}, {"column": "", "operator": "EQ", "value": "y"}]
        result = DataLoadingAgent._normalize_load_plan_filters(filters)
        assert result == []


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

        assert "Connected data sources: none" in prompt

    def test_graceful_when_user_home_missing(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        prompt = agent._build_system_prompt("test query")
        assert "Connected data sources: none" in prompt

    def test_includes_current_date_and_time(self) -> None:
        from datetime import datetime

        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        prompt = agent._build_system_prompt("test query")

        now = datetime.now()
        assert f"Current date and time: {now.strftime('%Y-%m-%d')}" in prompt
        assert f"({now.strftime('%A')})" in prompt
