from __future__ import annotations

import json

import pytest
from flask import Flask

from data_formulator.error_handler import register_error_handlers
from data_formulator.routes import model_endpoints


pytestmark = [pytest.mark.backend]


def test_sanitize_entry_keeps_only_non_secret_fields():
    entry = model_endpoints._sanitize_entry({
        "endpoint": "azure",
        "model": "gpt-5",
        "api_base": "https://example.openai.azure.com",
        "api_version": "preview",
        "auth_mode": "azure_identity",
        "api_key": "must-not-be-stored",
        "access_token": "also-secret",
    })

    assert entry == {
        "endpoint": "azure",
        "model": "gpt-5",
        "api_base": "https://example.openai.azure.com",
        "api_version": "preview",
        "auth_mode": "azure_identity",
    }


def test_history_round_trip_and_deduplication(tmp_path):
    path = tmp_path / "model_endpoints.json"
    first = model_endpoints._sanitize_entry({"endpoint": "openai", "model": "gpt-5"})
    second = model_endpoints._sanitize_entry({"endpoint": "azure", "model": "deployment"})

    model_endpoints._write_history(path, [second, first, second])

    assert model_endpoints._read_history(path) == [second, first, second]
    assert "api_key" not in path.read_text(encoding="utf-8")


def test_invalid_history_is_treated_as_empty(tmp_path):
    path = tmp_path / "model_endpoints.json"
    path.write_text("not-json", encoding="utf-8")

    assert model_endpoints._read_history(path) == []


def test_history_file_contains_no_unrecognized_fields(tmp_path):
    path = tmp_path / "model_endpoints.json"
    entry = model_endpoints._sanitize_entry({
        "endpoint": "ollama",
        "model": "llama3",
        "api_base": "http://localhost:11434",
        "api_key": "secret",
    })
    model_endpoints._write_history(path, [entry])

    stored = json.loads(path.read_text(encoding="utf-8"))
    assert set(stored[0]) == set(model_endpoints._FIELDS)
    assert "secret" not in path.read_text(encoding="utf-8")


def test_api_isolates_history_by_identity_and_drops_keys(tmp_path, monkeypatch):
    app = Flask(__name__)
    register_error_handlers(app)
    app.register_blueprint(model_endpoints.model_endpoints_bp)
    current_identity = ["user:alice"]
    monkeypatch.setattr(model_endpoints, "get_identity_id", lambda: current_identity[0])
    monkeypatch.setattr(
        model_endpoints,
        "_history_path",
        lambda identity: tmp_path / identity.replace(":", "_") / "model_endpoints.json",
    )
    client = app.test_client()

    response = client.post("/api/model-endpoints", json={
        "endpoint": "azure",
        "model": "sales-deployment",
        "api_base": "https://example.openai.azure.com",
        "api_key": "never-write-this",
    })
    assert response.get_json()["status"] == "success"
    assert "never-write-this" not in (tmp_path / "user_alice" / "model_endpoints.json").read_text()

    current_identity[0] = "user:bob"
    assert client.get("/api/model-endpoints").get_json()["data"] == []

    current_identity[0] = "user:alice"
    entries = client.get("/api/model-endpoints").get_json()["data"]
    assert entries[0]["model"] == "sales-deployment"
    assert "api_key" not in entries[0]