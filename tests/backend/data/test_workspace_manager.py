"""Tests for WorkspaceManager — multi-workspace lifecycle.

Covers create/list/delete/rename, session-state persistence,
workspace migration ops, and auto-repair of legacy workspaces
that lack workspace_meta.json.
"""

from __future__ import annotations

import json
import pytest
import yaml
from pathlib import Path

from data_formulator.datalake.workspace_manager import (
    WorkspaceManager,
    WORKSPACE_META_FILENAME,
)


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
        assert (ws_path / WORKSPACE_META_FILENAME).exists()

    def test_create_duplicate_raises(self, manager):
        manager.create_workspace("test")
        with pytest.raises(ValueError, match="already exists"):
            manager.create_workspace("test")

    def test_list_workspaces(self, manager):
        manager.create_workspace("first")
        manager.create_workspace("second")

        ws_list = manager.list_workspaces()
        names = [w["id"] for w in ws_list]
        assert "first" in names
        assert "second" in names
        assert len(ws_list) == 2

    def test_workspace_exists(self, manager):
        assert not manager.workspace_exists("nope")
        manager.create_workspace("test")
        assert manager.workspace_exists("test")

    def test_workspace_exists_is_directory_based(self, manager):
        """A bare directory (without any metadata files) counts as existing."""
        bare_dir = manager.root / "bare_ws"
        bare_dir.mkdir()
        assert manager.workspace_exists("bare_ws")

    def test_delete_workspace(self, manager):
        manager.create_workspace("to_delete")
        assert manager.delete_workspace("to_delete") is True
        assert not manager.workspace_exists("to_delete")

    def test_delete_nonexistent(self, manager):
        assert manager.delete_workspace("nope") is False

    def test_rename_workspace(self, manager):
        manager.create_workspace("old_name")
        new_path = manager.rename_workspace("old_name", "new_name")
        assert new_path.exists()
        assert not manager.workspace_exists("old_name")
        assert manager.workspace_exists("new_name")

    def test_rename_nonexistent_raises(self, manager):
        with pytest.raises(ValueError, match="does not exist"):
            manager.rename_workspace("nope", "new")

    def test_rename_to_existing_raises(self, manager):
        manager.create_workspace("a")
        manager.create_workspace("b")
        with pytest.raises(ValueError, match="already exists"):
            manager.rename_workspace("a", "b")


class TestSessionState:
    def test_save_and_load(self, manager):
        manager.create_workspace("test")

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

    def test_update_display_name_patches_session_state(self, manager):
        """update_display_name writes both meta and session_state."""
        manager.create_workspace("ws")
        manager.save_session_state("ws", {
            "tables": [],
            "activeWorkspace": {"id": "ws", "displayName": "Old Name"},
        })

        manager.update_display_name("ws", "New Name")

        meta = json.loads(
            (manager.get_workspace_path("ws") / WORKSPACE_META_FILENAME)
            .read_text(encoding="utf-8")
        )
        assert meta["displayName"] == "New Name"

        state = manager.load_session_state("ws")
        assert state["activeWorkspace"]["displayName"] == "New Name"

    def test_update_display_name_skips_missing_session_state(self, manager):
        """update_display_name does not error when session_state.json is absent."""
        manager.create_workspace("ws")
        # No save_session_state call — file does not exist

        manager.update_display_name("ws", "Some Name")

        meta = json.loads(
            (manager.get_workspace_path("ws") / WORKSPACE_META_FILENAME)
            .read_text(encoding="utf-8")
        )
        assert meta["displayName"] == "Some Name"

    def test_save_to_nonexistent_workspace_raises(self, manager):
        with pytest.raises(ValueError, match="does not exist"):
            manager.save_session_state("nope", {"tables": []})

    def test_overwrite_session_state(self, manager):
        manager.create_workspace("test")

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


