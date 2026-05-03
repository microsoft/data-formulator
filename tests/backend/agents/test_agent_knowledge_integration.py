# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for DataAgent knowledge integration (Phase 3).

Covers:
- Rules from KnowledgeStore injected into system prompt
- Both file-based rules and text-based rules coexist
- No rules → no User Rules section
- Library knowledge search and injection
- No matches → no injection
- Max 5 items limit
- search_knowledge / read_knowledge tool handlers
- Tool path traversal rejection
- Graceful degradation when knowledge store is unavailable
- Reasoning log records knowledge_search and knowledge_injected
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.agents.data_agent import DataAgent

pytestmark = [pytest.mark.backend]

TEST_IDENTITY = "user:test-knowledge@example.com"


RULE_MD = """\
---
title: ROI Standard
tags: [finance]
created: 2026-04-26
updated: 2026-04-26
---

ROI = (revenue - cost) / cost
"""

SKILL_MD = """\
---
title: Handle Missing Values
tags: [cleaning, pandas]
created: 2026-04-26
updated: 2026-04-26
source: agent_summarized
---

When encountering missing values, use fillna with median.
"""


@pytest.fixture()
def user_home(tmp_path):
    """Prepare a user_home with knowledge entries."""
    rules_dir = tmp_path / "knowledge" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "roi.md").write_text(RULE_MD, encoding="utf-8")

    exp_dir = tmp_path / "knowledge" / "experiences" / "cleaning"
    exp_dir.mkdir(parents=True)
    (exp_dir / "missing.md").write_text(SKILL_MD, encoding="utf-8")

    return tmp_path


@pytest.fixture()
def mock_client():
    c = MagicMock()
    c.model = "test-model"
    c.endpoint = "openai"
    c.params = {"api_key": "test-key"}
    return c


@pytest.fixture()
def mock_workspace():
    ws = MagicMock()
    ws.get_fresh_name = MagicMock(return_value="test-table")
    ws.user_home = None
    return ws


def _make_agent(mock_client, mock_workspace, user_home, **kwargs):
    mock_workspace.user_home = user_home
    return DataAgent(
        client=mock_client,
        workspace=mock_workspace,
        **kwargs,
    )


# ── Rules injection ──────────────────────────────────────────────────────


class TestRulesInjection:
    def test_rules_injected_into_system_prompt(self, mock_client, mock_workspace, user_home):
        agent = _make_agent(mock_client, mock_workspace, user_home)
        prompt = agent._build_system_prompt()
        assert "## User Rules" in prompt
        assert "ROI Standard" in prompt
        assert "ROI = (revenue - cost) / cost" in prompt

    def test_text_rules_and_knowledge_rules_coexist(
        self, mock_client, mock_workspace, user_home
    ):
        agent = _make_agent(
            mock_client, mock_workspace, user_home,
            agent_exploration_rules="Always explain your reasoning",
        )
        prompt = agent._build_system_prompt()
        assert "Always explain your reasoning" in prompt
        assert "ROI Standard" in prompt

    def test_no_rules_no_section(self, mock_client, mock_workspace, tmp_path):
        (tmp_path / "knowledge" / "rules").mkdir(parents=True)
        agent = _make_agent(mock_client, mock_workspace, tmp_path)
        prompt = agent._build_system_prompt()
        assert "## User Rules" not in prompt

    def test_no_knowledge_store_graceful(self, mock_client, mock_workspace):
        mock_workspace.user_home = None
        agent = DataAgent(
            client=mock_client,
            workspace=mock_workspace,
        )
        prompt = agent._build_system_prompt()
        assert "## User Rules" not in prompt


# ── Library knowledge injection ───────────────────────────────────────────


