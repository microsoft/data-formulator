import json
import litellm
from types import SimpleNamespace

from azure.identity import DefaultAzureCredential, get_bearer_token_provider


def _synthesize_stream(response):
    """Yield LiteLLM-style streaming chunks reconstructed from a *buffered*
    response, so a caller that consumes a stream sees the same data.

    Used for Ollama: LiteLLM's Ollama streaming path does not parse native
    tool calls (it leaks the call as raw JSON ``content`` with
    ``finish_reason='stop'``), whereas the buffered path parses them correctly.
    We therefore call Ollama non-streaming and replay the result as a stream.
    """
    try:
        choice0 = response.choices[0]
        message = choice0.message
        finish_reason = getattr(choice0, "finish_reason", "stop") or "stop"
    except (AttributeError, IndexError):
        return

    reasoning = getattr(message, "reasoning_content", None)
    if reasoning:
        yield SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=None, tool_calls=None,
                                  reasoning_content=reasoning),
            finish_reason=None)])

    content = getattr(message, "content", None)
    if content:
        yield SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=content, tool_calls=None,
                                  reasoning_content=None),
            finish_reason=None)])

    for idx, tc in enumerate(getattr(message, "tool_calls", None) or []):
        fn = getattr(tc, "function", None)
        yield SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(
                content=None, reasoning_content=None,
                tool_calls=[SimpleNamespace(
                    index=idx, id=getattr(tc, "id", None) or f"call_{idx}",
                    function=SimpleNamespace(
                        name=getattr(fn, "name", None),
                        arguments=getattr(fn, "arguments", "") or ""))]),
            finish_reason=None)])

    yield SimpleNamespace(choices=[SimpleNamespace(
        delta=SimpleNamespace(content=None, tool_calls=None,
                              reasoning_content=None),
        finish_reason=finish_reason)])


def _extract_json_objects(text):
    """Return top-level brace-balanced JSON object substrings found in ``text``.

    String-aware (ignores braces inside quoted strings) so it survives code
    payloads that contain ``{`` / ``}``. Used to recover an action that a weak
    model emitted as plain content instead of a native tool call.
    """
    objs = []
    depth = 0
    start = -1
    in_str = False
    esc = False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    objs.append(text[start:i + 1])
                    start = -1
    return objs


def _match_tool_from_obj(obj, tools, _depth=0):
    """Map a parsed JSON object to ``(tool_name, arguments_dict)`` if it matches
    one of ``tools``' schemas, else ``None``.

    Handles three shapes weak models emit instead of a native tool call:
      * nested wrapper — ``{"thought": ..., "action": {"name": "visualize",
        "arguments": {...}}}`` (a key points to an object describing the call);
      * flat explicit wrapper — ``{"name"/"tool"/"action": "visualize",
        "arguments": {...}}`` (the object names the tool directly);
      * bare arguments — ``{"code": ..., "output_variable": ..., "chart": ...}``
        (no tool named; keys matched against each tool's ``required`` params,
        most specific tool wins).
    """
    if not isinstance(obj, dict) or _depth > 4:
        return None

    tool_by_name = {}
    for t in tools or []:
        fn = (t or {}).get("function") or {}
        name = fn.get("name")
        if name:
            tool_by_name[name] = fn

    # Nested wrapper: a key points to an object that itself describes the call
    # (e.g. {"action": {"name": "visualize", "arguments": {...}}}). Recurse.
    for wrap_key in ("action", "tool", "function", "tool_call", "call",
                     "function_call"):
        inner = obj.get(wrap_key)
        if isinstance(inner, dict):
            got = _match_tool_from_obj(inner, tools, _depth + 1)
            if got is not None:
                return got

    # OpenAI tool-call wire format echoed as content: {"tool_calls": [{...}]}.
    tc_list = obj.get("tool_calls")
    if isinstance(tc_list, list) and tc_list:
        got = _match_tool_from_obj(tc_list[0], tools, _depth + 1)
        if got is not None:
            return got

    # Flat explicit wrapper: the object names the tool as a string.
    for name_key in ("name", "tool", "action", "function", "tool_name"):
        cand = obj.get(name_key)
        if isinstance(cand, str) and cand in tool_by_name:
            args = obj.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except (ValueError, TypeError):
                    args = None
            if not isinstance(args, dict):
                args = obj.get("parameters") if isinstance(obj.get("parameters"), dict) else None
            if not isinstance(args, dict):
                args = obj.get("args") if isinstance(obj.get("args"), dict) else None
            if not isinstance(args, dict):
                args = {k: v for k, v in obj.items()
                        if k not in (name_key, "arguments", "parameters", "args")}
            return cand, args

    # Bare arguments: match by required-key coverage, most specific tool wins.
    keys = set(obj.keys())
    best = None
    best_score = None
    for name, fn in tool_by_name.items():
        params = fn.get("parameters") or {}
        required = set(params.get("required") or [])
        props = set((params.get("properties") or {}).keys())
        if not required or not required.issubset(keys):
            continue
        score = (len(required), len(keys & props), -len(keys - props))
        if best_score is None or score > best_score:
            best_score, best = score, name
    if best is not None:
        return best, dict(obj)
    return None


