# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for data_formulator.agents.client_utils.Client.

Tests cover the pure-logic parts that don't require a live LLM:
- Model name prefixing for gemini / anthropic / ollama
- Ollama api_base normalisation (trailing /api stripping)
- Image block stripping helpers (_strip_image_blocks, _strip_images_from_messages)
- Image request detection (_messages_contain_images)
- Image deserialise error detection (_is_image_deserialize_error)
- Client.from_config constructor
"""

from __future__ import annotations

import pytest

import data_formulator.agents.client_utils as client_utils
from data_formulator.agents.client_utils import Client

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Model name prefixing
# ---------------------------------------------------------------------------

class TestModelNamePrefixing:
    def test_chatgpt_uses_private_native_responses_transport(self, monkeypatch):
        import base64
        import httpx
        import json
        from litellm.llms.chatgpt.authenticator import Authenticator
        from litellm.llms.custom_httpx.http_handler import HTTPHandler

        def forbid_file_auth(*args, **kwargs):
            raise AssertionError("Shared file authentication must not run")

        monkeypatch.setattr(Authenticator, "__init__", forbid_file_auth)
        monkeypatch.setattr(client_utils.litellm, "ChatGPTConfig", client_utils.litellm.ChatGPTConfig)
        original_config = client_utils.litellm.ChatGPTResponsesAPIConfig
        monkeypatch.setattr(client_utils.litellm, "ChatGPTResponsesAPIConfig", original_config)
        requests = []

        def respond(handler, url, **kwargs):
            requests.append((url, kwargs))
            return httpx.Response(200, request=httpx.Request("POST", url),
                headers={"content-type": "text/event-stream"}, text="data: " + json.dumps({
                    "type": "response.completed", "response": {
                        "id": "resp_test", "object": "response", "created_at": 1, "status": "completed",
                        "model": "gpt-5.4", "output": [{"type": "message", "id": "msg_test",
                            "role": "assistant", "status": "completed", "content": [
                                {"type": "output_text", "text": "ok", "annotations": []}]}],
                        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
                    },
                }) + "\n\n")

        monkeypatch.setattr(HTTPHandler, "post", respond)
        for owner in ("alice", "bob"):
            claims = base64.urlsafe_b64encode(json.dumps({"https://api.openai.com/auth": {
                "chatgpt_account_id": owner}}).encode()).decode().rstrip("=")
            token = "header." + claims + ".signature"
            client = Client("chatgpt", "gpt-5.4", api_key=token, chatgpt_account_id=owner)
            response = client.get_completion([{"role": "user", "content": "Hello"}])
            assert response.choices[0].message.content == "ok"
            url, options = requests[-1]
            assert url == "https://chatgpt.com/backend-api/codex/responses"
            headers = {key.lower(): value for key, value in options["headers"].items()}
            assert headers["authorization"] == "Bearer " + token
            assert headers["chatgpt-account-id"] == owner
            body = options["json"]
            assert body["model"] == "gpt-5.4"
            assert body["store"] is False
            assert body["stream"] is True
            assert not {"max_tokens", "max_output_tokens", "max_completion_tokens"} & body.keys()

    def test_responses_stream_survives_analyst_reconstruction(self, monkeypatch):
        import json
        from unittest.mock import Mock
        from data_formulator.analyst.agent import AnalystAgent
        from data_formulator.agents.agent_utils import attach_reasoning_content

        reasoning = {"type": "reasoning", "id": "rs_stream", "summary": [], "encrypted_content": "opaque-stream"}
        call = {"type": "function_call", "id": "fc_stream", "call_id": "call_stream",
                "name": "query", "arguments": ""}
        events = [
            {"type": "response.output_text.delta", "delta": "Checking data"},
            {"type": "response.output_item.added", "output_index": 1, "item": call},
            {"type": "response.function_call_arguments.delta", "output_index": 1, "delta": '{"sql":'},
            {"type": "response.function_call_arguments.delta", "output_index": 1, "delta": '"select 1"}'},
            {"type": "response.completed", "response": {"output": [reasoning, call],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}}},
        ]
        responses = Mock(side_effect=lambda **kwargs: iter(json.dumps(event) for event in events))
        monkeypatch.setattr(client_utils.litellm, "responses", responses)
        client = Client("github_copilot", "test-model", api_key="test-key",
                        api_base="https://api.githubcopilot.com", api_type="responses")
        messages = [{"role": "user", "content": "Query"}]
        tools = [{"type": "function", "function": {"name": "query", "parameters": {"type": "object"}}}]
        chunks = list(client.get_completion_with_tools(messages, tools, stream=True))
        assert any(getattr(chunk, "usage", None) and chunk.usage.total_tokens == 15 for chunk in chunks)
        analyst = AnalystAgent.__new__(AnalystAgent)
        monkeypatch.setattr(analyst, "_open_stream", lambda messages, tools: iter(chunks))
        monkeypatch.setattr(analyst, "_forward_stream_delta", lambda *args: iter(()))
        with pytest.raises(StopIteration) as finished:
            next(analyst._stream_llm(messages, tools))
        message = finished.value.value.choices[0].message
        assert message.content == "Checking data"
        assert message.tool_calls[0].id == "call_stream"
        assert message.tool_calls[0].function.arguments == '{"sql":"select 1"}'
        assert attach_reasoning_content({"role": "assistant"}, message)["reasoning_items"] == [reasoning]
        assert responses.call_args.kwargs["stream"] is True

    def test_responses_failure_does_not_fall_back_to_chat(self, monkeypatch):
        from unittest.mock import Mock

        responses = Mock(side_effect=RuntimeError("provider unavailable"))
        monkeypatch.setattr(client_utils.litellm, "responses", responses)
        client = Client("openai", "test-model", api_key="test-key", api_type="responses")
        chat = Mock(side_effect=AssertionError("Must not fall back to chat"))
        monkeypatch.setattr(client, "_dispatch_chat_completions", chat)
        with pytest.raises(Exception, match="provider unavailable"):
            client.get_completion([{"role": "user", "content": "Hello"}])
        assert responses.call_count == 1
        chat.assert_not_called()

    def test_responses_stream_error_does_not_restart_generation(self, monkeypatch):
        import json
        from unittest.mock import Mock

        def broken_stream():
            yield json.dumps({"type": "response.output_text.delta", "delta": "Partial"})
            raise RuntimeError("stream interrupted")

        responses = Mock(side_effect=lambda **kwargs: broken_stream())
        monkeypatch.setattr(client_utils.litellm, "responses", responses)
        client = Client("openai", "test-model", api_key="test-key", api_type="responses")
        with pytest.raises(Exception, match="stream interrupted"):
            list(client.get_completion([{"role": "user", "content": "Hello"}], stream=True))
        assert responses.call_count == 1

    def test_explicit_chat_routing_skips_responses_bridge(self, monkeypatch):
        from unittest.mock import Mock

        completion = Mock()
        monkeypatch.setattr(client_utils.litellm, "completion", completion)
        client = Client("github_copilot", "test-model", api_key="test-key",
                        api_base="https://api.githubcopilot.com", api_type="chat_completions")
        client.ping()
        assert completion.call_args.kwargs["_skip_responses_api_bridge"] is True
        assert completion.call_args.kwargs["model"] == "test-model"

    @pytest.mark.parametrize("endpoint", ["openai", "azure", "github_copilot"])
    def test_responses_transport_preserves_client_identity_and_contract(self, monkeypatch, endpoint):
        from unittest.mock import Mock
        from litellm.types.llms.openai import ResponsesAPIResponse

        responses = Mock(return_value=ResponsesAPIResponse(
            id="resp_test", created_at=1, model="test-deployment", object="response",
            status="completed", parallel_tool_calls=True, tool_choice="auto", tools=[],
            output=[{"type": "reasoning", "id": "rs_test", "summary": [], "encrypted_content": "opaque-test"},
                    {"type": "function_call", "id": "fc_test", "call_id": "call_test", "name": "query",
                     "arguments": '{"sql":"select 1"}', "status": "completed"}],
            usage={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
        ))
        monkeypatch.setattr(client_utils.litellm, "responses", responses)
        client = Client.from_config({"endpoint": endpoint, "model": "test-deployment", "api_key": "test-key",
                                     "api_base": "https://api.example.test", "api_type": "responses"})
        original_model = client.model
        original_params = dict(client.params)
        tools = [{"type": "function", "function": {"name": "query", "parameters": {"type": "object"}}}]
        messages = [{"role": "user", "content": "Query the data"}]
        reply = client.get_completion_with_tools(messages, tools, max_tokens=64, tool_choice="auto")
        assert reply.choices[0].message.tool_calls[0].id == "call_test"
        assert reply.usage.total_tokens == 15
        assert responses.call_args.kwargs["store"] is False
        assert responses.call_args.kwargs["max_output_tokens"] == 64
        assert responses.call_args.kwargs["tool_choice"] == "auto"
        assert "reasoning.encrypted_content" in responses.call_args.kwargs["include"]
        messages.extend([reply.choices[0].message.model_dump(exclude_none=True),
                         {"role": "tool", "tool_call_id": "call_test", "content": "1"}])
        client.get_completion_with_tools(messages, tools)
        inputs = responses.call_args.kwargs["input"]
        assert any(item.get("type") == "reasoning" and item.get("encrypted_content") == "opaque-test" for item in inputs)
        assert any(item.get("type") == "function_call" and item["call_id"] == "call_test" for item in inputs)
        assert any(item.get("type") == "function_call_output" and item["call_id"] == "call_test"
                   and item["output"] == [{"type": "input_text", "text": "1"}] for item in inputs)
        assert client.model == original_model
        assert client.params == original_params

        client.ping()
        assert responses.call_args.kwargs["max_output_tokens"] == 3

    def test_copilot_uses_explicit_credentials_without_shared_authenticator(self, monkeypatch):
        from unittest.mock import Mock
        from litellm.llms.github_copilot.authenticator import Authenticator

        authenticate = Mock(side_effect=AssertionError("Shared token cache must not be used"))
        monkeypatch.setattr(Authenticator, "get_api_key", authenticate)
        completion = Mock(return_value="response")
        monkeypatch.setattr(client_utils.litellm, "completion", completion)
        client = Client("github_copilot", "gpt-4.1", api_key="private-copilot", api_base="https://api.githubcopilot.com")
        messages = [{"role": "user", "content": "hello"}]
        tools = [{"type": "function", "function": {"name": "query", "parameters": {"type": "object"}}}]
        assert client._dispatch(messages=messages, stream=True, params=client.params, tools=tools) == "response"
        kwargs = completion.call_args.kwargs
        assert kwargs["model"] == "gpt-4.1"
        assert kwargs["custom_llm_provider"] == "openai"
        assert kwargs["api_key"] == "private-copilot"
        assert kwargs["api_base"] == "https://api.githubcopilot.com"
        assert kwargs["extra_headers"]["X-Initiator"] == "agent"
        assert kwargs["tools"] == tools
        authenticate.assert_not_called()

    @pytest.mark.parametrize("model", ["openai/gpt-4o", "openrouter/openai/gpt-4o"])
    def test_openrouter_preserves_provider_namespace(self, model):
        client = Client("openrouter", model, api_key="test-key")
        assert client.model == "openrouter/openai/gpt-4o"
        assert client.params["api_base"] == "https://openrouter.ai/api/v1"
        assert client.params["api_key"] == "test-key"

    def test_gemini_prefix_added_when_missing(self):
        c = Client("gemini", "gemini-1.5-pro", api_key="k")
        assert c.model == "gemini/gemini-1.5-pro"

    def test_gemini_prefix_not_doubled(self):
        c = Client("gemini", "gemini/gemini-1.5-pro", api_key="k")
        assert c.model == "gemini/gemini-1.5-pro"

    def test_anthropic_prefix_added_when_missing(self):
        c = Client("anthropic", "claude-3-opus-20240229", api_key="k")
        assert c.model == "anthropic/claude-3-opus-20240229"

    def test_anthropic_prefix_not_doubled(self):
        c = Client("anthropic", "anthropic/claude-3", api_key="k")
        assert c.model == "anthropic/claude-3"

    def test_ollama_prefix_added_when_missing(self):
        c = Client("ollama", "llama3", api_base="http://localhost:11434")
        assert c.model == "ollama/llama3"

    def test_ollama_prefix_not_doubled(self):
        c = Client("ollama", "ollama/llama3", api_base="http://localhost:11434")
        assert c.model == "ollama/llama3"

    def test_openai_model_prefixed(self):
        c = Client("openai", "gpt-4o", api_key="k")
        assert c.model == "openai/gpt-4o"


# ---------------------------------------------------------------------------
# OrcaRouter endpoint
# ---------------------------------------------------------------------------

class TestOrcaRouter:
    def test_default_base_url(self):
        c = Client("orcarouter", "auto", api_key="k")
        assert c.params["api_base"] == "https://api.orcarouter.ai/v1"

    def test_custom_base_url_strips_trailing_slash(self):
        c = Client("orcarouter", "auto", api_key="k",
                   api_base="https://api.orcarouter.ai/v1/")
        assert c.params["api_base"] == "https://api.orcarouter.ai/v1"

    def test_uses_openai_compatible_provider(self):
        c = Client("orcarouter", "auto", api_key="k")
        assert c.params["custom_llm_provider"] == "openai"

    def test_model_prefixed_with_orcarouter_namespace(self):
        """The ``orcarouter/`` prefix is preserved by LiteLLM (unlike
        ``openai/``, which it strips) so OrcaRouter's gateway can route it."""
        c = Client("orcarouter", "auto", api_key="k")
        assert c.model == "orcarouter/auto"

    def test_model_prefix_not_doubled(self):
        c = Client("orcarouter", "orcarouter/auto", api_key="k")
        assert c.model == "orcarouter/auto"


