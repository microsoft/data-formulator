# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A demo's bundled data folders: the profile's ``sources: [{folder: <name>, name: <label>}]``.

Installing a demo extracts each installed dataset's tables (its session ZIP's parquet files) into
``<release>/<folder>/<dataset id>/<table>.parquet`` (``write_data_folders``). On the demo, the server
offers the folder as a read-only source, as a linked local folder is in the standard app
(``data_connector._sync_demo_folder_connectors``).
"""

from __future__ import annotations

import re
import shutil
import zipfile
from pathlib import Path
from typing import Any, Callable

import yaml

# A folder in the release, a dataset id and a table name all become path parts: plain names only.
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$")


def folder_sources(profile: dict[str, Any]) -> list[dict[str, Any]]:
    return [source for source in profile.get("sources") or [] if isinstance(source, dict) and "folder" in source]


def folder_connector_id(site_id: str, folder: str) -> str:
    return f"demo-{site_id}-{folder}"


def write_data_folders(profile: dict[str, Any], content: Path, *, log: Callable[[str], None] = print) -> None:
    """Write each folder source of ``profile`` from the datasets installed in ``content`` (the release folder)."""
    for source in folder_sources(profile):
        folder = str(source["folder"])
        target = content / folder
        staging = content / f".{folder}.partial"
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        count = 0
        for starter in profile.get("starters") or []:
            dataset_id, name = str(starter.get("id") or ""), str(starter.get("file") or "")
            archive_path = content / name
            if not SAFE_NAME.fullmatch(dataset_id) or not name or not archive_path.is_file():
                continue
            with zipfile.ZipFile(archive_path) as archive:
                manifest = yaml.safe_load(archive.read("workspace/workspace.yaml")) or {}
                for table, entry in (manifest.get("tables") or {}).items():
                    if not isinstance(entry, dict) or not entry.get("filename") or not SAFE_NAME.fullmatch(str(table)):
                        continue
                    out = staging / dataset_id / f"{table}.parquet"
                    out.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(f"workspace/data/{entry['filename']}") as src, open(out, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    count += 1
        shutil.rmtree(target, ignore_errors=True)
        staging.rename(target)
        log(f"  {folder}/: {count} tables")
