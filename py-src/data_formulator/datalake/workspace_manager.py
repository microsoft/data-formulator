# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
WorkspaceManager — manages multiple workspaces per user.

Each workspace is a named folder containing:
  - workspace_meta.json: lightweight metadata for fast listing
  - workspace.yaml: all table metadata (single file)
  - session_state.json: auto-persisted frontend state
  - data/: data files (parquet, csv, etc.)

Users can create, list, open, delete, and switch workspaces.
"""

import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from werkzeug.utils import secure_filename

from data_formulator.datalake.workspace import Workspace

logger = logging.getLogger(__name__)

SESSION_STATE_FILENAME = "session_state.json"
WORKSPACE_META_FILENAME = "workspace_meta.json"

# Fields that must never be persisted (contain secrets / ephemeral info)
_SENSITIVE_FIELDS = frozenset([
    "models",
    "selectedModelId",
    "testedModels",
    "dataLoaderConnectParams",
    "identity",
    "agentRules",
    "serverConfig",
])


def _strip_sensitive(state: dict) -> dict:
    """Return a copy of *state* with sensitive / ephemeral fields removed."""
    return {k: v for k, v in state.items() if k not in _SENSITIVE_FIELDS}


class WorkspaceManager:
    """
    Manages the set of workspaces for a single user.

    Layout:
        <workspaces_root>/
          <workspace_id>/
            workspace_meta.json
            workspace.yaml
            session_state.json
            data/
    """

    def __init__(self, workspaces_root: Path):
        """
        Args:
            workspaces_root: Directory containing all workspaces for one user.
                             e.g. ~/.data_formulator/workspaces/<user_id>/
        """
        self._root = workspaces_root
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    @staticmethod
    def _safe_id(workspace_id: str) -> str:
        """Sanitize workspace ID for filesystem use."""
        safe = secure_filename(workspace_id)
        if not safe:
            safe = "unnamed"
        return safe

    def _write_meta(
        self,
        workspace_id: str,
        display_name: str,
        *,
        table_count: Optional[int] = None,
        chart_count: Optional[int] = None,
    ) -> None:
        """Write a lightweight ``workspace_meta.json`` used by list_workspaces."""
        safe = self._safe_id(workspace_id)
        meta_file = self._root / safe / WORKSPACE_META_FILENAME
        meta: dict = {
            "id": safe,
            "displayName": display_name,
            "updatedAt": datetime.now(tz=timezone.utc).isoformat(),
        }
        if table_count is not None:
            meta["tableCount"] = table_count
        if chart_count is not None:
            meta["chartCount"] = chart_count
        meta_file.write_text(
            json.dumps(meta, ensure_ascii=False), encoding="utf-8",
        )

    def _ensure_meta(self, workspace_id: str) -> dict:
        """Return the workspace_meta.json content, auto-creating it if missing.

        Legacy workspaces (created before workspace_meta.json was introduced)
        only have ``workspace.yaml`` and/or ``session_state.json``.  This
        method infers a display name from ``session_state.json`` when possible
        and writes a fresh ``workspace_meta.json`` so the workspace appears
        in :meth:`list_workspaces`.
        """
        safe = self._safe_id(workspace_id)
        ws_dir = self._root / safe
        meta_file = ws_dir / WORKSPACE_META_FILENAME

        if meta_file.exists():
            try:
                return json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        # Infer display name from session_state.json if available
        display_name = workspace_id
        state_file = ws_dir / SESSION_STATE_FILENAME
        if state_file.exists():
            try:
                state = json.loads(state_file.read_text(encoding="utf-8"))
                aw = state.get("activeWorkspace")
                if isinstance(aw, dict) and aw.get("displayName"):
                    display_name = aw["displayName"]
            except Exception:
                pass

        self._write_meta(workspace_id, display_name)
        logger.info("Auto-created workspace_meta.json for legacy workspace '%s'", safe)
        return json.loads(meta_file.read_text(encoding="utf-8"))

    def list_workspaces(self) -> list[dict]:
        """
        List all workspaces (newest first).

        Reads the lightweight ``workspace_meta.json`` (~150 bytes) per
        workspace.  If a workspace directory lacks this file (legacy),
        it is auto-repaired via :meth:`_ensure_meta`.

        Returns list of {"id": str, "display_name": str, "updated_at": str}.
        """
        workspaces = []
        if not self._root.exists():
            return workspaces

        for child in self._root.iterdir():
            if not child.is_dir():
                continue

            try:
                meta = self._ensure_meta(child.name)
            except Exception:
                continue

            workspaces.append({
                "id": child.name,
                "display_name": meta.get("displayName", child.name),
                "updated_at": meta.get("updatedAt"),
                "table_count": meta.get("tableCount"),
                "chart_count": meta.get("chartCount"),
            })

        workspaces.sort(key=lambda w: w.get("updated_at") or "", reverse=True)
        return workspaces

    def workspace_exists(self, workspace_id: str) -> bool:
        """Check if a workspace with the given ID exists.

        A workspace exists if and only if its directory exists.
        """
        safe = self._safe_id(workspace_id)
        return (self._root / safe).is_dir()

    def get_workspace_path(self, workspace_id: str) -> Path:
        """Get the filesystem path for a workspace."""
        return self._root / self._safe_id(workspace_id)

    def move_workspaces_from(self, source_root: Path) -> list[str]:
        """Copy all workspaces from *source_root* into this manager's root.

        Uses copy-then-delete semantics so that the operation succeeds even
        when the source files are locked by another process (common on
        Windows when the anonymous workspace is still open).

        - New workspaces are copied via ``shutil.copytree``.
        - Existing workspaces are merged (new data files + metadata).
        - Source removal is best-effort; locked files are left for later
          cleanup by ``delete_all_workspaces``.

        Returns the list of workspace IDs that were copied/merged.
        """
        moved: list[str] = []
        if not source_root.exists():
            return moved

        for child in source_root.iterdir():
            if not child.is_dir():
                continue
            dest = self._root / child.name
            if dest.exists():
                self._merge_workspace(child, dest)
                logger.info("Merged workspace '%s' from %s", child.name, source_root)
            else:
                shutil.copytree(str(child), str(dest))
                logger.info("Copied workspace '%s' from %s", child.name, source_root)

            # Ensure the destination has workspace_meta.json (source may be legacy)
            self._ensure_meta(child.name)
            moved.append(child.name)

            # Best-effort source removal; on Windows files may still be
            # locked by the current process and will be cleaned up later.
            try:
                shutil.rmtree(child)
            except OSError as exc:
                logger.warning(
                    "Could not remove source workspace '%s' (will retry later): %s",
                    child.name, exc,
                )

        return moved

    @staticmethod
    def _merge_workspace(src: Path, dest: Path) -> None:
        """Merge data files and metadata from *src* workspace into *dest*."""
        src_data = src / "data"
        dest_data = dest / "data"
        dest_data.mkdir(exist_ok=True)

        if src_data.is_dir():
            for f in src_data.iterdir():
                target = dest_data / f.name
                if not target.exists():
                    shutil.copy2(str(f), str(target))

        src_yaml = src / "workspace.yaml"
        dest_yaml = dest / "workspace.yaml"
        if src_yaml.exists() and dest_yaml.exists():
            try:
                import yaml
                src_meta = yaml.safe_load(src_yaml.read_text(encoding="utf-8")) or {}
                dest_meta = yaml.safe_load(dest_yaml.read_text(encoding="utf-8")) or {}
                src_tables = src_meta.get("tables", {})
                dest_tables = dest_meta.get("tables", {})
                for name, entry in src_tables.items():
                    if name not in dest_tables:
                        dest_tables[name] = entry
                dest_meta["tables"] = dest_tables
                dest_yaml.write_text(
                    yaml.dump(dest_meta, allow_unicode=True, default_flow_style=False),
                    encoding="utf-8",
                )
            except Exception as exc:
                logger.warning("Failed to merge workspace.yaml: %s", exc)
        elif src_yaml.exists():
            shutil.copy2(str(src_yaml), str(dest_yaml))

        src_ws_meta = src / WORKSPACE_META_FILENAME
        dest_ws_meta = dest / WORKSPACE_META_FILENAME
        if src_ws_meta.exists() and not dest_ws_meta.exists():
            shutil.copy2(str(src_ws_meta), str(dest_ws_meta))

    def delete_all_workspaces(self) -> int:
        """Delete every workspace under this manager's root.

        Returns the number of entries deleted (or attempted).
        On Windows, locked files are skipped with a warning.
        """
        count = 0
        if not self._root.exists():
            return count
        for child in list(self._root.iterdir()):
            try:
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink(missing_ok=True)
                count += 1
                logger.info("Deleted workspace entry '%s' during cleanup", child.name)
            except OSError as exc:
                logger.warning("Could not delete '%s' (file locked?): %s", child.name, exc)
        return count

    def create_workspace(self, workspace_id: str) -> Path:
        """
        Create a new empty workspace.

        Returns the workspace directory path.
        Raises ValueError if the workspace already exists.
        """
        if self.workspace_exists(workspace_id):
            raise ValueError(f"Workspace '{workspace_id}' already exists")

        safe = self._safe_id(workspace_id)
        ws_dir = self._root / safe
        ws_dir.mkdir(parents=True, exist_ok=True)
        (ws_dir / "data").mkdir(exist_ok=True)
        self._write_meta(workspace_id, "Untitled Session")

        logger.info(f"Created workspace '{safe}' at {ws_dir}")
        return ws_dir

    def open_workspace(self, workspace_id: str, identity_id: str) -> Workspace:
        """
        Open an existing workspace and return a Workspace instance.

        Args:
            workspace_id: Workspace ID (folder name).
            identity_id: User identity (passed through to Workspace for compatibility).

        Returns:
            Workspace instance rooted at the workspace folder.

        Raises:
            ValueError: If the workspace does not exist.
        """
        safe = self._safe_id(workspace_id)
        ws_dir = self._root / safe
        if not ws_dir.exists():
            raise ValueError(f"Workspace '{workspace_id}' does not exist")

        return Workspace(identity_id, workspace_path=ws_dir)

    def create_and_open_workspace(self, workspace_id: str, identity_id: str) -> Workspace:
        """Create a new workspace and return an open Workspace instance."""
        ws_dir = self.create_workspace(workspace_id)
        return Workspace(identity_id, workspace_path=ws_dir)

    def delete_workspace(self, workspace_id: str) -> bool:
        """
        Delete a workspace and all its contents.

        Returns True if the workspace existed and was deleted.
        """
        safe = self._safe_id(workspace_id)
        ws_dir = self._root / safe
        if not ws_dir.exists():
            return False

        shutil.rmtree(ws_dir)
        logger.info(f"Deleted workspace '{safe}'")
        return True

    def rename_workspace(self, old_id: str, new_id: str) -> Path:
        """
        Rename a workspace (change its folder ID).

        Returns the new workspace directory path.
        Raises ValueError if old doesn't exist or new already exists.
        """
        old_safe = self._safe_id(old_id)
        new_safe = self._safe_id(new_id)
        old_dir = self._root / old_safe
        new_dir = self._root / new_safe

        if not old_dir.exists():
            raise ValueError(f"Workspace '{old_id}' does not exist")
        if new_dir.exists():
            raise ValueError(f"Workspace '{new_id}' already exists")

        old_dir.rename(new_dir)

        meta_file = new_dir / WORKSPACE_META_FILENAME
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                meta["id"] = new_safe
                meta_file.write_text(
                    json.dumps(meta, ensure_ascii=False), encoding="utf-8",
                )
            except Exception:
                pass

        logger.info(f"Renamed workspace '{old_safe}' → '{new_safe}'")
        return new_dir

    def update_display_name(self, workspace_id: str, display_name: str) -> None:
        """Update only the displayName in workspace_meta.json (no full state write)."""
        safe = self._safe_id(workspace_id)
        meta_file = self._root / safe / WORKSPACE_META_FILENAME
        if not meta_file.exists():
            self._write_meta(workspace_id, display_name)
            return
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
        meta["displayName"] = display_name
        meta["updatedAt"] = datetime.now(tz=timezone.utc).isoformat()
        meta_file.write_text(
            json.dumps(meta, ensure_ascii=False), encoding="utf-8",
        )

    # ── Session state persistence ────────────────────────────────────

    def save_session_state(self, workspace_id: str, state: dict) -> None:
        """
        Save frontend state to session_state.json in a workspace.

        Sensitive fields are automatically stripped.  Also updates the
        lightweight ``workspace_meta.json`` used by :meth:`list_workspaces`.
        """
        safe = self._safe_id(workspace_id)
        ws_dir = self._root / safe
        if not ws_dir.exists():
            raise ValueError(f"Workspace '{workspace_id}' does not exist")

        clean_state = _strip_sensitive(state)
        state_file = ws_dir / SESSION_STATE_FILENAME
        state_file.write_text(
            json.dumps(clean_state, default=str, ensure_ascii=False),
            encoding="utf-8",
        )

        aw = clean_state.get("activeWorkspace")
        dn = aw["displayName"] if isinstance(aw, dict) and aw.get("displayName") else workspace_id
        tables = clean_state.get("tables")
        tc = len(tables) if isinstance(tables, list) else None
        charts = clean_state.get("charts")
        cc = len(charts) if isinstance(charts, list) else None
        self._write_meta(workspace_id, dn, table_count=tc, chart_count=cc)

        logger.debug(f"Saved session state to {state_file}")

    def load_session_state(self, workspace_id: str) -> Optional[dict]:
        """
        Load frontend state from session_state.json in a workspace.

        Returns None if the workspace or state file doesn't exist.
        """
        safe = self._safe_id(workspace_id)
        state_file = self._root / safe / SESSION_STATE_FILENAME
        if not state_file.exists():
            return None

        return json.loads(state_file.read_text(encoding="utf-8"))
