import litellm
import openai
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

        if self.endpoint == "gemini":
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

        if self.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.params.get("api_base", None),
                api_key=self.params.get("api_key", ""),
                timeout=timeout,
            )
            client.chat.completions.create(
                model=self.model, messages=messages, max_tokens=3,
            )
        else:
            params = self.params.copy()
            params["timeout"] = timeout
            litellm.completion(
                model=self.model, messages=messages,
                max_tokens=3, drop_params=True, **params,
            )

    def get_completion(self, messages, stream=False):
        """
        Returns a LiteLLM client configured for the specified endpoint and model.
        Supports OpenAI, Azure, Ollama, and other providers via LiteLLM.
        """
        # Configure LiteLLM 

        if self.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.params.get("api_base", None),
                api_key=self.params.get("api_key", ""),
                timeout=120
            )

            completion_params = {
                "model": self.model,
                "messages": messages,
            }

            if self.model.startswith("gpt-5") or self.model.startswith("o1") or self.model.startswith("o3"):
                completion_params["reasoning_effort"] = "low"

            try:
                return client.chat.completions.create(**completion_params, stream=stream)
            except Exception as e:
                error_text = str(e)
                if self._is_image_deserialize_error(error_text):
                    sanitized_messages = self._strip_images_from_messages(messages)
                    completion_params["messages"] = sanitized_messages
                    return client.chat.completions.create(**completion_params, stream=stream)
                raise
        else:

            params = self.params.copy()

            if (self.model.startswith("gpt-5") or self.model.startswith("o1") or self.model.startswith("o3")
                or self.model.startswith("claude-sonnet-4-5") or self.model.startswith("claude-opus-4")):
                params["reasoning_effort"] = "low"

            try:
                return litellm.completion(
                    model=self.model,
                    messages=messages,
                    drop_params=True,
                    stream=stream,
                    **params
                )
            except Exception as e:
                error_text = str(e)
                if self._is_image_deserialize_error(error_text):
                    sanitized_messages = self._strip_images_from_messages(messages)
                    return litellm.completion(
                        model=self.model,
                        messages=sanitized_messages,
                        drop_params=True,
                        stream=stream,
                        **params
                    )
                raise

        
    def get_response(self, messages: list[dict], tools: list | None = None):
        """
        Returns a response using OpenAI's Response API approach.
        """
        if self.endpoint == "openai":
            client = openai.OpenAI(
                base_url=self.params.get("api_base", None),
                api_key=self.params.get("api_key", ""),
                timeout=120
            )
            return client.responses.create(
                model=self.model,
                input=messages,
                tools=tools,
                **self.params
            )
        else:
            return litellm.responses(
                model=self.model,
                input=messages,
                tools=tools,
                drop_params=True,
                **self.params
            )