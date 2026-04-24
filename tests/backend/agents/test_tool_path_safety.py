# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Security tests for agent tool path confinement (_tool_read_file, etc.)."""

from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from data_formulator.agents.agent_data_loading_chat import DataLoadingAgent

pytestmark = [pytest.mark.backend]


class _FakeWorkspace:
    """Minimal workspace stub for tool tests."""
    def __init__(self, path: Path):
        self._path = path


@pytest.fixture()
def workspace_path(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    data = ws / "data"
    data.mkdir()
    (data / "sales.csv").write_text("product,amount\nA,100\n")
    scratch = ws / "scratch"
    scratch.mkdir()
    (scratch / "output.csv").write_text("x,y\n1,2\n")
    return ws


@pytest.fixture()
def agent(workspace_path):
    ws = _FakeWorkspace(workspace_path)
    a = DataLoadingAgent.__new__(DataLoadingAgent)
    a.workspace = ws
    return a


class TestToolReadFile:

    def test_read_valid_file(self, agent, workspace_path):
        result = agent._tool_read_file(
            {"path": "data/sales.csv"},
            workspace_path.resolve(),
        )
        assert "content" in result
        assert "product,amount" in result["content"]

    def test_traversal_blocked(self, agent, workspace_path):
        result = agent._tool_read_file(
            {"path": "../../etc/passwd"},
            workspace_path.resolve(),
        )
        assert "error" in result
        assert "Access denied" in result["error"]

    def test_absolute_path_blocked(self, agent, workspace_path):
        result = agent._tool_read_file(
            {"path": "/etc/passwd"},
            workspace_path.resolve(),
        )
        assert "error" in result

    def test_nonexistent_file(self, agent, workspace_path):
        result = agent._tool_read_file(
            {"path": "data/missing.csv"},
            workspace_path.resolve(),
        )
        assert "error" in result
        assert "not found" in result["error"].lower()


class TestToolListDirectory:

    def test_list_valid_directory(self, agent, workspace_path):
        result = agent._tool_list_directory(
            {"path": "data"},
            workspace_path.resolve(),
        )
        assert "entries" in result
        assert "sales.csv" in result["entries"]

    def test_traversal_blocked(self, agent, workspace_path):
        result = agent._tool_list_directory(
            {"path": "../../"},
            workspace_path.resolve(),
        )
        assert "error" in result
        assert "Access denied" in result["error"]

    def test_nonexistent_directory(self, agent, workspace_path):
        result = agent._tool_list_directory(
            {"path": "no_such_dir"},
            workspace_path.resolve(),
        )
        assert "error" in result


class TestPreviewScratchFiles:

    def test_traversal_blocked(self, agent, workspace_path):
        scratch_dir = workspace_path / "scratch"
        result = agent._preview_scratch_files(
            [{"path": "../../etc/passwd", "name": "evil"}],
            scratch_dir,
        )
        actions = result["actions"]
        assert len(actions) == 1
        assert "error" in actions[0]
        assert "outside" in actions[0]["error"].lower() or "Path" in actions[0]["error"]

    def test_valid_scratch_file(self, agent, workspace_path):
        scratch_dir = workspace_path / "scratch"
        result = agent._preview_scratch_files(
            [{"path": "scratch/output.csv", "name": "output"}],
            scratch_dir,
        )
        actions = result["actions"]
        assert len(actions) == 1
        assert "columns" in actions[0]