# ---------------------------------------------------------------------------
# Cheaper Inference endpoint
# ---------------------------------------------------------------------------

class TestCheaperInference:
    def test_default_base_url(self):
        c = Client("cheaperinference", "gpt-5.4-mini", api_key="k")
        assert c.params["api_base"] == "https://api.cheaperinference.com/v1"

    def test_custom_base_url_strips_trailing_slash(self):
        c = Client("cheaperinference", "gpt-5.4-mini", api_key="k",
                   api_base="https://api.cheaperinference.com/v1/")
        assert c.params["api_base"] == "https://api.cheaperinference.com/v1"

    def test_uses_openai_compatible_provider(self):
        c = Client("cheaperinference", "gpt-5.4-mini", api_key="k")
        assert c.params["custom_llm_provider"] == "openai"

    def test_model_id_kept_bare(self):
        """Cheaper Inference model ids are bare, so no prefix is added."""
        c = Client("cheaperinference", "claude-sonnet-5", api_key="k")
        assert c.model == "claude-sonnet-5"


# ---------------------------------------------------------------------------
# Ollama api_base normalisation
# ---------------------------------------------------------------------------

class TestOllamaApiBaseNormalisation:
    def test_trailing_slash_stripped(self):
        c = Client("ollama", "llama3", api_base="http://localhost:11434/")
        assert not c.params["api_base"].endswith("/")

    def test_trailing_api_stripped(self):
        """Users sometimes copy-paste the URL ending in /api — we strip it."""
        c = Client("ollama", "llama3", api_base="http://localhost:11434/api")
        assert not c.params["api_base"].endswith("/api")
        assert c.params["api_base"] == "http://localhost:11434"

    def test_trailing_api_slash_stripped(self):
        c = Client("ollama", "llama3", api_base="http://localhost:11434/api/")
        assert c.params["api_base"] == "http://localhost:11434"

    def test_non_api_suffix_preserved(self):
        c = Client("ollama", "llama3", api_base="http://myserver:11434/ollama")
        assert c.params["api_base"] == "http://myserver:11434/ollama"

    def test_default_base_when_none(self):
        c = Client("ollama", "llama3")
        assert c.params["api_base"] == "http://localhost:11434"


