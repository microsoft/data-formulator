# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A demo's datasets: what each one holds, read from its installed session ZIP, and loading
them into the visitor's session (design-docs/69).

A dataset is one profile ``starter`` whose session ZIP (``file``) is installed. Loading copies
its tables, with their descriptions, and its files (data guide, docs) into the session.
Datasets can share tables (the UIS ones all carry ``countries``): a table already in the
session is kept, and loaded only once. A file already there with other content is placed
under ``<dataset id>/``.
"""

from __future__ import annotations

import io
import logging
import zipfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from data_formulator.sites import site_content_dir, site_profile

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DatasetTable:
    name: str
    rows: int
    description: str
    filename: str


@dataclass(frozen=True)
class DatasetFile:
    path: str
    media_type: str | None


@dataclass(frozen=True)
class DemoDataset:
    id: str
    title: str
    kicker: str
    description: str
    path: Path
    tables: tuple[DatasetTable, ...]
    files: tuple[DatasetFile, ...]


@dataclass
class LoadResult:
    """What one ``load_datasets`` call did, per dataset id."""

    loaded: dict[str, list[DatasetTable]] = field(default_factory=dict)
    present: dict[str, list[str]] = field(default_factory=dict)
    files: dict[str, list[str]] = field(default_factory=dict)
    # Files this call copied in (not ones the session already had), with their content hash.
    copied_files: list[tuple[str, str]] = field(default_factory=list)
    unknown: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)

    @property
    def table_names(self) -> list[str]:
        return [table.name for tables in self.loaded.values() for table in tables]


def _read_manifest(path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(path) as archive:
        manifest = yaml.safe_load(archive.read("workspace/workspace.yaml")) or {}
    return manifest if isinstance(manifest, dict) else {}


@lru_cache(maxsize=64)
def _dataset(site_id: str, starter_id: str, path: str, mtime: float) -> DemoDataset | None:
    """One installed dataset; cached until its ZIP changes (``mtime`` is part of the key)."""
    starter = next((item for item in (site_profile(site_id) or {}).get("starters") or []
                    if item.get("id") == starter_id), None)
    if starter is None:
        return None
    try:
        manifest = _read_manifest(Path(path))
    except (OSError, KeyError, zipfile.BadZipFile, yaml.YAMLError) as exc:
        logger.error("Demo %r: cannot read dataset %r (%s): %s", site_id, starter_id, path, exc)
        return None
    tables = tuple(
        DatasetTable(name=str(name), rows=int(entry.get("row_count") or 0),
                     description=str(entry.get("description") or "").strip(), filename=str(entry.get("filename") or ""))
        for name, entry in (manifest.get("tables") or {}).items() if isinstance(entry, dict) and entry.get("filename"))
    files = tuple(
        DatasetFile(path=str(name), media_type=entry.get("media_type"))
        for name, entry in (manifest.get("files") or {}).items() if isinstance(entry, dict))
    return DemoDataset(
        id=starter_id, title=str(starter.get("title") or starter_id), kicker=str(starter.get("kicker") or ""),
        description=" ".join(str(starter.get("description") or "").split()), path=Path(path),
        tables=tables, files=files)


def demo_datasets(site_id: str) -> list[DemoDataset]:
    """The demo's installed datasets, in profile order."""
    profile = site_profile(site_id)
    if not profile:
        return []
    content = site_content_dir(site_id)
    datasets = []
    for starter in profile.get("starters") or []:
        name = str(starter.get("file") or "")
        path = content / name
        if not name or not path.is_file():
            continue
        dataset = _dataset(site_id, str(starter.get("id")), str(path), path.stat().st_mtime)
        if dataset is not None:
            datasets.append(dataset)
    return datasets


def shared_tables(datasets: list[DemoDataset]) -> set[str]:
    """Tables more than one dataset carries."""
    seen: dict[str, int] = {}
    for dataset in datasets:
        for table in dataset.tables:
            seen[table.name] = seen.get(table.name, 0) + 1
    return {name for name, count in seen.items() if count > 1}


def load_datasets(workspace: Any, site_id: str, ids: list[str]) -> LoadResult:
    """Copy the named datasets' tables and files into ``workspace``."""
    import pyarrow.parquet as pq

    datasets = {dataset.id: dataset for dataset in demo_datasets(site_id)}
    result = LoadResult()
    requested = list(dict.fromkeys(str(item).strip() for item in ids if str(item).strip()))
    result.unknown = [item for item in requested if item not in datasets]
    metadata = workspace.get_metadata()
    tables_present = set(metadata.tables) if metadata else set()
    files_present = {name: item.content_hash for name, item in (metadata.files if metadata else {}).items()}

    for dataset_id in (item for item in requested if item in datasets):
        dataset = datasets[dataset_id]
        loaded, present, files = [], [], []
        try:
            with zipfile.ZipFile(dataset.path) as archive:
                for table in dataset.tables:
                    if table.name in tables_present:
                        present.append(table.name)
                        continue
                    arrow = pq.read_table(io.BytesIO(archive.read(f"workspace/data/{table.filename}")))
                    table_metadata = workspace.write_parquet_from_arrow(arrow, table.name)
                    table_metadata.description = table.description or None
                    workspace.add_table_metadata(table_metadata)
                    tables_present.add(table_metadata.name)
                    loaded.append(table)
                for item in dataset.files:
                    files.extend(_copy_file(workspace, archive, dataset.id, item, files_present, result.copied_files))
        except (OSError, KeyError, ValueError, zipfile.BadZipFile) as exc:
            logger.exception("Demo %r: loading dataset %r failed", site_id, dataset_id)
            result.failed[dataset_id] = str(exc)
        result.loaded[dataset_id] = loaded
        result.present[dataset_id] = present
        result.files[dataset_id] = files
    return result


def _copy_file(workspace: Any, archive: zipfile.ZipFile, dataset_id: str, item: DatasetFile,
               files_present: dict[str, str], copied: list[tuple[str, str]]) -> list[str]:
    """Copy one file unless the session already has it; returns where it is in the session."""
    import hashlib

    content = archive.read(f"workspace/files/{item.path}")
    digest = hashlib.sha256(content).hexdigest()
    for target in (item.path, f"{dataset_id}/{item.path}"):
        # A file of the same name with other content is another dataset's (each has its own data guide).
        if target not in files_present:
            saved = workspace.save_workspace_file(content, target, item.media_type)
            files_present[saved.name] = digest
            copied.append((saved.name, digest))
            return [saved.name]
        if files_present[target] == digest:
            return [target]
    return []
