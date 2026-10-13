"""Analyst attachment → scratch-note injection.

Non-image attachments are uploaded to the workspace ``scratch/`` folder and
their paths passed as ``scratch_files``; the agent's initial user message must
tell the model the files exist and how to consume them (read via
``execute_python_script`` or delegate to data loading) — never inline their
bytes. See design-docs/40-analyst-scratch-file-attachments.md.
"""
from __future__ import annotations

import json

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
        events = list(agent.run([], "visualize this data", trajectory=trajectory,
                                session_state={"focusedId": {"type": "file", "fileName": "scratch/sample.csv"}}))
        assert events[-1]["type"] == "completion"
        assert events[-1]["status"] == "success"
        context = json.dumps(observed)
        if resume:
            # A resumed run hears what changed: the file is now on the canvas.
            assert observed[-1]["content"].startswith("[SESSION CHANGES]")
            assert "Focus: `scratch/sample.csv` is now on the canvas" in observed[-1]["content"]
        else:
            # A new request shows the index, with the scratch file, and the file on the canvas.
            user = observed[-1]["content"]
            assert "Focus: `scratch/sample.csv` is on the canvas" in user
            assert "## Scratch files (1)\n- `scratch/sample.csv`" in user
            assert "[ON THE CANVAS] `scratch/sample.csv`" in user and "category,value" in user
        assert "[CURRENT WORKSPACE FILE CONTEXT]" not in context

    def test_the_index_says_whether_the_file_on_the_canvas_exists_and_who_may_edit_it(self, tmp_path):
        from data_formulator.analyst.session_layer import SessionLayer
        workspace = Workspace("test-user", root_dir=tmp_path)
        workspace.confined_scratch.write("computed.parquet", b"binary not for prompt")
        workspace.confined_scratch.write("_explore_ns/private.txt", b"private")
        workspace.save_workspace_file(b"private content", "notes.md")
        workspace.save_workspace_file(b"app", "dash.app.jsx", agent_managed=True)

        def index(name):
            return SessionLayer({"focusedId": {"type": "file", "fileName": name}}, workspace).index()

        assert "Focus: `scratch/computed.parquet` is on the canvas\n" in index("scratch/computed.parquet")
        assert "Focus: `files/notes.md` is on the canvas (the user's: copy it to change it)" in index("notes.md")
        assert "Focus: `files/dash.app.jsx` is on the canvas (yours: edit it in place with edit_file)" in index("dash.app.jsx")
        for missing in ("scratch/missing.parquet", "missing.md"):
            assert "(no longer exists)" in index(missing)
        text = index("notes.md")
        assert "binary not for prompt" not in text and "private content" not in text and "_explore_ns" not in text

    def test_scratch_note_injected(self):
        agent = _agent()
        msgs = agent._build_initial_messages(
            "what's the ROI trend?", scratch_files=["scratch/sales_a1b2c3d4.xlsx"],
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
        msgs = agent._build_initial_messages("q")
        assert "[ATTACHED FILES]" not in msgs[1]["content"]
        assert msgs[1]["content"].endswith("[USER QUESTION]\n\nq")

    def test_file_bytes_not_inlined(self):
        """Only the path is passed — the note must not contain file contents."""
        agent = _agent()
        msgs = agent._build_initial_messages("q", scratch_files=["scratch/data_deadbeef.csv"])
        user = msgs[1]["content"]
        # Reference by path only; nothing resembling raw CSV rows.
        assert "scratch/data_deadbeef.csv" in user
