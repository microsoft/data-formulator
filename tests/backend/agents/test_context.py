from unittest.mock import MagicMock, patch

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