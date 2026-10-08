from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest

from data_formulator.datalake.azure_blob_workspace import AzureBlobWorkspace
from data_formulator.datalake.workspace import WORKSPACE_TEXT_MEMORY_MAX_CHARS, Workspace
from data_formulator.datalake.workspace_metadata import (
    MemorySource,
    WorkspaceMemoryMetadata,
    WorkspaceMetadata,
)

pytestmark = [pytest.mark.backend]


def test_memory_metadata_round_trip_and_legacy_default() -> None:
    metadata = WorkspaceMetadata.create_new()
    now = datetime.now(timezone.utc)
    metadata.add_memory(WorkspaceMemoryMetadata(
        id="memory-123",
        name="quarterly_revenue",
        kind="table",
        filename="quarterly_revenue--123.parquet",
        media_type="application/vnd.apache.parquet",
        created_at=now,
        updated_at=now,
        content_hash="abc",
        file_size=42,
        sources=[MemorySource(
            input_id="file:abc:report.pdf",
            name="report.pdf",
            content_hash="abc",
            media_type="application/pdf",
            locator={"page": 2},
        )],
        row_count=3,
    ))

    serialized = metadata.to_dict()
    restored = WorkspaceMetadata.from_dict(serialized)
    memory = restored.memory["memory-123"]
    assert memory.kind == "table"
    assert memory.sources[0].locator == {"page": 2}
    assert memory.row_count == 3

    serialized.pop("memory")
    assert WorkspaceMetadata.from_dict(serialized).memory == {}


def test_local_table_memory_lifecycle(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    source = MemorySource(
        input_id="file:abc:report.pdf",
        name="report.pdf",
        content_hash="abc",
        locator={"page": 2},
    )
    original = pd.DataFrame({"region": ["east", "west"], "revenue": [10, 20]})

    memory = workspace.write_memory_table(
        original,
        "quarterly revenue",
        sources=[source],
        description="Revenue extracted from the quarterly report.",
    )
    memory_path = workspace._path / "memory" / memory.filename

    assert memory.id.startswith("memory-")
    assert memory.name == "quarterly_revenue"
    assert memory_path.is_file()
    assert not (workspace._path / "data" / memory.filename).exists()
    assert workspace.list_memory() == [memory]
    pd.testing.assert_frame_equal(workspace.read_memory_table_as_df(memory.id), original)

    refreshed = workspace.write_memory_table(
        pd.DataFrame({"region": ["north"], "revenue": [30]}),
        "quarterly revenue",
        memory_id=memory.id,
    )
    assert refreshed.id == memory.id
    assert refreshed.filename == memory.filename
    assert refreshed.created_at == memory.created_at
    assert refreshed.row_count == 1
    assert refreshed.sources == [source]

    renamed = workspace.rename_memory(memory.id, "regional revenue")
    assert renamed.name == "regional_revenue"
    assert workspace.get_memory_metadata("regional_revenue") is renamed

    assert workspace.delete_memory(memory.id)
    assert workspace.list_memory() == []
    assert not memory_path.exists()


def test_local_text_memory_patch_lifecycle(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    memory = workspace.write_memory_text(
        "# Revenue\n\nEast: 10\n",
        "revenue notes",
        description="Remembered report context.",
    )
    memory_path = workspace._path / "memory" / memory.filename

    assert memory.kind == "text"
    assert memory.media_type == "text/markdown"
    assert memory_path.read_text(encoding="utf-8") == "# Revenue\n\nEast: 10\n"

    patched = workspace.patch_memory_text(
        memory.id,
        expected_content_hash=memory.content_hash,
        replacements=[{"old_text": "East: 10", "new_text": "East: 12"}],
        append_text="West: 8\n",
    )
    assert patched.id == memory.id
    assert patched.filename == memory.filename
    assert patched.created_at == memory.created_at
    assert workspace.read_memory_text(memory.id) == "# Revenue\n\nEast: 12\nWest: 8\n"

    with pytest.raises(ValueError, match="Memory changed while patching"):
        workspace.patch_memory_text(
            memory.id,
            expected_content_hash=memory.content_hash,
            append_text="stale",
        )


def test_text_memory_patch_rejects_ambiguous_replacement(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)
    memory = workspace.write_memory_text("same\nsame\n", "notes")

    with pytest.raises(ValueError, match="ambiguous"):
        workspace.patch_memory_text(
            memory.id,
            expected_content_hash=memory.content_hash,
            replacements=[{"old_text": "same", "new_text": "changed"}],
        )


def test_text_memory_rejects_oversized_content(tmp_path) -> None:
    workspace = Workspace("test-user", root_dir=tmp_path)

    with pytest.raises(ValueError, match="Text memory exceeds"):
        workspace.write_memory_text(
            "x" * (WORKSPACE_TEXT_MEMORY_MAX_CHARS + 1),
            "oversized",
        )


def test_azure_memory_uses_memory_blob_prefix() -> None:
    workspace = object.__new__(AzureBlobWorkspace)
    blobs: dict[str, bytes] = {}
    workspace._upload_bytes = lambda key, content: blobs.__setitem__(key, content)
    workspace._download_bytes = lambda key: blobs[key]
    workspace._blob_exists = lambda key: key in blobs
    workspace._delete_blob = lambda key: blobs.pop(key)

    workspace._write_memory_file("example.parquet", b"parquet")
    assert blobs == {"memory/example.parquet": b"parquet"}
    assert workspace._read_memory_file("example.parquet") == b"parquet"
    workspace._delete_memory_file("example.parquet")
    assert blobs == {}