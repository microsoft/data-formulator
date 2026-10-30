# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Turn an MCP tool result into what the agent sees and what the chat shows.

Small text and JSON come back inline. Anything large, and every image, audio clip or embedded
file, is saved under ``scratch/mcp/`` so the agent can read it, load it with ``create_data`` or
keep it with ``create_file``/``move_file``. The result is the server's output: untrusted data.
"""

from __future__ import annotations

import base64
import binascii
import json
import mimetypes
import re
import secrets
import time
from pathlib import Path
from typing import Any

INLINE_LIMIT = 6000
PREVIEW_LIMIT = 1200
MAX_FILE_BYTES = 50 * 1024 * 1024

_EXTENSIONS = {"application/json": ".json", "text/csv": ".csv", "text/markdown": ".md", "text/plain": ".txt",
               "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
               "image/svg+xml": ".svg", "audio/mpeg": ".mp3", "audio/wav": ".wav", "application/pdf": ".pdf"}


def _extension(mime: str | None, uri: str | None = None) -> str:
    if mime in _EXTENSIONS:
        return _EXTENSIONS[mime]
    if uri:
        suffix = Path(uri.split("?")[0]).suffix
        if re.fullmatch(r"\.[A-Za-z0-9]{1,8}", suffix or ""):
            return suffix.lower()
    return (mimetypes.guess_extension(mime or "") or ".bin") if mime else ".txt"


class _Saver:
    def __init__(self, scratch_root: Path, server_id: str, tool: str) -> None:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        safe_tool = re.sub(r"[^A-Za-z0-9_-]+", "-", tool)[:40] or "tool"
        self.directory = scratch_root / "mcp" / server_id
        self.prefix = f"{safe_tool}-{stamp}-{secrets.token_hex(2)}"
        self.count = 0
        self.saved: list[dict[str, Any]] = []

    def save(self, data: bytes, extension: str, mime: str | None) -> str:
        self.count += 1
        if len(data) > MAX_FILE_BYTES:
            raise ValueError("too large")
        self.directory.mkdir(parents=True, exist_ok=True)
        name = f"{self.prefix}-{self.count}{extension}"
        (self.directory / name).write_bytes(data)
        relative = f"scratch/mcp/{self.directory.name}/{name}"
        self.saved.append({"path": relative, "mime_type": mime, "bytes": len(data)})
        return relative


def _json_mime(text: str) -> str | None:
    """``application/json`` for text that is a JSON object or array, so a large one saves as a loadable .json file."""
    stripped = text.lstrip()
    if not stripped[:1] in ("{", "["):
        return None
    try:
        json.loads(text)
    except ValueError:
        return None
    return "application/json"


def _decode(data: str) -> bytes | None:
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        return None


def summarize_result(result: Any, *, scratch_root: Path, server_id: str, tool: str) -> dict[str, Any]:
    """Describe a ``CallToolResult``: ``observation`` for the agent, a compact ``display`` for the chat."""
    from mcp import types

    if not isinstance(result, types.CallToolResult):
        return {"is_error": True, "observation": "The server asked for more input, which Data Formulator does not support yet.",
                "display": {"error": "The server asked for more input (not supported).", "files": []}}
    saver = _Saver(scratch_root, server_id, tool)
    parts: list[str] = []
    budget = INLINE_LIMIT
    preview: list[str] = []

    def add_text(text: str, mime: str | None = None, label: str = "text", document: bool = False) -> None:
        nonlocal budget
        if len(text) <= budget:
            parts.append(text)
            budget -= len(text)
        else:
            # A saved document is read from its file: the conversation keeps only its opening.
            shown = 400 if document else 1500
            try:
                path = saver.save(text.encode("utf-8"), _extension(mime or "text/plain"), mime or "text/plain")
                parts.append(f"[{label}: {len(text):,} characters saved to {path}; first part:]\n{text[:shown]}")
            except (OSError, ValueError):
                parts.append(text[:budget] + "\n[truncated]")
            budget = max(0, budget - shown - 100)
        if len(preview) < 3:
            preview.append(text[:PREVIEW_LIMIT])

    def add_binary(data: str, mime: str | None, kind: str, uri: str | None = None) -> None:
        raw = _decode(data)
        if raw is None:
            parts.append(f"[{kind} with unreadable data omitted]")
            return
        try:
            path = saver.save(raw, _extension(mime, uri), mime)
            parts.append(f"[{kind} ({mime or 'unknown type'}, {len(raw):,} bytes) saved to {path}]")
        except (OSError, ValueError):
            parts.append(f"[{kind} ({mime or 'unknown type'}, {len(raw):,} bytes) too large to keep]")

    for block in result.content or []:
        if isinstance(block, types.TextContent):
            add_text(block.text, _json_mime(block.text))
        elif isinstance(block, types.ImageContent):
            add_binary(block.data, block.mime_type, "image")
        elif isinstance(block, types.AudioContent):
            add_binary(block.data, block.mime_type, "audio")
        elif isinstance(block, types.ResourceLink):
            parts.append(f"[link: {block.name} {block.uri}" + (f" — {block.description}" if block.description else "") + "]")
        elif isinstance(block, types.EmbeddedResource):
            resource = block.resource
            uri = str(resource.uri)
            if isinstance(resource, types.TextResourceContents):
                add_text(resource.text, resource.mime_type, f"resource {uri}", document=True)
            else:
                add_binary(resource.blob, resource.mime_type, f"resource {uri}", uri)
        else:
            parts.append(f"[{getattr(block, 'type', 'content')} omitted]")

    # Servers also send structured output as text; it is only needed when there is nothing else.
    structured = getattr(result, "structured_content", None)
    if structured is not None and not result.content:
        add_text(json.dumps(structured, ensure_ascii=False, indent=1, default=str), "application/json", "structured result")

    body = "\n\n".join(part for part in parts if part) or "(no content)"
    is_error = bool(getattr(result, "is_error", False))
    return {
        "is_error": is_error,
        "observation": body,
        "display": {"error": body[:PREVIEW_LIMIT] if is_error else None,
                    "preview": "\n\n".join(preview)[:PREVIEW_LIMIT] if not is_error else "",
                    "files": saver.saved},
    }