# ---------------------------------------------------------------------------
# Azure credential selection
# ---------------------------------------------------------------------------

class TestAzureCredentialSelection:
    def test_server_keyless_model_keeps_default_credential(self, monkeypatch):
        credential = object()
        monkeypatch.delenv("DATA_FORMULATOR_DESKTOP", raising=False)
        monkeypatch.setattr(client_utils, "DefaultAzureCredential", lambda: credential)
        monkeypatch.setattr(client_utils, "get_bearer_token_provider", lambda selected, scope: selected)
        monkeypatch.setattr(client_utils, "get_desktop_azure_token_provider", lambda: pytest.fail("desktop auth used"))
        client = Client("azure", "deployment", api_base="https://example.openai.azure.com")
        assert client.params["azure_ad_token_provider"] is credential

    def test_desktop_api_key_does_not_use_cli(self, monkeypatch):
        monkeypatch.setenv("DATA_FORMULATOR_DESKTOP", "1")
        monkeypatch.setattr(client_utils, "get_desktop_azure_token_provider", lambda: pytest.fail("CLI auth used"))
        client = Client("azure", "deployment", api_key="key", api_base="https://example.openai.azure.com")
        assert "azure_ad_token_provider" not in client.params

    def test_desktop_keyless_model_uses_azure_cli_credential(self, monkeypatch):
        token_provider = object()
        monkeypatch.setenv("DATA_FORMULATOR_DESKTOP", "1")
        monkeypatch.setattr(client_utils, "get_desktop_azure_token_provider", lambda: token_provider)
        monkeypatch.setattr(
            client_utils,
            "DefaultAzureCredential",
            lambda: pytest.fail("desktop mode must not select an ambient credential"),
        )
        monkeypatch.setattr(
            client_utils,
            "get_bearer_token_provider",
            lambda credential, scope: (credential, scope),
        )

        client = Client(
            "azure",
            "deployment-name",
            api_base="https://example.openai.azure.com",
        )

        assert client.params["azure_ad_token_provider"] is token_provider

    def test_blank_api_version_is_not_defaulted(self):
        client = Client(
            "azure",
            "deployment-name",
            api_key="key",
            api_base="https://example.openai.azure.com/",
        )

        assert client.params["api_base"] == "https://example.openai.azure.com"
        assert "api_version" not in client.params

    def test_explicit_api_version_is_preserved(self):
        client = Client(
            "azure",
            "deployment-name",
            api_key="key",
            api_base="https://example.openai.azure.com",
            api_version="2025-04-01-preview",
        )

        assert client.params["api_version"] == "2025-04-01-preview"

    def test_api_base_is_required(self):
        with pytest.raises(ValueError, match="Azure API base URL is required"):
            Client("azure", "deployment-name", api_key="key")


