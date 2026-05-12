# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
from typing import Optional, Dict, List

BUILTIN_PROVIDERS = {'openai', 'azure', 'anthropic', 'gemini', 'ollama'}


def is_likely_text_only_model(model_name: str | None) -> bool:
    """Return True for known model names that reject image input."""
    return "deepseek-chat" in (model_name or "").lower()


def model_supports_vision(model_config: dict | None) -> bool:
    """Infer whether a model can receive image input."""
    if not model_config:
        return False
    if model_config.get("supports_vision") is False:
        return False
    return not is_likely_text_only_model(model_config.get("model"))


class ModelRegistry:
    """
    Load global model configurations from environment variables.

    Supports both built-in providers (openai / azure / anthropic / gemini /
    ollama) and arbitrary custom providers (e.g. DEEPSEEK, QWEN).

    For a custom provider, set:
        {PROVIDER}_ENABLED=true
        {PROVIDER}_ENDPOINT=openai        # actual call type; defaults to openai
        {PROVIDER}_API_KEY=<key>
        {PROVIDER}_API_BASE=<url>
        {PROVIDER}_API_VERSION=<ver>      # optional
        {PROVIDER}_MODELS=model-a,model-b

    API keys and credentials live server-side only; the public information
    returned to the frontend contains no sensitive fields.
    """

    def __init__(self) -> None:
        self._models: Dict[str, dict] = {}
        self._reload()

    @staticmethod
    def make_id(provider: str, model: str) -> str:
        return f"global-{provider}-{model}"

    def _discover_providers(self) -> List[str]:
        """
        Return the lowercase names of all enabled providers by scanning
        every environment variable that ends with _ENABLED=true.
        """
        providers: List[str] = []
        for key, val in os.environ.items():
            if key.upper().endswith("_ENABLED") and val.strip().lower() == "true":
                prefix = key[: -len("_ENABLED")].lower()
                providers.append(prefix)
        return providers

    def _reload(self) -> None:
        self._models = {}
        for provider in self._discover_providers():
            env = provider.upper()

            api_key = os.getenv(f"{env}_API_KEY", "").strip()
            api_base = os.getenv(f"{env}_API_BASE", "").strip()
            api_version = os.getenv(f"{env}_API_VERSION", "").strip()
            models_str = os.getenv(f"{env}_MODELS", "").strip()

            if not (api_key or api_base) or not models_str:
                continue

            if provider in BUILTIN_PROVIDERS:
                endpoint = provider
            else:
                endpoint = os.getenv(f"{env}_ENDPOINT", "openai").strip().lower()

            for model_name in models_str.split(","):
                model_name = model_name.strip()
                if not model_name:
                    continue

                model_id = self.make_id(provider, model_name)
                self._models[model_id] = {
                    "id": model_id,
                    "endpoint": endpoint,
                    "model": model_name,
                    "api_key": api_key,
                    "api_base": api_base,
                    "api_version": api_version,
                    "provider_display": provider,
                    "supports_vision": not is_likely_text_only_model(model_name),
                }

    def get_config(self, model_id: str) -> Optional[dict]:
        """Return the full config (including credentials) for a global model."""
        return self._models.get(model_id)

    def list_public(self) -> list:
        """
        Return public info for all globally configured models.
        Sensitive fields (api_key) are intentionally excluded.
        """
        return [
            {
                "id": m["id"],
                "endpoint": m["endpoint"],
                "model": m["model"],
                "api_base": m["api_base"],
                "api_version": m["api_version"],
                "supports_vision": m.get("supports_vision", True),
                "is_global": True,
            }
            for m in self._models.values()
        ]

    def is_global(self, model_id: str) -> bool:
        return model_id in self._models


model_registry = ModelRegistry()
