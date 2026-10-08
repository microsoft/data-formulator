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


def test_azure_runtime_includes_visible_scratch_and_promotion_is_additive(tmp_path):
    import io
    from types import SimpleNamespace
    import pyarrow as pa
    import pyarrow.parquet as pq
    from data_formulator.datalake.azure_blob_workspace import AzureBlobWorkspace
    from data_formulator.datalake.workspace_metadata import WorkspaceMetadata

    workspace = object.__new__(AzureBlobWorkspace)
    workspace._prefix = "workspace/"
    workspace._confined_scratch = ConfinedDir(tmp_path / "scratch")
    workspace.confined_scratch.write("nested/factor.txt", b"4")
    workspace.confined_scratch.write("_explore_ns/private.txt", b"private")
    blobs = {"files/source.txt": b"user source"}
    workspace._container = SimpleNamespace(
        list_blobs=lambda **kwargs: [SimpleNamespace(name="workspace/" + name) for name in blobs],
        download_blob=lambda name: SimpleNamespace(readall=lambda: blobs[name.removeprefix("workspace/")]),
    )
    workspace._blob_exists = lambda name: name in blobs
    workspace._upload_bytes = lambda name, content: blobs.__setitem__(name, content)
    workspace._download_bytes = lambda name: blobs[name]
    metadata = WorkspaceMetadata.create_new()
    workspace._atomic_update_metadata = lambda update: update(metadata)
    generated = workspace.save_workspace_file(b"first", "generated.txt", agent_managed=True)
    revised = workspace.save_workspace_file(b"revised", "generated.txt", agent_managed=True,
                                            expected_content_hash=generated.content_hash)
    assert revised.origin == "agent"
    assert revised.edit_policy == "agent_editable"
    assert blobs["files/generated.txt"] == b"revised"
    assert not workspace.confined_scratch.exists("generated.txt")
    first = workspace.add_parquet_from_arrow(pa.table({"value": [1]}), "computed")
    second = workspace.add_parquet_from_arrow(pa.table({"value": [2]}), "computed")
    assert first.name == "computed"
    assert second.name == "computed_2"
    assert pq.read_table(io.BytesIO(blobs["data/computed.parquet"])).to_pylist() == [{"value": 1}]
    with workspace.local_dir() as directory:
        assert (directory / "files/source.txt").read_bytes() == b"user source"
        assert (directory / "files/generated.txt").read_bytes() == b"revised"
        assert (directory / "scratch/nested/factor.txt").read_bytes() == b"4"
        assert not (directory / "scratch/_explore_ns/private.txt").exists()
        assert pq.read_table(directory / "data/computed_2.parquet").to_pylist() == [{"value": 2}]