# ---------------------------------------------------------------------------
# _strip_image_blocks
# ---------------------------------------------------------------------------

class TestStripImageBlocks:
    def setup_method(self):
        self.client = Client("openai", "gpt-4o", api_key="k")

    def test_string_content_unchanged(self):
        result = self.client._strip_image_blocks("hello")
        assert result == "hello"

    def test_image_url_blocks_removed(self):
        content = [
            {"type": "text", "text": "Describe this"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
        ]
        result = self.client._strip_image_blocks(content)
        assert len(result) == 1
        assert result[0]["type"] == "text"

    def test_non_image_blocks_preserved(self):
        content = [
            {"type": "text", "text": "Hello"},
            {"type": "text", "text": "World"},
        ]
        result = self.client._strip_image_blocks(content)
        assert len(result) == 2

    def test_mixed_list_with_non_dict_preserved(self):
        content = [
            "plain string",
            {"type": "image_url", "image_url": {}},
            {"type": "text", "text": "keep"},
        ]
        result = self.client._strip_image_blocks(content)
        assert "plain string" in result
        assert any(isinstance(r, dict) and r.get("type") == "text" for r in result)
        assert not any(isinstance(r, dict) and r.get("type") == "image_url" for r in result)

    def test_all_images_removed_returns_empty_list(self):
        content = [{"type": "image_url"}, {"type": "image_url"}]
        result = self.client._strip_image_blocks(content)
        assert result == []


# ---------------------------------------------------------------------------
# _strip_images_from_messages
# ---------------------------------------------------------------------------

class TestStripImagesFromMessages:
    def setup_method(self):
        self.client = Client("openai", "gpt-4o", api_key="k")

    def _multimodal_messages(self):
        return [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": [
                {"type": "text", "text": "What is in this image?"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
            ]},
        ]

    def test_system_message_unchanged(self):
        msgs = self._multimodal_messages()
        result = self.client._strip_images_from_messages(msgs)
        assert result[0]["content"] == "You are helpful."

    def test_image_blocks_removed_from_user_message(self):
        msgs = self._multimodal_messages()
        result = self.client._strip_images_from_messages(msgs)
        user_content = result[1]["content"]
        assert all(
            not (isinstance(b, dict) and b.get("type") == "image_url")
            for b in user_content
        )

    def test_text_blocks_preserved_in_user_message(self):
        msgs = self._multimodal_messages()
        result = self.client._strip_images_from_messages(msgs)
        user_content = result[1]["content"]
        assert any(isinstance(b, dict) and b.get("type") == "text" for b in user_content)

    def test_original_messages_not_mutated(self):
        msgs = self._multimodal_messages()
        original_len = len(msgs[1]["content"])
        self.client._strip_images_from_messages(msgs)
        assert len(msgs[1]["content"]) == original_len

    def test_non_dict_messages_preserved(self):
        msgs = ["plain string message"]
        result = self.client._strip_images_from_messages(msgs)
        assert result == ["plain string message"]


