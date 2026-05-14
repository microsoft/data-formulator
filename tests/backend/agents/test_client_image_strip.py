"""Verify Client helper methods that strip image_url blocks from messages
and detect text-only model errors for automatic retry.

Background
----------
Some LLM providers (e.g. deepseek-chat) reject multimodal payloads that
contain image_url blocks.  The Client class now:

1. Detects these provider errors via _is_image_deserialize_error.
2. Strips image_url blocks from messages via _strip_image_blocks /
   _strip_images_from_messages.
3. Retries the completion call with sanitized messages.

These unit tests cover the three helper methods and the retry logic
inside get_completion (mocked, no real API calls).
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from data_formulator.agents.client_utils import Client


pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    """Return a Client wired to the litellm (non-openai) path."""
    return Client(endpoint="other", model="deepseek-chat")


@pytest.fixture()
def openai_client():
    """Return a Client wired to the openai path."""
    return Client(endpoint="openai", model="deepseek-chat", api_key="fake")


# ---------------------------------------------------------------------------
# _strip_image_blocks
# ---------------------------------------------------------------------------

class TestStripImageBlocks:
    def test_removes_image_url_items(self, client):
        content = [
            {"type": "text", "text": "hello"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
            {"type": "text", "text": "world"},
        ]
        result = client._strip_image_blocks(content)
        assert result == [
            {"type": "text", "text": "hello"},
            {"type": "text", "text": "world"},
        ]

    def test_keeps_all_when_no_images(self, client):
        content = [
            {"type": "text", "text": "only text"},
        ]
        result = client._strip_image_blocks(content)
        assert result == content

    def test_returns_empty_list_when_all_images(self, client):
        content = [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,x"}},
        ]
        result = client._strip_image_blocks(content)
        assert result == []

    def test_passthrough_non_list(self, client):
        assert client._strip_image_blocks("plain string") == "plain string"

    def test_preserves_non_dict_items(self, client):
        content = ["raw string", {"type": "image_url"}, 42]
        result = client._strip_image_blocks(content)
        assert result == ["raw string", 42]


# ---------------------------------------------------------------------------
# _strip_images_from_messages
# ---------------------------------------------------------------------------

class TestStripImagesFromMessages:
    def test_strips_images_from_multimodal_message(self, client):
        messages = [
            {"role": "system", "content": "You are helpful."},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "describe this"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
                ],
            },
        ]
        result = client._strip_images_from_messages(messages)
        assert len(result) == 2
        assert result[0]["content"] == "You are helpful."
        assert result[1]["content"] == [{"type": "text", "text": "describe this"}]

    def test_does_not_mutate_original(self, client):
        original_content = [
            {"type": "text", "text": "hi"},
            {"type": "image_url", "image_url": {"url": "x"}},
        ]
        messages = [{"role": "user", "content": original_content}]
        client._strip_images_from_messages(messages)
        assert len(messages[0]["content"]) == 2

    def test_handles_plain_text_messages(self, client):
        messages = [
            {"role": "user", "content": "just text"},
        ]
        result = client._strip_images_from_messages(messages)
        assert result == messages

    def test_preserves_non_dict_messages(self, client):
        messages = ["not a dict", {"role": "user", "content": "hi"}]
        result = client._strip_images_from_messages(messages)
        assert result[0] == "not a dict"
        assert result[1]["content"] == "hi"


# ---------------------------------------------------------------------------
# _is_image_deserialize_error
# ---------------------------------------------------------------------------

class TestIsImageDeserializeError:
    @pytest.mark.parametrize("error_text", [
        'Error: image_url is not supported, expected `text`',
        'BadRequestError: unknown variant `image_url`',
        'unknown variant `image_url`, expected `text`',
    ])
    def test_detects_known_patterns(self, client, error_text):
        assert client._is_image_deserialize_error(error_text) is True

    @pytest.mark.parametrize("error_text", [
        "Rate limit exceeded",
        "Connection timeout",
        "Invalid API key",
        "",
        "image_url",
    ])
    def test_ignores_unrelated_errors(self, client, error_text):
        assert client._is_image_deserialize_error(error_text) is False

    def test_case_insensitive(self, client):
        assert client._is_image_deserialize_error(
            'IMAGE_URL is not valid, Expected `text`'
        ) is True


# ---------------------------------------------------------------------------
# get_completion retry logic (litellm path)
# ---------------------------------------------------------------------------

class TestGetCompletionRetryLitellm:
    @patch("data_formulator.agents.client_utils.litellm")
    def test_retries_on_image_error(self, mock_litellm, client):
        mock_litellm.completion.side_effect = [
            Exception('unknown variant `image_url`, expected `text`'),
            MagicMock(name="success_response"),
        ]

        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": "hi"},
                {"type": "image_url", "image_url": {"url": "x"}},
            ]},
        ]
        result = client.get_completion(messages)

        assert mock_litellm.completion.call_count == 2
        retry_messages = mock_litellm.completion.call_args_list[1].kwargs.get(
            "messages", mock_litellm.completion.call_args_list[1][1].get("messages")
        )
        if retry_messages is None:
            retry_messages = mock_litellm.completion.call_args_list[1][1]
        assert result is not None

    @patch("data_formulator.agents.client_utils.litellm")
    def test_raises_unrelated_error(self, mock_litellm, client):
        mock_litellm.completion.side_effect = Exception("Rate limit exceeded")

        with pytest.raises(Exception, match="Rate limit"):
            client.get_completion([{"role": "user", "content": "hi"}])

        assert mock_litellm.completion.call_count == 1

    @patch("data_formulator.agents.client_utils.litellm")
    def test_no_retry_on_success(self, mock_litellm, client):
        mock_litellm.completion.return_value = MagicMock(name="ok")

        result = client.get_completion([{"role": "user", "content": "hi"}])

        assert mock_litellm.completion.call_count == 1
        assert result is not None


# ---------------------------------------------------------------------------
# get_completion retry logic (openai endpoint — now also via litellm)
# ---------------------------------------------------------------------------

class TestGetCompletionRetryOpenAI:
    """OpenAI endpoint now uses litellm.completion like all other providers."""

    @patch("data_formulator.agents.client_utils.litellm")
    def test_retries_on_image_error(self, mock_litellm, openai_client):
        mock_litellm.completion.side_effect = [
            Exception('image_url is not supported, expected `text`'),
            MagicMock(name="success_response"),
        ]

        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": "describe"},
                {"type": "image_url", "image_url": {"url": "data:img"}},
            ]},
        ]
        result = openai_client.get_completion(messages)

        assert mock_litellm.completion.call_count == 2
        assert result is not None

    @patch("data_formulator.agents.client_utils.litellm")
    def test_raises_unrelated_error(self, mock_litellm, openai_client):
        mock_litellm.completion.side_effect = Exception("Unauthorized")

        with pytest.raises(Exception, match="Unauthorized"):
            openai_client.get_completion([{"role": "user", "content": "hi"}])

        assert mock_litellm.completion.call_count == 1
