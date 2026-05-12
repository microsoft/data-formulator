"""Tests for ModelRegistry: env-var loading, public listing, and credential isolation.

These are the security-critical paths — global model API keys must never
be included in the public listing sent to the frontend.
"""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from data_formulator.model_registry import (
    ModelRegistry,
    BUILTIN_PROVIDERS,
    is_likely_text_only_model,
    model_supports_vision,
)

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_env(providers: dict[str, dict[str, str]]) -> dict[str, str]:
    """Build a flat env-var dict from a nested {provider: {suffix: value}} mapping."""
    env = {}
    for provider, settings in providers.items():
        prefix = provider.upper()
        for suffix, value in settings.items():
            env[f"{prefix}_{suffix.upper()}"] = value
    return env


SAMPLE_ENV = _make_env({
    "openai": {
        "enabled": "true",
        "api_key": "sk-secret-openai-key",
        "models": "gpt-4o,gpt-5",
    },
    "ollama": {
        "enabled": "true",
        "api_base": "http://localhost:11434",
        "models": "qwen3:32b",
    },
    "deepseek": {
        "enabled": "true",
        "endpoint": "openai",
        "api_key": "sk-secret-deepseek-key",
        "api_base": "https://api.deepseek.com/v1",
        "models": "deepseek-chat",
    },
})


# ---------------------------------------------------------------------------
# Tests: discovery & loading
# ---------------------------------------------------------------------------

class TestModelDiscovery:
    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_discovers_all_enabled_providers(self):
        registry = ModelRegistry()
        public = registry.list_public()
        ids = {m["id"] for m in public}

        assert "global-openai-gpt-4o" in ids
        assert "global-openai-gpt-5" in ids
        assert "global-ollama-qwen3:32b" in ids
        assert "global-deepseek-deepseek-chat" in ids

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_total_model_count(self):
        registry = ModelRegistry()
        assert len(registry.list_public()) == 4  # 2 openai + 1 ollama + 1 deepseek

    @patch.dict(os.environ, {}, clear=True)
    def test_empty_env_yields_no_models(self):
        registry = ModelRegistry()
        assert registry.list_public() == []

    @patch.dict(os.environ, {"OPENAI_ENABLED": "true", "OPENAI_API_KEY": "sk-x"}, clear=True)
    def test_skips_provider_without_models(self):
        """OPENAI_MODELS not set → no models registered."""
        registry = ModelRegistry()
        assert registry.list_public() == []

    @patch.dict(os.environ, {"OPENAI_ENABLED": "false", "OPENAI_API_KEY": "sk-x", "OPENAI_MODELS": "gpt-4o"}, clear=True)
    def test_skips_disabled_provider(self):
        registry = ModelRegistry()
        assert registry.list_public() == []


# ---------------------------------------------------------------------------
# Tests: public listing never leaks credentials
# ---------------------------------------------------------------------------

class TestPublicListingSecurity:
    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_no_api_key_in_public_info(self):
        registry = ModelRegistry()
        for model in registry.list_public():
            assert "api_key" not in model, f"api_key leaked for {model['id']}"

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_public_fields_are_complete(self):
        registry = ModelRegistry()
        for model in registry.list_public():
            assert "id" in model
            assert "endpoint" in model
            assert "model" in model
            assert "supports_vision" in model
            assert "is_global" in model
            assert model["is_global"] is True

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_full_config_contains_api_key(self):
        """get_config must return credentials for server-side use."""
        registry = ModelRegistry()
        config = registry.get_config("global-openai-gpt-4o")
        assert config is not None
        assert config["api_key"] == "sk-secret-openai-key"


# ---------------------------------------------------------------------------
# Tests: custom provider endpoint resolution
# ---------------------------------------------------------------------------

class TestCustomProvider:
    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_custom_provider_uses_explicit_endpoint(self):
        """deepseek is not in BUILTIN_PROVIDERS, so it reads DEEPSEEK_ENDPOINT."""
        registry = ModelRegistry()
        config = registry.get_config("global-deepseek-deepseek-chat")
        assert config is not None
        assert config["endpoint"] == "openai"

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_builtin_provider_uses_own_name_as_endpoint(self):
        registry = ModelRegistry()
        config = registry.get_config("global-openai-gpt-4o")
        assert config is not None
        assert config["endpoint"] == "openai"

    @patch.dict(os.environ, {
        "MYVENDOR_ENABLED": "true",
        "MYVENDOR_API_KEY": "key123",
        "MYVENDOR_MODELS": "my-model",
    }, clear=True)
    def test_custom_provider_defaults_to_openai_endpoint(self):
        """When MYVENDOR_ENDPOINT is not set, defaults to 'openai'."""
        registry = ModelRegistry()
        config = registry.get_config("global-myvendor-my-model")
        assert config is not None
        assert config["endpoint"] == "openai"


# ---------------------------------------------------------------------------
# Tests: image input capability hints
# ---------------------------------------------------------------------------

class TestVisionCapability:
    @pytest.mark.parametrize("model_name", ["deepseek-chat", "provider/deepseek-chat-v2", "DeepSeek-Chat"])
    def test_known_text_only_models_are_detected(self, model_name):
        assert is_likely_text_only_model(model_name) is True

    @pytest.mark.parametrize("model_name", ["gpt-4o", "claude-sonnet-4-20250514", "deepseek-reasoner", None])
    def test_other_models_are_not_marked_text_only(self, model_name):
        assert is_likely_text_only_model(model_name) is False

    @patch.dict(os.environ, SAMPLE_ENV, clear=True)
    def test_public_listing_marks_deepseek_chat_as_not_vision_capable(self):
        registry = ModelRegistry()
        by_id = {m["id"]: m for m in registry.list_public()}

        assert by_id["global-deepseek-deepseek-chat"]["supports_vision"] is False
        assert by_id["global-openai-gpt-4o"]["supports_vision"] is True

    def test_explicit_supports_vision_false_wins(self):
        assert model_supports_vision({"model": "gpt-4o", "supports_vision": False}) is False