# ---------------------------------------------------------------------------
# _is_image_deserialize_error
# ---------------------------------------------------------------------------

class TestIsImageDeserializeError:
    def setup_method(self):
        self.client = Client("openai", "gpt-4o", api_key="k")

    def test_image_url_expected_text_detected(self):
        err = "Error: image_url content part was sent but expected `text` content"
        assert self.client._is_image_deserialize_error(err) is True

    def test_unknown_variant_image_url_detected(self):
        err = "unknown variant `image_url`, expected one of `text`, `audio`"
        assert self.client._is_image_deserialize_error(err) is True

    def test_unrelated_error_not_detected(self):
        assert self.client._is_image_deserialize_error("rate limit exceeded") is False

    def test_empty_string_not_detected(self):
        assert self.client._is_image_deserialize_error("") is False

    def test_partial_match_image_url_without_expected(self):
        """'image_url' alone without 'expected `text`' should NOT match."""
        assert self.client._is_image_deserialize_error("received image_url block") is False

    def test_upstream_failure_with_images_detected(self):
        err = "400: Error from provider (OpenCode Go): Upstream request failed"
        assert self.client._is_image_deserialize_error(err, has_images=True) is True

    def test_upstream_failure_without_images_not_detected(self):
        err = "400: Error from provider (OpenCode Go): Upstream request failed"
        assert self.client._is_image_deserialize_error(err, has_images=False) is False

    def test_unsupported_image_message_with_images_detected(self):
        err = "The selected model does not support image inputs"
        assert self.client._is_image_deserialize_error(err, has_images=True) is True


