# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Share images: a picture of an app, map or chart, put on the web to post from a phone.

The person clicks Share on the canvas; their browser draws a card (the picture, its title, the space's name) and
uploads it here. The canvas then shows a QR code to ``/s/<id>``, a small page that opens on their phone with the
image and buttons to post it. Only the image and its words are stored, never data or the session.

Shares live beside the workspaces, in ``<data home>/shares/``, but outside any one: a space's workspaces are
deleted within a day, and a posted link has to keep working. Each share keeps ``DF_SHARE_DAYS`` (default 30).
They need a server others can reach, so they are on for hosted (multi-user) deployments and off on a person's own
computer; ``DF_SHARE_LINKS=on|off`` overrides that (e.g. a kiosk serving its laptop on the local network).
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_IMAGE_BYTES = 10_000_000
MAX_TITLE_CHARS = 200
MAX_CAPTION_CHARS = 500
# Shares one person can make an hour; a booth's laptop is one person to the server, so this is generous.
SHARES_PER_HOUR = 60
SHARE_ID = re.compile(r"[A-Za-z0-9_-]{12,32}")

_lock = threading.Lock()
_recent: dict[str, list[float]] = {}
_last_cleanup = 0.0


_ON = ("1", "on", "true", "yes")
_OFF = ("0", "off", "false", "no")


def share_links_locked() -> bool:
    """``DF_SHARE_LINKS`` decides, and the administrator's setting cannot change it."""
    return os.environ.get("DF_SHARE_LINKS", "").strip().lower() in _ON + _OFF


def shares_available() -> bool:
    """Shared images can be put on the web: ``DF_SHARE_LINKS`` if set, else the administrator's setting
    (``share_links`` in the configuration), else on when hosted. Off, people still download or copy them."""
    setting = os.environ.get("DF_SHARE_LINKS", "").strip().lower()
    if setting in _ON:
        return True
    if setting in _OFF:
        return False
    from data_formulator.configuration import read_configuration
    try:
        configured = read_configuration()["overrides"].get("share_links")
    except (OSError, ValueError):
        configured = None
    if isinstance(configured, bool):
        return configured
    from data_formulator.auth.identity import is_local_mode
    return not is_local_mode()


def keep_days() -> float:
    try:
        return max(1.0, float(os.environ.get("DF_SHARE_DAYS", "30")))
    except ValueError:
        return 30.0


def shares_dir() -> Path:
    from data_formulator.datalake.workspace import get_data_formulator_home
    return get_data_formulator_home() / "shares"


def _clip(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _paths(share_id: str) -> tuple[Path, Path]:
    """A share's image and record, confined to the shares folder (an ID is never a path)."""
    from data_formulator.security.path_safety import ConfinedDir

    if not SHARE_ID.fullmatch(share_id):
        raise ValueError("Not a share ID.")
    folder = ConfinedDir(shares_dir(), mkdir=False)
    return folder.resolve(f"{share_id}.png"), folder.resolve(f"{share_id}.json")


def png_size(image: bytes) -> tuple[int, int]:
    """A PNG's width and height in pixels (from its header)."""
    if len(image) < 24 or image[12:16] != b"IHDR":
        raise ValueError("A share image is a PNG.")
    return int.from_bytes(image[16:20], "big"), int.from_bytes(image[20:24], "big")


def create(image: bytes, *, title: str, caption: str, space: str | None, owner: str) -> dict[str, Any]:
    """Store a share; raises ``ValueError`` for a bad image or ``PermissionError`` when the owner made too many."""
    if not image.startswith(PNG_SIGNATURE):
        raise ValueError("A share image is a PNG.")
    if len(image) > MAX_IMAGE_BYTES:
        raise ValueError(f"A share image is at most {MAX_IMAGE_BYTES // 1_000_000} MB.")
    now = time.time()
    with _lock:
        recent = [moment for moment in _recent.get(owner, []) if now - moment < 3600]
        if len(recent) >= SHARES_PER_HOUR:
            raise PermissionError("Too many shares in the last hour. Try again later.")
        _recent[owner] = recent + [now]
    _cleanup(now)
    width, height = png_size(image)
    share_id = secrets.token_urlsafe(12)
    png, meta = _paths(share_id)
    png.parent.mkdir(parents=True, exist_ok=True)
    record = {"id": share_id, "title": _clip(title, MAX_TITLE_CHARS), "caption": _clip(caption, MAX_CAPTION_CHARS),
              "site": space or "", "width": width, "height": height, "created": now, "expires": now + keep_days() * 86400}
    png.write_bytes(image)
    meta.write_text(json.dumps(record), encoding="utf-8")
    return record


def load(share_id: str) -> tuple[dict[str, Any], Path] | None:
    """A share's record and image, or None when it does not exist or has expired."""
    if not SHARE_ID.fullmatch(share_id or ""):
        return None
    png, meta = _paths(share_id)
    try:
        record = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not png.is_file() or float(record.get("expires", 0)) <= time.time():
        return None
    return record, png


def _cleanup(now: float) -> None:
    """Remove expired shares, at most once an hour."""
    global _last_cleanup
    with _lock:
        if now - _last_cleanup < 3600:
            return
        _last_cleanup = now
    folder = shares_dir()
    if not folder.is_dir():
        return
    for meta in folder.glob("*.json"):
        try:
            expired = float(json.loads(meta.read_text(encoding="utf-8")).get("expires", 0)) <= now
        except (OSError, ValueError):
            expired = True
        if expired:
            meta.with_suffix(".png").unlink(missing_ok=True)
            meta.unlink(missing_ok=True)
