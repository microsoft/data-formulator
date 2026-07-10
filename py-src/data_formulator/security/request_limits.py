"""Request-boundary limits for JSON payloads with amplified decoded data."""

from __future__ import annotations

import json
from collections.abc import Iterable
from typing import Any

from flask import Flask, request
from werkzeug.exceptions import RequestEntityTooLarge


def _bounded_json_size(value: Any, limit: int) -> int:
    """Estimate compact UTF-8 JSON bytes and stop as soon as *limit* is exceeded."""
    total = 0
    encoder = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"))
    for chunk in encoder.iterencode(value):
        total += len(chunk.encode("utf-8"))
        if total > limit:
            raise RequestEntityTooLarge()
    return total


def _inline_image_size(value: str) -> int:
    """Return the decoded-byte estimate for an inline base64 image URL."""
    marker = ";base64,"
    if not value.startswith("data:image/") or marker not in value:
        return 0
    payload = value.split(marker, 1)[1].rstrip("=")
    return (len(payload) * 3) // 4


def _walk_values(value: Any) -> Iterable[Any]:
    stack = [value]
    while stack:
        current = stack.pop()
        yield current
        if isinstance(current, dict):
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)


def _validate_decoded_limits(data: dict[str, Any], app: Flask) -> None:
    workspace_tables = data.get("_workspace_tables")
    if workspace_tables:
        _bounded_json_size(
            workspace_tables,
            int(app.config["MAX_EPHEMERAL_TABLE_BYTES"]),
        )

    image_total = 0
    image_limit = int(app.config["MAX_INLINE_IMAGE_BYTES"])
    for value in _walk_values(data):
        if isinstance(value, str):
            image_total += _inline_image_size(value)
            if image_total > image_limit:
                raise RequestEntityTooLarge()


def register_request_limits(app: Flask) -> None:
    """Register JSON wire and decoded aggregate limits on *app*."""

    @app.before_request
    def _enforce_request_limits() -> None:
        if not request.is_json:
            return

        content_length = request.content_length
        if (
            content_length is not None
            and content_length > int(app.config["MAX_JSON_REQUEST_BYTES"])
        ):
            raise RequestEntityTooLarge()

        data = request.get_json(silent=True)
        if isinstance(data, dict):
            _validate_decoded_limits(data, app)