# ---------------------------------------------------------------------------
# _messages_contain_images
# ---------------------------------------------------------------------------

class TestMessagesContainImages:
    def setup_method(self):
        self.client = Client("openai", "gpt-4o", api_key="k")

    def test_multimodal_message_detected(self):
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": "Describe this"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
            ]},
        ]
        assert self.client._messages_contain_images(messages) is True

    def test_text_only_messages_not_detected(self):
        messages = [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": [{"type": "text", "text": "Describe this"}]},
        ]
        assert self.client._messages_contain_images(messages) is False


# ---------------------------------------------------------------------------
# Client.from_config
# ---------------------------------------------------------------------------

class TestFromConfig:
    def test_creates_client_from_dict(self):
        cfg = {"endpoint": "openai", "model": "gpt-4o", "api_key": "mykey"}
        c = Client.from_config(cfg)
        assert c.endpoint == "openai"
        assert c.model == "openai/gpt-4o"
        assert c.params["api_key"] == "mykey"

    def test_strips_whitespace_from_values(self):
        cfg = {"endpoint": "  openai  ", "model": "  gpt-4o  ", "api_key": "  key  "}
        c = Client.from_config(cfg)
        assert c.endpoint == "openai"
        assert c.model == "openai/gpt-4o"
        assert c.params["api_key"] == "key"

    def test_optional_fields_absent_when_empty(self):
        cfg = {"endpoint": "openai", "model": "gpt-4o", "api_key": "k"}
        c = Client.from_config(cfg)
        # api_base and api_version should not be set when absent
        assert "api_base" not in c.params or c.params.get("api_base", "") == ""

    def test_gemini_prefix_applied_via_from_config(self):
        cfg = {"endpoint": "gemini", "model": "gemini-pro", "api_key": "k"}
        c = Client.from_config(cfg)
        assert c.model.startswith("gemini/")