def _salvage_tool_calls_from_content(response, tools):
    """If ``response`` carries an action as JSON *content* but no native
    ``tool_calls``, rewrite it into a proper tool call in place.

    Weak / open models under a long system prompt frequently emit the action
    (e.g. ``visualize``/``ask_user``) as a JSON object in the assistant content
    channel rather than as a native function call. This recovers that action so
    the agent — which only consumes native ``tool_calls`` — can proceed."""
    if not tools:
        return response
    try:
        choice0 = response.choices[0]
        message = choice0.message
    except (AttributeError, IndexError):
        return response
    if getattr(message, "tool_calls", None):
        return response
    content = getattr(message, "content", None)
    if not isinstance(content, str) or "{" not in content:
        return response

    for blob in _extract_json_objects(content):
        try:
            obj = json.loads(blob)
        except (ValueError, TypeError):
            continue
        matched = _match_tool_from_obj(obj, tools)
        if matched is None:
            continue
        name, args = matched
        try:
            from litellm.types.utils import ChatCompletionMessageToolCall, Function
            tc = ChatCompletionMessageToolCall(
                function=Function(name=name, arguments=json.dumps(args)),
                id="call_salvage_0", type="function")
        except Exception:
            tc = SimpleNamespace(
                id="call_salvage_0", type="function",
                function=SimpleNamespace(name=name, arguments=json.dumps(args)))
        message.tool_calls = [tc]
        message.content = None
        try:
            choice0.finish_reason = "tool_calls"
        except (AttributeError, TypeError):
            pass
        break
    return response


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

    def _is_reasoning_effort_error(self, error_text: str) -> bool:
        """Detect provider errors caused by an unsupported ``reasoning_effort``
        value (e.g. ``"minimal"`` on a model that only accepts
        ``none/low/medium/high/xhigh``). The provider message reliably
        mentions the parameter name.

        Also covers Ollama models that lack reasoning support: LiteLLM maps
        ``reasoning_effort`` to Ollama's ``think`` flag, and such models reject
        it with ``"<model> does not support thinking"``. Retrying without
        ``reasoning_effort`` (which drops ``think``) lets these models run."""
        lowered = error_text.lower()
        return "reasoning_effort" in lowered or "does not support thinking" in lowered

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
            max_tokens=3, drop_params=True, _skip_mcp_handler=True, **params,
        )

    def _dispatch(self, *, messages, stream, params, tools=None, extra=None):
        """Issue the LiteLLM call, transparently handling Ollama streaming.

        Ollama's streaming path in LiteLLM fails to parse native tool calls, so
        for Ollama we always call non-streaming and, when the caller asked for a
        stream, replay the buffered response as streaming chunks via
        ``_synthesize_stream``. All other providers stream natively."""
        is_ollama = self.endpoint == "ollama"
        effective_stream = stream and not is_ollama
        call_kwargs = dict(model=self.model, messages=messages,
                           drop_params=True, stream=effective_stream,
                           # We never use litellm's built-in MCP gateway. Setting this
                           # skips litellm's proxy/MCP handler import path, which pulls
                           # in fastapi and is not a dependency of this project
                           # (litellm>=1.92 imports it whenever `tools` are passed).
                           _skip_mcp_handler=True,
                           **params, **(extra or {}))
        if tools is not None:
            call_kwargs["tools"] = tools
        resp = litellm.completion(**call_kwargs)
        if is_ollama and tools:
            resp = _salvage_tool_calls_from_content(resp, tools)
        if is_ollama and stream:
            return _synthesize_stream(resp)
        return resp

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
            return self._dispatch(messages=messages, stream=stream, params=params)
        except Exception as e:
            err = str(e)
            if self._is_reasoning_effort_error(err):
                params.pop("reasoning_effort", None)
                return self._dispatch(messages=messages, stream=stream, params=params)
            if self._is_image_deserialize_error(err):
                sanitized = self._strip_images_from_messages(messages)
                return self._dispatch(messages=sanitized, stream=stream, params=params)
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
            return self._dispatch(messages=messages, stream=stream,
                                  params=params, tools=tools, extra=kwargs)
        except Exception as e:
            err = str(e)
            if self._is_reasoning_effort_error(err):
                params.pop("reasoning_effort", None)
                return self._dispatch(messages=messages, stream=stream,
                                      params=params, tools=tools, extra=kwargs)
            if self._is_image_deserialize_error(err):
                sanitized = self._strip_images_from_messages(messages)
                return self._dispatch(messages=sanitized, stream=stream,
                                      params=params, tools=tools, extra=kwargs)
            raise