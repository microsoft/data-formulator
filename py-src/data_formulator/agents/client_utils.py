import litellm
import random
import time
from azure.identity import DefaultAzureCredential, get_bearer_token_provider


class Client(object):
    """
    Returns a LiteLLM client configured for the specified endpoint and model.
    Supports OpenAI, Azure, Ollama, and other providers via LiteLLM.
    """
    _MAX_ATTEMPTS = 3
    _MAX_RETRY_DELAY_SECONDS = 30.0
    _DEFAULT_TIMEOUT_SECONDS = 90.0
    _MAX_TOTAL_RETRY_SECONDS = 120.0

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

    def _is_reasoning_effort_error(self, error_text: str) -> bool:
        """Detect provider errors caused by an unsupported ``reasoning_effort``
        value (e.g. ``"minimal"`` on a model that only accepts
        ``none/low/medium/high/xhigh``). Some Azure model errors name only the
        rejected value and supported values, not the parameter itself."""
        lowered = error_text.lower()
        return "reasoning_effort" in lowered or (
            "unsupported value" in lowered
            and "supported values" in lowered
            and "medium" in lowered
            and "high" in lowered
        )

    @staticmethod
    def _status_code(error: Exception) -> int | None:
        status = getattr(error, "status_code", None)
        if isinstance(status, int):
            return status
        response = getattr(error, "response", None)
        status = getattr(response, "status_code", None)
        return status if isinstance(status, int) else None

    @classmethod
    def _is_retryable_transport_error(cls, error: Exception) -> bool:
        status = cls._status_code(error)
        if status is not None:
            return status == 408 or status == 429 or 500 <= status <= 599
        return isinstance(error, (ConnectionError, TimeoutError))

    @classmethod
    def _retry_delay(cls, error: Exception, attempt: int) -> float:
        response = getattr(error, "response", None)
        headers = getattr(response, "headers", {}) or {}
        retry_after = headers.get("Retry-After") or headers.get("retry-after")
        if retry_after is not None:
            try:
                return min(float(retry_after), cls._MAX_RETRY_DELAY_SECONDS)
            except (TypeError, ValueError):
                pass
        base = min(2 ** attempt, cls._MAX_RETRY_DELAY_SECONDS)
        return min(base + random.uniform(0, 0.25), cls._MAX_RETRY_DELAY_SECONDS)

    @classmethod
    def _bounded_call_kwargs(cls, kwargs: dict, deadline: float) -> dict:
        call_kwargs = dict(kwargs)
        remaining = max(deadline - time.monotonic(), 0.001)
        configured_timeout = call_kwargs.get("timeout", cls._DEFAULT_TIMEOUT_SECONDS)
        if isinstance(configured_timeout, (int, float)):
            call_kwargs["timeout"] = min(float(configured_timeout), remaining)
        else:
            call_kwargs["timeout"] = min(cls._DEFAULT_TIMEOUT_SECONDS, remaining)
        return call_kwargs

    @classmethod
    def _can_retry_within_deadline(cls, deadline: float, delay: float) -> bool:
        return delay < deadline - time.monotonic()

    def _stream_completion_with_retry(self, *, deadline: float, **kwargs):
        current_kwargs = dict(kwargs)
        transport_attempt = 0
        removed_reasoning = False
        removed_images = False

        while True:
            emitted_chunk = False
            try:
                stream = litellm.completion(
                    **self._bounded_call_kwargs(current_kwargs, deadline)
                )
                for chunk in stream:
                    emitted_chunk = True
                    yield chunk
                return
            except Exception as error:
                if emitted_chunk:
                    raise

                error_text = str(error)
                if (
                    not removed_reasoning
                    and "reasoning_effort" in current_kwargs
                    and self._is_reasoning_effort_error(error_text)
                ):
                    current_kwargs.pop("reasoning_effort", None)
                    removed_reasoning = True
                    continue
                if (
                    not removed_images
                    and self._is_image_deserialize_error(error_text)
                ):
                    current_kwargs["messages"] = self._strip_images_from_messages(
                        current_kwargs["messages"]
                    )
                    removed_images = True
                    continue

                transport_attempt += 1
                if (
                    transport_attempt >= self._MAX_ATTEMPTS
                    or not self._is_retryable_transport_error(error)
                ):
                    raise
                delay = self._retry_delay(error, transport_attempt - 1)
                if not self._can_retry_within_deadline(deadline, delay):
                    raise
                time.sleep(delay)

    def _completion_with_retry(self, *, deadline: float | None = None, **kwargs):
        deadline = deadline or time.monotonic() + self._MAX_TOTAL_RETRY_SECONDS
        if kwargs.get("stream"):
            return self._stream_completion_with_retry(deadline=deadline, **kwargs)

        for attempt in range(self._MAX_ATTEMPTS):
            try:
                return litellm.completion(
                    **self._bounded_call_kwargs(kwargs, deadline)
                )
            except Exception as error:
                if (
                    attempt == self._MAX_ATTEMPTS - 1
                    or not self._is_retryable_transport_error(error)
                ):
                    raise
                delay = self._retry_delay(error, attempt)
                if not self._can_retry_within_deadline(deadline, delay):
                    raise
                time.sleep(delay)

        raise RuntimeError("Completion retry loop exited unexpectedly")

    def _completion_with_compatibility_fallbacks(
        self,
        *,
        deadline: float,
        **kwargs,
    ):
        current_kwargs = dict(kwargs)
        removed_reasoning = False
        removed_images = False

        while True:
            try:
                return self._completion_with_retry(
                    deadline=deadline,
                    **current_kwargs,
                )
            except Exception as error:
                error_text = str(error)
                if (
                    not removed_reasoning
                    and "reasoning_effort" in current_kwargs
                    and self._is_reasoning_effort_error(error_text)
                ):
                    current_kwargs.pop("reasoning_effort", None)
                    removed_reasoning = True
                    continue
                if (
                    not removed_images
                    and self._is_image_deserialize_error(error_text)
                ):
                    current_kwargs["messages"] = self._strip_images_from_messages(
                        current_kwargs["messages"]
                    )
                    removed_images = True
                    continue
                raise

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
        max_tokens=64 and a short timeout. GPT-5 Pro rejects output limits
        below 16 tokens and can consume that minimum budget while reasoning.
        Raises on any failure."""
        messages = [{"role": "user", "content": "Reply only 'ok'."}]
        params = self.params.copy()
        params["timeout"] = timeout
        litellm.completion(
            model=self.model, messages=messages,
            max_tokens=64, drop_params=True, **params,
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
        deadline = time.monotonic() + self._MAX_TOTAL_RETRY_SECONDS
        return self._completion_with_compatibility_fallbacks(
            model=self.model,
            messages=messages,
            drop_params=True,
            stream=stream,
            deadline=deadline,
            **params,
        )

    def get_completion_with_tools(self, messages, tools, stream=False,
                                  reasoning_effort="low", **kwargs):
        """Send a chat completion request with tool definitions via LiteLLM.

        Same as ``get_completion`` but accepts ``tools`` (and optional
        ``tool_choice``, ``parallel_tool_calls``, etc. via ``**kwargs``).
        """
        params = self.params.copy()
        params["reasoning_effort"] = reasoning_effort
        params.update(kwargs)
        deadline = time.monotonic() + self._MAX_TOTAL_RETRY_SECONDS
        return self._completion_with_compatibility_fallbacks(
            model=self.model,
            messages=messages,
            tools=tools,
            drop_params=True,
            stream=stream,
            deadline=deadline,
            **params,
        )
