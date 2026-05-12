"""Tests for the /list-global-models API endpoint.

Verifies that the endpoint returns all configured models instantly
without running any connectivity checks, and that the response
contains the expected fields (without sensitive data).
"""
from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from data_formulator.model_registry import ModelRegistry

pytestmark = [pytest.mark.backend]


SAMPLE_ENV = {
    "OPENAI_ENABLED": "true",
    "OPENAI_API_KEY": "sk-secret-key-12345",
    "OPENAI_MODELS": "gpt-4o,gpt-4o-mini",
    "ANTHROPIC_ENABLED": "true",
    "ANTHROPIC_API_KEY": "sk-ant-secret",
    "ANTHROPIC_MODELS": "claude-sonnet-4-20250514",
}


@pytest.fixture()
def flask_client():
    """Create a test client for the Flask app."""
    from data_formulator.app import app

    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


class TestListGlobalModelsEndpoint:

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_returns_all_configured_models(self, flask_client):
        registry = ModelRegistry()
        with patch("data_formulator.routes.agents.model_registry", registry):
            resp = flask_client.get("/api/agent/list-global-models")
            assert resp.status_code == 200
            body = json.loads(resp.data)
            assert body["status"] == "success"
            data = body["data"]
            assert len(data) == 3  # gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_response_has_required_fields(self, flask_client):
        registry = ModelRegistry()
        required = {"id", "endpoint", "model", "api_base", "api_version", "is_global"}
        with patch("data_formulator.routes.agents.model_registry", registry):
            resp = flask_client.get("/api/agent/list-global-models")
            body = json.loads(resp.data)
            data = body["data"]
            for item in data:
                assert required.issubset(item.keys())

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_no_api_key_in_response(self, flask_client):
        registry = ModelRegistry()
        with patch("data_formulator.routes.agents.model_registry", registry):
            resp = flask_client.get("/api/agent/list-global-models")
            raw = resp.data.decode("utf-8")
            assert "sk-secret-key-12345" not in raw
            assert "sk-ant-secret" not in raw
            assert "api_key" not in raw

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_all_models_marked_global(self, flask_client):
        registry = ModelRegistry()
        with patch("data_formulator.routes.agents.model_registry", registry):
            resp = flask_client.get("/api/agent/list-global-models")
            body = json.loads(resp.data)
            data = body["data"]
            assert all(m["is_global"] is True for m in data)

    @patch.dict(os.environ, {}, clear=True)
    def test_empty_env_returns_empty_list(self, flask_client):
        registry = ModelRegistry()
        with patch("data_formulator.routes.agents.model_registry", registry):
            resp = flask_client.get("/api/agent/list-global-models")
            body = json.loads(resp.data)
            assert body["status"] == "success"
            assert body["data"] == []
