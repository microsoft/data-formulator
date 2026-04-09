# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
AzureBlobWorkspaceManager — manages multiple workspaces per user on Azure Blob Storage.

Extends WorkspaceManager, overriding storage operations to use Azure Blob
instead of the local filesystem. Same interface, different backend.

Layout (blob prefixes):
    <datalake_root>/users/<safe_id>/workspaces/<workspace_id>/
      workspace.yaml
      session_state.json
      data/
        <table>.parquet
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING

from data_formulator.datalake.workspace_manager import (
    WorkspaceManager,
    SESSION_STATE_FILENAME,
    _strip_sensitive,
)

if TYPE_CHECKING:
    from azure.storage.blob import ContainerClient

logger = logging.getLogger(__name__)


class AzureBlobWorkspaceManager(WorkspaceManager):
    """
    Manages workspaces stored as blob prefixes in Azure Blob Storage.

    Inherits _safe_id, rename_workspace (raises NotImplementedError for now),
    and the method signatures from WorkspaceManager.
    """

    def __init__(
        self,
        container_client: "ContainerClient",
        workspaces_blob_prefix: str,
    ):
        """
        Args:
            container_client: Authenticated Azure ContainerClient.
            workspaces_blob_prefix: Blob prefix for this user's workspaces,
                e.g. "workspaces/users/user_123/workspaces/"
        """
        # Don't call super().__init__ — it expects a filesystem Path
        self._container = container_client
        self._blob_prefix = workspaces_blob_prefix.rstrip("/") + "/"

    @property
    def root(self):
        """Not a filesystem path — returns the blob prefix."""
        return self._blob_prefix

    # ── Blob helpers ─────────────────────────────────────────────────

    def _ws_prefix(self, workspace_id: str) -> str:
        """Blob prefix for a specific workspace."""
        safe = self._safe_id(workspace_id)
        return f"{self._blob_prefix}{safe}/"

    def _blob_name(self, workspace_id: str, filename: str) -> str:
        """Full blob name for a file within a workspace."""
        return f"{self._ws_prefix(workspace_id)}{filename}"

    def _blob_exists(self, blob_name: str) -> bool:
        from azure.core.exceptions import ResourceNotFoundError
        try:
            self._container.get_blob_client(blob_name).get_blob_properties()
            return True
        except ResourceNotFoundError:
            return False

    def _upload_blob(self, blob_name: str, data: bytes | str) -> None:
        if isinstance(data, str):
            data = data.encode("utf-8")
        self._container.get_blob_client(blob_name).upload_blob(
            data, overwrite=True
        )

    def _download_blob(self, blob_name: str) -> bytes:
        return self._container.download_blob(blob_name).readall()

    def _delete_blobs_with_prefix(self, prefix: str) -> int:
        """Delete all blobs under a prefix. Returns count deleted."""
        count = 0
        for blob in self._container.list_blobs(name_starts_with=prefix):
            self._container.delete_blob(blob.name)
            count += 1
        return count

    def _list_workspace_prefixes(self) -> list[str]:
        """List unique workspace ID prefixes under the user's workspaces root."""
        prefix_len = len(self._blob_prefix)
        seen = set()
        for blob in self._container.list_blobs(name_starts_with=self._blob_prefix):
            # Extract workspace_id from: <prefix><ws_id>/...
            rel = blob.name[prefix_len:]
            ws_id = rel.split("/")[0]
            if ws_id and ws_id not in seen:
                seen.add(ws_id)
        return sorted(seen)

    # ── WorkspaceManager overrides ───────────────────────────────────

    def list_workspaces(self) -> list[dict]:
        """List all workspaces (newest first)."""
        workspaces = []
        for ws_id in self._list_workspace_prefixes():
            display_name = ws_id
            updated_at = None

            # Try to read displayName from session_state.json
            sess_blob = self._blob_name(ws_id, SESSION_STATE_FILENAME)
            if self._blob_exists(sess_blob):
                try:
                    data = json.loads(self._download_blob(sess_blob))
                    aw = data.get("activeWorkspace")
                    if isinstance(aw, dict) and aw.get("displayName"):
                        display_name = aw["displayName"]
                except Exception:
                    pass

            # Get updated_at from workspace.yaml blob properties
            yaml_blob = self._blob_name(ws_id, "workspace.yaml")
            try:
                props = self._container.get_blob_client(yaml_blob).get_blob_properties()
                updated_at = props.last_modified.isoformat() if props.last_modified else None
            except Exception:
                # Try session_state.json as fallback
                try:
                    props = self._container.get_blob_client(sess_blob).get_blob_properties()
                    updated_at = props.last_modified.isoformat() if props.last_modified else None
                except Exception:
                    pass

            workspaces.append({
                "id": ws_id,
                "display_name": display_name,
                "updated_at": updated_at,
            })

        workspaces.sort(key=lambda w: w.get("updated_at") or "", reverse=True)
        return workspaces

    def workspace_exists(self, workspace_id: str) -> bool:
        """Check if a workspace exists (has a workspace.yaml or session_state.json blob)."""
        ws_prefix = self._ws_prefix(workspace_id)
        yaml_blob = f"{ws_prefix}workspace.yaml"
        sess_blob = f"{ws_prefix}{SESSION_STATE_FILENAME}"
        return self._blob_exists(yaml_blob) or self._blob_exists(sess_blob)

    def get_workspace_path(self, workspace_id: str):
        """Returns the blob prefix (not a filesystem path)."""
        return self._ws_prefix(workspace_id)

    def create_workspace(self, workspace_id: str) -> str:
        """
        Create a new empty workspace by uploading an initial workspace.yaml.

        Returns the workspace blob prefix.
        Raises ValueError if the workspace already exists.
        """
        if self.workspace_exists(workspace_id):
            raise ValueError(f"Workspace '{workspace_id}' already exists")

        # Upload a minimal workspace.yaml to mark the workspace as existing
        from data_formulator.datalake.workspace_metadata import WorkspaceMetadata
        meta = WorkspaceMetadata.create_new()
        import yaml
        yaml_content = yaml.safe_dump(
            meta.to_dict(), default_flow_style=False, allow_unicode=True, sort_keys=False
        )
        yaml_blob = self._blob_name(workspace_id, "workspace.yaml")
        self._upload_blob(yaml_blob, yaml_content)

        safe = self._safe_id(workspace_id)
        logger.info(f"Created Azure workspace '{safe}' at {self._ws_prefix(workspace_id)}")
        return self._ws_prefix(workspace_id)

    def open_workspace(self, workspace_id: str, identity_id: str):
        """Open a workspace and return an AzureBlobWorkspace (or cached variant)."""
        if not self.workspace_exists(workspace_id):
            raise ValueError(f"Workspace '{workspace_id}' does not exist")

        from data_formulator.datalake.azure_blob_workspace import AzureBlobWorkspace
        return AzureBlobWorkspace(
            identity_id,
            self._container,
            blob_prefix=self._ws_prefix(workspace_id),
        )

    def create_and_open_workspace(self, workspace_id: str, identity_id: str):
        """Create a new workspace and return an open workspace instance."""
        self.create_workspace(workspace_id)
        return self.open_workspace(workspace_id, identity_id)

    def delete_workspace(self, workspace_id: str) -> bool:
        """Delete all blobs under the workspace prefix."""
        ws_prefix = self._ws_prefix(workspace_id)
        count = self._delete_blobs_with_prefix(ws_prefix)
        if count > 0:
            logger.info(f"Deleted Azure workspace '{workspace_id}' ({count} blobs)")
            return True
        return False

    def rename_workspace(self, old_id: str, new_id: str):
        """Rename not supported for Azure Blob (no atomic rename for prefixes)."""
        raise NotImplementedError(
            "Workspace rename is not supported on Azure Blob Storage. "
            "Use display name changes instead."
        )

    # ── Session state persistence ────────────────────────────────────

    def save_session_state(self, workspace_id: str, state: dict) -> None:
        """Save frontend state to session_state.json blob."""
        if not self.workspace_exists(workspace_id):
            raise ValueError(f"Workspace '{workspace_id}' does not exist")

        clean_state = _strip_sensitive(state)
        blob_name = self._blob_name(workspace_id, SESSION_STATE_FILENAME)
        self._upload_blob(
            blob_name,
            json.dumps(clean_state, default=str, ensure_ascii=False),
        )
        logger.debug(f"Saved session state to blob {blob_name}")

    def load_session_state(self, workspace_id: str) -> Optional[dict]:
        """Load frontend state from session_state.json blob."""
        blob_name = self._blob_name(workspace_id, SESSION_STATE_FILENAME)
        if not self._blob_exists(blob_name):
            return None
        return json.loads(self._download_blob(blob_name))
