# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The one cleaning path for a session that leaves this server (design-docs/71).

Downloading a session, publishing it as an example and sending it through a
wormhole all build their archive with :func:`build_session_archive`, so a
session is shared the same way whichever channel carries it:

- ``state.json`` is the saved state without credentials, model settings or
  in-flight requests (:func:`share_state`);
- ``workspace/`` holds the session's tables, files, reports and memory, but not
  its bookkeeping or the agent's working area (:func:`is_shared_workspace_file`).
  From ``scratch/`` only the files a user attached in chat travel with it; the
  agent's conversation (``scratch/_agent``) stays with the session it happened
  in (design-docs/63).
"""

from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path, PurePosixPath
from typing import Any

from data_formulator.datalake.workspace_manager import _strip_sensitive

# Server-provided or in-flight fields: the model deployments this server offers
# (endpoints, auth modes) and requests that were pending when the session was saved.
SHARE_STRIPPED_FIELDS = frozenset([
    "globalModels",
    "analystChatPending",
    "agentHandoffRequest",
    "connectorRefreshRequest",
])

# Per-workspace bookkeeping, rebuilt by whichever server imports the session.
_WORKSPACE_BOOKKEEPING = frozenset(["session_state.json", "workspace_meta.json"])
_TEMPORARY_PREFIXES = (".write-", ".edit-")
_LOCK_FILE = ".workspace.lock"
# The chat's attachment upload saves files as ``<name>_<first 8 hex of sha256><ext>``.
_ATTACHMENT_HASH_LENGTH = 8


def share_state(state: dict[str, Any]) -> dict[str, Any]:
    """The part of a saved session state that may be given to someone else."""
    clean = {key: value for key, value in _strip_sensitive(state).items() if key not in SHARE_STRIPPED_FIELDS}
    workspace = clean.get("activeWorkspace")
    if isinstance(workspace, dict):
        # The importing side assigns its own id; only the name carries over.
        name = workspace.get("displayName")
        clean["activeWorkspace"] = {"displayName": name} if isinstance(name, str) and name else {}
    return clean


def is_chat_attachment(path: Path) -> bool:
    """Whether a top-level scratch file is one a user attached in chat (its name ends with its own hash)."""
    stem, _extension = os.path.splitext(path.name)
    _name, separator, digest = stem.rpartition("_")
    if not separator or len(digest) != _ATTACHMENT_HASH_LENGTH or any(c not in "0123456789abcdef" for c in digest):
        return False
    hasher = hashlib.sha256()
    with path.open("rb") as content:
        for chunk in iter(lambda: content.read(1 << 20), b""):
            hasher.update(chunk)
    return hasher.hexdigest()[:_ATTACHMENT_HASH_LENGTH] == digest


def is_shared_workspace_file(relative: PurePosixPath, path: Path) -> bool:
    """Whether a file of the workspace folder (``relative`` to its root) belongs in a shared archive."""
    parts = relative.parts
    if not parts or path.is_symlink():
        return False
    name = parts[-1]
    if name == _LOCK_FILE or name.startswith(_TEMPORARY_PREFIXES):
        return False
    if len(parts) == 1 and name in _WORKSPACE_BOOKKEEPING:
        return False
    if parts[0] == "scratch":
        return len(parts) == 2 and is_chat_attachment(path)
    return True


def build_session_archive(workspace: Any, state: dict[str, Any]) -> io.BytesIO:
    """The zip to download, publish or send for ``workspace`` with its saved ``state``."""
    return workspace.export_session_zip(share_state(state))
