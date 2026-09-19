"""Per-user connector availability preferences."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from threading import Lock
from uuid import uuid4

from data_formulator.security.path_safety import ConfinedDir

logger = logging.getLogger(__name__)

_PREFERENCES_FILE = "connector_preferences.json"
_PREFERENCES_LOCK = Lock()


def disabled_connector_ids(user_home: Path | str) -> set[str]:
    jail = ConfinedDir(user_home, mkdir=False)
    if not jail.exists(_PREFERENCES_FILE):
        return set()
    try:
        raw = json.loads(jail.read_text(_PREFERENCES_FILE))
        values = raw.get("disabled_connector_ids", []) if isinstance(raw, dict) else []
        return {value for value in values if isinstance(value, str) and value}
    except Exception:
        logger.warning("Failed to read connector preferences", exc_info=True)
        return set()


def connector_is_enabled(user_home: Path | str, source_id: str) -> bool:
    return source_id not in disabled_connector_ids(user_home)


def set_connector_enabled(
    user_home: Path | str,
    source_id: str,
    enabled: bool,
) -> None:
    jail = ConfinedDir(user_home, mkdir=True)
    with _PREFERENCES_LOCK:
        disabled = disabled_connector_ids(user_home)
        if enabled:
            disabled.discard(source_id)
        else:
            disabled.add(source_id)

        target = jail.resolve(_PREFERENCES_FILE)
        temporary = jail.resolve(f".{_PREFERENCES_FILE}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with open(temporary, "w", encoding="utf-8") as file:
                json.dump({"disabled_connector_ids": sorted(disabled)}, file)
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink()