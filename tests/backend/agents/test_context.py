from unittest.mock import MagicMock

from data_formulator.agents.context import (
    build_focused_thread_context,
    build_lightweight_table_context,
)


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
        },
    }])

    assert "User: I want to load data" in context
    assert "Analyst: Choose an engagement dataset." in context
    assert "User reply: Use movies" in context
    assert "Selected loading option: Movies" in context
    assert "Loaded workspace tables: netflix_movies" in context


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