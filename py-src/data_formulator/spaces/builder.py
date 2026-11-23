# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The steps every shipped space's ``build.py`` shares; see ``data_formulator/spaces/README.md``.

A space's build makes its datasets' sessions (the starters) its own way: the UIS space from downloaded
files, NeurIPS from its collected dataset. Everything after that is the
same and lives here: the dataset sessions' tables recorded as loaded from the space's source (so they
show where they came from and refresh from it), the story sessions assembled from their seeds, and the
profile, guidance and images installed beside them.
"""

from __future__ import annotations

import io
import json
import shutil
import time
from pathlib import Path
from typing import Any, Callable

import pyarrow.parquet as pq

from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.security.code_signing import sign_code
from data_formulator.session_format import SESSION_STATE_VERSION
from data_formulator.spaces import referenced_files
from data_formulator.spaces.data_folder import folder_connector_id, folder_sources, write_data_folders

# Media types of the files a story seed carries, by suffix.
FILE_TYPES = {".map.json": "application/json", ".app.jsx": "text/jsx"}


class InstallError(Exception):
    """The space could not be installed (its data could not be read, or a file is missing)."""


def folder_source(profile: dict[str, Any], space_id: str, dataset_id: str) -> tuple[str, Callable[[str], str]]:
    """The space's data folder as a dataset's source: its connector id, and each table's path in it."""
    folders = folder_sources(profile)
    if not folders:
        raise InstallError("the profile has no `sources: [{folder: ...}]` for the datasets' tables")
    return folder_connector_id(space_id, str(folders[0]["folder"])), lambda table: f"{dataset_id}/{table}.parquet"


def dataset_state(workspace, starter: dict[str, Any], order: list[str], *, connector_id: str,
                  source_table: Callable[[str], str], loader_type: str,
                  display_names: dict[str, str] | None = None) -> dict[str, Any]:
    """A dataset session's state: its tables (in ``order``), each as loaded from ``connector_id``.

    Each table records its source table there (``source_table(name)``), in the workspace as in the session,
    as the sidebar records a table it loads, so the session shows its source and Refresh reads it again.
    """
    now = int(time.time() * 1000)
    metadata = workspace.get_metadata()
    input_tables = []
    for name in order:
        table = metadata.tables[name]
        path = source_table(name)
        table.loader_type, table.source_table = loader_type, path
        workspace.add_table_metadata(table)
        input_tables.append({
            "kind": "input-table", "id": name, "displayId": (display_names or {}).get(name, name),
            "source": {"kind": "connector", "connectorId": connector_id, "sourceTable": {"id": path, "name": name},
                       "path": path.split("/")[:-1], "workspaceTableId": name},
            "snapshot": {"columns": [{"name": c.name, "type": "number" if c.dtype in ("integer", "number") else "string"}
                                     for c in table.columns], "rowCount": table.row_count, "capturedAt": now},
            "description": table.description or "",
            "sourceConfig": {"type": "database", "connectorId": connector_id, "databaseTable": path,
                             "canRefresh": True, "lastRefreshed": now, "originalTableName": name},
            "addedAt": now,
        })
    return {"__stateVersion": SESSION_STATE_VERSION, "inputTables": input_tables,
            "workspaceItemOrder": [f"shelf-card-{name}" for name in order],
            "activeWorkspace": {"id": starter["id"], "displayName": starter["title"]}}


def save_session(workspace, state: dict[str, Any], target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(workspace.export_session_zip(state).getvalue())
    return target


def signed_here(table: dict[str, Any]) -> dict[str, Any]:
    """A seed's derived table with its code signed by this installation, so the app can refresh it.

    The seeds ship with Data Formulator, but the signatures they carry are the key of the machine that
    made them, which no other installation accepts.
    """
    derive = table.get("derive")
    if not isinstance(derive, dict) or not derive.get("code"):
        return table
    return {**table, "derive": {**derive, "codeSignature": sign_code(derive["code"])}}


def build_story(folder: Path, story: dict[str, Any], starter: dict[str, Any], work: Path, content: Path,
                theme_id: str | None = None) -> Path:
    """A story's session: its dataset's session with the story's seed (``<space>/stories/<id>/``: questions,
    answers, tables, maps and apps) added. With the space's chart theme (``theme_id``), the seed's charts are
    drawn in it, like charts made on the space."""
    seed = folder / "stories" / story["id"]
    state = json.loads((seed / "state.json").read_text(encoding="utf-8"))
    workspace = WorkspaceManager(work / "stories").create_and_open_workspace(story["id"], "local:site-builder")
    dataset = workspace.import_session_zip(io.BytesIO((content / starter["file"]).read_bytes()))
    for path in sorted(seed.glob("*.parquet")):
        workspace.write_parquet_from_arrow(pq.read_table(path), path.stem)
    # The story's maps and apps, as the analyst saves them: files it may revise when the visitor asks.
    titles = {node["path"]: node.get("displayName") for node in state.get("fileNodes") or []}
    for path in sorted((seed / "files").glob("*")):
        workspace.save_workspace_file(path.read_bytes(), path.name, FILE_TYPES.get("".join(path.suffixes[-2:])),
                                      display_name=titles.get(path.name), agent_managed=True)
    state = {**state, "derivedTables": [signed_here(table) for table in state.get("derivedTables") or []],
             "inputTables": dataset["inputTables"], "workspaceItemOrder": dataset["workspaceItemOrder"]}
    if theme_id:
        state["charts"] = [{**chart, "themeId": theme_id} if isinstance(chart, dict) else chart
                           for chart in state.get("charts") or []]
    return save_session(workspace, state, content / story["file"])


def build_stories(folder: Path, profile: dict[str, Any], starters: list[dict[str, Any]], work: Path, content: Path,
                  log: Callable[[str], None]) -> None:
    """Every story with a seed, of each built dataset in ``starters``; quick, so always assembled again."""
    theme_id = (profile.get("chart_theme") or {}).get("id")
    for starter in starters:
        if not (content / starter["file"]).is_file():
            continue
        for story in starter.get("stories") or []:
            if story.get("file") and (folder / "stories" / story["id"] / "state.json").is_file():
                target = build_story(folder, story, starter, work, content, theme_id)
                log(f"  story {story['id']} -> {target.name} ({target.stat().st_size / 2**20:.1f} MB)")


def install_static(folder: Path, profile: dict[str, Any], space: Path) -> None:
    """Copy the profile, the analyst's space guidance and front-page images into the installed space."""
    content = space / str(profile["release"])
    assets = folder / "assets"
    for path in sorted(assets.rglob("*")) if assets.is_dir() else []:
        if path.is_file():
            target = content / path.relative_to(assets)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    space.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(folder / "profile.yaml", space / "profile.yaml")
    (space / "skill").mkdir(exist_ok=True)
    shutil.copyfile(folder / "skill" / "SKILL.md", space / "skill" / "SKILL.md")


def missing_files(profile: dict[str, Any], content: Path) -> list[str]:
    return [name for name in referenced_files(profile) if not (content / name).is_file()]


def finish(folder: Path, profile: dict[str, Any], space: Path, *, log: Callable[[str], None]) -> Path:
    """Install the profile, guidance and images, write the data folders, and check nothing is missing."""
    content = space / str(profile["release"])
    install_static(folder, profile, space)
    write_data_folders(profile, content, log=log)
    missing = missing_files(profile, content)
    if missing:
        raise InstallError(f"missing from {content}: {', '.join(missing)}")
    log(f"{space.name}: installed in {space}")
    return space
