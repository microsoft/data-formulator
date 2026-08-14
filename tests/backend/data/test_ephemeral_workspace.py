"""Tests for TTL-managed ephemeral workspace storage."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import flask
import pandas as pd
import pytest

from data_formulator.datalake.ephemeral_workspace import (
    EphemeralWorkspaceManager,
    cleanup_ephemeral_workspaces,
)
from data_formulator.datalake.workspace_manager import WORKSPACE_META_FILENAME, WorkspaceManager
from data_formulator import workspace_factory

pytestmark = [pytest.mark.backend]


def _set_updated_at(workspace_dir, value: datetime) -> None:
    meta_file = workspace_dir / WORKSPACE_META_FILENAME
    meta = json.loads(meta_file.read_text(encoding="utf-8"))
    meta["updatedAt"] = value.isoformat()
    meta_file.write_text(json.dumps(meta), encoding="utf-8")


def _run_workspace_lifecycle(manager: WorkspaceManager) -> dict:
    workspace = manager.create_and_open_workspace("analysis", "browser:test")
    workspace.write_parquet(pd.DataFrame({"number": [1, 2], "label": ["a", "b"]}), "source")
    manager.save_session_state("analysis", {
        "tables": [{"id": "source"}],
        "charts": [{"id": "chart-1"}],
        "activeWorkspace": {"id": "analysis", "displayName": "Analysis"},
        "models": [{"api_key": "secret"}],
    })
    manager.update_display_name("analysis", "Renamed Analysis")

    reopened = manager.open_workspace("analysis", "browser:test")
    observations = {
        "tables": reopened.list_tables(),
        "rows": reopened.read_data_as_df("source").to_dict(orient="records"),
        "state": manager.load_session_state("analysis"),
        "summary": [{
            key: value
            for key, value in entry.items()
            if key not in {"created_at", "updated_at"}
        } for entry in manager.list_workspaces()],
    }

    assert reopened.delete_table("source") is True
    assert reopened.list_tables() == []
    manager.rename_workspace("analysis", "renamed")
    assert manager.workspace_exists("renamed")
    assert manager.delete_workspace("renamed") is True
    assert manager.list_workspaces() == []
    return observations


def test_ephemeral_matches_local_workspace_lifecycle_without_retention(tmp_path, monkeypatch):
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_ROOT", str(tmp_path / "ephemeral"))
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_TTL_HOURS", "0")
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_MAX_BYTES", "0")

    local = WorkspaceManager(tmp_path / "local" / "workspaces")
    ephemeral = EphemeralWorkspaceManager("browser:test")

    assert isinstance(ephemeral, WorkspaceManager)
    assert _run_workspace_lifecycle(ephemeral) == _run_workspace_lifecycle(local)


@pytest.mark.parametrize("backend", ["local", "ephemeral"])
def test_factory_uses_same_lazy_workspace_contract(backend, tmp_path, monkeypatch):
    monkeypatch.setattr(
        workspace_factory,
        "_get_user_workspaces_root",
        lambda _identity_id: tmp_path / "local" / "workspaces",
    )
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_ROOT", str(tmp_path / "ephemeral"))
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_TTL_HOURS", "0")
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_MAX_BYTES", "0")

    app = flask.Flask(__name__)
    app.config["CLI_ARGS"] = {"workspace_backend": backend}
    with app.test_request_context(headers={"X-Workspace-Id": "lazy-workspace"}):
        workspace = workspace_factory.get_workspace("browser:test")
        workspace.write_parquet(pd.DataFrame({"value": [1, 2]}), "table")

        assert workspace.list_tables() == ["table"]
        assert workspace.read_data_as_df("table").to_dict(orient="records") == [
            {"value": 1},
            {"value": 2},
        ]


def test_cleanup_expires_only_ephemeral_workspaces(tmp_path, monkeypatch):
    ephemeral_root = tmp_path / "ephemeral"
    local_root = tmp_path / "local" / "workspaces"
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_ROOT", str(ephemeral_root))
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_TTL_HOURS", "1")
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_MAX_BYTES", "0")

    ephemeral_manager = EphemeralWorkspaceManager("browser:test")
    ephemeral_dir = ephemeral_manager.create_workspace("expired")
    _set_updated_at(ephemeral_dir, datetime.now(timezone.utc) - timedelta(hours=2))

    local_manager = WorkspaceManager(local_root)
    local_dir = local_manager.create_workspace("durable")
    _set_updated_at(local_dir, datetime.now(timezone.utc) - timedelta(days=30))

    assert cleanup_ephemeral_workspaces(force=True) == 1
    assert not ephemeral_dir.exists()
    assert ephemeral_manager.workspace_was_evicted("expired")
    assert local_dir.exists()


def test_cleanup_lru_evicts_oldest_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_ROOT", str(tmp_path / "ephemeral"))
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_TTL_HOURS", "0")
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_MAX_BYTES", "0")

    manager = EphemeralWorkspaceManager("browser:test")
    oldest_dir = manager.create_workspace("oldest")
    newest_dir = manager.create_workspace("newest")
    (oldest_dir / "data" / "payload.bin").write_bytes(b"a" * 20)
    (newest_dir / "data" / "payload.bin").write_bytes(b"b" * 20)
    _set_updated_at(oldest_dir, datetime.now(timezone.utc) - timedelta(hours=2))
    _set_updated_at(newest_dir, datetime.now(timezone.utc) - timedelta(hours=1))
    newest_size = sum(path.stat().st_size for path in newest_dir.rglob("*") if path.is_file())
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_MAX_BYTES", str(newest_size))

    assert cleanup_ephemeral_workspaces(force=True) == 1
    assert not oldest_dir.exists()
    assert newest_dir.exists()