# ---------------------------------------------------------------------------
# Ollama content-JSON -> tool_call salvage
# ---------------------------------------------------------------------------

import json as _json
from types import SimpleNamespace

from data_formulator.agents.client_utils import (
    _extract_json_objects,
    _match_tool_from_obj,
    _salvage_tool_calls_from_content,
)


def _core_action_tools():
    """The visualize / ask_user / delegate / execute_python_script schemas the
    matcher disambiguates between."""
    return [
        {"type": "function", "function": {
            "name": "execute_python_script",
            "parameters": {"type": "object",
                           "properties": {"purpose": {"type": "string"},
                                          "code": {"type": "string"}},
                           "required": ["purpose", "code"]}}},
        {"type": "function", "function": {
            "name": "visualize",
            "parameters": {"type": "object",
                           "properties": {"code": {"type": "string"},
                                          "output_variable": {"type": "string"},
                                          "chart": {"type": "object"},
                                          "title": {"type": "string"}},
                           "required": ["code", "output_variable", "chart"]}}},
        {"type": "function", "function": {
            "name": "ask_user",
            "parameters": {"type": "object",
                           "properties": {"thought": {"type": "string"},
                                          "questions": {"type": "array"}},
                           "required": ["questions"]}}},
        {"type": "function", "function": {
            "name": "delegate",
            "parameters": {"type": "object",
                           "properties": {"target": {"type": "string"},
                                          "delegate_prompt": {"type": "string"}},
                           "required": ["target", "delegate_prompt"]}}},
    ]


class TestExtractJsonObjects:
    def test_extracts_single_object(self):
        assert _extract_json_objects('{"a": 1}') == ['{"a": 1}']

    def test_ignores_braces_inside_strings(self):
        text = '{"code": "x = {1: 2}; y = \\"}\\""}'
        objs = _extract_json_objects(text)
        assert len(objs) == 1
        assert _json.loads(objs[0])["code"] == 'x = {1: 2}; y = "}"'

    def test_extracts_object_from_markdown_fence(self):
        text = 'Sure:\n```json\n{"tool": "visualize"}\n```\n'
        objs = _extract_json_objects(text)
        assert objs == ['{"tool": "visualize"}']

    def test_no_object_returns_empty(self):
        assert _extract_json_objects("just prose, no json") == []


