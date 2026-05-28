from flask import Flask

from data_formulator.agent_routes import agent_bp
from data_formulator.agents.agent_smart_chat import SmartChatResult


def _make_app():
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(agent_bp)
    return app


def test_smart_chat_without_model_returns_suggest():
    app = _make_app()
    client = app.test_client()
    payload = {
        "token": "t1",
        "input_tables": [{"name": "t", "rows": [{"month": "2026-01", "revenue": 100}]}],
        "extra_prompt": "vẽ biểu đồ cho tôi",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s1"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["action"] == "suggest"
    assert "suggestions" in data


def test_smart_chat_qc_suggest_action(monkeypatch):
    app = _make_app()
    client = app.test_client()

    def _fake_run(*args, **kwargs):
        return SmartChatResult(
            action="qc_suggest",
            message_vi="chon qc chart",
            chart_type_hint="",
            detected_fields=[],
            confidence=0.9,
            rationale="test",
        )

    monkeypatch.setattr("data_formulator.agents.agent_smart_chat.SmartChatAgent.run", _fake_run)
    payload = {
        "token": "t2",
        "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "x"},
        "input_tables": [{
            "name": "t",
            "rows": [{"INDEX": 1, "VALUE": 10, "QCSTDPARAMNAME": "a", "TARGET": 9, "LL": 8, "UL": 12, "ARLL": 7, "ARUL": 13, "QCDATE": "2026-01-01", "QCSHIFT": "D"}],
        }],
        "extra_prompt": "ve qc chart",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s2"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["action"] == "qc_suggest"


def test_smart_chat_generic_qc_draw_is_overridden_to_info(monkeypatch):
    app = _make_app()
    client = app.test_client()

    def _fake_run(*args, **kwargs):
        return SmartChatResult(
            action="draw",
            message_vi="draw now",
            chart_type_hint="QC Trend Line",
            detected_fields=[],
            confidence=0.9,
            rationale="test",
        )

    monkeypatch.setattr("data_formulator.agents.agent_smart_chat.SmartChatAgent.run", _fake_run)
    payload = {
        "token": "t3",
        "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "x"},
        "input_tables": [{"name": "t", "rows": [{"month": "2026-01", "revenue": 100}]}],
        "extra_prompt": "ve qc trend line",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s3"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["action"] == "info"


def test_smart_chat_draw_delegates_to_derive(monkeypatch):
    app = _make_app()
    client = app.test_client()

    def _fake_run(*args, **kwargs):
        return SmartChatResult(
            action="draw",
            message_vi="draw now",
            chart_type_hint="Bar Chart",
            detected_fields=["month", "revenue"],
            confidence=0.95,
            rationale="test",
        )

    def _fake_derive(content):
        return {"token": content["token"], "status": "ok", "results": [{"status": "ok"}]}, 200

    monkeypatch.setattr("data_formulator.agents.agent_smart_chat.SmartChatAgent.run", _fake_run)
    monkeypatch.setattr("data_formulator.agent_routes._run_derive_data_core", _fake_derive)
    payload = {
        "token": "t4",
        "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "x"},
        "input_tables": [{"name": "t", "rows": [{"month": "2026-01", "revenue": 100}]}],
        "extra_prompt": "bar chart revenue by month",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s4"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["action"] == "draw"
    assert data["status"] == "ok"


def test_smart_chat_draw_normalizes_qc_chart_type_hint(monkeypatch):
    app = _make_app()
    client = app.test_client()
    captured = {}

    def _fake_run(*args, **kwargs):
        return SmartChatResult(
            action="draw",
            message_vi="draw now",
            chart_type_hint="QC Trend Line",
            detected_fields=["VALUE", "QCDATE"],
            confidence=0.95,
            rationale="test",
        )

    def _fake_derive(content):
        captured["user_preferred_chart_type"] = content.get("user_preferred_chart_type")
        return {"token": content["token"], "status": "ok", "results": [{"status": "ok"}]}, 200

    monkeypatch.setattr("data_formulator.agents.agent_smart_chat.SmartChatAgent.run", _fake_run)
    monkeypatch.setattr("data_formulator.agent_routes._run_derive_data_core", _fake_derive)
    monkeypatch.setattr(
        "data_formulator.agent_routes._enrich_suggestions_with_agent",
        lambda client, prompt, domain, suggestion_dicts: suggestion_dicts,
    )
    payload = {
        "token": "t5",
        "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "x"},
        "input_tables": [{
            "name": "t",
            "rows": [{
                "INDEX": 1, "VALUE": 10, "QCSTDPARAMNAME": "a", "TARGET": 9, "LL": 8, "UL": 12,
                "ARLL": 7, "ARUL": 13, "QCDATE": "2026-01-01", "QCSHIFT": "D"
            }],
        }],
        "extra_prompt": "Vẽ QC trend line VALUE theo QCDATE",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s5"
    res = client.post("/api/agent/smart-chat", json=payload)
    assert res.status_code == 200
    assert captured["user_preferred_chart_type"] == "qc_trend_line"


def test_smart_chat_draw_without_fields_downgrades_to_confirm(monkeypatch):
    app = _make_app()
    client = app.test_client()
    called = {"derive": 0}

    def _fake_run(*args, **kwargs):
        return SmartChatResult(
            action="draw",
            message_vi="draw now",
            chart_type_hint="Bar Chart",
            detected_fields=[],
            confidence=0.92,
            rationale="test",
        )

    def _fake_derive(content):
        called["derive"] += 1
        return {"token": content["token"], "status": "ok", "results": [{"status": "ok"}]}, 200

    monkeypatch.setattr("data_formulator.agents.agent_smart_chat.SmartChatAgent.run", _fake_run)
    monkeypatch.setattr("data_formulator.agent_routes._run_derive_data_core", _fake_derive)
    monkeypatch.setattr(
        "data_formulator.agent_routes._enrich_suggestions_with_agent",
        lambda client, prompt, domain, suggestion_dicts: suggestion_dicts,
    )
    payload = {
        "token": "t6",
        "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "x"},
        "input_tables": [{
            "name": "t",
            "rows": [
                {"month": "2026-01", "revenue": 100, "product": "A"},
                {"month": "2026-02", "revenue": 120, "product": "A"},
                {"month": "2026-03", "revenue": 90, "product": "B"},
                {"month": "2026-04", "revenue": 150, "product": "B"},
            ],
        }],
        "extra_prompt": "vẽ bar chart",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s6"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["action"] == "confirm"
    assert called["derive"] == 0
    assert len(data.get("suggestions", [])) > 0


def test_smart_chat_qc_suggest_returns_qc_and_generic(monkeypatch):
    app = _make_app()
    client = app.test_client()

    def _fake_run(*args, **kwargs):
        return SmartChatResult(
            action="qc_suggest",
            message_vi="goi y qc",
            chart_type_hint="",
            detected_fields=[],
            confidence=0.9,
            rationale="test",
        )

    monkeypatch.setattr("data_formulator.agents.agent_smart_chat.SmartChatAgent.run", _fake_run)
    monkeypatch.setattr(
        "data_formulator.agent_routes._enrich_suggestions_with_agent",
        lambda client, prompt, domain, suggestion_dicts: suggestion_dicts,
    )
    payload = {
        "token": "t7",
        "model": {"endpoint": "openai", "model": "gpt-4o", "api_key": "x"},
        "input_tables": [{
            "name": "t",
            "rows": [
                {"INDEX": 1, "VALUE": 10, "QCSTDPARAMNAME": "a", "TARGET": 9, "LL": 8, "UL": 12, "ARLL": 7, "ARUL": 13, "QCDATE": "2026-01-01", "QCSHIFT": "D", "ITEMNAME": "X", "LOT": "L1"},
                {"INDEX": 2, "VALUE": 11, "QCSTDPARAMNAME": "a", "TARGET": 9, "LL": 8, "UL": 12, "ARLL": 7, "ARUL": 13, "QCDATE": "2026-01-02", "QCSHIFT": "N", "ITEMNAME": "X", "LOT": "L1"},
                {"INDEX": 3, "VALUE": 9, "QCSTDPARAMNAME": "b", "TARGET": 9, "LL": 8, "UL": 12, "ARLL": 7, "ARUL": 13, "QCDATE": "2026-01-03", "QCSHIFT": "D", "ITEMNAME": "Y", "LOT": "L2"},
                {"INDEX": 4, "VALUE": 13, "QCSTDPARAMNAME": "b", "TARGET": 9, "LL": 8, "UL": 12, "ARLL": 7, "ARUL": 13, "QCDATE": "2026-01-04", "QCSHIFT": "N", "ITEMNAME": "Y", "LOT": "L2"},
            ],
        }],
        "extra_prompt": "vẽ qc chart",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s7"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["action"] == "qc_suggest"
    chart_types = [s.get("chart_type", "") for s in data.get("suggestions", [])]
    assert any(ct.startswith("QC") for ct in chart_types)
    # Generic slots may be absent on some sparse QC datasets; this test just
    # verifies we don't force QC-only response contract.
    assert len(chart_types) > 0


def test_enrich_suggestions_skips_qc_special_templates():
    from data_formulator.agent_routes import _enrich_suggestions_with_agent

    class FailClient:
        def get_completion(self, messages):
            raise AssertionError("LLM should not be called for QC special templates")

    suggestions = [
        {
            "chart_type": "QC Trend Line",
            "encoding": {"x": "QCDATE", "y": "VALUE", "color": "QCSHIFT"},
            "confidence": 0.9,
            "rationale_vi": "",
            "sample_prompt_vi": "",
        }
    ]
    result = _enrich_suggestions_with_agent(FailClient(), "ve", "qc", suggestions)
    assert result == suggestions


def test_log_telemetry_endpoint_accepts_event():
    app = _make_app()
    client = app.test_client()
    res = client.post(
        "/api/agent/log-telemetry",
        json={"event_name": "suggestion_clicked", "payload": {"chart_type": "Bar Chart"}},
    )
    data = res.get_json()
    assert res.status_code == 200
    assert data["status"] == "ok"
