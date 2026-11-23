# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""One-time changes to a workspace's files when the layout or format moves on.

Each step has a name and runs once per workspace, when the workspace opens: applied steps are recorded in
``_internal/migrations.json``, so a later open reads one small file. Steps are idempotent, so a lost record (an
imported session replaces the whole workspace) only means they run again and find nothing to do. Add a step to
``STEPS`` for the next layout change; never rename or reorder existing ones.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any, Callable

from data_formulator.datalake.workspace_metadata import WorkspaceLock

logger = logging.getLogger(__name__)

INTERNAL_DIR = "_internal"
RECORD = "migrations.json"

# What older versions kept in scratch/, and where it lives in _internal/ now (design-docs/73).
SCRATCH_INTERNALS = {
    "_agent": "agent",
    "_explore_ns": "explore_ns",
    "_workflow_runs": "workflow_runs",
    ".display_names": "display_names",
    "data_operations": "data_operations",
}
# Leftovers in scratch/ nothing reads any more: a lock file and an old terminal runtime.
SCRATCH_LEFTOVERS = (".workspace.lock", "_terminal_tmp", "_terminal_cache")


def _merge_move(source: Path, target: Path) -> None:
    """Move ``source`` to ``target``; when both are folders, move what ``target`` lacks and keep its own."""
    if source.is_symlink():
        source.unlink()
        return
    if not target.exists() and not target.is_symlink():
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, target)
        return
    if source.is_dir() and target.is_dir() and not target.is_symlink():
        for child in list(source.iterdir()):
            _merge_move(child, target / child.name)
        try:
            source.rmdir()
        except OSError:
            pass


def migrate_scratch_internals(scratch: Path, internal: Path) -> None:
    """Move the app's state out of ``scratch/`` into ``internal`` (idempotent)."""
    for old, new in SCRATCH_INTERNALS.items():
        source = scratch / old
        if source.exists() or source.is_symlink():
            try:
                _merge_move(source, internal / new)
            except OSError:
                logger.warning("Could not move scratch/%s to %s/%s", old, INTERNAL_DIR, new, exc_info=True)
    for name in SCRATCH_LEFTOVERS:
        leftover = scratch / name
        try:
            if leftover.is_dir() and not leftover.is_symlink():
                shutil.rmtree(leftover)
            elif leftover.exists() or leftover.is_symlink():
                leftover.unlink()
        except OSError:
            logger.debug("Could not remove scratch/%s", name, exc_info=True)


def _scratch_internals(workspace: Any) -> None:
    """scratch/ holds only the agent's and the user's files (design-docs/73)."""
    migrate_scratch_internals(workspace.confined_scratch.root, workspace.confined_internal.root)


def _legacy_memory(workspace: Any) -> None:
    """Legacy memory becomes ordinary files under memory/ (design-docs/65)."""
    workspace.migrate_legacy_memory()


STEPS: tuple[tuple[str, Callable[[Any], None]], ...] = (
    ("scratch-internals", _scratch_internals),
    ("legacy-memory", _legacy_memory),
)


def _applied(internal: Any) -> set[str]:
    try:
        record = json.loads(internal.read_text(RECORD))
        return {name for name in record.get("applied", []) if isinstance(name, str)}
    except (OSError, ValueError, AttributeError, TypeError):
        return set()


def run_workspace_migrations(workspace: Any) -> list[str]:
    """Run the steps this workspace has not had yet; returns the names applied now."""
    internal = getattr(workspace, "confined_internal", None)
    if internal is None or not {name for name, _ in STEPS} - _applied(internal):
        return []
    applied: list[str] = []
    try:
        with WorkspaceLock(internal.root):
            done = _applied(internal)
            for name, step in STEPS:
                if name in done:
                    continue
                try:
                    step(workspace)
                except Exception:
                    logger.warning("Workspace migration %s failed; it runs again on the next open", name, exc_info=True)
                    continue
                done.add(name)
                applied.append(name)
            if applied:
                path = internal.root / RECORD
                temporary = path.with_name(f".{RECORD}.{os.getpid()}.tmp")
                temporary.write_text(json.dumps({"applied": [name for name, _ in STEPS if name in done]}),
                                     encoding="utf-8")
                os.replace(temporary, path)
    except OSError:
        logger.warning("Could not run workspace migrations", exc_info=True)
    return applied
