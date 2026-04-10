# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Ephemeral workspace — scratch workspaces for frontend-owned data.

In ephemeral mode the **frontend (IndexedDB) is the sole source of truth**.
Every request sends ``_workspace_tables`` and the backend calls
:func:`construct_scratch_workspace` to materialize them as parquet files.
Agents and DuckDB then read from these files identically to local/Azure mode.

Cleanup:
- ``atexit`` wipes the entire ephemeral root on server shutdown.
- Startup cleans orphaned roots from previous crashes.
"""

import atexit
import logging
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from data_formulator.datalake.workspace import Workspace
from werkzeug.utils import secure_filename

logger = logging.getLogger(__name__)

_EPHEMERAL_ROOT: Optional[Path] = None


def _get_ephemeral_root() -> Path:
    """Return (and lazily create) the process-wide ephemeral root."""
    global _EPHEMERAL_ROOT
    if _EPHEMERAL_ROOT is None or not _EPHEMERAL_ROOT.exists():
        _cleanup_stale_roots()
        _EPHEMERAL_ROOT = Path(tempfile.mkdtemp(prefix="df_ephemeral_"))
        logger.info(f"Ephemeral workspace root: {_EPHEMERAL_ROOT}")
        atexit.register(_atexit_cleanup)
    return _EPHEMERAL_ROOT


def _atexit_cleanup() -> None:
    global _EPHEMERAL_ROOT
    if _EPHEMERAL_ROOT is not None and _EPHEMERAL_ROOT.exists():
        shutil.rmtree(_EPHEMERAL_ROOT, ignore_errors=True)
        logger.info(f"Ephemeral root cleaned up on shutdown: {_EPHEMERAL_ROOT}")
        _EPHEMERAL_ROOT = None


def _cleanup_stale_roots() -> None:
    tmp = Path(tempfile.gettempdir())
    for p in tmp.glob("df_ephemeral_*"):
        if p == _EPHEMERAL_ROOT:
            continue
        try:
            age_hours = (time.time() - p.stat().st_mtime) / 3600
            if age_hours > 1:
                shutil.rmtree(p, ignore_errors=True)
                logger.info(f"Cleaned up stale ephemeral root: {p} (age: {age_hours:.1f}h)")
        except Exception:
            pass


def construct_scratch_workspace(
    identity_id: str,
    workspace_id: str,
    workspace_tables: list[dict[str, Any]],
) -> Workspace:
    """Build a ready-to-use :class:`Workspace` from frontend-provided content.

    Creates (or reuses) a temp directory, writes each table as parquet, and
    returns a :class:`Workspace` that agents/DuckDB/sandbox can use
    identically to a local or Azure workspace.

    Args:
        identity_id: User identity.
        workspace_id: Workspace ID from X-Workspace-Id header.
        workspace_tables: ``[{"name": str, "rows": list[dict]}, ...]``
            — the full table data sent by the frontend from IndexedDB.

    Returns:
        A :class:`Workspace` with all tables materialized as parquet files.
    """
    safe_user = secure_filename(identity_id) or "anonymous"
    safe_ws = secure_filename(workspace_id) or "default"
    ws_dir = _get_ephemeral_root() / "users" / safe_user / "workspaces" / safe_ws
    ws_dir.mkdir(parents=True, exist_ok=True)
    (ws_dir / "data").mkdir(exist_ok=True)

    ws = Workspace(identity_id, workspace_path=ws_dir)

    logger.info(
        f"construct_scratch_workspace: ws_id={workspace_id}, "
        f"received {len(workspace_tables)} table(s): "
        f"{[t.get('name') for t in workspace_tables]}"
    )

    for table in workspace_tables:
        name = table.get("name")
        rows = table.get("rows")
        if not name or rows is None:
            continue
        df = pd.DataFrame(rows) if rows else pd.DataFrame()
        ws.write_parquet(df, name)

    if workspace_tables:
        logger.info(
            f"Constructed ephemeral workspace '{workspace_id}' "
            f"with {len(workspace_tables)} table(s)"
        )

    return ws
