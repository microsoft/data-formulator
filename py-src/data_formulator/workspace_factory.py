# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Flask-aware workspace factory.

Reads the workspace backend configuration from Flask's ``current_app.config``
(populated by CLI args / env vars in ``app.py``) and returns the appropriate
:class:`Workspace` subclass.  This keeps the data-layer modules
(``datalake.workspace``, ``datalake.azure_blob_workspace``) free of any
Flask dependency.
"""

import os
import logging

from data_formulator.datalake.workspace import Workspace

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


def get_workspace(identity_id: str) -> Workspace:
    """
    Return a :class:`Workspace` (or subclass) for *identity_id*.

    The backend is selected via the running Flask app's ``CLI_ARGS`` config,
    which mirrors CLI flags and environment variables set in ``app.py``:

    ================================= ================================ ==================
    CLI flag                          Env var                          Default
    ================================= ================================ ==================
    ``--workspace-backend``           ``WORKSPACE_BACKEND``            ``local``
    ``--azure-blob-connection-string````AZURE_BLOB_CONNECTION_STRING`` (none)
    ``--azure-blob-account-url``      ``AZURE_BLOB_ACCOUNT_URL``       (none)
    ``--azure-blob-container``        ``AZURE_BLOB_CONTAINER``         ``data-formulator``
    ================================= ================================ ==================

    ``datalake_root`` reuses ``--data-dir`` / ``DATA_FORMULATOR_HOME``
    (defaulting to ``"workspaces"``).
    """
    from flask import current_app

    cfg = current_app.config.get("CLI_ARGS", {})

    backend = cfg.get(
        "workspace_backend", os.getenv("WORKSPACE_BACKEND", "local")
    )

    if backend == "azure_blob":
        from data_formulator.datalake.cached_azure_blob_workspace import (
            CachedAzureBlobWorkspace,
        )

        client = _build_azure_container_client(cfg)
        root = (
            cfg.get("data_dir")
            or os.getenv("DATA_FORMULATOR_HOME")
            or "workspaces"
        )

        # Cache configuration from env vars / CLI args
        max_cache_mb = int(
            cfg.get("cache_max_mb", os.getenv("DF_CACHE_MAX_MB", "1024"))
        )
        max_global_cache_mb = int(
            cfg.get(
                "global_cache_max_mb",
                os.getenv("DF_GLOBAL_CACHE_MAX_MB", "10240"),
            )
        )
        return CachedAzureBlobWorkspace(
            identity_id,
            client,
            datalake_root=root,
            max_cache_bytes=max_cache_mb * 1024 * 1024,
            max_global_cache_bytes=max_global_cache_mb * 1024 * 1024,
        )

    # Default: local filesystem workspace
    return Workspace(identity_id)
