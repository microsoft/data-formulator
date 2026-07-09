# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Regression tests for model-specific reasoning effort normalization."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from data_formulator.agent_config import reasoning_effort_for

pytestmark = [pytest.mark.backend]


class TestGpt5ProReasoningEffort:
    @pytest.mark.parametrize("configured", ["none", "minimal", "low"])
    def test_maps_unsupported_light_tiers_to_medium(self, configured):
        with patch(
            "data_formulator.agent_config.get_reasoning_effort",
            return_value=configured,
        ):
            assert reasoning_effort_for(
                "data_transform",
                "azure/gpt-5.4-pro",
            ) == "medium"

    @pytest.mark.parametrize("configured", ["medium", "high"])
    def test_preserves_supported_tiers(self, configured):
        with patch(
            "data_formulator.agent_config.get_reasoning_effort",
            return_value=configured,
        ):
            assert reasoning_effort_for(
                "data_transform",
                "azure/gpt-5.4-pro",
            ) == configured


class TestOtherModelReasoningEffort:
    def test_minimal_is_preserved_for_gpt5_mini(self):
        with patch(
            "data_formulator.agent_config.get_reasoning_effort",
            return_value="minimal",
        ):
            assert reasoning_effort_for(
                "data_load",
                "azure/gpt-5.4-mini",
            ) == "minimal"

    def test_minimal_maps_to_none_for_gpt5_codex(self):
        with patch(
            "data_formulator.agent_config.get_reasoning_effort",
            return_value="minimal",
        ):
            assert reasoning_effort_for(
                "data_load",
                "azure/gpt-5.2-codex",
            ) == "none"

    def test_none_downgrades_to_low_for_non_gpt_model(self):
        with patch(
            "data_formulator.agent_config.get_reasoning_effort",
            return_value="none",
        ):
            assert reasoning_effort_for(
                "data_transform",
                "anthropic/claude-opus",
            ) == "low"
