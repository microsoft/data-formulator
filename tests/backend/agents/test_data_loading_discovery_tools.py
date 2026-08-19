"""Tests for the data discovery tools on DataLoadingAgent.

Covers the navigation surface introduced by design-docs/32:
``list_data``, ``find_data``, ``describe_data``, and the existing
``propose_load_plan`` / ``_normalize_load_plan_filters`` helpers.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from data_formulator.agents.agent_data_loading_chat import (
    DataLoadingAgent,
    TOOLS,
    _build_connector_summary_block,
)
from data_formulator.datalake.catalog_cache import (
    CatalogSearchError,
    load_catalog_snapshot,
    save_catalog,
)
from data_formulator.datalake.connector_preferences import set_connector_enabled
from data_formulator.knowledge.store import KnowledgeStore

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


class _NoAuthLoader:
    @classmethod
    def list_params(cls):
        return []

    def __init__(self, _params):
        pass

    def test_connection(self):
        return True

    def sync_catalog_metadata(self):
        return _SAMPLE_TABLES


def _zero_auth_connector():
    return SimpleNamespace(_loader_class=_NoAuthLoader, _default_params={})


class TestListData:
    def test_summary_includes_connected_source_without_cache(self, tmp_path: Path) -> None:
        with patch(
            "data_formulator.data_connector.list_available_connector_ids",
            return_value=["mysql-main"],
        ):
            summary = _build_connector_summary_block(tmp_path)

        assert "mysql-main: connected, catalog not cached" in summary

    def test_source_inventory_includes_connected_source_without_cache(self, tmp_path: Path) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        with patch(
            "data_formulator.data_connector.list_available_connector_ids",
            return_value=["mysql-main"],
        ):
            result = agent._tool_list_data({})

        assert result == {"sources": [{
            "source_id": "mysql-main",
            "table_count": 0,
            "is_hierarchical": False,
            "connected": True,
            "catalog_status": "not_cached",
        }]}

    def test_connector_summary_hides_disconnected_cached_source(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "databricks--databricks", _SAMPLE_TABLES)

        with patch(
            "data_formulator.data_connector.connector_is_available",
            return_value=False,
        ):
            summary = _build_connector_summary_block(tmp_path)

        assert summary == "  none"

    def test_browsing_connected_source_bootstraps_missing_catalog(self, tmp_path: Path) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        with (
            patch(
                "data_formulator.data_connector.list_available_connector_ids",
                return_value=["mysql-main"],
            ),
            patch("data_formulator.data_connector.resolve_live_loader", return_value=object()),
            patch(
                "data_formulator.datalake.catalog_refresh.ensure_catalog_freshness",
                side_effect=lambda root, source_id: (
                    save_catalog(root, source_id, _SAMPLE_TABLES),
                    load_catalog_snapshot(root, source_id),
                )[1],
            ),
        ):
            result = agent._tool_list_data({"source_id": "mysql-main"})

        assert result["source_id"] == "mysql-main"
        assert {table["name"] for table in result["tables"]} == {"customers"}

    def test_bootstraps_uncached_zero_auth_connector(self, tmp_path: Path) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        with (
            patch("data_formulator.data_connector._ADMIN_CONNECTOR_IDS", {"sample_datasets"}),
            patch.dict(
                "data_formulator.data_connector.DATA_CONNECTORS",
                {"sample_datasets": _zero_auth_connector()},
                clear=True,
            ),
        ):
            result = agent._tool_list_data({})

        assert result["sources"] == [
            {
                "source_id": "sample_datasets",
                "table_count": 3,
                "is_hierarchical": True,
                "top_level": ["Sales", "customers"],
            }
        ]

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

    def test_disabled_source_is_hidden_without_deleting_cache(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "sample_datasets", _SAMPLE_TABLES)
        set_connector_enabled(tmp_path, "sample_datasets", False)

        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        result = agent._tool_list_data({})

        assert result == {"sources": []}
        assert (tmp_path / "catalog_cache" / "sample_datasets.json").exists()

    def test_disconnected_source_is_hidden_without_deleting_cache(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "databricks--databricks", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        with patch(
            "data_formulator.data_connector.connector_is_available",
            return_value=False,
        ):
            result = agent._tool_list_data({})

        assert result == {"sources": []}
        assert (tmp_path / "catalog_cache" / "databricks--databricks.json").exists()

    def test_disconnected_cached_source_cannot_be_browsed(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "databricks--databricks", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        with patch(
            "data_formulator.data_connector.connector_is_available",
            return_value=False,
        ):
            result = agent._tool_list_data({"source_id": "databricks--databricks"})

        assert result == {"error": "Source 'databricks--databricks' is disconnected."}

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
    def test_bootstraps_uncached_zero_auth_connector(self, tmp_path: Path) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        with (
            patch("data_formulator.data_connector._ADMIN_CONNECTOR_IDS", {"sample_datasets"}),
            patch.dict(
                "data_formulator.data_connector.DATA_CONNECTORS",
                {"sample_datasets": _zero_auth_connector()},
                clear=True,
            ),
        ):
            result = agent._tool_find_data({"query": "customers", "scope": "connected"})

        assert [item["name"] for item in result["results"]] == ["customers"]

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

    def test_disabled_source_is_excluded_from_explicit_search(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "sample_datasets", _SAMPLE_TABLES)
        set_connector_enabled(tmp_path, "sample_datasets", False)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_find_data({
            "query": "customers",
            "scope": "sample_datasets",
        })

        assert result["results"] == []
        assert "sample_datasets" not in result["valid_source_ids"]

    def test_disconnected_source_is_excluded_from_search(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "databricks--databricks", _SAMPLE_TABLES)
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        with patch(
            "data_formulator.data_connector.connector_is_available",
            return_value=False,
        ):
            result = agent._tool_find_data({
                "query": "customers",
                "scope": "connected",
            })

        assert result["results"] == []
        assert "databricks--databricks" not in result["valid_source_ids"]
        assert "databricks--databricks" not in result["catalog_freshness"]

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
# propose_load_plan
# ------------------------------------------------------------------

class TestProposeLoadPlan:
    def test_preserves_all_option_groups(self, tmp_path: Path) -> None:
        save_catalog(tmp_path, "pg_prod", [
            {"name": "orders", "table_key": "public.orders", "metadata": {}},
            {"name": "customers", "table_key": "public.customers", "metadata": {}},
        ])
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))

        result = agent._tool_propose_load_plan({
            "response": "Choose the data to load.",
            "options": [
                {"label": "Orders", "tables": [{
                    "source_id": "pg_prod", "table_key": "public.orders",
                }]},
                {"label": "Customers", "tables": [{
                    "source_id": "pg_prod", "table_key": "public.customers",
                }]},
            ],
        })

        action = result["actions"][0]
        assert action["response"] == "Choose the data to load."
        assert [option["label"] for option in action["options"]] == ["Orders", "Customers"]
        assert action["options"][1]["tables"][0]["table_key"] == "public.customers"
        assert "candidates" not in action
        assert "reasoning" not in action

    def test_empty_options_returns_empty_action(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace())
        result = agent._tool_propose_load_plan({"response": "Nothing found.", "options": []})
        assert result["actions"][0]["type"] == "load_plan"
        assert result["actions"][0]["options"] == []

    def test_resolves_superset_dataset_id_from_catalog(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace("/tmp/home"))
        catalog = [{
            "name": "136:product_periodic_sales_trend",
            "table_key": "uuid-136",
            "metadata": {
                "dataset_id": 136,
                "_source_name": "product_periodic_sales_trend",
                "row_count": 36121,
            },
        }]

        with patch(
            "data_formulator.datalake.catalog_cache.load_catalog",
            return_value=catalog,
        ):
            result = agent._tool_propose_load_plan({
                "response": "Load filtered sales.",
                "options": [{
                    "label": "Sales",
                    "tables": [{
                        "source_id": "superset",
                        "table_key": "uuid-136",
                        "query": {
                            "filters": [{"column": "brand", "op": "EQ", "value": "Pantum"}],
                        },
                    }],
                }],
            })

        candidate = result["actions"][0]["options"][0]["tables"][0]
        assert candidate["source_table"] == "136"
        assert candidate["source_table_name"] == "product_periodic_sales_trend"
        assert candidate["query"]["filters"] == [
            {"column": "brand", "op": "EQ", "value": "Pantum"},
        ]


# ------------------------------------------------------------------
# _normalize_load_query_filters
# ------------------------------------------------------------------

class TestNormalizeLoadQueryFilters:
    def test_strips_wildcards_and_upgrades_eq_to_ilike(self) -> None:
        filters = [{"column": "brand", "op": "EQ", "value": "%奔图%"}]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result == [{"column": "brand", "op": "ILIKE", "value": "奔图"}]

    def test_strips_wildcards_from_like(self) -> None:
        filters = [{"column": "name", "op": "LIKE", "value": "%printer%"}]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result == [{"column": "name", "op": "ILIKE", "value": "printer"}]

    def test_like_without_wildcards_upgraded_to_ilike(self) -> None:
        filters = [{"column": "name", "op": "LIKE", "value": "printer"}]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result == [{"column": "name", "op": "ILIKE", "value": "printer"}]

    def test_eq_without_wildcards_stays_eq(self) -> None:
        filters = [{"column": "brand", "op": "EQ", "value": "奔图"}]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result == [{"column": "brand", "op": "EQ", "value": "奔图"}]

    def test_symbol_operators_mapped(self) -> None:
        filters = [
            {"column": "qty", "op": ">=", "value": 10},
            {"column": "status", "op": "!=", "value": "closed"},
        ]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result[0]["op"] == "GTE"
        assert result[1]["op"] == "NEQ"

    def test_contains_mapped_to_ilike(self) -> None:
        filters = [{"column": "name", "op": "CONTAINS", "value": "printer"}]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result == [{"column": "name", "op": "ILIKE", "value": "printer"}]

    def test_is_null_no_value(self) -> None:
        filters = [{"column": "deleted_at", "op": "IS_NULL", "value": None}]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result == [{"column": "deleted_at", "op": "IS_NULL"}]

    def test_empty_wildcard_only_value_skipped(self) -> None:
        filters = [{"column": "brand", "op": "LIKE", "value": "%%"}]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result == []

    def test_invalid_operator_falls_back_to_eq(self) -> None:
        filters = [{"column": "x", "op": "FUZZY", "value": "abc"}]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
        assert result == [{"column": "x", "op": "EQ", "value": "abc"}]

    def test_non_list_returns_empty(self) -> None:
        assert DataLoadingAgent._normalize_load_query_filters(None) == []
        assert DataLoadingAgent._normalize_load_query_filters("bad") == []

    def test_missing_column_skipped(self) -> None:
        filters = [
            {"op": "EQ", "value": "x"},
            {"column": "", "op": "EQ", "value": "y"},
        ]
        result = DataLoadingAgent._normalize_load_query_filters(filters)
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
# User-scoped data-source memory
# ------------------------------------------------------------------


class TestDataMemoryTools:
    def test_tools_are_exposed(self) -> None:
        names = {tool["function"]["name"] for tool in TOOLS}
        assert {
            "read_data_memory",
            "append_data_memory",
            "replace_data_memory",
        }.issubset(names)

    def test_read_append_and_rewrite(self, tmp_path: Path) -> None:
        store = KnowledgeStore(tmp_path)
        agent = DataLoadingAgent(
            client=None,
            workspace=_FakeWorkspace(tmp_path),
            knowledge_store=store,
        )

        appended = agent._tool_append_data_memory({
            "content": "## CRM\naccounts joins contacts on account_id.",
        })
        assert appended["updated"] is True
        assert "account_id" in agent._tool_read_data_memory()["content"]

        search = agent._execute_tool("read_data_memory", {"pattern": r"ACCOUNTS.*account_id"})
        assert search["match_count"] == 1
        match_line = search["matches"][0]["line"]
        assert search["matches"][0]["text"] == "accounts joins contacts on account_id."

        window = agent._execute_tool("read_data_memory", {
            "offset": max(1, match_line - 1),
            "max_lines": 3,
        })
        assert "accounts joins contacts on account_id." in window["content"]

        replaced = agent._execute_tool("replace_data_memory", {
            "old_text": "accounts joins contacts on account_id.",
            "new_text": "accounts relates to contacts through account_id.",
        })
        assert replaced["updated"] is True
        assert replaced["replacements"] == 1
        assert "relates to contacts" in store.read_data_memory()

        deleted = agent._execute_tool("replace_data_memory", {
            "old_text": "## CRM\n",
            "new_text": "",
        })
        assert deleted["updated"] is True
        assert "## CRM" not in store.read_data_memory()

    def test_read_defaults_to_one_hundred_lines_and_pages(self, tmp_path: Path) -> None:
        store = KnowledgeStore(tmp_path)
        store.rewrite_data_memory("\n".join(f"line {number}" for number in range(1, 151)))
        agent = DataLoadingAgent(
            client=None,
            workspace=_FakeWorkspace(tmp_path),
            knowledge_store=store,
        )

        first_page = agent._execute_tool("read_data_memory", {})
        assert first_page["returned_lines"] == 100
        assert first_page["next_offset"] == 101
        assert first_page["content"].splitlines()[-1] == "line 100"

        second_page = agent._execute_tool("read_data_memory", {"offset": 101})
        assert second_page["returned_lines"] == 50
        assert second_page["content"].splitlines()[0] == "line 101"
        assert "next_offset" not in second_page

    def test_read_rejects_invalid_regex(self, tmp_path: Path) -> None:
        agent = DataLoadingAgent(
            client=None,
            workspace=_FakeWorkspace(tmp_path),
            knowledge_store=KnowledgeStore(tmp_path),
        )

        result = agent._execute_tool("read_data_memory", {"pattern": "["})

        assert result["error"].startswith("Invalid regex pattern:")

    def test_unavailable_without_knowledge_store(self, tmp_path: Path) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(tmp_path))
        assert "unavailable" in agent._tool_read_data_memory()["error"]
        assert "unavailable" in agent._tool_append_data_memory({"content": "note"})["error"]
        assert "unavailable" in agent._tool_replace_data_memory({
            "old_text": "old",
            "new_text": "new",
        })["error"]

    def test_prompt_labels_memory_as_stale_and_requires_verification(self, tmp_path: Path) -> None:
        store = KnowledgeStore(tmp_path)
        store.rewrite_data_memory("# Sources\n\nCRM contains accounts and contacts.")
        agent = DataLoadingAgent(
            client=None,
            workspace=_FakeWorkspace(tmp_path),
            knowledge_store=store,
        )

        prompt = agent._build_system_prompt("find accounts")

        assert "USER DATA-SOURCE MEMORY — MAY BE STALE" in prompt
        assert "CRM contains accounts and contacts" in prompt
        assert "Verify important details against live source metadata" in prompt


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


# ------------------------------------------------------------------
# Connector discovery + inline connection proposal (design 38)
# ------------------------------------------------------------------


class TestConnectorTools:
    def test_list_connectors_returns_available(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        result = agent._tool_list_connectors({})

        assert "connectors" in result
        assert "unavailable" in result
        by_type = {c["type"]: c for c in result["connectors"]}
        # sqlite/local_folder are hidden from the connector form flow.
        assert "local_folder" not in by_type
        assert "sample_datasets" not in by_type
        # Every entry is high-level only: no per-parameter detail leaks here.
        for c in result["connectors"]:
            assert set(c.keys()) == {"type", "name", "summary", "auth_mode", "available"}
            assert c["available"] is True
        # Calling the tool arms the propose_connection precondition.
        assert agent._connectors_listed is True

    def test_describe_connector_returns_full_detail(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        available = {c["type"] for c in agent._tool_list_connectors({})["connectors"]}
        if not available:
            pytest.skip("no connectors available in this environment")
        source_type = next(iter(sorted(available)))

        result = agent._tool_describe_connector({"source_type": source_type})
        assert "error" not in result
        assert result["type"] == source_type
        assert isinstance(result["params"], list)
        for p in result["params"]:
            assert set(p.keys()) == {"name", "required", "tier", "sensitive", "description"}

    def test_describe_connector_unknown_type(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        result = agent._tool_describe_connector({"source_type": "definitely_not_a_loader"})
        assert "error" in result

    def test_propose_connection_requires_list_first(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        available = {c["type"] for c in agent._tool_list_connectors({})["connectors"]}
        if not available:
            pytest.skip("no connectors available in this environment")
        source_type = next(iter(sorted(available)))

        # Reset the per-turn guard to simulate proposing without discovery.
        agent._connectors_listed = False
        result = agent._tool_propose_connection({"source_type": source_type})
        assert "error" in result
        assert "list_connectors" in result["error"]

    def test_propose_connection_emits_connect_form_action(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        available = {c["type"] for c in agent._tool_list_connectors({})["connectors"]}
        if not available:
            pytest.skip("no connectors available in this environment")
        source_type = next(iter(sorted(available)))

        result = agent._tool_propose_connection({
            "source_type": source_type,
            "prefilled": {"host": "db.example.com", "empty": ""},
        })
        assert "error" not in result
        actions = result["actions"]
        assert len(actions) == 1
        action = actions[0]
        assert action["type"] == "connect_form"
        assert action["source_type"] == source_type
        # Empty values are dropped; real values are coerced to strings.
        assert action["prefilled"] == {"host": "db.example.com"}
        # LLM-facing result never echoes prefilled field values.
        assert "db.example.com" not in result.get("summary", "")

    def test_propose_connection_unknown_type(self) -> None:
        agent = DataLoadingAgent(client=None, workspace=_FakeWorkspace(None))
        agent._tool_list_connectors({})
        result = agent._tool_propose_connection({"source_type": "definitely_not_a_loader"})
        assert "error" in result
