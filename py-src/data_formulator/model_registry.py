# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import os
from typing import Optional, Dict, List

BUILTIN_PROVIDERS = {'openai', 'azure', 'anthropic', 'gemini', 'ollama', 'orcarouter', 'cheaperinference'}


class ModelRegistry:
    """
    Load global model configurations from environment variables.

    Supports both built-in providers (openai / azure / anthropic / gemini /
    ollama / orcarouter / cheaperinference) and arbitrary custom providers
    (e.g. DEEPSEEK, QWEN).

    A provider is enabled when {PROVIDER}_MODELS is set together with
    {PROVIDER}_API_KEY and/or {PROVIDER}_API_BASE. For a custom provider, set:
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
        Return the lowercase names of all candidate providers by scanning
        every non-empty environment variable that ends with _MODELS.
        ``_reload`` skips candidates without an API key or base URL.
        """
        providers: List[str] = []
        for key, val in os.environ.items():
            if key.upper().endswith("_MODELS") and val.strip():
                prefix = key[: -len("_MODELS")].lower()
                if prefix:
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
                }

    def get_config(self, model_id: str, *, configured: bool = True) -> Optional[dict]:
        """Return the full config (including credentials) for a global model."""
        from data_formulator.configuration import resource_enabled
        if configured and not resource_enabled('models', model_id):
            return None
        if isinstance(model_id, str) and model_id.startswith('installation-'):
            from data_formulator.configuration import connection_definitions
            definition = connection_definitions('models').get(model_id)
            return {**definition, 'id': model_id} if definition else None
        return self._models.get(model_id)

    def list_public(self, configured: bool = True) -> list:
        """
        Return public info for all globally configured models.
        Sensitive fields (api_key) are intentionally excluded.
        """
        from data_formulator.configuration import connection_definitions
        definitions = {**self._models, **{identifier: {**definition, 'id': identifier, 'api_base': definition.get('api_base', ''),
                   'api_version': definition.get('api_version', ''), 'api_key': definition.get('api_key', '')}
                   for identifier, definition in connection_definitions('models').items()}}
        models = [
            {
                "id": m["id"],
                "endpoint": m["endpoint"],
                "model": m["model"],
                "api_base": m["api_base"],
                "api_version": m["api_version"],
                "auth_mode": (
                    "azure_identity"
                    if m["endpoint"] == "azure" and not m["api_key"]
                    else "key"
                ),
                "is_global": True,
            }
            for m in definitions.values()
        ]
        if not configured:
            return models
        from data_formulator.configuration import read_configuration
        overrides = read_configuration()['overrides']
        options = overrides.get('models', {})
        models = [{**model, **({'display_name': options[model['id']]['display_name']}
                   if options.get(model['id'], {}).get('display_name') else {})}
                  for model in models if options.get(model['id'], {}).get('enabled', True)]
        default = overrides.get('default_model')
        return sorted(models, key=lambda model: model['id'] != default)

    def is_global(self, model_id: str) -> bool:
        return self.get_config(model_id) is not None


model_registry = ModelRegistry()
