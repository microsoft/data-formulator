"""Tests for WorkspaceManager — multi-workspace lifecycle."""

from __future__ import annotations

import json
import pytest
from pathlib import Path

from data_formulator.datalake.workspace_manager import WorkspaceManager


pytestmark = [pytest.mark.backend]


@pytest.fixture
def manager(tmp_path) -> WorkspaceManager:
    return WorkspaceManager(tmp_path / "workspaces")


class TestWorkspaceLifecycle:
    def test_list_empty(self, manager):
        assert manager.list_workspaces() == []

    def test_create_workspace(self, manager):
        ws_path = manager.create_workspace("My Analysis")
        assert ws_path.exists()
        assert (ws_path / "data").is_dir()

    def test_create_duplicate_raises(self, manager):
        manager.create_workspace("test")
        with pytest.raises(ValueError, match="already exists"):
            manager.create_workspace("test")

    def test_list_workspaces(self, manager):
        manager.create_workspace("first")
        manager.create_workspace("second")
        # Write a workspace.yaml so they show up in listing
        (manager.get_workspace_path("first") / "workspace.yaml").write_text("version: '2.0'")
        (manager.get_workspace_path("second") / "workspace.yaml").write_text("version: '2.0'")

        ws_list = manager.list_workspaces()
        names = [w["id"] for w in ws_list]
        assert "first" in names
        assert "second" in names
        assert len(ws_list) == 2

    def test_workspace_exists(self, manager):
        assert not manager.workspace_exists("nope")
        manager.create_workspace("test")
        (manager.get_workspace_path("test") / "workspace.yaml").write_text("version: '2.0'")
        assert manager.workspace_exists("test")

    def test_delete_workspace(self, manager):
        manager.create_workspace("to_delete")
        (manager.get_workspace_path("to_delete") / "workspace.yaml").write_text("v")
        assert manager.delete_workspace("to_delete") is True
        assert not manager.workspace_exists("to_delete")

    def test_delete_nonexistent(self, manager):
        assert manager.delete_workspace("nope") is False

    def test_rename_workspace(self, manager):
        manager.create_workspace("old_name")
        (manager.get_workspace_path("old_name") / "workspace.yaml").write_text("v")
        new_path = manager.rename_workspace("old_name", "new_name")
        assert new_path.exists()
        assert not manager.workspace_exists("old_name")
        assert (new_path / "workspace.yaml").exists()

    def test_rename_nonexistent_raises(self, manager):
        with pytest.raises(ValueError, match="does not exist"):
            manager.rename_workspace("nope", "new")

    def test_rename_to_existing_raises(self, manager):
        manager.create_workspace("a")
        manager.create_workspace("b")
        (manager.get_workspace_path("a") / "workspace.yaml").write_text("v")
        (manager.get_workspace_path("b") / "workspace.yaml").write_text("v")
        with pytest.raises(ValueError, match="already exists"):
            manager.rename_workspace("a", "b")


class TestSessionState:
    def test_save_and_load(self, manager):
        manager.create_workspace("test")
        (manager.get_workspace_path("test") / "workspace.yaml").write_text("v")

        state = {
            "tables": [{"id": "t1", "name": "Table 1"}],
            "charts": [],
            "focusedId": None,
        }
        manager.save_session_state("test", state)

        loaded = manager.load_session_state("test")
        assert loaded is not None
        assert loaded["tables"] == [{"id": "t1", "name": "Table 1"}]

    def test_sensitive_fields_stripped(self, manager):
        manager.create_workspace("test")
        (manager.get_workspace_path("test") / "workspace.yaml").write_text("v")

        state = {
            "tables": [],
            "models": [{"id": "gpt-4", "api_key": "secret"}],
            "identity": {"type": "user", "id": "123"},
            "dataLoaderConnectParams": {"mysql": {"password": "secret"}},
            "selectedModelId": "gpt-4",
            "testedModels": [],
            "agentRules": {},
            "serverConfig": {},
        }
        manager.save_session_state("test", state)

        loaded = manager.load_session_state("test")
        assert "models" not in loaded
        assert "identity" not in loaded
        assert "dataLoaderConnectParams" not in loaded
        assert "selectedModelId" not in loaded
        assert "tables" in loaded

    def test_load_nonexistent(self, manager):
        assert manager.load_session_state("nope") is None

    def test_save_to_nonexistent_workspace_raises(self, manager):
        with pytest.raises(ValueError, match="does not exist"):
            manager.save_session_state("nope", {"tables": []})

    def test_overwrite_session_state(self, manager):
        manager.create_workspace("test")
        (manager.get_workspace_path("test") / "workspace.yaml").write_text("v")

        manager.save_session_state("test", {"version": 1})
        manager.save_session_state("test", {"version": 2})

        loaded = manager.load_session_state("test")
        assert loaded["version"] == 2


class TestOpenWorkspace:
    """Integration: WorkspaceManager creates workspace, opens as Workspace, writes data."""

    def test_open_workspace_returns_workspace(self, manager):
        manager.create_workspace("analysis")
        ws = manager.open_workspace("analysis", identity_id="test-user")
        assert ws is not None
        assert ws.list_tables() == []

    def test_open_nonexistent_raises(self, manager):
        with pytest.raises(ValueError, match="does not exist"):
            manager.open_workspace("nope", identity_id="test-user")

    def test_create_and_open_workspace(self, manager):
        ws = manager.create_and_open_workspace("new_ws", identity_id="test-user")
        assert ws is not None
        assert ws.list_tables() == []

    def test_write_data_in_workspace(self, manager):
        import pandas as pd
        ws = manager.create_and_open_workspace("data_ws", identity_id="test-user")

        df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
        meta = ws.write_parquet(df, "my_table")
        assert meta.name == "my_table"
        assert "my_table" in ws.list_tables()

        # Data should be readable
        loaded_df = ws.read_data_as_df("my_table")
        assert len(loaded_df) == 3

    def test_session_state_persists_with_data(self, manager):
        import pandas as pd
        ws = manager.create_and_open_workspace("full_ws", identity_id="test-user")

        # Write data
        df = pd.DataFrame({"x": [10, 20]})
        ws.write_parquet(df, "data_table")

        # Save session state
        manager.save_session_state("full_ws", {"tables": [{"id": "data_table"}], "charts": []})

        # Verify both exist
        assert "data_table" in ws.list_tables()
        state = manager.load_session_state("full_ws")
        assert state["tables"] == [{"id": "data_table"}]
