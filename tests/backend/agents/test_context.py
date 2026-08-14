from data_formulator.agents.context import build_focused_thread_context


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