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
from data_formulator.datalake.workspace import Workspace

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
    @pytest.mark.parametrize("resume", [False, True])
    def test_agent_loop_receives_current_scratch_focus(self, tmp_path, resume):
        workspace = Workspace("test-user", root_dir=tmp_path)
        workspace.confined_scratch.write("sample.csv", b"category,value\na,1\nb,2\n")
        client = MagicMock()
        client.model = "test-model"
        agent = AnalystAgent(client=client, workspace=workspace)
        agent._build_lightweight_table_context = lambda *args, **kwargs: "No durable tables"
        agent._build_system_prompt = lambda *args, **kwargs: "SYS"
        observed = []

        def next_action(messages, *args, **kwargs):
            observed.extend(messages)
            yield {"type": "agent_action", "final_text": "Ready to inspect the selected CSV."}

        agent._get_next_action = next_action
        trajectory = [{"role": "user", "content": "Earlier context had no files."}] if resume else None
        events = list(agent.run([], "visualize this data", trajectory=trajectory, focused_file="scratch/sample.csv"))
        assert events[-1]["type"] == "completion"
        assert events[-1]["status"] == "success"
        assert '"selected_file": {"path": "scratch/sample.csv"' in observed[-1]["content"]
        assert '"scratch_files": ["scratch/sample.csv"]' in observed[-1]["content"]
        assert "promotion or another upload is not required" in observed[-1]["content"]

    def test_file_context_includes_prior_scratch_and_current_selection(self, tmp_path):
        agent = _agent()
        agent.workspace = Workspace("test-user", root_dir=tmp_path)
        agent.workspace.confined_scratch.write("computed.parquet", b"binary not for prompt")
        agent.workspace.confined_scratch.write("_explore_ns/private.txt", b"private")
        agent.workspace.save_workspace_file(b"private content", "notes.md")
        for name, path in [("scratch/computed.parquet", "scratch/computed.parquet"), ("notes.md", "files/notes.md")]:
            context = agent._build_file_selection_context(name)
            assert '"path": "' + path + '"' in context
            assert "visualize them directly" in context
            assert "binary not for prompt" not in context
            assert "private content" not in context
            assert "_explore_ns" not in context
        context = agent._build_file_selection_context(None)
        assert "No file is currently selected" in context
        assert "scratch/computed.parquet" in context
        for name in ["scratch/missing.parquet", "scratch/../data/private.parquet", "missing.md"]:
            assert "unavailable or expired" in agent._build_file_selection_context(name)

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
        assert "create_file" in user
        assert "edit_file" in user
        assert "add_to_workspace" not in user
        assert "Prioritize relevant user-managed sources" in user
        # The note precedes the question, and the question is still present.
        assert "[USER QUESTION]" in user
        assert user.index("[ATTACHED FILES]") < user.index("[USER QUESTION]")

    def test_no_note_without_files(self):
        agent = _agent()
        msgs = agent._build_initial_messages([{"name": "t"}], "q")
        assert "[ATTACHED FILES]" not in msgs[1]["content"]
        assert msgs[1]["content"].startswith("[WORKSPACE INPUTS]")
        assert "[AVAILABLE TABLES]" not in msgs[1]["content"]

    def test_file_bytes_not_inlined(self):
        """Only the path is passed — the note must not contain file contents."""
        agent = _agent()
        msgs = agent._build_initial_messages(
            [{"name": "t"}], "q", scratch_files=["scratch/data_deadbeef.csv"],
        )
        user = msgs[1]["content"]
        # Reference by path only; nothing resembling raw CSV rows.
        assert "scratch/data_deadbeef.csv" in user
