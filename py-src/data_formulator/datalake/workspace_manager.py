# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
WorkspaceManager — manages multiple workspaces per user.

Each workspace is a named folder containing:
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

    def list_workspaces(self) -> list[dict]:
        """
        List all workspaces (newest first).

        Returns list of {"id": str, "display_name": str, "updated_at": str}.
        """
        workspaces = []
        if not self._root.exists():
            return workspaces

        for child in self._root.iterdir():
            if not child.is_dir():
                continue
            ws_yaml = child / "workspace.yaml"
            sess_file = child / SESSION_STATE_FILENAME
            if not ws_yaml.exists() and not sess_file.exists():
                continue

            mtime = 0.0
            for f in [ws_yaml, sess_file]:
                if f.exists():
                    mtime = max(mtime, f.stat().st_mtime)

            # Try to read displayName from session_state.json
            display_name = child.name
            if sess_file.exists():
                try:
                    state = json.loads(sess_file.read_text(encoding="utf-8"))
                    aw = state.get("activeWorkspace")
                    if isinstance(aw, dict) and aw.get("displayName"):
                        display_name = aw["displayName"]
                except Exception:
                    pass

            workspaces.append({
                "id": child.name,
                "display_name": display_name,
                "updated_at": datetime.fromtimestamp(
                    mtime, tz=timezone.utc
                ).isoformat() if mtime > 0 else None,
            })

        workspaces.sort(key=lambda w: w.get("updated_at") or "", reverse=True)
        return workspaces

    def workspace_exists(self, workspace_id: str) -> bool:
        """Check if a workspace with the given ID exists."""
        safe = self._safe_id(workspace_id)
        ws_dir = self._root / safe
        return ws_dir.is_dir() and (
            (ws_dir / "workspace.yaml").exists()
            or (ws_dir / SESSION_STATE_FILENAME).exists()
        )

    def get_workspace_path(self, workspace_id: str) -> Path:
        """Get the filesystem path for a workspace."""
        return self._root / self._safe_id(workspace_id)

    def create_workspace(self, workspace_id: str) -> Path:
        """
        Create a new empty workspace.

        Returns the workspace directory path.
        Raises ValueError if a workspace with this ID already exists.
        """
        safe = self._safe_id(workspace_id)
        ws_dir = self._root / safe
        if ws_dir.exists():
            raise ValueError(f"Workspace '{workspace_id}' already exists")

        ws_dir.mkdir(parents=True)
        (ws_dir / "data").mkdir(exist_ok=True)

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
        logger.info(f"Renamed workspace '{old_safe}' → '{new_safe}'")
        return new_dir

    # ── Session state persistence ────────────────────────────────────

    def save_session_state(self, workspace_id: str, state: dict) -> None:
        """
        Save frontend state to session_state.json in a workspace.

        Sensitive fields are automatically stripped.
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
