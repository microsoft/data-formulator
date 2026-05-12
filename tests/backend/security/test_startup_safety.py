# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for FINDING-5: startup safety checks."""

from __future__ import annotations

import logging
from unittest.mock import patch

import pytest

pytestmark = [pytest.mark.backend]


class TestStartupSafetyChecks:

    def test_multi_user_no_sandbox_logs_critical(self):
        """Multi-user mode + not_a_sandbox must emit a CRITICAL log."""
        from data_formulator.app import app, _safety_checks

        app.config.setdefault("CLI_ARGS", {})
        original = app.config["CLI_ARGS"].copy()
        try:
            app.config["CLI_ARGS"]["workspace_backend"] = "azure_blob"
            app.config["CLI_ARGS"]["sandbox"] = "not_a_sandbox"

            with patch("data_formulator.app.logger") as mock_logger:
                _safety_checks()
                mock_logger.critical.assert_called_once()
                msg = mock_logger.critical.call_args[0][0]
                assert "sandbox" in msg.lower()
        finally:
            app.config["CLI_ARGS"] = original

    def test_local_mode_no_warning(self):
        """Local (desktop) mode should not log any critical warning."""
        from data_formulator.app import app, _safety_checks

        app.config.setdefault("CLI_ARGS", {})
        original = app.config["CLI_ARGS"].copy()
        try:
            app.config["CLI_ARGS"]["workspace_backend"] = "local"
            app.config["CLI_ARGS"]["sandbox"] = "not_a_sandbox"

            with patch("data_formulator.app.logger") as mock_logger:
                _safety_checks()
                mock_logger.critical.assert_not_called()
        finally:
            app.config["CLI_ARGS"] = original

    def test_multi_user_with_docker_sandbox_no_warning(self):
        """Multi-user + docker sandbox should not log any critical warning."""
        from data_formulator.app import app, _safety_checks

        app.config.setdefault("CLI_ARGS", {})
        original = app.config["CLI_ARGS"].copy()
        try:
            app.config["CLI_ARGS"]["workspace_backend"] = "azure_blob"
            app.config["CLI_ARGS"]["sandbox"] = "docker"

            with patch("data_formulator.app.logger") as mock_logger:
                _safety_checks()
                mock_logger.critical.assert_not_called()
        finally:
            app.config["CLI_ARGS"] = original
