# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for ReasoningLogger — structured JSONL reasoning log for Agent sessions.

Covers file creation, JSONL format, env-var switch (off/on/verbose), log
sanitization in verbose mode, expired-log cleanup, and context-manager safety.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

from data_formulator.agents.reasoning_log import (
    ReasoningLogger,
    _NullReasoningLogger,
    _cleanup_expired_logs,
    _LOG_RETENTION_DAYS,
    _today_str,
)
from data_formulator.datalake.workspace import sanitize_identity_dirname

pytestmark = [pytest.mark.backend]
TEST_IDENTITY = "user:alice@example.com"


# ── helpers ───────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _agent_log_home(tmp_path, monkeypatch):
    """Use tmp_path as DATA_FORMULATOR_HOME for system-level agent logs."""
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))


def _read_log_lines(data_home: Path, agent_type: str = "TestAgent",
                    session_id: str = "sess-1") -> list[dict]:
    """Find and parse the JSONL log file for the given session."""
    safe_id = sanitize_identity_dirname(TEST_IDENTITY)
    logs_dir = data_home / "agent-logs" / _today_str() / safe_id
    log_file = logs_dir / f"{session_id}-{agent_type}.jsonl"
    assert log_file.exists(), f"Expected log file not found: {log_file}"
    lines = log_file.read_text(encoding="utf-8").strip().splitlines()
    return [json.loads(line) for line in lines]


# ── log file creation ─────────────────────────────────────────────────────


