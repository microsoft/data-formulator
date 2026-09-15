"""Request-scoped authentication for LiteLLM 1.91's native ChatGPT adapter."""

import logging
from collections import Counter

import litellm
from litellm.llms.chatgpt.authenticator import Authenticator
from litellm.llms.chatgpt.common_utils import (
    CHATGPT_API_BASE,
    ensure_chatgpt_session_id,
    get_chatgpt_default_headers,
)
from litellm.llms.chatgpt.responses.transformation import ChatGPTResponsesAPIConfig
from litellm.llms.chatgpt.chat.transformation import ChatGPTConfig
from litellm.llms.openai.openai import OpenAIConfig
from litellm.llms.openai.responses.transformation import OpenAIResponsesAPIConfig
from litellm.responses.sse_output_recovery import (
    record_output_item_chunk,
    record_output_text_chunk,
)


CHATGPT_CLIENT_VERSION = "0.154.0"
logger = logging.getLogger(__name__)


def get_account_chatgpt_headers(access_token, account_id, session_id=None):
    return {
        **get_chatgpt_default_headers(access_token, account_id, session_id),
        "originator": "codex_cli_rs",
        "user-agent": f"codex_cli_rs/{CHATGPT_CLIENT_VERSION}",
    }


class AccountChatGPTConfig(ChatGPTConfig):
    def __init__(self, *args, **kwargs):
        OpenAIConfig.__init__(self)

    def _get_openai_compatible_provider_info(self, model, api_base, api_key, custom_llm_provider):
        if not api_key:
            raise ValueError("ChatGPT requires a resolved account connection")
        return CHATGPT_API_BASE, api_key, custom_llm_provider

    def validate_environment(self, *args, **kwargs):
        raise ValueError("ChatGPT must use the Responses transport")


class AccountChatGPTResponsesConfig(ChatGPTResponsesAPIConfig):
    def __init__(self):
        OpenAIResponsesAPIConfig.__init__(self)
        self._output_items = {}
        self._text_only_items = {}
        self._event_counts = Counter()
        self._text_delta_chars = 0

    def should_fake_stream(self, model, stream, custom_llm_provider=None):
        return False

    def validate_environment(self, headers, model, litellm_params):
        token = litellm_params.api_key if litellm_params else None
        account_id = object.__new__(Authenticator)._extract_account_id(token)
        if not token or not account_id:
            raise ValueError("ChatGPT requires a resolved account connection")
        return {**headers, **get_account_chatgpt_headers(
            token, account_id, ensure_chatgpt_session_id(litellm_params),
        )}

    def transform_streaming_response(self, model, parsed_chunk, logging_obj):
        event_type = parsed_chunk.get("type")
        if event_type == "response.created":
            self._output_items.clear()
            self._text_only_items.clear()
            self._event_counts.clear()
            self._text_delta_chars = 0
        if isinstance(event_type, str):
            self._event_counts[event_type] += 1
        if event_type == "response.output_item.done":
            record_output_item_chunk(parsed_chunk=parsed_chunk, output_items=self._output_items)
        elif event_type == "response.output_text.done":
            record_output_text_chunk(
                parsed_chunk=parsed_chunk, output_items=self._output_items,
                text_only_items=self._text_only_items,
            )
        elif event_type == "response.output_text.delta" and isinstance(parsed_chunk.get("delta"), str):
            self._text_delta_chars += len(parsed_chunk["delta"])
        elif event_type == "response.completed":
            response = parsed_chunk.get("response")
            if isinstance(response, dict) and not response.get("output"):
                merged_items = {**self._text_only_items, **self._output_items}
                if merged_items:
                    parsed_chunk = {**parsed_chunk, "response": {
                        **response, "output": [item for _, item in sorted(merged_items.items())],
                    }}
                logger.warning(
                    "ChatGPT stream output recovery: model=%s client_version=%s "
                    "response_status=%s recovered_items=%s sse_events=%s text_delta_chars=%s",
                    model, CHATGPT_CLIENT_VERSION, response.get("status"), len(merged_items),
                    dict(self._event_counts), self._text_delta_chars,
                )
        if event_type in ("response.failed", "error"):
            logger.warning(
                "ChatGPT stream failure: model=%s event=%s sse_events=%s",
                model, event_type, dict(self._event_counts),
            )
        return super().transform_streaming_response(model, parsed_chunk, logging_obj)

    def get_complete_url(self, api_base, litellm_params):
        return CHATGPT_API_BASE + "/responses"


def install_chatgpt_transport():
    """Replace only the config factory; no credentials or request state are global."""
    litellm.ChatGPTConfig = AccountChatGPTConfig
    litellm.ChatGPTResponsesAPIConfig = AccountChatGPTResponsesConfig