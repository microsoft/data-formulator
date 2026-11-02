"""The saved record of one agent tool call: what was called, with what, and what came back.

The UI keeps one record per call on the message that made it and shows it by tool type (design-docs/67).
Long text is capped here, once, so a record stays small however much the agent read.
"""
from __future__ import annotations

import json
from typing import Any

# Code is what makes a result reproducible, so it is kept nearly whole; real calls stay under 2K.
CODE_CHARS = 16_000
TEXT_CHARS = 4_000
OUTPUT_HEAD_CHARS = 4_000
OUTPUT_TAIL_CHARS = 1_000
ERROR_CHARS = 2_000
LIST_ITEMS = 50
CODE_FIELDS = frozenset({"code"})


def _head(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + f"\n… ({len(text) - limit:,} more characters)"


def _head_and_tail(text: str, head: int, tail: int) -> str:
    if len(text) <= head + tail:
        return text
    return f"{text[:head]}\n… ({len(text) - head - tail:,} characters omitted) …\n{text[-tail:]}"


def _tail(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"… ({len(text) - limit:,} earlier characters)\n" + text[-limit:]


def _cap_args(value: Any, key: str, truncated: dict[str, int], path: str) -> Any:
    if isinstance(value, str):
        limit = CODE_CHARS if key in CODE_FIELDS else TEXT_CHARS
        if len(value) > limit:
            truncated[path] = len(value)
        return _head(value, limit)
    if isinstance(value, dict):
        return {name: _cap_args(item, name, truncated, f"{path}.{name}" if path else name)
                for name, item in value.items()}
    if isinstance(value, list):
        if len(value) > LIST_ITEMS:
            truncated[path] = len(value)
        return [_cap_args(item, key, truncated, f"{path}[{index}]") for index, item in enumerate(value[:LIST_ITEMS])]
    return value


def _readable_output(tool: str, output: str) -> str:
    """`read_file` answers in JSON with each file's content as an escaped string; keep it as plain sections instead,
    so the record reads like the files and stays readable when capped."""
    if tool != "read_file":
        return output
    try:
        response = json.loads(output)
    except (TypeError, ValueError):
        return output
    if not isinstance(response, dict) or not isinstance(response.get("files"), list):
        return output
    sections = []
    for item in response["files"]:
        if not isinstance(item, dict):
            continue
        body = item.get("content")
        note = item.get("error") or item.get("not_read")
        extra = {key: value for key, value in item.items() if key not in ("path", "name", "content", "error", "not_read")}
        lines = [f"# {item.get('path', '')}" + (f" ({note})" if note else "")]
        if extra:
            lines.append(json.dumps(extra, ensure_ascii=False))
        if body is not None:
            lines.append(body if isinstance(body, str) else json.dumps(body, ensure_ascii=False, indent=2))
        sections.append("\n".join(lines))
    if response.get("no_match"):
        sections.append("# No match: " + ", ".join(map(str, response["no_match"])))
    return "\n\n".join(sections)


def tool_call_record(
    *,
    call_id: str,
    tool: str,
    args: dict[str, Any] | None,
    output: str | None,
    error: str | None,
    status: str,
    started: float,
    ended: float,
) -> dict[str, Any]:
    """One tool call as the UI saves it: arguments, output and error, each capped.

    `truncated` maps each capped field (`output`, `error`, or an argument path such as `args.code`) to its
    original length in characters, or in items for a list.
    """
    truncated: dict[str, int] = {}
    capped_args = _cap_args(args or {}, "", truncated, "")
    truncated = {f"args.{path}": size for path, size in truncated.items()}
    record: dict[str, Any] = {
        "id": call_id,
        "tool": tool,
        "args": capped_args,
        "status": "failed" if status == "error" or error else "completed",
        "createdAt": int(started * 1000),
        "durationMs": max(0, int((ended - started) * 1000)),
    }
    if output:
        output = _readable_output(tool, output)
        if len(output) > OUTPUT_HEAD_CHARS + OUTPUT_TAIL_CHARS:
            truncated["output"] = len(output)
        record["output"] = _head_and_tail(output, OUTPUT_HEAD_CHARS, OUTPUT_TAIL_CHARS)
    if error:
        if len(error) > ERROR_CHARS:
            truncated["error"] = len(error)
        record["error"] = _tail(error, ERROR_CHARS)
    if truncated:
        record["truncated"] = truncated
    return record
