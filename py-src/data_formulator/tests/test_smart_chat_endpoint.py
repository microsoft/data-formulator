from flask import Flask

from data_formulator.agent_routes import agent_bp


def _make_app():
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(agent_bp)
    return app


def test_smart_chat_off_topic_returns_info():
    app = _make_app()
    client = app.test_client()
    payload = {
        "token": "t1",
        "input_tables": [{"name": "t", "rows": [{"a": 1, "b": 2}]}],
        "extra_prompt": "Hôm nay thời tiết thế nào?",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s1"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["category"] == "OFF_TOPIC"
    assert data["action"] == "info"
    assert len(data["sample_prompts"]) > 0


def test_smart_chat_vague_returns_suggestions():
    app = _make_app()
    client = app.test_client()
    payload = {
        "token": "t2",
        "input_tables": [{"name": "t", "rows": [{"month": "2026-01", "revenue": 100}, {"month": "2026-02", "revenue": 120}]}],
        "extra_prompt": "Vẽ biểu đồ cho tôi",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s2"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["category"] == "VAGUE"
    assert data["action"] == "suggestion"
    assert "suggestions" in data


def test_smart_chat_partial_returns_confirm():
    app = _make_app()
    client = app.test_client()
    payload = {
        "token": "t3",
        "input_tables": [{"name": "t", "rows": [{"month": "2026-01", "revenue": 100}, {"month": "2026-02", "revenue": 120}]}],
        "extra_prompt": "Vẽ bar chart",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s3"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["category"] == "PARTIAL"
    assert data["action"] == "confirm"


def test_smart_chat_concrete_delegates_to_derive(monkeypatch):
    app = _make_app()
    client = app.test_client()

    def _fake_run(content):
        return {"token": content["token"], "status": "ok", "results": [{"status": "ok"}]}, 200

    monkeypatch.setattr("data_formulator.agent_routes._run_derive_data_core", _fake_run)
    payload = {
        "token": "t4",
        "model": {"endpoint": "openai", "model": "gpt-4o"},
        "input_tables": [{"name": "t", "rows": [{"QCSHIFT": "D", "VALUE": 10}, {"QCSHIFT": "N", "VALUE": 20}]}],
        "extra_prompt": "Vẽ bar chart x=QCSHIFT y=VALUE",
    }
    with client.session_transaction() as sess:
        sess["session_id"] = "s4"
    res = client.post("/api/agent/smart-chat", json=payload)
    data = res.get_json()
    assert res.status_code == 200
    assert data["category"] == "CONCRETE"
    assert data["action"] == "derive"
    assert data["status"] == "ok"

