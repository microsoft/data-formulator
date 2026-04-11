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
# Error sanitization (shared sanitize module)
# ---------------------------------------------------------------------------

class TestSharedErrorSanitization:
    """The shared sanitize_error_message function must strip sensitive data."""

    def test_sanitize_redacts_api_key_patterns(self):
        from data_formulator.security.sanitize import sanitize_error_message

        raw = "Connection failed: api_key=sk-secret-key-12345 is invalid"
        sanitized = sanitize_error_message(raw)

        assert "sk-secret-key-12345" not in sanitized
        assert "<redacted>" in sanitized

    def test_sanitize_truncates_long_messages(self):
        from data_formulator.security.sanitize import sanitize_error_message

        raw = "x" * 1000
        sanitized = sanitize_error_message(raw)

        assert len(sanitized) <= 503  # 500 + "..."
        assert sanitized.endswith("...")

    def test_sanitize_escapes_html(self):
        from data_formulator.security.sanitize import sanitize_error_message

        raw = '<script>alert("xss")</script>'
        sanitized = sanitize_error_message(raw)

        assert "<script>" not in sanitized
        assert "&lt;script&gt;" in sanitized


# ---------------------------------------------------------------------------
# classify_llm_error: pattern-based safe message classification
# ---------------------------------------------------------------------------

class TestClassifyLlmError:
    """classify_llm_error returns pre-defined safe messages based on error patterns."""

    def test_auth_error_401(self):
        from data_formulator.security.sanitize import classify_llm_error

        msg = classify_llm_error(RuntimeError("Error code: 401 - Unauthorized"))
        assert "Authentication failed" in msg
        assert "401" not in msg

    def test_auth_error_invalid_key(self):
        from data_formulator.security.sanitize import classify_llm_error

        msg = classify_llm_error(RuntimeError("Invalid API key provided: sk-secret..."))
        assert "Authentication failed" in msg
        assert "sk-secret" not in msg

    def test_rate_limit_429(self):
        from data_formulator.security.sanitize import classify_llm_error

        msg = classify_llm_error(RuntimeError("Error code: 429 - Rate limit exceeded"))
        assert "Rate limit" in msg

    def test_context_length(self):
        from data_formulator.security.sanitize import classify_llm_error

        msg = classify_llm_error(RuntimeError("maximum context length is 8192 tokens"))
        assert "too long" in msg.lower() or "reduce" in msg.lower()

    def test_model_not_found(self):
        from data_formulator.security.sanitize import classify_llm_error

        msg = classify_llm_error(RuntimeError("The model 'gpt-5' does not exist"))
        assert "Model not found" in msg

    def test_timeout(self):
        from data_formulator.security.sanitize import classify_llm_error

        msg = classify_llm_error(RuntimeError("Connection timed out"))
        assert "timed out" in msg.lower() or "timeout" in msg.lower()

    def test_unknown_error_generic_fallback(self):
        from data_formulator.security.sanitize import classify_llm_error

        msg = classify_llm_error(RuntimeError("some completely unknown error xyz"))
        assert msg == "Model request failed"
        assert "unknown error xyz" not in msg

    def test_never_includes_raw_exception_text(self):
        from data_formulator.security.sanitize import classify_llm_error

        secret = "my-super-secret-api-key-12345"
        msg = classify_llm_error(RuntimeError(f"Failed with api_key={secret}"))
        assert secret not in msg
