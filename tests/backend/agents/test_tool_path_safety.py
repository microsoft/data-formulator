# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Security tests for agent tool path confinement (_tool_read_file, etc.)."""

from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from data_formulator.agents.agent_data_loading_chat import DataLoadingAgent
from data_formulator.security.path_safety import ConfinedDir

pytestmark = [pytest.mark.backend]


class _FakeWorkspace:
    """Minimal workspace stub for tool tests."""
    def __init__(self, path: Path):
        self._path = path
        self._confined_root = ConfinedDir(path, mkdir=False)
        self._confined_data = ConfinedDir(path / "data")
        self._confined_scratch = ConfinedDir(path / "scratch")

    @property
    def confined_root(self):
        return self._confined_root

    @property
    def confined_data(self):
        return self._confined_data

    @property
    def confined_scratch(self):
        return self._confined_scratch


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
def workspace_jail(workspace_path):
    return ConfinedDir(workspace_path, mkdir=False)


@pytest.fixture()
def scratch_jail(workspace_path):
    return ConfinedDir(workspace_path / "scratch", mkdir=False)


@pytest.fixture()
def agent(workspace_path):
    ws = _FakeWorkspace(workspace_path)
    a = DataLoadingAgent.__new__(DataLoadingAgent)
    a.workspace = ws
    return a


class TestToolReadFile:

    def test_read_valid_file(self, agent, workspace_jail):
        result = agent._tool_read_file(
            {"path": "data/sales.csv"},
            workspace_jail,
        )
        assert "content" in result
        assert "product,amount" in result["content"]

    def test_traversal_blocked(self, agent, workspace_jail):
        result = agent._tool_read_file(
            {"path": "../../etc/passwd"},
            workspace_jail,
        )
        assert "error" in result
        assert "Access denied" in result["error"]

    def test_absolute_path_blocked(self, agent, workspace_jail):
        result = agent._tool_read_file(
            {"path": "/etc/passwd"},
            workspace_jail,
        )
        assert "error" in result

    def test_nonexistent_file(self, agent, workspace_jail):
        result = agent._tool_read_file(
            {"path": "data/missing.csv"},
            workspace_jail,
        )
        assert "error" in result
        assert "not found" in result["error"].lower()

    def test_empty_path_blocked(self, agent, workspace_jail):
        result = agent._tool_read_file(
            {"path": ""},
            workspace_jail,
        )
        assert "error" in result
        assert "Access denied" in result["error"]


class TestToolListDirectory:

    def test_list_valid_directory(self, agent, workspace_jail):
        result = agent._tool_list_directory(
            {"path": "data"},
            workspace_jail,
        )
        assert "entries" in result
        assert "sales.csv" in result["entries"]

    def test_list_root_directory(self, agent, workspace_jail):
        result = agent._tool_list_directory(
            {"path": ""},
            workspace_jail,
        )
        assert "entries" in result
        assert "data/" in result["entries"]

    def test_traversal_blocked(self, agent, workspace_jail):
        result = agent._tool_list_directory(
            {"path": "../../"},
            workspace_jail,
        )
        assert "error" in result
        assert "Access denied" in result["error"]

    def test_nonexistent_directory(self, agent, workspace_jail):
        result = agent._tool_list_directory(
            {"path": "no_such_dir"},
            workspace_jail,
        )
        assert "error" in result


class TestToolWriteFile:

    def test_write_valid_file(self, agent, scratch_jail):
        result = agent._tool_write_file(
            {"path": "output.txt", "content": "hello"},
            scratch_jail,
        )
        assert "path" in result
        assert result["size"] == 5

    def test_traversal_sanitized_and_confined(self, agent, scratch_jail, workspace_path):
        """_secure_filename sanitizes first, then ConfinedDir validates.

        The file is written with a sanitized name inside scratch/ — both
        defense layers cooperate to prevent escape.
        """
        result = agent._tool_write_file(
            {"path": "../../evil.txt", "content": "hacked"},
            scratch_jail,
        )
        assert "path" in result
        written = workspace_path / "scratch" / result["path"].split("/")[-1]
        assert written.exists()
        assert written.parent == workspace_path / "scratch"


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
