import json
import re
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.agents.context import (
    build_focused_thread_context,
    build_lightweight_table_context,
    handle_read_catalog_metadata,
)


def test_catalog_inspection_exposes_limits_and_bounded_examples(tmp_path):
    metadata = {"columns": [{"name": "review", "type": "string"}],
                "sample_rows": [{"review": "sample review " * 1000}],
                "inspection": {"schema_source": "inferred", "row_count_status": "unknown",
                               "sample_method": "source_head", "values_truncated": True}}
    workspace = MagicMock(user_home=tmp_path)
    with patch("data_formulator.agents.context.ensure_no_auth_catalogs_cached"), \
         patch("data_formulator.datalake.connector_preferences.connector_is_enabled", return_value=True), \
         patch("data_formulator.datalake.catalog_cache.load_catalog", return_value=[{
             "name": "reviews", "table_key": "reviews", "metadata": metadata,
         }]):
        text = handle_read_catalog_metadata("source", "reviews", workspace)
    assert "Row count not collected" in text
    assert "later records may differ" in text
    assert "not necessarily representative" in text
    assert "sample text truncated" in text
    assert len(text) < 2000


def test_catalog_columns_are_paged_and_filtered(tmp_path):
    columns = [{"name": f"Measure {index}", "role": "measure", "aggregation": "sum", "ref": f"orders.m{index}"}
               for index in range(120)]
    columns.append({"name": "Order Date", "role": "time_dimension", "granularities": ["day", "month"]})
    metadata = {"query_model": "semantic", "columns": columns,
                "relationships": [{"from": "orders", "to": "customers", "kind": "joinable"}]}
    workspace = MagicMock(user_home=tmp_path)

    def describe(**kwargs):
        with patch("data_formulator.agents.context.ensure_no_auth_catalogs_cached"), \
             patch("data_formulator.datalake.connector_preferences.connector_is_enabled", return_value=True), \
             patch("data_formulator.datalake.catalog_cache.load_catalog", return_value=[{
                 "name": "orders", "table_key": "orders", "metadata": metadata,
             }]):
            return handle_read_catalog_metadata("cube", "orders", workspace, **kwargs)

    first = describe()
    assert "121 fields: 120 measures, 0 dimensions, 1 time dimensions" in first
    assert "Relationships:" in first
    assert "Columns 1-50 of 121:" in first
    assert "Next: column_offset=50." in first
    assert "Measure 0 (measure, aggregation=sum, ref=orders.m0)" in first
    second = describe(column_offset=50)
    assert "Columns 51-100 of 121:" in second and "Relationships:" not in second
    filtered = describe(role="time_dimension")
    assert "Columns 1-1 of 1 matching the filter:" in filtered
    assert "granularities=day/month" in filtered
    assert "No columns matching the filter at column_offset=0" in describe(column_query="missing")


def test_external_reference_agent_sample_bounds_values_without_mutation():
    from data_formulator.analyst.workspace_inputs import normalize_external_references

    reference = {"kind": "external-table-reference", "id": "ref", "connectorId": "source",
                 "tableKey": "reviews", "displayName": "Reviews",
                 "summary": {"sampleRows": [{"review": "x" * 1000, "nested": {"items": list(range(30))}}],
                             "inspection": {"schema_source": "inferred", "columns_omitted": 2}}}
    summary = normalize_external_references([reference])[0]["summary"]
    assert summary["sampleRows"][0]["review"] == "x" * 200 + "..."
    assert summary["sampleRows"][0]["nested"]["items"] == list(range(10))
    assert summary["sampleTruncated"] is True
    assert summary["inspection"]["columns_omitted"] == 2
    assert len(reference["summary"]["sampleRows"][0]["review"]) == 1000


def test_semantic_reference_keeps_bounded_model_shape_for_agents():
    from data_formulator.analyst.workspace_inputs import normalize_external_references

    columns = [{"name": "Sales", "type": "number", "role": "measure", "aggregation": "sum", "entity": "Sales",
                "ref": "SUM('Sales'[Amount])", "format": "$#,0.00", "description": "d" * 400}]
    columns.append({"name": "Date", "role": "time_dimension", "ref": "orders.date", "granularities": ["day", "month"]})
    columns += [{"name": f"Dim {index}", "type": "string", "role": "dimension", "entity": "Product"} for index in range(200)]
    reference = {"kind": "external-table-reference", "id": "ref", "connectorId": "powerbi", "tableKey": "model",
                 "displayName": "Model", "queryModel": "semantic",
                 "summary": {"columns": columns, "relationships": [{"from": "Sales[Key]", "to": "Product[Key]"}] * 30}}
    item = normalize_external_references([reference])[0]
    assert item["queryModel"] == "semantic"
    summary = item["summary"]
    assert summary["columns"][0] == {"name": "Sales", "type": "number", "role": "measure", "aggregation": "sum",
                                     "entity": "Sales", "ref": "SUM('Sales'[Amount])", "format": "$#,0.00",
                                     "description": "d" * 160}
    assert summary["columns"][1] == columns[1]
    assert len(summary["columns"]) == 150 and summary["columnsOmitted"] == 52
    assert len(summary["relationships"]) == 20
    assert summary["relationshipsOmitted"] == 10
    assert len(reference["summary"]["columns"]) == 202
    assert len(reference["summary"]["relationships"]) == 30
    assert normalize_external_references(json.loads(json.dumps([item])))[0] == item


