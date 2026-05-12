"""Tests for image attachment handling in the data loading chat agent.

The data extraction workflow relies on image attachments reaching vision models
as multimodal content blocks, with the user's instruction before the image.
"""
from __future__ import annotations

import pytest

from data_formulator.agents.agent_data_loading_chat import DataLoadingAgent

pytestmark = [pytest.mark.backend]


def test_convert_message_keeps_instruction_before_image_attachment() -> None:
    agent = DataLoadingAgent(client=None, workspace=None)

    converted = agent._convert_message({
        "role": "user",
        "content": "Extract the table from this image.",
        "attachments": [
            {"type": "image", "name": "image-1", "url": "data:image/png;base64,abc"},
        ],
    })

    assert converted["role"] == "user"
    assert converted["content"] == [
        {"type": "text", "text": "Extract the table from this image."},
        {"type": "text", "text": "[USER ATTACHMENT]: image(s) provided by the user."},
        {
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64,abc", "detail": "high"},
        },
    ]


def test_convert_message_ignores_empty_image_attachment() -> None:
    agent = DataLoadingAgent(client=None, workspace=None)

    converted = agent._convert_message({
        "role": "user",
        "content": "Extract data.",
        "attachments": [{"type": "image", "name": "empty", "url": ""}],
    })

    assert converted == {"role": "user", "content": [{"type": "text", "text": "Extract data."}]}


def test_build_system_prompt_accepts_workspace_table_name_strings() -> None:
    class Workspace:
        def list_tables(self) -> list[str]:
            return ["sales", "inventory"]

    agent = DataLoadingAgent(client=None, workspace=Workspace())

    prompt = agent._build_system_prompt()

    assert "Currently loaded workspace tables: sales, inventory" in prompt
