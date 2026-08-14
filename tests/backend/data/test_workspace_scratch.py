from __future__ import annotations

import os
from pathlib import Path

import pytest

from data_formulator.datalake.workspace import Workspace
from data_formulator.datalake.azure_blob_workspace_manager import AzureBlobWorkspaceManager
from data_formulator.security.path_safety import ConfinedDir


pytestmark = [pytest.mark.backend]


class _ScratchOnlyWorkspace:
    def __init__(self, scratch: Path):
        self.confined_scratch = ConfinedDir(scratch)


def test_prune_scratch_uses_backend_neutral_confined_directory(tmp_path: Path) -> None:
    scratch = tmp_path / "scratch"
    workspace = _ScratchOnlyWorkspace(scratch)
    oldest = scratch / "oldest.bin"
    newest = scratch / "newest.bin"
    oldest.write_bytes(b"a" * 8)
    newest.write_bytes(b"b" * 8)
    os.utime(oldest, (1, 1))
    os.utime(newest, (2, 2))

    freed = Workspace.prune_scratch(workspace, max_bytes=8)

    assert freed == 8
    assert not oldest.exists()
    assert newest.exists()


def test_deleting_azure_workspace_removes_local_scratch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from data_formulator.datalake import azure_blob_workspace

    monkeypatch.setattr(
        azure_blob_workspace,
        "get_data_formulator_home",
        lambda: tmp_path,
    )
    manager = AzureBlobWorkspaceManager.__new__(AzureBlobWorkspaceManager)
    monkeypatch.setattr(manager, "_ws_prefix", lambda _workspace_id: "users/u/workspaces/w/")
    monkeypatch.setattr(manager, "_safe_id", lambda value: value)
    monkeypatch.setattr(manager, "_delete_blobs_with_prefix", lambda _prefix: 3)
    scratch = azure_blob_workspace.get_azure_workspace_scratch_path(
        "users/u/workspaces/w/",
        "w",
    )
    scratch.mkdir(parents=True)
    (scratch / "operation.json").write_text("{}")

    assert manager.delete_workspace("w") is True
    assert not scratch.exists()