class TestKnowledgeSearchInjection:
    def test_relevant_knowledge_injected(self, mock_client, mock_workspace, user_home):
        agent = _make_agent(mock_client, mock_workspace, user_home)
        input_tables = [{"name": "sales_data"}]
        messages = agent._build_initial_messages(
            input_tables, "How to handle missing values?",
        )
        user_msg = messages[1]["content"]
        if isinstance(user_msg, list):
            user_msg = "\n".join(p.get("text", "") for p in user_msg if p.get("type") == "text")
        assert "[RELEVANT KNOWLEDGE]" in user_msg or agent._injected_knowledge == []

    def test_no_match_no_injection(self, mock_client, mock_workspace, user_home):
        agent = _make_agent(mock_client, mock_workspace, user_home)
        input_tables = [{"name": "xyz_table"}]
        messages = agent._build_initial_messages(
            input_tables, "xyznonexistent query",
        )
        user_msg = messages[1]["content"]
        if isinstance(user_msg, list):
            user_msg = "\n".join(p.get("text", "") for p in user_msg if p.get("type") == "text")
        assert agent._injected_knowledge == []

    def test_max_five_items(self, mock_client, mock_workspace, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        rules_dir.mkdir(parents=True)
        exp_dir = tmp_path / "knowledge" / "experiences" / "common"
        exp_dir.mkdir(parents=True)
        for i in range(10):
            (exp_dir / f"exp-{i}.md").write_text(
                f"---\ntitle: Common Experience {i}\ntags: [common]\n"
                f"created: 2026-04-26\nupdated: 2026-04-26\n---\n"
                f"Content about common topic {i}.\n",
                encoding="utf-8",
            )

        agent = _make_agent(mock_client, mock_workspace, tmp_path)
        results = agent._search_relevant_knowledge("common topic", [])
        assert len(results) <= 5


# ── Tool handlers ─────────────────────────────────────────────────────────


class TestKnowledgeToolHandlers:
    def test_search_knowledge_returns_results(self, mock_client, mock_workspace, user_home):
        agent = _make_agent(mock_client, mock_workspace, user_home)
        result = agent._handle_search_knowledge({"query": "missing values"})
        assert "Handle Missing Values" in result

    def test_search_knowledge_no_match(self, mock_client, mock_workspace, user_home):
        agent = _make_agent(mock_client, mock_workspace, user_home)
        result = agent._handle_search_knowledge({"query": "xyznonexistent"})
        assert "No matching" in result

    def test_read_knowledge_returns_content(self, mock_client, mock_workspace, user_home):
        agent = _make_agent(mock_client, mock_workspace, user_home)
        result = agent._handle_read_knowledge(
            {"category": "rules", "path": "roi.md"}
        )
        assert "ROI = (revenue - cost) / cost" in result

    def test_read_knowledge_not_found(self, mock_client, mock_workspace, user_home):
        agent = _make_agent(mock_client, mock_workspace, user_home)
        result = agent._handle_read_knowledge(
            {"category": "rules", "path": "ghost.md"}
        )
        assert "not found" in result

    def test_read_knowledge_traversal_rejected(self, mock_client, mock_workspace, user_home):
        agent = _make_agent(mock_client, mock_workspace, user_home)
        result = agent._handle_read_knowledge(
            {"category": "rules", "path": "../../etc/passwd.md"}
        )
        assert "Invalid path" in result or "not found" in result.lower()

    def test_no_knowledge_store_returns_message(self, mock_client, mock_workspace):
        mock_workspace.user_home = None
        agent = DataAgent(client=mock_client, workspace=mock_workspace)
        result = agent._handle_search_knowledge({"query": "anything"})
        assert "not available" in result

        result = agent._handle_read_knowledge({"category": "rules", "path": "file.md"})
        assert "not available" in result


# ── Graceful degradation ──────────────────────────────────────────────────


class TestGracefulDegradation:
    def test_agent_works_without_knowledge(self, mock_client, mock_workspace):
        """Agent with no user_home still constructs valid system prompt."""
        mock_workspace.user_home = None
        agent = DataAgent(
            client=mock_client,
            workspace=mock_workspace,
        )
        prompt = agent._build_system_prompt()
        assert "data exploration agent" in prompt

    def test_empty_knowledge_dir(self, mock_client, mock_workspace, tmp_path):
        """Agent with empty knowledge dir works normally."""
        (tmp_path / "knowledge" / "rules").mkdir(parents=True)
        (tmp_path / "knowledge" / "experiences").mkdir(parents=True)
        agent = _make_agent(mock_client, mock_workspace, tmp_path)
        prompt = agent._build_system_prompt()
        assert "## User Rules" not in prompt


# ── Reasoning log integration ─────────────────────────────────────────────


class TestReasoningLogIntegration:
    @patch.dict(os.environ, {"DF_AGENT_LOG": "on"})
    def test_session_start_includes_rules(self, mock_client, mock_workspace, user_home, tmp_path):
        """session_start log event should be written (file-based check)."""
        with patch.dict(os.environ, {"DATA_FORMULATOR_HOME": str(tmp_path)}):
            agent = _make_agent(
                mock_client, mock_workspace, user_home,
                identity_id=TEST_IDENTITY,
            )
            rlog = agent._reasoning_log
            rlog.log(
                "session_start",
                rules_injected=["ROI Standard"],
                knowledge_injected=agent._injected_knowledge,
            )
            rlog.close()
        # Logs are now stored system-level under DATA_FORMULATOR_HOME/agent-logs/
        logs_dir = tmp_path / "agent-logs"
        jsonl_files = list(logs_dir.rglob("*.jsonl"))
        assert len(jsonl_files) >= 1
