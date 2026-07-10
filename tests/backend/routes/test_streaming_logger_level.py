"""Streaming routes must not mutate process-global logger configuration."""

from __future__ import annotations

import logging

import pytest

from data_formulator.routes import agents

pytestmark = [pytest.mark.backend]


def test_streaming_route_does_not_mutate_module_logger_level() -> None:
    source = agents.data_agent_streaming.__wrapped__ if hasattr(
        agents.data_agent_streaming, "__wrapped__"
    ) else agents.data_agent_streaming
    original = agents.logger.level

    assert "setLevel" not in source.__code__.co_names
    assert agents.logger.level == original
