import litellm
from azure.identity import DefaultAzureCredential, get_bearer_token_provider


class Client(object):
    """
    Returns a LiteLLM client configured for the specified endpoint and model.
    Supports OpenAI, Azure, Ollama, and other providers via LiteLLM.
    """
    def __init__(self, endpoint, model, api_key=None,  api_base=None, api_version=None):
        
        self.endpoint = endpoint
        self.model = model
        self.params = {}

        if api_key is not None and api_key != "":
            self.params["api_key"] = api_key
        if api_base is not None and api_base != "":
            self.params["api_base"] = api_base
        if api_version is not None and api_version != "":
            self.params["api_version"] = api_version

        if self.endpoint == "openai":
            if not model.startswith("openai/"):
                self.model = f"openai/{model}"
        elif self.endpoint == "gemini":
            if model.startswith("gemini/"):
                self.model = model
            else:
                self.model = f"gemini/{model}"
        elif self.endpoint == "anthropic":
            if model.startswith("anthropic/"):
                self.model = model
            else:
                self.model = f"anthropic/{model}"
        elif self.endpoint == "azure":
            self.params["api_base"] = api_base
            self.params["api_version"] = api_version if api_version else "2025-04-01-preview"
            if api_key is None or api_key == "":
                token_provider = get_bearer_token_provider(
                    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
                )
                self.params["azure_ad_token_provider"] = token_provider
            self.params["custom_llm_provider"] = "azure"
        elif self.endpoint == "ollama":
            ollama_base = api_base if api_base else "http://localhost:11434"
            # LiteLLM appends "/api/generate" itself, so strip a user-supplied
            # trailing "/api" (and any trailing slashes) to avoid "/api/api/generate".
            ollama_base = ollama_base.rstrip("/")
            if ollama_base.endswith("/api"):
                ollama_base = ollama_base[: -len("/api")]
            self.params["api_base"] = ollama_base
            if model.startswith("ollama/"):
                self.model = model
            else:
                self.model = f"ollama/{model}"

    def _strip_image_blocks(self, content):
        """Remove image_url blocks from multimodal content arrays."""
        if isinstance(content, list):
            sanitized = []
            for item in content:
                if isinstance(item, dict):
                    if item.get("type") == "image_url":
                        continue
                    sanitized.append(item)
                else:
                    sanitized.append(item)
            return sanitized
        return content

    def _strip_images_from_messages(self, messages):
        """Create a copy of messages with image_url blocks removed."""
        sanitized_messages = []
        for msg in messages:
            if isinstance(msg, dict):
                new_msg = dict(msg)
                if "content" in new_msg:
                    new_msg["content"] = self._strip_image_blocks(new_msg["content"])
                sanitized_messages.append(new_msg)
            else:
                sanitized_messages.append(msg)
        return sanitized_messages

    def _is_image_deserialize_error(self, error_text: str) -> bool:
        """Detect provider errors caused by image blocks on text-only models."""
        lowered = error_text.lower()
        return ("image_url" in lowered and "expected `text`" in lowered) or "unknown variant `image_url`" in lowered

    @classmethod
    def from_config(cls, model_config: dict[str, str]):
        """
        Create a client instance from model configuration.
        
        Args:
            model_config: Dictionary containing endpoint, model, api_key, api_base, api_version
            
        Returns:
            Client instance for making API calls
        """
        # Strip whitespace from all values
        for key in model_config:
            if isinstance(model_config[key], str):
                model_config[key] = model_config[key].strip()

        return cls(
            model_config["endpoint"],
            model_config["model"],
            model_config.get("api_key"),
            model_config.get("api_base"),
            model_config.get("api_version")
        )

    def ping(self, timeout: int = 10):
        """Lightweight connectivity check: send a minimal completion with
        max_tokens=3 and a short timeout.  Raises on any failure."""
        messages = [{"role": "user", "content": "Reply only 'ok'."}]
        params = self.params.copy()
        params["timeout"] = timeout
        litellm.completion(
            model=self.model, messages=messages,
            max_tokens=3, drop_params=True, **params,
        )

    def get_completion(self, messages, stream=False, reasoning_effort="low",
                       **kwargs):
        """Send a chat completion request via LiteLLM.

        All providers (OpenAI, Azure, Anthropic, etc.) are handled uniformly
        by LiteLLM.  ``drop_params=True`` ensures unsupported parameters
        (like ``reasoning_effort`` on non-reasoning models) are silently
        ignored rather than causing errors.
        """
        params = self.params.copy()
        params["reasoning_effort"] = reasoning_effort
        params.update(kwargs)
        try:
            return litellm.completion(
                model=self.model, messages=messages,
                drop_params=True, stream=stream, **params,
            )
        except Exception as e:
            if self._is_image_deserialize_error(str(e)):
                sanitized = self._strip_images_from_messages(messages)
                return litellm.completion(
                    model=self.model, messages=sanitized,
                    drop_params=True, stream=stream, **params,
                )
            raise

    def get_completion_with_tools(self, messages, tools, stream=False,
                                  reasoning_effort="low", **kwargs):
        """Send a chat completion request with tool definitions via LiteLLM.

        Same as ``get_completion`` but accepts ``tools`` (and optional
        ``tool_choice``, ``parallel_tool_calls``, etc. via ``**kwargs``).
        """
        params = self.params.copy()
        params["reasoning_effort"] = reasoning_effort
        try:
            return litellm.completion(
                model=self.model, messages=messages, tools=tools,
                drop_params=True, stream=stream, **params, **kwargs,
            )
        except Exception as e:
            if self._is_image_deserialize_error(str(e)):
                sanitized = self._strip_images_from_messages(messages)
                return litellm.completion(
                    model=self.model, messages=sanitized, tools=tools,
                    drop_params=True, stream=stream, **params, **kwargs,
                )
            raise