@pytest.mark.parametrize("relationships_only", [False, True])
def test_catalog_pagination_preserves_progress_with_long_metadata(tmp_path, relationships_only):
    columns = [{"name": f"Field {index}", "role": "measure", "entity": "Sales",
                "ref": f"[Measure {index}]", "format": "$#,0", "description": "d" * 10000}
               for index in range(130)]
    relationships = [{"from": f"Sales[Key{index}]", "to": f"Dimension{index}[Key]", "active": False}
                     for index in range(75)]
    metadata = {"query_model": "semantic", "columns": columns, "relationships": relationships,
                "description": "long description " * 1000}
    cursor = "relationship_offset" if relationships_only else "column_offset"
    items = relationships if relationships_only else columns
    offset = 0
    with patch("data_formulator.agents.context.ensure_no_auth_catalogs_cached"), \
         patch("data_formulator.datalake.connector_preferences.connector_is_enabled", return_value=True), \
         patch("data_formulator.datalake.catalog_cache.load_catalog", return_value=[{
             "name": "Sales model", "table_key": "model", "metadata": metadata,
         }]):
        for _ in range(len(items)):
            text = handle_read_catalog_metadata("source", "model", MagicMock(user_home=tmp_path), **{cursor: offset})
            assert len(text) <= 4000
            assert "[Summary truncated]" in text
            page = re.search(r"(?:Columns|Relationships) (\d+)-(\d+) of (\d+):", text)
            assert page is not None
            start, end, total = map(int, page.groups())
            assert start == offset + 1 and end > offset and total == len(items)
            for index in range(offset, end):
                if relationships_only:
                    assert json.dumps(relationships[index]) in text
                else:
                    assert f"ref=[Measure {index}]" in text
                    assert "entity=Sales" in text and "format=$#,0" in text
            offset = end
            if end == total:
                assert "Next:" not in text
                break
            assert f"Next: {cursor}={end}." in text
        assert offset == len(items)
        empty = handle_read_catalog_metadata("source", "model", MagicMock(user_home=tmp_path), **{cursor: offset})
        assert f"at {cursor}={offset}" in empty and "Next:" not in empty


def test_focused_context_includes_text_turn_and_loading_decision() -> None:
    context = build_focused_thread_context([{
        "user_question": "I want to load data",
        "agent_response": "Choose an engagement dataset.",
        "user_answer": "Use movies",
        "data_operation": {
            "reason": "Which dataset?",
            "status": "loaded",
            "options": ["Movies", "Shows"],
            "selected_plan": "Movies",
            "result_tables": ["netflix_movies"],
            "result_references": [{"displayName": "All shows", "connectorId": "warehouse", "tableKey": "shows"}],
        },
    }])

    assert "User: I want to load data" in context
    assert "Analyst: Choose an engagement dataset." in context
    assert "User reply: Use movies" in context
    assert "Selected loading option: Movies" in context
    assert "Loaded workspace tables: netflix_movies" in context
    assert "Virtual workspace sources (not compute-ready; rows remain remote)" in context
    assert '"tableKey": "shows"' in context


def test_focused_context_preserves_workflow_definition_for_revision() -> None:
    definition = "version: 1\nname: Daily trips\noverview: Compare the previous day\ndeliverables: [Hourly chart]"
    context = build_focused_thread_context([{
        "user_question": "Create a workflow",
        "agent_response": "Review this proposal.",
        "workflow_definition": definition,
    }])
    assert definition in context
    assert "not execution state" in context
    assert "Workflow status and outputs" not in context


def test_focused_context_includes_workflow_status_and_outputs() -> None:
    context = build_focused_thread_context([{
        "workflow": {
            "run_id": "native", "status": "completed",
            "steps": [{"id": "analyze", "description": "Compare prices", "status": "passed"}],
            "checks": [{"id": "coverage", "status": "passed"}],
            "output_ids": ["prices", "brief"],
            "reports": [{"id": "brief", "content": "# Price comparison"}],
        },
    }])

    assert '"status": "completed"' in context
    assert '"description": "Compare prices"' in context
    assert '"id": "coverage", "status": "passed"' in context
    assert '"output_ids": ["prices", "brief"]' in context
    assert "# Price comparison" in context


def test_table_context_uses_analysis_input_headings() -> None:
    workspace = MagicMock()
    workspace.user_home = None
    workspace.get_metadata.return_value = None
    workspace.read_data_as_df.side_effect = FileNotFoundError
    tables = [
        {"name": "orders", "columns": [{"name": "amount", "type": "number"}]},
        {"name": "customers", "columns": [{"name": "name", "type": "string"}]},
    ]

    context = build_lightweight_table_context(
        tables,
        workspace,
        primary_tables=["orders"],
    )

    assert "[PRIMARY ANALYSIS INPUTS]" in context
    assert "[OTHER ANALYSIS INPUTS]" in context
    assert "[PRIMARY TABLE" not in context
    assert "[OTHER AVAILABLE TABLES]" not in context