# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""TTL-managed local workspaces for anonymous/demo deployments.

``WORKSPACE_BACKEND=ephemeral`` uses the normal on-disk workspace format, but
stores it under a separate root and removes inactive workspaces after a
configurable TTL. A global LRU byte cap provides a second storage bound.
Durable ``local`` workspaces never pass through this module.
"""

import json
import logging
import os
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from data_formulator.datalake.workspace import Workspace, get_data_formulator_home
from data_formulator.datalake.workspace_manager import WORKSPACE_META_FILENAME, WorkspaceManager

logger = logging.getLogger(__name__)

_CLEANUP_LOCK = threading.RLock()
_LAST_CLEANUP_AT = 0.0


def _positive_float_env(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        logger.warning("Invalid %s; using default %s", name, default)
        return default


def get_ephemeral_root() -> Path:
    """Return the root reserved for TTL-managed ephemeral workspaces."""
    configured = os.getenv("EPHEMERAL_WORKSPACE_ROOT")
    return Path(configured).expanduser() if configured else get_data_formulator_home() / "ephemeral"


def get_ephemeral_workspaces_root(identity_id: str) -> Path:
    safe_identity = Workspace._sanitize_identity_id(identity_id)
    return get_ephemeral_root() / "users" / safe_identity / "workspaces"


def _workspace_updated_at(workspace_dir: Path) -> float:
    meta_file = workspace_dir / WORKSPACE_META_FILENAME
    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        values = [meta.get("lastAccessedAt"), meta.get("updatedAt")]
        timestamps = [
            datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            for value in values
            if value
        ]
        if timestamps:
            return max(timestamps)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass
    return workspace_dir.stat().st_mtime


def _directory_size(path: Path) -> int:
    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            continue
    return total


def _workspace_directories(root: Path) -> list[Path]:
    users_root = root / "users"
    if not users_root.exists():
        return []
    return [
        workspace_dir
        for workspaces_root in users_root.glob("*/workspaces")
        if workspaces_root.is_dir()
        for workspace_dir in workspaces_root.iterdir()
        if workspace_dir.is_dir()
    ]


def _tombstone_path(root: Path, identity_dir: str, workspace_id: str) -> Path:
    return root / "tombstones" / identity_dir / f"{workspace_id}.json"


def _write_tombstone(root: Path, workspace_dir: Path, reason: str) -> None:
    identity_dir = workspace_dir.parent.parent.name
    tombstone = _tombstone_path(root, identity_dir, workspace_dir.name)
    tombstone.parent.mkdir(parents=True, exist_ok=True)
    tombstone.write_text(json.dumps({
        "workspaceId": workspace_dir.name,
        "evictedAt": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
    }), encoding="utf-8")


def cleanup_ephemeral_workspaces(*, force: bool = False) -> int:
    """Remove expired workspaces, then enforce the global LRU byte cap."""
    global _LAST_CLEANUP_AT

    root = get_ephemeral_root()
    interval_seconds = _positive_float_env("EPHEMERAL_WORKSPACE_CLEANUP_INTERVAL_SECONDS", 1800)
    now = time.time()

    with _CLEANUP_LOCK:
        if not force and now - _LAST_CLEANUP_AT < interval_seconds:
            return 0
        _LAST_CLEANUP_AT = now

        ttl_seconds = _positive_float_env("EPHEMERAL_WORKSPACE_TTL_HOURS", 24) * 3600
        removed = 0
        retained: list[tuple[Path, float, int]] = []

        for workspace_dir in _workspace_directories(root):
            try:
                updated_at = _workspace_updated_at(workspace_dir)
                if ttl_seconds > 0 and now - updated_at >= ttl_seconds:
                    _write_tombstone(root, workspace_dir, "ttl")
                    shutil.rmtree(workspace_dir)
                    removed += 1
                    logger.info("Expired ephemeral workspace: %s", workspace_dir)
                    continue
                retained.append((workspace_dir, updated_at, _directory_size(workspace_dir)))
            except OSError:
                logger.warning("Failed to inspect ephemeral workspace %s", workspace_dir, exc_info=True)

        max_bytes = int(_positive_float_env("EPHEMERAL_WORKSPACE_MAX_BYTES", 10 * 1024**3))
        total_bytes = sum(size for _, _, size in retained)
        if max_bytes > 0 and total_bytes > max_bytes:
            for workspace_dir, _, size in sorted(retained, key=lambda entry: entry[1]):
                try:
                    _write_tombstone(root, workspace_dir, "lru")
                    shutil.rmtree(workspace_dir)
                    total_bytes -= size
                    removed += 1
                    logger.info("LRU-evicted ephemeral workspace: %s", workspace_dir)
                except OSError:
                    logger.warning("Failed to evict ephemeral workspace %s", workspace_dir, exc_info=True)
                if total_bytes <= max_bytes:
                    break

        return removed


class EphemeralWorkspaceManager(WorkspaceManager):
    """Standard local workspace manager with ephemeral retention semantics."""

    def __init__(self, identity_id: str):
        cleanup_ephemeral_workspaces()
        self._identity_dir = Workspace._sanitize_identity_id(identity_id)
        super().__init__(get_ephemeral_workspaces_root(identity_id))

    def workspace_was_evicted(self, workspace_id: str) -> bool:
        safe_id = self._safe_id(workspace_id)
        return _tombstone_path(get_ephemeral_root(), self._identity_dir, safe_id).exists()

    def _touch(self, workspace_id: str) -> None:
        meta_file = self.get_workspace_path(workspace_id) / WORKSPACE_META_FILENAME
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            meta["lastAccessedAt"] = datetime.now(timezone.utc).isoformat()
            meta_file.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        except (OSError, json.JSONDecodeError):
            logger.warning("Failed to update ephemeral workspace access time", exc_info=True)

    def open_workspace(self, workspace_id: str, identity_id: str) -> Workspace:
        workspace = super().open_workspace(workspace_id, identity_id)
        self._touch(workspace_id)
        return workspace

    def load_session_state(self, workspace_id: str) -> dict | None:
        state = super().load_session_state(workspace_id)
        if state is not None:
            self._touch(workspace_id)
        return state
