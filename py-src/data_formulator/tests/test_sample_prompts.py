from data_formulator.agents.sample_prompts import generate_sample_prompt


def test_generate_sample_prompt_for_bar_chart():
    prompt = generate_sample_prompt("Bar Chart", {"x": "QCSHIFT", "y": "VALUE"})
    assert "bar chart" in prompt.lower()
    assert "QCSHIFT" in prompt
    assert "VALUE" in prompt


def test_generate_sample_prompt_fallback():
    prompt = generate_sample_prompt("Unknown Chart", {"x": "a"})
    assert "Unknown Chart" in prompt

