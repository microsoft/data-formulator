"""Analyst attachment → scratch-note injection.

Non-image attachments are uploaded to the workspace ``scratch/`` folder and
their paths passed as ``scratch_files``; the agent's initial user message must
tell the model the files exist and how to consume them (read via
``execute_python_script`` or delegate to data loading) — never inline their
bytes. See design-docs/40-analyst-scratch-file-attachments.md.
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from data_formulator.analyst.agent import AnalystAgent

pytestmark = [pytest.mark.backend]


def _agent() -> AnalystAgent:
    ws = MagicMock()
    ws.user_home = None  # skip KnowledgeStore init
    agent = AnalystAgent(client=None, workspace=ws)
    # Stub the heavy context builders so we isolate the scratch-note logic.
    agent._build_lightweight_table_context = lambda *a, **k: "TABLE_CTX"
    agent._build_system_prompt = lambda *a, **k: "SYS"
    return agent


class TestScratchFileInjection:
    def test_scratch_note_injected(self):
        agent = _agent()
        msgs = agent._build_initial_messages(
            [{"name": "t"}], "what's the ROI trend?",
            scratch_files=["scratch/sales_a1b2c3d4.xlsx"],
        )
        user = msgs[1]["content"]
        assert "[ATTACHED FILES]" in user
        assert "scratch/sales_a1b2c3d4.xlsx" in user
        assert "execute_python_script" in user
        assert "data_loading" in user
        # The note precedes the question, and the question is still present.
        assert "[USER QUESTION]" in user
        assert user.index("[ATTACHED FILES]") < user.index("[USER QUESTION]")

    def test_no_note_without_files(self):
        agent = _agent()
        msgs = agent._build_initial_messages([{"name": "t"}], "q")
        assert "[ATTACHED FILES]" not in msgs[1]["content"]

    def test_file_bytes_not_inlined(self):
        """Only the path is passed — the note must not contain file contents."""
        agent = _agent()
        msgs = agent._build_initial_messages(
            [{"name": "t"}], "q", scratch_files=["scratch/data_deadbeef.csv"],
        )
        user = msgs[1]["content"]
        # Reference by path only; nothing resembling raw CSV rows.
        assert "scratch/data_deadbeef.csv" in user