class TestMatchToolFromObj:
    def test_explicit_wrapper_name_and_arguments(self):
        obj = {"tool": "visualize",
               "arguments": {"code": "df=1", "output_variable": "df",
                             "chart": {}}}
        name, args = _match_tool_from_obj(obj, _core_action_tools())
        assert name == "visualize"
        assert args["output_variable"] == "df"

    def test_bare_visualize_args_match_visualize_not_execute(self):
        obj = {"output_variable": "t", "code": "df=1", "chart": {}}
        name, _ = _match_tool_from_obj(obj, _core_action_tools())
        assert name == "visualize"

    def test_bare_execute_args_match_execute(self):
        obj = {"purpose": "peek", "code": "print(1)"}
        name, _ = _match_tool_from_obj(obj, _core_action_tools())
        assert name == "execute_python_script"

    def test_ask_user_shape(self):
        obj = {"thought": "clarify", "questions": [{"text": "which?"}]}
        name, _ = _match_tool_from_obj(obj, _core_action_tools())
        assert name == "ask_user"

    def test_nested_action_wrapper_shape(self):
        # qwen2.5-coder emits this under the long agent prompt.
        obj = {"thought": "show it",
               "action": {"name": "visualize",
                          "arguments": {"code": "df=1", "output_variable": "df",
                                        "chart": {"chart_type": "Bar Chart"}}}}
        name, args = _match_tool_from_obj(obj, _core_action_tools())
        assert name == "visualize"
        assert args["output_variable"] == "df"

    def test_nested_tool_wrapper_shape(self):
        obj = {"tool": {"name": "ask_user",
                        "arguments": {"questions": [{"text": "?"}]}}}
        name, _ = _match_tool_from_obj(obj, _core_action_tools())
        assert name == "ask_user"

    def test_non_matching_object_returns_none(self):
        assert _match_tool_from_obj({"answer": "42"}, _core_action_tools()) is None


class TestSalvageToolCallsFromContent:
    def _resp(self, content, tool_calls=None):
        msg = SimpleNamespace(content=content, tool_calls=tool_calls)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg,
                                                        finish_reason="stop")])

    def test_salvages_visualize_action_from_content(self):
        content = _json.dumps({"output_variable": "t", "code": "df=1",
                               "chart": {"chart_type": "Bar Chart"}})
        resp = self._resp(content)
        out = _salvage_tool_calls_from_content(resp, _core_action_tools())
        msg = out.choices[0].message
        assert msg.tool_calls and msg.tool_calls[0].function.name == "visualize"
        assert msg.content is None
        assert out.choices[0].finish_reason == "tool_calls"
        assert _json.loads(msg.tool_calls[0].function.arguments)["output_variable"] == "t"

    def test_does_not_touch_response_with_native_tool_calls(self):
        existing = [SimpleNamespace(function=SimpleNamespace(name="visualize",
                                                             arguments="{}"))]
        resp = self._resp(None, tool_calls=existing)
        out = _salvage_tool_calls_from_content(resp, _core_action_tools())
        assert out.choices[0].message.tool_calls is existing

    def test_plain_text_answer_left_untouched(self):
        resp = self._resp("The dataset has 14 languages.")
        out = _salvage_tool_calls_from_content(resp, _core_action_tools())
        assert not getattr(out.choices[0].message, "tool_calls", None)
        assert out.choices[0].message.content == "The dataset has 14 languages."

    def test_no_tools_is_noop(self):
        content = _json.dumps({"output_variable": "t", "code": "df=1", "chart": {}})
        resp = self._resp(content)
        out = _salvage_tool_calls_from_content(resp, [])
        assert not getattr(out.choices[0].message, "tool_calls", None)


class TestMatchToolWireFormats:
    def test_openai_tool_calls_array_in_content(self):
        obj = {"tool_calls": [{"id": "x", "type": "function",
                               "function": {"name": "visualize",
                                            "arguments": {"code": "df=1",
                                                          "output_variable": "df",
                                                          "chart": {}}}}]}
        name, args = _match_tool_from_obj(obj, _core_action_tools())
        assert name == "visualize"
        assert args["output_variable"] == "df"

    def test_stringified_arguments_are_parsed(self):
        obj = {"name": "execute_python_script",
               "arguments": '{"purpose": "peek", "code": "print(1)"}'}
        name, args = _match_tool_from_obj(obj, _core_action_tools())
        assert name == "execute_python_script"
        assert args["code"] == "print(1)"