@patch.dict(os.environ, {"DF_AGENT_LOG": "on"})
class TestLogFileCreation:
    def test_creates_file_in_correct_directory(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "DataAgent", "abc-123") as rlog:
            rlog.log("session_start", user_question="hello")

        expected_dir = (
            tmp_path / "agent-logs" / _today_str()
            / sanitize_identity_dirname(TEST_IDENTITY)
        )
        assert expected_dir.is_dir()
        log_file = expected_dir / "abc-123-DataAgent.jsonl"
        assert log_file.exists()

    def test_jsonl_format_each_line_parseable(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("session_start", model="gpt-4o")
            rlog.log("llm_request", iteration=1, messages_count=3)
            rlog.log("session_end", status="success")

        lines = _read_log_lines(tmp_path)
        assert len(lines) == 3
        for line in lines:
            assert isinstance(line, dict)

    def test_each_line_has_step_type_and_ts(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("context_built", system_prompt_tokens=1200)

        lines = _read_log_lines(tmp_path)
        assert lines[0]["step_type"] == "context_built"
        assert "ts" in lines[0]
        # ts should be an ISO 8601 string
        datetime.fromisoformat(lines[0]["ts"])

    def test_close_makes_file_complete(self, tmp_path):
        rlog = ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1")
        rlog.log("session_start")
        rlog.log("session_end", status="ok")
        rlog.close()

        lines = _read_log_lines(tmp_path)
        assert lines[0]["step_type"] == "session_start"
        assert lines[1]["step_type"] == "session_end"

    def test_close_is_idempotent(self, tmp_path):
        rlog = ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1")
        rlog.log("session_start")
        rlog.close()
        rlog.close()  # should not raise


# ── DF_AGENT_LOG=off ──────────────────────────────────────────────────────


class TestOffMode:
    @patch.dict(os.environ, {"DF_AGENT_LOG": "off"})
    def test_off_creates_no_file(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("session_start", user_question="ignored")

        logs_dir = tmp_path / "agent-logs"
        assert not logs_dir.exists() or not any(logs_dir.rglob("*.jsonl"))

    @patch.dict(os.environ, {"DF_AGENT_LOG": "OFF"})
    def test_off_case_insensitive(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("session_start")
        logs_dir = tmp_path / "agent-logs"
        assert not logs_dir.exists() or not any(logs_dir.rglob("*.jsonl"))


# ── DF_AGENT_LOG=on (default) ────────────────────────────────────────────


class TestOnMode:
    @patch.dict(os.environ, {"DF_AGENT_LOG": "on"})
    def test_on_writes_structured_summary(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("llm_request", iteration=1, messages_count=5,
                     tools_available=["think", "explore"])

        lines = _read_log_lines(tmp_path)
        assert lines[0]["step_type"] == "llm_request"
        assert lines[0]["messages_count"] == 5

    @patch.dict(os.environ, {"DF_AGENT_LOG": "on"})
    def test_on_strips_messages_defensively(self, tmp_path):
        """Even if a caller accidentally passes ``messages``, the ``on``
        mode logger strips it before writing."""
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("llm_request", iteration=1, messages_count=3,
                     messages=[{"role": "user", "content": "should be stripped"}])

        lines = _read_log_lines(tmp_path)
        assert "messages" not in lines[0]
        assert lines[0]["messages_count"] == 3

    @patch.dict(os.environ, {"DF_AGENT_LOG": "on"})
    def test_on_auto_fields_cannot_be_overridden(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log(
                "llm_request",
                ts="fake",
                session_id="fake",
                agent_type="fake",
                identity_id="fake",
            )

        lines = _read_log_lines(tmp_path)
        assert lines[0]["step_type"] == "llm_request"
        assert lines[0]["ts"] != "fake"
        assert lines[0]["session_id"] == "sess-1"
        assert lines[0]["agent_type"] == "TestAgent"
        assert lines[0]["identity_id"] == TEST_IDENTITY

    def test_default_is_off(self, tmp_path):
        """When DF_AGENT_LOG is not set, default to ``off`` (no file)."""
        env = os.environ.copy()
        env.pop("DF_AGENT_LOG", None)
        with patch.dict(os.environ, env, clear=True):
            with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
                rlog.log("session_start")
            logs_dir = tmp_path / "agent-logs"
            assert not logs_dir.exists() or not any(logs_dir.rglob("*.jsonl"))


# ── DF_AGENT_LOG=verbose ─────────────────────────────────────────────────


class TestVerboseMode:
    @patch.dict(os.environ, {"DF_AGENT_LOG": "verbose"})
    def test_verbose_writes_full_content(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("llm_request", iteration=1,
                     messages=[{"role": "user", "content": "hello"}])

        lines = _read_log_lines(tmp_path)
        assert "messages" in lines[0]

    @patch.dict(os.environ, {"DF_AGENT_LOG": "verbose"})
    def test_verbose_sanitizes_api_key(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("llm_request",
                     config={"api_key": "sk-secret-12345", "model": "gpt-4o"})

        lines = _read_log_lines(tmp_path)
        config = lines[0]["config"]
        assert config["api_key"] == "***"
        assert config["model"] == "gpt-4o"

    @patch.dict(os.environ, {"DF_AGENT_LOG": "verbose"})
    def test_verbose_sanitizes_password_in_list(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("tool_execution",
                     params=[{"password": "hunter2", "host": "db.local"}])

        lines = _read_log_lines(tmp_path)
        assert lines[0]["params"][0]["password"] == "***"
        assert lines[0]["params"][0]["host"] == "db.local"

    @patch.dict(os.environ, {"DF_AGENT_LOG": "verbose"})
    def test_verbose_sanitizes_top_level_kwargs(self, tmp_path):
        """Top-level sensitive keys (e.g. ``api_key``) must be redacted."""
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("session_start", api_key="sk-top-level-secret",
                     model="gpt-4o")

        lines = _read_log_lines(tmp_path)
        assert lines[0]["api_key"] == "***"
        assert lines[0]["model"] == "gpt-4o"

    @patch.dict(os.environ, {"DF_AGENT_LOG": "VERBOSE"})
    def test_verbose_case_insensitive(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("session_start")
        lines = _read_log_lines(tmp_path)
        assert len(lines) == 1


# ── security: sensitive info must not appear ──────────────────────────────


class TestSecurityConstraints:
    @patch.dict(os.environ, {"DF_AGENT_LOG": "verbose"})
    def test_no_api_key_in_log(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("session_start",
                     config={"api_key": "sk-abc123xyz", "endpoint": "openai"})

        raw = (
            tmp_path / "agent-logs" / _today_str()
            / sanitize_identity_dirname(TEST_IDENTITY)
            / "sess-1-TestAgent.jsonl"
        ).read_text()
        assert "sk-abc123xyz" not in raw

    @patch.dict(os.environ, {"DF_AGENT_LOG": "verbose"})
    def test_no_connection_string_in_log(self, tmp_path):
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("tool_execution",
                     config={"connection_string": "postgresql://user:pass@host/db"})

        raw = (
            tmp_path / "agent-logs" / _today_str()
            / sanitize_identity_dirname(TEST_IDENTITY)
            / "sess-1-TestAgent.jsonl"
        ).read_text()
        assert "postgresql://user:pass@host/db" not in raw

    @patch.dict(os.environ, {"DF_AGENT_LOG": "on"})
    def test_confined_dir_prevents_traversal(self, tmp_path):
        """The log file path is confined to the identity log directory."""
        # ReasoningLogger creates a ConfinedDir internally — verify that
        # a traversal in session_id would be caught.  We test via the
        # ConfinedDir used inside; direct injection is blocked by resolve().
        from data_formulator.security.path_safety import ConfinedDir
        jail = ConfinedDir(
            tmp_path / "agent-logs" / _today_str()
            / sanitize_identity_dirname(TEST_IDENTITY)
        )
        with pytest.raises(ValueError):
            jail.resolve("../../etc/passwd")


# ── expired log cleanup ──────────────────────────────────────────────────


class TestExpiredLogCleanup:
    def test_old_directories_removed(self, tmp_path):
        logs_root = tmp_path / "agent-logs"
        logs_root.mkdir()

        old_date = (datetime.now(timezone.utc) - timedelta(days=35)).strftime("%Y-%m-%d")
        recent_date = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d")

        old_dir = logs_root / old_date
        old_dir.mkdir()
        (old_dir / "test.jsonl").write_text("line")

        recent_dir = logs_root / recent_date
        recent_dir.mkdir()
        (recent_dir / "test.jsonl").write_text("line")

        _cleanup_expired_logs(logs_root)

        assert not old_dir.exists()
        assert recent_dir.exists()

    def test_cleanup_ignores_non_date_dirs(self, tmp_path):
        logs_root = tmp_path / "agent-logs"
        logs_root.mkdir()

        not_a_date = logs_root / "not-a-date"
        not_a_date.mkdir()

        _cleanup_expired_logs(logs_root)
        assert not_a_date.exists()

    def test_cleanup_failure_does_not_raise(self, tmp_path):
        logs_root = tmp_path / "agent-logs"
        logs_root.mkdir()

        old_date = (datetime.now(timezone.utc) - timedelta(days=35)).strftime("%Y-%m-%d")
        old_dir = logs_root / old_date
        old_dir.mkdir()

        with patch("shutil.rmtree", side_effect=PermissionError("denied")):
            _cleanup_expired_logs(logs_root)  # should not raise

        assert old_dir.exists()

    def test_cleanup_nonexistent_dir_does_not_raise(self, tmp_path):
        _cleanup_expired_logs(tmp_path / "does-not-exist")

    @patch.dict(os.environ, {"DF_AGENT_LOG": "on"})
    def test_cleanup_runs_in_background(self, tmp_path):
        """Cleanup thread is daemon and non-blocking."""
        logs_root = tmp_path / "agent-logs"
        logs_root.mkdir()

        old_date = (datetime.now(timezone.utc) - timedelta(days=35)).strftime("%Y-%m-%d")
        old_dir = logs_root / old_date
        old_dir.mkdir()
        (old_dir / "test.jsonl").write_text("old")

        rlog = ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-bg")
        rlog.log("session_start")
        rlog.close()

        # Give the daemon thread a moment to run
        time.sleep(0.3)
        assert not old_dir.exists()


# ── context manager safety ────────────────────────────────────────────────


class TestContextManager:
    @patch.dict(os.environ, {"DF_AGENT_LOG": "on"})
    def test_exception_still_closes_file(self, tmp_path):
        try:
            with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
                rlog.log("session_start")
                raise RuntimeError("boom")
        except RuntimeError:
            pass

        lines = _read_log_lines(tmp_path)
        assert lines[0]["step_type"] == "session_start"

    @patch.dict(os.environ, {"DF_AGENT_LOG": "off"})
    def test_off_mode_context_manager_safe(self, tmp_path):
        """Off mode should work fine as a context manager."""
        with ReasoningLogger(TEST_IDENTITY, "TestAgent", "sess-1") as rlog:
            rlog.log("session_start")
        # No file, no error


# ── _NullReasoningLogger (null-object pattern) ──────────────────────────


class TestNullReasoningLogger:
    def test_log_is_noop(self):
        nlog = _NullReasoningLogger()
        nlog.log("session_start", user_question="hello")

    def test_close_is_noop(self):
        nlog = _NullReasoningLogger()
        nlog.close()
        nlog.close()  # idempotent

    def test_context_manager(self):
        with _NullReasoningLogger() as nlog:
            nlog.log("session_start")

    def test_level_is_off(self):
        nlog = _NullReasoningLogger()
        assert nlog._level == "off"
        assert nlog._fd is None
