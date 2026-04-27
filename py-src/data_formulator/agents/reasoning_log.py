# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Structured reasoning logger for Agent sessions.

Each ``ReasoningLogger`` instance is bound to one Agent session and writes
a JSONL file under
``DATA_FORMULATOR_HOME/agent-logs/<date>/<safe_identity_id>/<session_id>-<agent_type>.jsonl``.

The log level is controlled by the **DF_AGENT_LOG** environment variable:

    off      – no-op; no file created, no I/O
    on       – structured summaries (counts, latencies, tool names); no full messages
    verbose  – full messages content, sanitised via ``log_sanitizer``

Default is ``off``.

Expired logs (> 30 days old) are cleaned up best-effort in a background
thread at logger creation time.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_formulator.security.path_safety import ConfinedDir
from werkzeug.utils import secure_filename

logger = logging.getLogger(__name__)

_LOG_RETENTION_DAYS = 30


def _today_str() -> str:
    """UTC date string for directory partitioning."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _utc_now_iso() -> str:
    """UTC timestamp in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()


def _parse_log_level() -> str:
    """Read ``DF_AGENT_LOG`` env var (case-insensitive, default ``off``)."""
    raw = os.environ.get("DF_AGENT_LOG", "off").strip().lower()
    if raw in ("off", "on", "verbose"):
        return raw
    return "on"


def get_agent_logs_root() -> Path:
    """Return the system-level root for administrator Agent logs."""
    from data_formulator.datalake.workspace import get_data_formulator_home
    return get_data_formulator_home() / "agent-logs"


def _safe_log_filename(session_id: str, agent_type: str) -> str:
    """Return a safe single-component JSONL log filename."""
    filename = secure_filename(f"{session_id}-{agent_type}.jsonl")
    if not filename or not filename.endswith(".jsonl"):
        raise ValueError("invalid log filename")
    return filename


def _cleanup_expired_logs(agent_logs_root: Path) -> None:
    """Delete date sub-directories older than ``_LOG_RETENTION_DAYS``.

    Only inspects immediate children whose names look like ``YYYY-MM-DD``.
    Runs best-effort — failures are logged as warnings and swallowed.
    """
    if not agent_logs_root.is_dir():
        return
    cutoff = datetime.now(timezone.utc).date()
    for child in agent_logs_root.iterdir():
        if not child.is_dir():
            continue
        try:
            dir_date = datetime.strptime(child.name, "%Y-%m-%d").date()
        except ValueError:
            continue
        age_days = (cutoff - dir_date).days
        if age_days > _LOG_RETENTION_DAYS:
            try:
                shutil.rmtree(child)
            except Exception:
                logger.warning("Failed to clean up expired log dir %s", child.name)


_ON_FILTERED_KEYS = frozenset({"messages"})


class ReasoningLogger:
    """Structured JSONL logger for a single Agent session.

    Usage::

        with ReasoningLogger(identity_id, "DataAgent", session_id) as rlog:
            rlog.log("session_start", user_question="...", model="gpt-4o")
            ...
            rlog.log("session_end", status="success")
    """

    def __init__(
        self,
        identity_id: str,
        agent_type: str,
        session_id: str,
    ) -> None:
        self._level = _parse_log_level()
        self._fd = None
        self._agent_type = agent_type
        self._session_id = session_id
        self._identity_id = identity_id

        if self._level == "off":
            return

        from data_formulator.datalake.workspace import sanitize_identity_dirname

        safe_identity_id = sanitize_identity_dirname(identity_id)
        agent_logs_root = get_agent_logs_root()

        # Best-effort async cleanup of expired log directories.
        t = threading.Thread(
            target=_cleanup_expired_logs,
            args=(agent_logs_root,),
            daemon=True,
        )
        t.start()

        today = _today_str()
        jail = ConfinedDir(agent_logs_root / today / safe_identity_id, mkdir=True)
        filename = _safe_log_filename(session_id, agent_type)
        log_path = jail.resolve(filename, mkdir_parents=True)
        self._fd = open(log_path, "a", encoding="utf-8")

    # -- public API --------------------------------------------------------

    def log(self, step_type: str, **kwargs: Any) -> None:
        """Append one JSON line to the log.

        In ``on`` mode, keys listed in ``_ON_FILTERED_KEYS`` (e.g.
        ``messages``) are stripped defensively so that callers cannot
        accidentally write full conversation content.

        In ``verbose`` mode, the entire *kwargs* dict (including nested
        dicts and lists) is sanitised via ``log_sanitizer.sanitize_params``.
        """
        if self._fd is None:
            return

        if self._level == "on":
            kwargs = {k: v for k, v in kwargs.items()
                      if k not in _ON_FILTERED_KEYS}
        elif self._level == "verbose":
            kwargs = self._sanitize_verbose(kwargs)

        record: dict[str, Any] = {
            **kwargs,
            "step_type": step_type,
            "ts": _utc_now_iso(),
            "session_id": self._session_id,
            "agent_type": self._agent_type,
            "identity_id": self._identity_id,
        }
        self._fd.write(
            json.dumps(record, ensure_ascii=False, default=str) + "\n"
        )
        self._fd.flush()

    def close(self) -> None:
        """Close the underlying file descriptor (idempotent)."""
        if self._fd is not None:
            try:
                self._fd.close()
            except Exception:
                pass
            self._fd = None

    # -- context manager ---------------------------------------------------

    def __enter__(self) -> "ReasoningLogger":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    # -- internals ---------------------------------------------------------

    @staticmethod
    def _sanitize_verbose(kwargs: dict[str, Any]) -> dict[str, Any]:
        """Sanitise *kwargs* for ``verbose`` mode.

        First runs ``sanitize_params`` on the top-level dict (catches
        ``api_key``, ``token``, etc. passed as direct kwargs), then
        recurses into nested dicts and lists.
        """
        from data_formulator.security.log_sanitizer import sanitize_params

        result = sanitize_params(kwargs)
        for key, value in result.items():
            if isinstance(value, list):
                result[key] = [
                    sanitize_params(item) if isinstance(item, dict) else item
                    for item in value
                ]
        return result


class _NullReasoningLogger(ReasoningLogger):
    """No-op logger used when identity or log storage is unavailable."""

    def __init__(self) -> None:
        self._level = "off"
        self._fd = None
        self._agent_type = ""
        self._session_id = ""
        self._identity_id = ""

    def log(self, step_type: str, **kwargs: Any) -> None:
        pass

    def close(self) -> None:
        pass
