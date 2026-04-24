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
_GENERIC_4XX = "Bad request"

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
    client_message: Optional[str] = None,
    log_message: Optional[str] = None,
    log_level: int = logging.WARNING,
):
    """Build a sanitized JSON error response for the client.

    Strategy by *status_code*:

    * **5xx** — never expose exception details; return a fixed generic message
      and log the full exception server-side.
    * **502 (HTTPError from upstream)** — return "Upstream service unavailable".
    * **4xx** — if *client_message* is provided, use it directly (caller
      asserts the message is safe); otherwise select a canned message based
      on the upstream HTTP status, falling back to a generic "Bad request".
      Exception details are **never** derived from the exception object.

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

    # 4xx — caller-supplied safe message takes priority
    if client_message:
        return jsonify({"status": "error", "message": client_message}), status_code

    # HTTPError with known upstream status → canned message
    if isinstance(exc, HTTPError) and exc.response is not None:
        upstream_code = exc.response.status_code
        canned = _HTTP_CLIENT_MESSAGES.get(upstream_code)
        if canned:
            return jsonify({"status": "error", "message": canned}), status_code

    return jsonify({"status": "error", "message": _GENERIC_4XX}), status_code


_LLM_ERROR_GENERIC = "Model request failed"

_LLM_ERROR_PATTERNS: list[tuple[str, str]] = [
    # (regex matched against lowercased str(exception), safe client message)
    # — Authentication / credentials
    (r"401|unauthorized|invalid.{0,15}api.?key|invalid.{0,15}key|auth\w*.{0,10}fail",
     "Authentication failed — please check your API key"),
    # — Rate limiting
    (r"429|rate.?limit|too many requests|quota",
     "Rate limit exceeded — please wait and try again"),
    # — Context / token length
    (r"context.{0,10}length|too many tokens|max.{0,10}tokens|token limit|maximum context",
     "Input too long — please reduce the data size or prompt length"),
    # — Model not found / not available
    (r"model.{0,20}not.{0,5}found|model.{0,20}does not exist|no such model|decommissioned|deprecated model",
     "Model not found — please check the model name"),
    # — Timeout / connectivity
    (r"timeout|timed?\s*out|connect.{0,10}error|connection.{0,10}refused|unreachable|econnrefused|name.{0,15}resolution",
     "Request timed out — please check connectivity and try again"),
    # — Server-side (upstream 5xx)
    (r"\b50[0-9]\b|bad gateway|service.{0,10}unavailable|internal server error|server.{0,10}error",
     "The model service returned an error — please try again later"),
    # — Content filtering / safety
    (r"content.?filter|content.?policy|responsible.?ai|safety|flagged",
     "The request was blocked by the content safety filter"),
    # — Permission / access
    (r"403|forbidden|access.?denied|not.?allowed|insufficient.{0,10}permission",
     "Access denied — you do not have permission to use this model"),
    # — Invalid request shape
    (r"400|bad request|invalid.{0,10}request|malformed",
     "Invalid request — please check your input and try again"),
]


def classify_llm_error(exc: Exception) -> str:
    """Return a safe, user-friendly message for an LLM / external-API error.

    The function matches ``str(exc)`` against known error patterns and
    returns a **pre-defined** human-readable message.  No text from the
    original exception is ever included in the return value.

    Falls back to a generic ``"Model request failed"`` for unknown errors.
    The caller is responsible for logging the full exception server-side.
    """
    text = str(exc).lower()
    for pattern, safe_msg in _LLM_ERROR_PATTERNS:
        if re.search(pattern, text):
            return safe_msg
    return _LLM_ERROR_GENERIC


def sanitize_error_message(error_message: str) -> str:
    """Sanitize error messages before sending to client.

    Strips stack traces, file paths, API keys, and other potentially
    sensitive implementation details so that only a human-readable
    summary is returned to the browser.
    """
    # Cap input length first to prevent ReDoS on crafted payloads.
    message = html.escape(error_message[:2000])

    # Remove API keys / tokens
    message = re.sub(
        r'(api[-_]?key|api[-_]?token)[=:]\s*[^\s&]+',
        r'\1=<redacted>', message, flags=re.IGNORECASE,
    )

    # Strip Python stack-trace blocks ("Traceback (most recent call last): ...")
    # Use an atomic-style pattern: match non-T chars or T-not-starting-a-new-
    # traceback header, avoiding catastrophic backtracking.
    message = re.sub(
        r'Traceback \(most recent call last\):'
        r'[^T]*(?:T(?!raceback \(most recent call last\):)[^T]*)*',
        '', message, flags=re.IGNORECASE,
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
