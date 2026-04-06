"""Tests for global model security: credential resolution and error sanitization.

These verify two critical security properties:
1. get_client() resolves real credentials from the registry for global models.
2. test_model error messages never leak API keys for global models.
"""
from __future__ import annotations

import os
from unittest.mock import patch, MagicMock

import pytest

from data_formulator.model_registry import ModelRegistry

pytestmark = [pytest.mark.backend]


SAMPLE_ENV = {
    "OPENAI_ENABLED": "true",
    "OPENAI_API_KEY": "sk-secret-key-12345",
    "OPENAI_MODELS": "gpt-4o",
}


# ---------------------------------------------------------------------------
# get_client: global model credential resolution
# ---------------------------------------------------------------------------

class TestGetClientGlobalResolution:
    """get_client() must resolve real credentials from model_registry
    when the model config has is_global=True."""

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_global_model_gets_real_api_key(self):
        """A global model config (no api_key from frontend) should be
        resolved to the full config with the real api_key."""
        registry = ModelRegistry()

        with patch("data_formulator.agent_routes.model_registry", registry):
            from data_formulator.agent_routes import get_client

            client = get_client({
                "id": "global-openai-gpt-4o",
                "endpoint": "openai",
                "model": "gpt-4o",
                "is_global": True,
            })

            assert client.params.get("api_key") == "sk-secret-key-12345"

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_user_model_keeps_own_credentials(self):
        """A non-global (user-added) model should use its own api_key,
        not touch the registry."""
        registry = ModelRegistry()

        with patch("data_formulator.agent_routes.model_registry", registry):
            from data_formulator.agent_routes import get_client

            client = get_client({
                "id": "user-custom-model",
                "endpoint": "openai",
                "model": "gpt-4o",
                "api_key": "sk-user-own-key",
                "api_base": "",
                "api_version": "",
            })

            assert client.params.get("api_key") == "sk-user-own-key"

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_global_model_without_registry_match_falls_through(self):
        """If a global model id is not in the registry, get_client should
        still work (using whatever config was passed)."""
        registry = ModelRegistry()

        with patch("data_formulator.agent_routes.model_registry", registry):
            from data_formulator.agent_routes import get_client

            client = get_client({
                "id": "global-nonexistent-model",
                "endpoint": "openai",
                "model": "nonexistent",
                "api_key": "sk-fallback",
                "api_base": "",
                "api_version": "",
                "is_global": True,
            })

            assert client.params.get("api_key") == "sk-fallback"


# ---------------------------------------------------------------------------
# Error sanitization for global models
# ---------------------------------------------------------------------------

class TestGlobalModelErrorSanitization:
    """Global model errors must not leak API keys to the frontend."""

    def test_sanitize_redacts_api_key_patterns(self):
        from data_formulator.agent_routes import sanitize_model_error

        raw = "Connection failed: api_key=sk-secret-key-12345 is invalid"
        sanitized = sanitize_model_error(raw)

        assert "sk-secret-key-12345" not in sanitized
        assert "<redacted>" in sanitized

    def test_sanitize_truncates_long_messages(self):
        from data_formulator.agent_routes import sanitize_model_error

        raw = "x" * 1000
        sanitized = sanitize_model_error(raw)

        assert len(sanitized) <= 503  # 500 + "..."
        assert sanitized.endswith("...")

    def test_sanitize_escapes_html(self):
        from data_formulator.agent_routes import sanitize_model_error

        raw = '<script>alert("xss")</script>'
        sanitized = sanitize_model_error(raw)

        assert "<script>" not in sanitized
        assert "&lt;script&gt;" in sanitized
