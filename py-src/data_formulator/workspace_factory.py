# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Flask-aware workspace factory.

Reads the workspace backend configuration from Flask's ``current_app.config``
(populated by CLI args / env vars in ``app.py``) and returns the appropriate
:class:`Workspace` subclass.  This keeps the data-layer modules
(``datalake.workspace``, ``datalake.azure_blob_workspace``) free of any
Flask dependency.

Multi-workspace support:
  - Each user has a WorkspaceManager with multiple named workspaces.
  - ``get_workspace()`` returns the active workspace (read from X-Workspace-Id header).
  - ``get_workspace_manager()`` returns the WorkspaceManager for workspace CRUD.
  - Backend is stateless: workspace ID comes from the frontend on every request.
"""

import os
import logging
from pathlib import Path

from data_formulator.datalake.workspace import Workspace, get_data_formulator_home
from data_formulator.datalake.workspace_manager import WorkspaceManager

logger = logging.getLogger(__name__)


def _build_azure_container_client(cfg: dict):
    """
    Create an Azure ``ContainerClient`` using the best available credential.

    Resolution order:

    1. **Connection string** (``AZURE_BLOB_CONNECTION_STRING``) — shared-key
       access, convenient for local development and testing.
    2. **Account URL** (``AZURE_BLOB_ACCOUNT_URL``) + ``DefaultAzureCredential``
       — uses Entra ID (Managed Identity on Azure, ``az login`` locally,
       workload identity on Kubernetes).  No secrets required in production.

    At least one of the two must be set.
    """
    from azure.storage.blob import ContainerClient

    conn_str = cfg.get(
        "azure_blob_connection_string",
        os.getenv("AZURE_BLOB_CONNECTION_STRING"),
    )
    account_url = cfg.get(
        "azure_blob_account_url",
        os.getenv("AZURE_BLOB_ACCOUNT_URL"),
    )
    container_name = cfg.get(
        "azure_blob_container",
        os.getenv("AZURE_BLOB_CONTAINER", "data-formulator"),
    )

    if conn_str:
        # Option 1: connection string (shared key / SAS)
        return ContainerClient.from_connection_string(conn_str, container_name)

    if account_url:
        # Option 2: Entra ID via DefaultAzureCredential
        from azure.identity import DefaultAzureCredential

        credential = DefaultAzureCredential()
        return ContainerClient(account_url, container_name, credential=credential)

    raise ValueError(
        "Azure Blob workspace requires either a connection string or an "
        "account URL.  Set --azure-blob-connection-string / "
        "AZURE_BLOB_CONNECTION_STRING, or --azure-blob-account-url / "
        "AZURE_BLOB_ACCOUNT_URL."
    )


def _get_user_workspaces_root(identity_id: str) -> Path:
    """Return the workspaces root for a user: <home>/users/<safe_id>/workspaces/."""
    safe_id = Workspace._sanitize_identity_id(identity_id)
    return get_data_formulator_home() / "users" / safe_id / "workspaces"


def _get_backend() -> str:
    """Read workspace backend from Flask config."""
    from flask import current_app
    cfg = current_app.config.get("CLI_ARGS", {})
    return cfg.get("workspace_backend", os.getenv("WORKSPACE_BACKEND", "local"))


def get_workspace_manager(identity_id: str) -> WorkspaceManager:
    """
    Return a :class:`WorkspaceManager` (or Azure subclass) for the given user.

    Not available for ephemeral mode — raises RuntimeError.
    """
    from flask import current_app

    cfg = current_app.config.get("CLI_ARGS", {})
    backend = cfg.get(
        "workspace_backend", os.getenv("WORKSPACE_BACKEND", "local")
    )

    if backend == "ephemeral":
        raise RuntimeError(
            "get_workspace_manager() is not available for ephemeral backend. "
            "Session management is handled client-side."
        )

    if backend == "azure_blob":
        from data_formulator.datalake.azure_blob_workspace_manager import (
            AzureBlobWorkspaceManager,
        )
        client = _build_azure_container_client(cfg)
        safe_id = Workspace._sanitize_identity_id(identity_id)
        blob_prefix = f"users/{safe_id}/workspaces"
        return AzureBlobWorkspaceManager(client, blob_prefix)

    # Default: local filesystem
    root = _get_user_workspaces_root(identity_id)
    return WorkspaceManager(root)


def get_active_workspace_id() -> str | None:
    """Read the active workspace ID from the current Flask request's X-Workspace-Id header."""
    from flask import request
    return request.headers.get("X-Workspace-Id") or None


def get_workspace(identity_id: str) -> Workspace:
    """
    Return the active :class:`Workspace` for *identity_id*.

    For local/Azure: uses WorkspaceManager with lazy creation.
    For ephemeral: creates a scratch workspace and materializes table data
    from ``_workspace_tables`` in the request body.  The frontend (IndexedDB)
    owns all data and sends it with every request; the backend writes it to
    temp parquet files so agents/DuckDB can read normally.
    """
    ws_id = get_active_workspace_id()
    if not ws_id:
        raise ValueError("No active workspace. X-Workspace-Id header is required.")

    backend = _get_backend()

    if backend == "ephemeral":
        from data_formulator.datalake.ephemeral_workspace import construct_scratch_workspace

        # Extract workspace tables from the request body
        workspace_tables = []
        from flask import request
        if request.is_json:
            data = request.get_json(silent=True) or {}
            workspace_tables = data.get("_workspace_tables") or []

        return construct_scratch_workspace(identity_id, ws_id, workspace_tables)

    mgr = get_workspace_manager(identity_id)

    # Lazy creation: frontend generates the ID, backend creates on first use
    if not mgr.workspace_exists(ws_id):
        mgr.create_workspace(ws_id)

    return mgr.open_workspace(ws_id, identity_id)
