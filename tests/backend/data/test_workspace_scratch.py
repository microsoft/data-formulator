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

def test_opening_a_workspace_moves_app_state_out_of_scratch(tmp_path: Path) -> None:
    """Older versions kept the app's own state in scratch/; it moves to _internal/ (design-docs/73)."""
    scratch = tmp_path / "ws" / "scratch"
    for name, content in (("_agent/history.json", "{}"), ("_explore_ns/state.bin", "ns"),
                          ("_workflow_runs/run.json", "{}"), (".display_names/key.json", "{}"),
                          ("data_operations/data_operations.json", "{}"), ("_terminal_tmp/x", ""),
                          (".workspace.lock", ""), ("download.csv", "a\n1\n")):
        (scratch / name).parent.mkdir(parents=True, exist_ok=True)
        (scratch / name).write_text(content)
    # A run recorded under the new layout before the move is kept, and the old one joins it.
    (tmp_path / "ws" / "_internal" / "workflow_runs").mkdir(parents=True)
    (tmp_path / "ws" / "_internal" / "workflow_runs" / "new.json").write_text("{}")

    workspace = Workspace("user:a", workspace_path=tmp_path / "ws")
    internal = workspace.confined_internal.root

    assert sorted(p.name for p in scratch.iterdir()) == ["download.csv"]
    assert (internal / "agent" / "history.json").read_text() == "{}"
    assert (internal / "explore_ns" / "state.bin").read_text() == "ns"
    assert {p.name for p in (internal / "workflow_runs").iterdir()} == {"run.json", "new.json"}
    assert (internal / "display_names" / "key.json").exists()
    assert (internal / "data_operations" / "data_operations.json").exists()

    Workspace("user:a", workspace_path=tmp_path / "ws")  # a second open changes nothing
    assert sorted(p.name for p in scratch.iterdir()) == ["download.csv"]
    assert (internal / "agent" / "history.json").read_text() == "{}"


def test_agent_history_continues_after_the_move(tmp_path: Path) -> None:
    from data_formulator.analyst.history import SessionHistory

    scratch = tmp_path / "ws" / "scratch" / "_agent"
    scratch.mkdir(parents=True)
    (scratch / "history.json").write_text(
        '{"version": 1, "model": "m", "updated_at": 0, "messages": [{"role": "user", "content": "hi"}]}')

    history = SessionHistory(Workspace("user:a", workspace_path=tmp_path / "ws"))

    assert history.load()["messages"] == [{"role": "user", "content": "hi"}]
    history.commit("m", [{"role": "assistant", "content": "hello"}], continued=True)
    assert len(history.load()["messages"]) == 2
    assert not (tmp_path / "ws" / "scratch" / ".workspace.lock").exists()


def test_workspace_migrations_run_once_and_retry_a_failed_step(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from data_formulator.datalake import workspace_migrations

    calls: list[str] = []
    failing = {"broken": True}

    def ok(workspace):
        calls.append("ok")

    def flaky(workspace):
        calls.append("flaky")
        if failing["broken"]:
            raise RuntimeError("not yet")

    monkeypatch.setattr(workspace_migrations, "STEPS", (("ok", ok), ("flaky", flaky)))
    Workspace("user:a", workspace_path=tmp_path / "ws")
    Workspace("user:a", workspace_path=tmp_path / "ws")  # "ok" is recorded; "flaky" failed, so it runs again
    failing["broken"] = False
    Workspace("user:a", workspace_path=tmp_path / "ws")
    Workspace("user:a", workspace_path=tmp_path / "ws")  # both recorded: nothing runs

    assert calls == ["ok", "flaky", "flaky", "flaky"]
    record = (tmp_path / "ws" / "_internal" / "migrations.json").read_text()
    assert '"ok"' in record and '"flaky"' in record
