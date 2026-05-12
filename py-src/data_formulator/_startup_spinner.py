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
    if os.environ.get("DF_NO_SPINNER"):
        return False
    if os.environ.get("NO_COLOR") and os.environ.get("TERM") == "dumb":
        return False
    try:
        return sys.stdout.isatty()
    except Exception:
        return False


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
        glyph = "\x1b[32m✔\x1b[0m" if ok else "\x1b[31m✖\x1b[0m"
        sys.stdout.write(f"\r\x1b[2K{_INDENT}{glyph} {label} ({elapsed:.1f}s)\n")
        sys.stdout.flush()
