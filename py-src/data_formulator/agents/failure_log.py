# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""A log of the agent's failed tool calls and actions, kept across sessions.

Session state shows a failure only inside the session it happened in, and the reasoning log is off by default, so
finding which failures recur (design-docs/73 began by sifting 610 sessions by hand) meant reading every saved
session. This log keeps one JSON line per failure in ``<DATA_FORMULATOR_HOME>/logs/agent-failures.jsonl``: when,
which agent and workspace, the tool or action, a category, the error, and the arguments (capped, credentials
redacted). It stays on the machine like ``data_formulator.log`` and rotates at ``MAX_BYTES``.

``DF_AGENT_FAILURE_LOG=off`` turns it off. Summarize it with::

    uv run python -m data_formulator.agents.failure_log [--days 30] [--category CATEGORY]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import threading
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

logger = logging.getLogger(__name__)

FILENAME = "agent-failures.jsonl"
MAX_BYTES = 5 * 1024 * 1024
BACKUPS = 3
ERROR_CHARS = 2000
ARG_CHARS = 2000
ARGS_CHARS = 6000

# First match wins: specific sandbox and path causes before generic errors.
CATEGORIES: tuple[tuple[str, re.Pattern[str]], ...] = tuple((name, re.compile(pattern, re.IGNORECASE)) for name, pattern in (
    ("sandbox_write_denied", r"file write forbidden"),
    ("sandbox_read_denied", r"read outside workspace forbidden|read via an unverified descriptor|requires an absolute path"),
    ("sandbox_blocked", r"forbidden in sandbox|import of '[^']+' is forbidden|filesystem-accessing functions forbidden"),
    ("view_path_in_code", r"No such file or directory: '[^']*(session|sources|workflows):?/"),
    ("missing_data_file", r"No such file or directory: '[^']*data/"),
    ("file_not_found", r"FileNotFoundError|No such file or directory|does not exist"),
    ("os_access_denied", r"Operation not permitted|Permission denied|Read-only file system|TERMINAL_ACCESS_DENIED"),
    ("stale_content", r"changed; read it again|content_hash|hash conflict"),
    ("timeout", r"timed out|timeout"),
    ("python_error", r"\b\w+Error\b|Traceback"),
))
# An action's observation that reports failure: [ERROR], [SKILL ERROR], [APP NOT CREATED], [MAP NOT UPDATED], ...
_FAILED_OBSERVATION = re.compile(r"^\[[A-Z ]*(ERROR|NOT [A-Z]+)\]")
_TERMINAL_OBSERVATION = re.compile(r"^Command finished\b[^\n]*\n(\{.*\})\s*$", re.DOTALL)

_lock = threading.Lock()


def enabled() -> bool:
    return os.environ.get("DF_AGENT_FAILURE_LOG", "on").strip().lower() not in ("off", "0", "false", "no")


def log_path() -> Path:
    from data_formulator.datalake.workspace import get_data_formulator_home
    return get_data_formulator_home() / "logs" / FILENAME


def classify(error: str) -> str:
    """The failure's category, from its error text."""
    for name, pattern in CATEGORIES:
        if pattern.search(error or ""):
            return name
    return "other"


def observation_failure(observation: Any) -> str | None:
    """The error an action's observation reports, or None when the action succeeded or paused."""
    if not isinstance(observation, str):
        return None
    text = observation.lstrip()
    if _FAILED_OBSERVATION.match(text):
        return text
    match = _TERMINAL_OBSERVATION.match(text)
    if match:
        try:
            result = json.loads(match.group(1)).get("result") or {}
        except (ValueError, AttributeError):
            return None
        if result.get("error_code") or result.get("timed_out") or result.get("exit_code") not in (0, None):
            parts = [result.get("error_code"), result.get("error"),
                     f"exit code {result.get('exit_code')}" if result.get("exit_code") not in (0, None) else None,
                     "timed out" if result.get("timed_out") else None, str(result.get("output") or "")[-1500:]]
            return "\n".join(str(part) for part in parts if part)
    return None


def _cap(value: Any, limit: int) -> Any:
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + f"… [{len(value) - limit} more characters]"
    if isinstance(value, dict):
        return {str(key): _cap(item, limit) for key, item in list(value.items())[:40]}
    if isinstance(value, (list, tuple)):
        return [_cap(item, limit) for item in list(value)[:40]]
    return value if isinstance(value, (int, float, bool)) or value is None else _cap(str(value), limit)


