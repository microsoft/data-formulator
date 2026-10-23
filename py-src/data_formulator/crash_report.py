# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Record the Python stack when the process dies from a native crash.

A native fault (for example an access violation inside a compiled extension)
cannot be caught or recovered from in Python, so the app still exits. With
:mod:`faulthandler` writing to ``<home>/logs/crash.log`` we at least capture
which Python code was running on every thread, and the next launch copies
that report into the regular log file.

On Windows, faulthandler also dumps stacks for exceptions that are handled
and survived (COM errors raised by WebView2, first-chance access violations
inside the .NET runtime). A "session running" marker that is removed on a
clean exit tells those apart from real crashes.
"""

from __future__ import annotations

import faulthandler
import logging
from pathlib import Path
from typing import TextIO

_CRASH_FILE = "crash.log"
_PREVIOUS_CRASH_FILE = "crash.previous.log"
_RUNNING_MARKER = ".session-running"
_MAX_REPORT_BYTES = 64 * 1024

_log_dir: Path | None = None
_stream: TextIO | None = None
# None: previous session exited cleanly; "": ended without a recorded stack.
_previous_report: str | None = None


def enable(home: Path) -> None:
    """Start recording fatal-error stacks for this process (idempotent)."""
    global _log_dir, _stream, _previous_report
    if _stream is not None:
        return
    log_dir = Path(home) / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        crash_path = log_dir / _CRASH_FILE
        marker = log_dir / _RUNNING_MARKER
        if marker.exists():
            report = ""
            if crash_path.is_file() and crash_path.stat().st_size:
                saved = crash_path.replace(log_dir / _PREVIOUS_CRASH_FILE)
                with saved.open("rb") as handle:
                    report = handle.read(_MAX_REPORT_BYTES).decode("utf-8", "replace")
            _previous_report = report
        marker.touch()
        stream = crash_path.open("w", encoding="utf-8")
        faulthandler.enable(stream, all_threads=True)
    except OSError as exc:
        logging.getLogger(__name__).debug("Crash reporting unavailable: %s", exc)
        return
    _log_dir = log_dir
    _stream = stream


def mark_clean_exit() -> None:
    """Stop recording and mark this session as having ended normally."""
    global _stream
    if _stream is None or _log_dir is None:
        return
    faulthandler.disable()
    _stream.close()
    _stream = None
    (_log_dir / _RUNNING_MARKER).unlink(missing_ok=True)


def report_previous_crash(logger: logging.Logger) -> str | None:
    """Log the previous session's crash once; return its stack, if any."""
    global _previous_report
    report, _previous_report = _previous_report, None
    if report is None:
        return None
    if report.strip():
        saved = _log_dir / _PREVIOUS_CRASH_FILE if _log_dir else _PREVIOUS_CRASH_FILE
        logger.error(
            "Data Formulator crashed during the previous session (saved to %s). "
            "Python stack at the time of the crash:\n%s",
            saved, report,
        )
    else:
        logger.warning(
            "The previous Data Formulator session ended unexpectedly; "
            "no Python stack was recorded."
        )
    return report
