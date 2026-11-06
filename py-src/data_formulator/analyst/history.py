"""The agent's conversation in a session (design-docs/63).

Requests in a session continue one conversation, as turns do in a chat: a request is the
stored history, then what changed in the session and where the user is working, then the
question. The provider caches the conversation up to the new turn, and the agent keeps what
it read, ran, and loaded.

The history lives in the session's workspace (``scratch/_agent/history.json``, hidden from
the agent's file listings and left out of exports), so deleting the session deletes it.
Losing it is harmless: a missing, unreadable, or unwritable history means a fresh start,
which shows the whole session as files again.

Runs that start from the same history (concurrent requests) each append their turn when
they finish, in the order they finish; each sees the other's work as session changes on the
next turn.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

HISTORY_FILE = "_agent/history.json"
PAUSED_FILE = "_agent/paused.json"
PAUSED_SECONDS = 7 * 24 * 3_600
VERSION = 1
# Older tool output is shortened once past COMPACT_TOKENS; past MAX_TOKENS the next request
# starts fresh. After IDLE_SECONDS the provider's cache is gone, so a history larger than
# IDLE_RESET_TOKENS would be paid for in full: start fresh instead.
COMPACT_TOKENS = 100_000
MAX_TOKENS = 150_000
IDLE_SECONDS = 3_600
IDLE_RESET_TOKENS = 40_000
KEEP_RECENT_TURNS = 2
_COMPACTED = "[Shortened to keep the conversation small; rerun or reread for the full output.]"


def continuation_enabled() -> bool:
    return os.environ.get("DF_AGENT_CONTINUATION", "on").strip().lower() not in ("off", "0", "false", "no")


def estimate_tokens(messages: list[dict[str, Any]]) -> int:
    return len(json.dumps(messages, ensure_ascii=False, default=str)) // 4


def compact(messages: list[dict[str, Any]], starts: list[int]) -> list[dict[str, Any]]:
    """Shorten tool output older than the last KEEP_RECENT_TURNS turns (``starts``: where each turn begins)."""
    keep_from = starts[-KEEP_RECENT_TURNS] if len(starts) >= KEEP_RECENT_TURNS else 0
    compacted = []
    for index, message in enumerate(messages):
        content = message.get("content")
        if (index < keep_from and message.get("role") == "tool" and isinstance(content, str)
                and len(content) > 600 and not content.endswith(_COMPACTED)):
            message = {**message, "content": f"{content[:300]}\n...\n{_COMPACTED}"}
        compacted.append(message)
    return compacted


def _without_images(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            parts = [part for part in content if not (isinstance(part, dict) and part.get("type") == "image_url")]
            if len(parts) != len(content):
                parts.append({"type": "text", "text": "[Image omitted from the stored conversation.]"})
            message = {**message, "content": parts}
        out.append(message)
    return out


class SessionHistory:
    """The stored conversation of one session's workspace."""

    def __init__(self, workspace: Any):
        self.workspace = workspace

    def _path(self):
        return self.workspace.confined_scratch.resolve(HISTORY_FILE)

    def _lock(self):
        from data_formulator.datalake.workspace import WorkspaceLock
        return WorkspaceLock(self.workspace.confined_scratch.root)

    def load(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self._path().read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except Exception:
            logger.warning("Unreadable agent history; starting fresh", exc_info=True)
            return None
        if not isinstance(data, dict) or data.get("version") != VERSION or not isinstance(data.get("messages"), list):
            return None
        return data

    def _save(self, data: dict[str, Any]) -> None:
        path = self._path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")
        os.replace(temporary, path)

    def continuable(self, model: str) -> tuple[list[dict[str, Any]] | None, str]:
        """The stored messages to continue from, or None and why the request starts fresh. They are sent
        exactly as stored, so the provider's cache covers them."""
        if not continuation_enabled():
            return None, "continuation off"
        data = self.load()
        if not data or not data["messages"]:
            return None, "no history"
        if data.get("model") != model:
            return None, "model changed"
        tokens = estimate_tokens(data["messages"])
        if time.time() - float(data.get("updated_at") or 0) > IDLE_SECONDS and tokens > IDLE_RESET_TOKENS:
            return None, "idle with a large history"
        if tokens > MAX_TOKENS:
            return None, "history too large"
        return data["messages"], "continuing"

    def commit(self, model: str, turn: list[dict[str, Any]], *, continued: bool) -> None:
        """Add a finished turn. A continued turn is appended to the stored conversation as it is now (other
        turns may have been added meanwhile); a fresh one replaces it. Past COMPACT_TOKENS, older tool
        output is shortened in this one step, so the stored conversation stays what the next request sends."""
        if not continuation_enabled() or not turn:
            return
        turn = _without_images(turn)
        try:
            with self._lock():
                data = self.load() if continued else None
                if data is not None and data.get("model") != model:
                    data = None
                messages = (data["messages"] if data else []) + turn
                starts = (list(data.get("turn_starts") or []) if data else []) + [len(messages) - len(turn)]
                if estimate_tokens(messages) > COMPACT_TOKENS:
                    messages = compact(messages, starts)
                self._save({"version": VERSION, "model": model, "updated_at": time.time(),
                            "revision": int((data or {}).get("revision") or 0) + 1,
                            "turn_starts": starts, "messages": messages})
        except Exception:
            logger.warning("Could not store the agent conversation; the next request starts fresh", exc_info=True)

    def clear(self) -> None:
        try:
            self._path().unlink(missing_ok=True)
        except Exception:
            logger.debug("Could not clear the agent conversation", exc_info=True)

    # A paused run (waiting on the user) commits when its resumed run finishes; until then the
    # history keeps where its turn began in the trajectory the client holds.

    def _paused_path(self):
        return self.workspace.confined_scratch.resolve(PAUSED_FILE)

    def _paused(self) -> dict[str, Any]:
        try:
            data = json.loads(self._paused_path().read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def remember_paused(self, conversation_id: str, start: int, continued: bool) -> None:
        if not continuation_enabled() or not conversation_id:
            return
        try:
            with self._lock():
                now = time.time()
                paused = {key: value for key, value in self._paused().items()
                          if now - float(value.get("at") or 0) < PAUSED_SECONDS}
                paused[conversation_id] = {"start": start, "continued": continued, "at": now}
                path = self._paused_path()
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(paused), encoding="utf-8")
        except Exception:
            logger.debug("Could not record a paused run", exc_info=True)

    def take_paused(self, conversation_id: str) -> dict[str, Any] | None:
        """Where a paused run's turn began, removed from the record (a run resumes once)."""
        if not conversation_id:
            return None
        try:
            with self._lock():
                paused = self._paused()
                entry = paused.pop(conversation_id, None)
                if entry is not None:
                    self._paused_path().write_text(json.dumps(paused), encoding="utf-8")
                return entry
        except Exception:
            return None
