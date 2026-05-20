# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for data_formulator.agents.client_utils.Client.

Tests cover the pure-logic parts that don't require a live LLM:
- Model name prefixing for gemini / anthropic / ollama
- Ollama api_base normalisation (trailing /api stripping)
- Image block stripping helpers (_strip_image_blocks, _strip_images_from_messages)
- Image deserialise error detection (_is_image_deserialize_error)
- Client.from_config constructor
"""

from __future__ import annotations

import pytest

from data_formulator.agents.client_utils import Client

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Model name prefixing
# ---------------------------------------------------------------------------

class TestModelNamePrefixing:
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

    def test_openai_model_unchanged(self):
        c = Client("openai", "gpt-4o", api_key="k")
        assert c.model == "gpt-4o"


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


# ---------------------------------------------------------------------------
# Client.from_config
# ---------------------------------------------------------------------------

class TestFromConfig:
    def test_creates_client_from_dict(self):
        cfg = {"endpoint": "openai", "model": "gpt-4o", "api_key": "mykey"}
        c = Client.from_config(cfg)
        assert c.endpoint == "openai"
        assert c.model == "gpt-4o"
        assert c.params["api_key"] == "mykey"

    def test_strips_whitespace_from_values(self):
        cfg = {"endpoint": "  openai  ", "model": "  gpt-4o  ", "api_key": "  key  "}
        c = Client.from_config(cfg)
        assert c.endpoint == "openai"
        assert c.model == "gpt-4o"
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
