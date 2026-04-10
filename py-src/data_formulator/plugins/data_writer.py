# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""High-level helper for plugins to write data into a user's Workspace.

Instead of calling ``workspace.write_parquet()`` directly, plugins use
:class:`PluginDataWriter` which handles:

* Identity-scoped workspace resolution (via ``get_identity_id()``)
* Table name sanitisation
* Automatic ``loader_metadata`` stamping (``loader_type = "plugin:<id>"``)
* ``overwrite=False`` collision avoidance (auto-suffix ``_1``, ``_2``, …)
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import pandas as pd

from data_formulator.datalake.parquet_utils import sanitize_table_name
from data_formulator.security.auth import get_identity_id
from data_formulator.workspace_factory import get_workspace

logger = logging.getLogger(__name__)


class PluginDataWriter:
    """Write DataFrames into the current user's active Workspace.

    Parameters
    ----------
    plugin_id:
        Slug that identifies the plugin (e.g. ``"superset"``).
        Stored as ``loader_type = "plugin:<plugin_id>"``.
    """

    def __init__(self, plugin_id: str) -> None:
        self._plugin_id = plugin_id

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def write_dataframe(
        self,
        df: pd.DataFrame,
        table_name: str,
        *,
        overwrite: bool = True,
        source_metadata: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Write *df* as a Parquet table in the user's workspace.

        Returns a dict suitable for a JSON response::

            {
                "table_name": "sales_data",
                "row_count": 1234,
                "columns": [...],
                "is_renamed": False,
            }
        """
        identity = get_identity_id()
        workspace = get_workspace(identity)

        safe_name = sanitize_table_name(table_name)

        if not overwrite:
            safe_name = self._unique_name(safe_name, workspace)

        loader_metadata = self._build_loader_metadata(
            safe_name, source_metadata,
        )

        table_meta = workspace.write_parquet(
            df, safe_name, loader_metadata=loader_metadata,
        )

        is_renamed = safe_name != sanitize_table_name(table_name)

        return {
            "table_name": table_meta.name,
            "row_count": table_meta.row_count,
            "columns": [
                {"name": c.name, "type": c.dtype}
                for c in (table_meta.columns or [])
            ],
            "is_renamed": is_renamed,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_loader_metadata(
        self,
        table_name: str,
        source_metadata: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        meta: dict[str, Any] = {
            "loader_type": f"plugin:{self._plugin_id}",
            "source_table": table_name,
        }
        if source_metadata:
            meta["loader_params"] = source_metadata
        return meta

    @staticmethod
    def _unique_name(base: str, workspace: Any) -> str:
        """Append ``_1``, ``_2``, … until the name doesn't collide."""
        existing = set(workspace.list_tables())
        if base not in existing:
            return base
        idx = 1
        while f"{base}_{idx}" in existing:
            idx += 1
        return f"{base}_{idx}"
