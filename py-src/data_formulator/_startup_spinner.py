# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.
"""Minimal startup spinner.

Animates a single line on a TTY while a slow import / setup step runs.
Falls back to plain prints in non-TTY environments (gunicorn, Docker logs,
CI, redirected stdout) so log files stay clean.

Usage:
    with spinner("Loading AI agents"):
        from data_formulator.routes.agents import agent_bp
"""

from __future__ import annotations

import os
import sys
import threading
import time
from contextlib import contextmanager

_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
_FRAME_INTERVAL = 0.08  # seconds
_INDENT = "  "


def _enabled() -> bool:
    if os.environ.get("TERM") == "dumb":
        return False
    try:
        return sys.stdout.isatty()
    except Exception:
        return False


def _color(code: str, text: str) -> str:
    if os.environ.get("NO_COLOR"):
        return text
    return f"\x1b[{code}m{text}\x1b[0m"


@contextmanager
def spinner(label: str):
    """Context manager that animates `label` on stdout while the body runs."""
    if not _enabled():
        # Non-TTY: emit a single static line, like the original prints.
        print(f"{_INDENT}{label}...", flush=True)
        yield
        return

    stop = threading.Event()
    start = time.monotonic()

    def _spin():
        i = 0
        while not stop.is_set():
            frame = _FRAMES[i % len(_FRAMES)]
            elapsed = time.monotonic() - start
            sys.stdout.write(f"\r\x1b[2K{_INDENT}{frame} {label}… ({elapsed:.1f}s)")
            sys.stdout.flush()
            i += 1
            stop.wait(_FRAME_INTERVAL)

    thread = threading.Thread(target=_spin, daemon=True)
    thread.start()
    ok = True
    try:
        yield
    except BaseException:
        ok = False
        raise
    finally:
        stop.set()
        thread.join()
        elapsed = time.monotonic() - start
        glyph = _color("32", "✔") if ok else _color("31", "✖")
        sys.stdout.write(f"\r\x1b[2K{_INDENT}{glyph} {label} ({elapsed:.1f}s)\n")
        sys.stdout.flush()