def _workspace_id(workspace: Any) -> str | None:
    path = getattr(workspace, "_path", None)
    if path is not None:
        return Path(path).name
    prefix = str(getattr(workspace, "_prefix", None) or "").strip("/")
    return prefix or None


def _rotate(path: Path) -> None:
    for index in range(BACKUPS, 0, -1):
        older = path.with_name(f"{path.name}.{index}")
        newer = path.with_name(f"{path.name}.{index - 1}") if index > 1 else path
        if newer.exists():
            os.replace(newer, older)


def log_failure(*, agent: str, tool: str, error: Any, args: Any = None, workspace: Any = None,
                model: str | None = None, call_id: str | None = None) -> None:
    """Record one failed tool call or action. Never raises: logging must not break a run."""
    if not enabled():
        return
    try:
        from data_formulator.security.log_sanitizer import sanitize_params, sanitize_text

        error_text = str(error or "")
        capped_args = _cap(sanitize_params(args) if isinstance(args, dict) else args, ARG_CHARS)
        args_json = json.dumps(capped_args, ensure_ascii=False, default=str)
        if len(args_json) > ARGS_CHARS:
            capped_args = {"truncated": args_json[:ARGS_CHARS]}
        record = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "agent": agent,
            "workspace": _workspace_id(workspace),
            "model": model,
            "tool": tool,
            "call_id": call_id,
            "category": classify(error_text),
            "error": error_text if len(error_text) <= ERROR_CHARS else "…" + error_text[-ERROR_CHARS:],
            "args": capped_args,
        }
        line = sanitize_text(json.dumps({key: value for key, value in record.items() if value is not None},
                                        ensure_ascii=False, default=str)) + "\n"
        path = log_path()
        with _lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists() and path.stat().st_size + len(line) > MAX_BYTES:
                _rotate(path)
            with path.open("a", encoding="utf-8") as stream:
                stream.write(line)
    except Exception:
        logger.debug("Could not record an agent failure", exc_info=True)


# -- reading ---------------------------------------------------------------------------------------------------


def read_failures(days: float | None = None, path: Path | None = None) -> Iterator[dict[str, Any]]:
    """The recorded failures, oldest first (rotated files included), optionally only the last ``days``."""
    path = path or log_path()
    since = datetime.now(timezone.utc) - timedelta(days=days) if days else None
    for file in [path.with_name(f"{path.name}.{index}") for index in range(BACKUPS, 0, -1)] + [path]:
        if not file.exists():
            continue
        with file.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    record = json.loads(line)
                    if since is None or datetime.fromisoformat(record["ts"]) >= since:
                        yield record
                except (ValueError, KeyError, TypeError):
                    continue


def summarize(records: list[dict[str, Any]], examples: int = 3) -> str:
    """Counts by category and by tool, with the most frequent errors of each category."""
    if not records:
        return "No agent failures recorded."
    workspaces = {record["workspace"] for record in records if record.get("workspace")}
    lines = [f"{len(records)} failures in {len(workspaces)} workspaces "
             f"({records[0]['ts'][:10]} to {records[-1]['ts'][:10]})", "", "By category:"]
    categories = Counter(record.get("category", "other") for record in records)
    for category, count in categories.most_common():
        tools = Counter(record.get("tool") for record in records if record.get("category") == category)
        lines.append(f"  {count:5}  {category:22} {', '.join(f'{tool} {n}' for tool, n in tools.most_common(4))}")
        errors = Counter(re.sub(r"\s+", " ", str(record.get("error", "")))[:160]
                         for record in records if record.get("category") == category)
        lines += [f"           {n}× {text}" for text, n in errors.most_common(examples)]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Summarize the agent failure log.")
    parser.add_argument("--days", type=float, default=None, help="only the last N days")
    parser.add_argument("--category", default=None, help="only this category")
    parser.add_argument("--json", action="store_true", help="print the matching records as JSON lines")
    options = parser.parse_args(argv)
    records = [record for record in read_failures(options.days)
               if options.category is None or record.get("category") == options.category]
    if options.json:
        for record in records:
            print(json.dumps(record, ensure_ascii=False))
    else:
        print(f"{log_path()}\n")
        print(summarize(records))


if __name__ == "__main__":
    main()
