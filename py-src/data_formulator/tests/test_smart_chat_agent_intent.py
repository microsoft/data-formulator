from data_formulator.agents.agent_smart_chat import (
    SmartChatAgent,
    _build_data_sample_section,
    _build_column_profile,
)
from data_formulator.agents.drawable_catalog import DrawableChartEntry
from data_formulator.agents.field_metadata import FieldMeta
from data_formulator.agent_routes import _extract_sample_rows


class ErrorClient:
    def get_completion(self, messages):
        raise RuntimeError("force fallback")


class MockClient:
    def __init__(self, payload: dict):
        self.payload = payload

    def get_completion(self, messages):
        class _Msg:
            def __init__(self, content):
                self.content = content

        class _Choice:
            def __init__(self, message):
                self.message = message

        class _Resp:
            def __init__(self, content):
                self.choices = [_Choice(_Msg(content))]

        import json
        return _Resp(json.dumps(self.payload, ensure_ascii=False))


def _catalog():
    return [
        DrawableChartEntry(
            chart_type="Line Chart",
            template_channels=["x", "y"],
            encoding={"x": "INDEX", "y": "VALUE"},
            domain="qc",
            confidence=0.9,
            rationale_vi="",
            sample_prompt_vi="",
            preview_spec=None,
        ),
        DrawableChartEntry(
            chart_type="Boxplot",
            template_channels=["x", "y"],
            encoding={"x": "QCSHIFT", "y": "VALUE"},
            domain="qc",
            confidence=0.9,
            rationale_vi="",
            sample_prompt_vi="",
            preview_spec=None,
        ),
        DrawableChartEntry(
            chart_type="Pie Chart",
            template_channels=["theta", "color"],
            encoding={"theta": "VALUE", "color": "QCSTDPARAMNAME"},
            domain="qc",
            confidence=0.9,
            rationale_vi="",
            sample_prompt_vi="",
            preview_spec=None,
        ),
    ]


def test_intent_short_lin_maps_to_line_chart_confirm():
    agent = SmartChatAgent(client=ErrorClient())
    result = agent.run("ve lin", ["INDEX", "VALUE", "QCSHIFT"], "qc", _catalog())
    assert result.action == "confirm"
    assert result.chart_type_hint == "Line Chart"


def test_intent_box_maps_to_boxplot_confirm():
    agent = SmartChatAgent(client=ErrorClient())
    result = agent.run("ve box", ["INDEX", "VALUE", "QCSHIFT"], "qc", _catalog())
    assert result.action == "confirm"
    assert result.chart_type_hint == "Boxplot"


def test_intent_pie_maps_to_pie_chart_confirm():
    agent = SmartChatAgent(client=ErrorClient())
    result = agent.run("ve pie", ["VALUE", "QCSTDPARAMNAME"], "qc", _catalog())
    assert result.action == "confirm"
    assert result.chart_type_hint == "Pie Chart"


def test_column_profile_shows_sample_values():
    metas = {
        "product": FieldMeta(
            name="product",
            sql_type="object",
            cardinality=3,
            null_ratio=0.0,
            cardinality_class="low",
            is_temporal=False,
            is_sequential=False,
            is_quantitative=False,
            is_categorical=True,
            sample_values=["iPhone", "Oppo", "Samsung"],
        )
    }
    profile = _build_column_profile(metas)
    assert "values=[iPhone, Oppo, Samsung]" in profile


def test_data_sample_section_markdown():
    rows = [
        {"month": "2024-01", "product": "iPhone", "revenue": 120000},
        {"month": "2024-04", "product": "Samsung", "revenue": 98000},
    ]
    result = _build_data_sample_section(rows)
    assert "| month | product | revenue |" in result
    assert "iPhone" in result


def test_extract_sample_rows_picks_representative():
    rows = [{"a": i, "b": i * 2} for i in range(10)]
    sample = _extract_sample_rows([{"rows": rows}])
    assert len(sample) == 3
    assert sample[0]["a"] == "0"
    assert sample[1]["a"] == "5"
    assert sample[2]["a"] == "9"


def test_agent_run_accepts_sample_rows_and_keeps_message():
    payload = {
        "action": "suggest",
        "message_vi": "Mình thấy data có iPhone, Samsung, Oppo.",
        "chart_type_hint": "Line Chart",
        "detected_fields": ["month", "product"],
        "confidence": 0.85,
        "rationale": "uses observed product names",
    }
    agent = SmartChatAgent(client=MockClient(payload))
    result = agent.run(
        "vẽ biểu đồ",
        ["month", "product", "revenue"],
        "generic",
        _catalog(),
        field_metas={},
        sample_rows=[{"month": "2024-01", "product": "iPhone", "revenue": 120000}],
    )
    assert "iPhone" in result.message_vi
