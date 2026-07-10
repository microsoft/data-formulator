"""Azure Blob workspace metadata concurrency regression tests."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
import yaml
from azure.core.exceptions import ResourceModifiedError, ResourceNotFoundError

from data_formulator.datalake.azure_blob_workspace import AzureBlobWorkspace
from data_formulator.datalake.workspace_metadata import TableMetadata

pytestmark = [pytest.mark.backend]


@dataclass
class _StoredBlob:
    data: bytes
    version: int


class _Download:
    def __init__(self, data: bytes):
        self._data = data

    def readall(self) -> bytes:
        return self._data


class _BlobClient:
    def __init__(self, store: "_BlobStore", name: str):
        self._store = store
        self._name = name

    def get_blob_properties(self):
        with self._store.lock:
            blob = self._store.blobs.get(self._name)
            if blob is None:
                raise ResourceNotFoundError("Blob does not exist")
            return SimpleNamespace(etag=f'"{blob.version}"')

    def download_blob(
        self,
        *,
        etag: str | None = None,
        match_condition=None,
    ) -> _Download:
        del match_condition
        with self._store.lock:
            blob = self._store.blobs[self._name]
            if etag is not None and etag != f'"{blob.version}"':
                raise ResourceModifiedError("ETag does not match")
            return _Download(blob.data)

    def upload_blob(
        self,
        data: bytes | str,
        *,
        overwrite: bool = False,
        etag: str | None = None,
        match_condition=None,
    ) -> None:
        del match_condition
        raw = data.encode("utf-8") if isinstance(data, str) else data
        with self._store.lock:
            current = self._store.blobs.get(self._name)
            current_etag = f'"{current.version}"' if current else None
            if etag is not None and etag != current_etag:
                raise ResourceModifiedError("ETag does not match")
            if current is not None and not overwrite and etag is None:
                raise ResourceModifiedError("Blob already exists")
            version = (current.version + 1) if current else 1
            self._store.blobs[self._name] = _StoredBlob(raw, version)


class _BlobStore:
    def __init__(self):
        self.blobs: dict[str, _StoredBlob] = {}
        self.lock = threading.Lock()

    def get_blob_client(self, name: str) -> _BlobClient:
        return _BlobClient(self, name)


def _table(name: str) -> TableMetadata:
    return TableMetadata(
        name=name,
        source_type="upload",
        filename=f"{name}.parquet",
        file_type="parquet",
        created_at=datetime.now(timezone.utc),
    )


def test_separate_instances_retry_etag_conflict_without_lost_update() -> None:
    """Two workspace objects must preserve both concurrent metadata changes."""
    store = _BlobStore()
    first = AzureBlobWorkspace("user", store, blob_prefix="workspace")
    second = AzureBlobWorkspace("user", store, blob_prefix="workspace")
    barrier = threading.Barrier(2)

    def synchronize_first_read(workspace: AzureBlobWorkspace) -> None:
        original_download = workspace._download_metadata_with_etag
        first_read = True

        def synchronized_download():
            nonlocal first_read
            metadata = original_download()
            if first_read:
                first_read = False
                barrier.wait(timeout=5)
            return metadata

        workspace._download_metadata_with_etag = synchronized_download  # type: ignore[method-assign]

    for workspace in (first, second):
        synchronize_first_read(workspace)

    errors: list[Exception] = []

    def add_table(workspace: AzureBlobWorkspace, name: str) -> None:
        try:
            workspace.add_table_metadata(_table(name))
        except Exception as exc:
            errors.append(exc)

    threads = [
        threading.Thread(target=add_table, args=(first, "first")),
        threading.Thread(target=add_table, args=(second, "second")),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert not errors
    raw = store.get_blob_client("workspace/workspace.yaml").download_blob().readall()
    persisted = yaml.safe_load(raw)
    assert set(persisted["tables"]) == {"first", "second"}
