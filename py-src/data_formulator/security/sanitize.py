# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Shared helpers for sanitizing error messages before they reach the client."""

from __future__ import annotations

import html
import logging
import re
from typing import Any, Optional

from flask import jsonify
from requests.exceptions import HTTPError

logger = logging.getLogger(__name__)

_GENERIC_5XX = "An unexpected error occurred"
_GENERIC_502 = "Upstream service unavailable"

_HTTP_CLIENT_MESSAGES: dict[int, str] = {
    400: "Bad request",
    401: "Authentication required",
    403: "Access denied",
    404: "Resource not found",
    409: "Conflict",
    429: "Too many requests",
}


def safe_error_response(
    exc: BaseException,
    status_code: int = 500,
    *,
    log_message: Optional[str] = None,
    log_level: int = logging.WARNING,
):
    """Build a sanitized JSON error response for the client.

    Strategy by *status_code*:

    * **5xx** — never expose exception details; return a fixed generic message
      and log the full exception server-side.
    * **502 (HTTPError from upstream)** — return "Upstream service unavailable".
    * **4xx** — run ``sanitize_error_message`` on the exception text so that
      business-validation errors remain useful while secrets are stripped.

    For ``HTTPError`` exceptions the upstream HTTP status is used to choose
    a safe canned message when the resulting *status_code* is 4xx.
    """
    if log_message:
        logger.log(log_level, "%s: %s", log_message, exc)
    else:
        logger.log(log_level, "%s", exc)

    if status_code >= 500 and status_code != 502:
        return jsonify({"status": "error", "message": _GENERIC_5XX}), status_code

    if status_code == 502:
        return jsonify({"status": "error", "message": _GENERIC_502}), 502

    # 4xx — allow sanitized detail through
    if isinstance(exc, HTTPError) and exc.response is not None:
        upstream_code = exc.response.status_code
        canned = _HTTP_CLIENT_MESSAGES.get(upstream_code)
        if canned:
            return jsonify({"status": "error", "message": canned}), status_code

    safe_msg = sanitize_error_message(str(exc))
    return jsonify({"status": "error", "message": safe_msg}), status_code


def sanitize_error_message(error_message: str) -> str:
    """Sanitize error messages before sending to client.

    Strips stack traces, file paths, API keys, and other potentially
    sensitive implementation details so that only a human-readable
    summary is returned to the browser.
    """
    message = html.escape(error_message)

    # Remove API keys / tokens
    message = re.sub(
        r'(api[-_]?key|api[-_]?token)[=:]\s*[^\s&]+',
        r'\1=<redacted>', message, flags=re.IGNORECASE,
    )

    # Strip Python stack-trace blocks ("Traceback (most recent call last): ...")
    message = re.sub(
        r'Traceback \(most recent call last\):.*?(?=\w+Error:|\w+Exception:|\Z)',
        '', message, flags=re.DOTALL | re.IGNORECASE,
    )

    # Strip individual "File "/path/...", line N" references
    message = re.sub(r'File\s+"[^"]+",\s+line\s+\d+[^\n]*', '', message)

    # Strip Unix-style absolute paths (/home/..., /opt/..., etc.)
    message = re.sub(
        r'(?<!\w)/(?:home|opt|usr|tmp|var|etc|srv|root|app|workspace)[/\\]\S+',
        '<path>', message,
    )

    # Strip Windows-style absolute paths (C:\..., D:\..., etc.)
    message = re.sub(r'[A-Za-z]:[/\\]{1,2}\S+', '<path>', message)

    # Collapse successive blank lines left after stripping
    message = re.sub(r'\n{3,}', '\n\n', message).strip()

    if len(message) > 500:
        message = message[:500] + "..."

    return message
