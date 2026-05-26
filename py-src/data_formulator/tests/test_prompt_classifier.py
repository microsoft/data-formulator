from data_formulator.agents.prompt_classifier import (
    PROMPT_CONCRETE,
    PROMPT_OFF_TOPIC,
    PROMPT_PARTIAL,
    PROMPT_VAGUE,
    classify_prompt,
)


def test_classifier_concrete_with_chart_and_fields():
    result = classify_prompt(
        "Vẽ bar chart x=QCSHIFT y=VALUE",
        available_columns=["QCSHIFT", "VALUE", "QCDATE"],
    )
    assert result.category == PROMPT_CONCRETE


def test_classifier_concrete_with_formula():
    result = classify_prompt(
        "Line chart SUM(revenue) GROUP BY month",
        available_columns=["month", "revenue"],
    )
    assert result.category == PROMPT_CONCRETE


def test_classifier_partial_missing_fields():
    result = classify_prompt("Vẽ bar chart", available_columns=["a", "b"])
    assert result.category == PROMPT_PARTIAL


def test_classifier_partial_missing_chart_type():
    result = classify_prompt("Phân tích doanh thu theo tháng", available_columns=["tháng", "doanh thu"])
    assert result.category == PROMPT_PARTIAL


def test_classifier_vague():
    result = classify_prompt("Vẽ biểu đồ cho tôi", available_columns=["a", "b"])
    assert result.category == PROMPT_VAGUE


def test_classifier_off_topic():
    result = classify_prompt("Hôm nay thời tiết thế nào?", available_columns=["a", "b"])
    assert result.category == PROMPT_OFF_TOPIC