class TestWorkspaceMigrationOps:
    def test_move_workspaces_from_merges_existing_and_cleans_source(self, tmp_path):
        src = WorkspaceManager(tmp_path / "src")
        dst = WorkspaceManager(tmp_path / "dst")

        # Source workspace "alpha" with table_a
        src.create_workspace("alpha")
        alpha_src = src.get_workspace_path("alpha")
        (alpha_src / "workspace.yaml").write_text(
            yaml.safe_dump(
                {
                    "version": "2.0",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                    "tables": {
                        "table_a": {
                            "source_type": "upload",
                            "filename": "a.parquet",
                            "file_type": "parquet",
                            "created_at": "2026-01-01T00:00:00+00:00",
                            "updated_at": "2026-01-01T00:00:00+00:00",
                        }
                    },
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        (alpha_src / "data" / "a.parquet").write_text("source-a", encoding="utf-8")

        # Destination workspace with same ID "alpha" and existing table_b
        dst.create_workspace("alpha")
        alpha_dst = dst.get_workspace_path("alpha")
        (alpha_dst / "workspace.yaml").write_text(
            yaml.safe_dump(
                {
                    "version": "2.0",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                    "tables": {
                        "table_b": {
                            "source_type": "upload",
                            "filename": "b.parquet",
                            "file_type": "parquet",
                            "created_at": "2026-01-01T00:00:00+00:00",
                            "updated_at": "2026-01-01T00:00:00+00:00",
                        }
                    },
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        (alpha_dst / "data" / "b.parquet").write_text("dest-b", encoding="utf-8")

        moved = dst.move_workspaces_from(src.root)
        assert moved == ["alpha"]

        # Source workspace directory removed after merge
        assert not alpha_src.exists()

        # Destination metadata contains both tables
        merged_meta = yaml.safe_load((alpha_dst / "workspace.yaml").read_text(encoding="utf-8"))
        assert "table_a" in merged_meta["tables"]
        assert "table_b" in merged_meta["tables"]
        assert (alpha_dst / "data" / "a.parquet").exists()
        assert (alpha_dst / "data" / "b.parquet").exists()

    def test_delete_all_workspaces_removes_dirs_and_files(self, manager):
        manager.create_workspace("one")
        manager.create_workspace("two")
        # simulate stale non-directory artifact under root
        (manager.root / "stale.txt").write_text("x", encoding="utf-8")

        deleted = manager.delete_all_workspaces()
        assert deleted == 3
        assert list(manager.root.iterdir()) == []

    def test_move_workspaces_from_succeeds_when_source_locked(self, tmp_path, monkeypatch):
        """When source rmtree fails (e.g. Windows file lock), data is still
        copied to the target and the method does not raise."""
        import shutil as _shutil

        src = WorkspaceManager(tmp_path / "src")
        dst = WorkspaceManager(tmp_path / "dst")

        src.create_workspace("ws1")
        ws1_src = src.get_workspace_path("ws1")
        (ws1_src / "data" / "file.parquet").write_text("data", encoding="utf-8")
        (ws1_src / "workspace.yaml").write_text(
            yaml.safe_dump({"version": "2.0", "tables": {"t": {"filename": "file.parquet"}}}),
            encoding="utf-8",
        )

        # Simulate Windows file lock: rmtree raises OSError
        original_rmtree = _shutil.rmtree

        def locked_rmtree(path, *args, **kwargs):
            if "ws1" in str(path):
                raise OSError("[WinError 32] File in use")
            return original_rmtree(path, *args, **kwargs)

        monkeypatch.setattr("shutil.rmtree", locked_rmtree)

        moved = dst.move_workspaces_from(src.root)
        assert moved == ["ws1"]

        # Data successfully copied to destination
        ws1_dst = dst.get_workspace_path("ws1")
        assert (ws1_dst / "data" / "file.parquet").read_text(encoding="utf-8") == "data"
        meta = yaml.safe_load((ws1_dst / "workspace.yaml").read_text(encoding="utf-8"))
        assert "t" in meta["tables"]

        # Source still exists (could not be removed)
        assert ws1_src.exists()

    def test_delete_all_workspaces_skips_locked_entries(self, tmp_path, monkeypatch):
        """Locked directories are skipped; unlocked ones are still deleted."""
        import shutil as _shutil

        mgr = WorkspaceManager(tmp_path / "root")
        mgr.create_workspace("can_delete")
        mgr.create_workspace("is_locked")

        original_rmtree = _shutil.rmtree

        def selective_rmtree(path, *args, **kwargs):
            if "is_locked" in str(path):
                raise OSError("[WinError 32] File in use")
            return original_rmtree(path, *args, **kwargs)

        monkeypatch.setattr("shutil.rmtree", selective_rmtree)

        deleted = mgr.delete_all_workspaces()
        # One deleted, one skipped
        assert deleted == 1
        assert not mgr.get_workspace_path("can_delete").exists()
        assert mgr.get_workspace_path("is_locked").exists()


class TestLegacyWorkspaceAutoRepair:
    """Workspaces created before workspace_meta.json was introduced only
    have workspace.yaml and/or session_state.json.  They should be
    auto-repaired (meta.json created) on first access."""

    def test_legacy_workspace_with_only_yaml_appears_in_list(self, manager):
        """A directory with workspace.yaml but no workspace_meta.json
        should be auto-repaired and visible in list_workspaces."""
        ws_dir = manager.root / "legacy_ws"
        ws_dir.mkdir(parents=True)
        (ws_dir / "workspace.yaml").write_text(
            yaml.safe_dump({"version": "1.1", "tables": {}}),
            encoding="utf-8",
        )

        ws_list = manager.list_workspaces()
        ids = [w["id"] for w in ws_list]
        assert "legacy_ws" in ids

        # workspace_meta.json should have been auto-created
        assert (ws_dir / WORKSPACE_META_FILENAME).exists()

    def test_legacy_workspace_with_only_session_state_appears_in_list(self, manager):
        """A directory with only session_state.json should be auto-repaired."""
        ws_dir = manager.root / "state_only"
        ws_dir.mkdir(parents=True)
        (ws_dir / "session_state.json").write_text(
            json.dumps({
                "tables": [],
                "activeWorkspace": {"displayName": "My Old Session"},
            }),
            encoding="utf-8",
        )

        ws_list = manager.list_workspaces()
        ids = [w["id"] for w in ws_list]
        assert "state_only" in ids

        # displayName should be inferred from session_state.json
        entry = next(w for w in ws_list if w["id"] == "state_only")
        assert entry["display_name"] == "My Old Session"

    def test_legacy_workspace_with_empty_dir_appears_in_list(self, manager):
        """Even a bare directory (no metadata files at all) should be listed."""
        ws_dir = manager.root / "bare"
        ws_dir.mkdir(parents=True)

        ws_list = manager.list_workspaces()
        ids = [w["id"] for w in ws_list]
        assert "bare" in ids

        # workspace_meta.json auto-created with fallback displayName = dir name
        meta = json.loads((ws_dir / WORKSPACE_META_FILENAME).read_text(encoding="utf-8"))
        assert meta["displayName"] == "bare"

    def test_workspace_exists_consistent_with_create(self, manager):
        """workspace_exists and create_workspace should use the same
        definition: directory exists = workspace exists."""
        ws_dir = manager.root / "orphan"
        ws_dir.mkdir(parents=True)

        assert manager.workspace_exists("orphan")
        with pytest.raises(ValueError, match="already exists"):
            manager.create_workspace("orphan")

    def test_move_legacy_workspace_auto_repairs_meta(self, tmp_path):
        """Moving a legacy workspace (no meta.json) should auto-repair it."""
        src = WorkspaceManager(tmp_path / "src")
        dst = WorkspaceManager(tmp_path / "dst")

        # Create a legacy source workspace (no workspace_meta.json)
        ws_dir = src.root / "old_ws"
        ws_dir.mkdir(parents=True)
        (ws_dir / "data").mkdir()
        (ws_dir / "workspace.yaml").write_text(
            yaml.safe_dump({
                "version": "1.1",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
                "tables": {},
            }),
            encoding="utf-8",
        )

        moved = dst.move_workspaces_from(src.root)
        assert "old_ws" in moved

        # Destination should have workspace_meta.json
        dst_ws = dst.get_workspace_path("old_ws")
        assert (dst_ws / WORKSPACE_META_FILENAME).exists()
