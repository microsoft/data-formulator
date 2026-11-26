# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""What the user signed in to, and what was done with it (design-docs/72): one JSON line per event, under
``<DATA_FORMULATOR_HOME>/logs/signins.jsonl``, shown in the Console's Sign-ins tab.

Events: ``signed_in``, ``signed_out``, ``login_changed`` (this computer's login changed, followed), ``login_unreadable``
(a spec's local read failed, so the key was not used) and ``used`` (a signed-in request: host and path, never the
query, and the status). Each says the service, where its key goes, how it was signed in and for which session. Never
a secret: an event holds only names, hosts and the read a spec shows on its card.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

MAX_BYTES = 1_000_000
_lock = threading.Lock()


def _path() -> Path:
    from data_formulator.datalake.workspace import get_data_formulator_home

    return Path(get_data_formulator_home()) / "logs" / "signins.jsonl"


def record(event: str, spec: Any, *, workspace: str | None = None, **details: Any) -> None:
    """Note one sign-in event; best effort, never in the way of the sign-in itself."""
    entry = {"time": time.time(), "event": event, "service": spec.id, "name": spec.name,
             "send_to": list(spec.send_to), **({"session": workspace} if workspace else {}),
             **{key: value for key, value in details.items() if value not in (None, "")}}
    try:
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(entry, ensure_ascii=False, default=str) + "\n"
        with _lock:
            if path.exists() and path.stat().st_size > MAX_BYTES:
                # Keep the newer half.
                kept = path.read_text(encoding="utf-8").splitlines(keepends=True)
                path.write_text("".join(kept[len(kept) // 2:]), encoding="utf-8")
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line)
    except OSError:
        logger.warning("Could not note a sign-in event (%s, %s)", event, spec.id, exc_info=True)
    logger.info("Sign-in %s: %s (%s)", event, spec.id, ", ".join(spec.send_to))


def where(url: str) -> str:
    """A URL as an event keeps it: host and path, without the query (a query may carry a key)."""
    parts = urlsplit(url)
    return f"{parts.hostname or ''}{parts.path or '/'}"


def recent(limit: int = 300) -> list[dict[str, Any]]:
    """The latest events, newest first."""
    try:
        lines = _path().read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    events = []
    for line in reversed(lines):
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict):
            events.append(item)
        if len(events) >= limit:
            break
    return events
