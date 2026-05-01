# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unified error handling and response helpers for the Data Formulator Flask application.

Public entry points:

* ``register_error_handlers(app)`` — call once during app setup to install
  global error handlers and the request-id middleware.
* ``classify_and_wrap_llm_error(exc)`` — convert a raw LLM / external-API
  exception into a structured ``AppError``.
* ``stream_error_event(error)`` — format an error as a single
  NDJSON line for streaming endpoints.
* ``json_ok(data)`` — build a success JSON response with the unified envelope.
* ``stream_preflight_error(error)`` — build an error response for streaming
  endpoint pre-flight validation failures (always HTTP 200).
"""

from __future__ import annotations

import json
import logging
import re
import traceback
from uuid import uuid4

import flask
from flask import g, jsonify, request

from data_formulator.errors import AppError, ErrorCode
from data_formulator.security.sanitize import classify_llm_error, sanitize_error_message

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LLM exception → AppError
# ---------------------------------------------------------------------------

_LLM_CODE_PATTERNS: list[tuple[str, str, bool]] = [
    # (regex, ErrorCode, retryable?)
    (r"401|unauthorized|invalid.{0,15}api.?key|invalid.{0,15}key|auth\w*.{0,10}fail",
     ErrorCode.LLM_AUTH_FAILED, False),
    (r"429|rate.?limit|too many requests|quota",
     ErrorCode.LLM_RATE_LIMIT, True),
    (r"context.{0,10}length|too many tokens|max.{0,10}tokens|token limit|maximum context",
     ErrorCode.LLM_CONTEXT_TOO_LONG, False),
    (r"model.{0,20}not.{0,5}found|model.{0,20}does not exist|no such model|decommissioned|deprecated model",
     ErrorCode.LLM_MODEL_NOT_FOUND, False),
    (r"timeout|timed?\s*out|connect.{0,10}error|connection.{0,10}refused|unreachable|econnrefused|name.{0,15}resolution",
     ErrorCode.LLM_TIMEOUT, True),
    (r"\b50[0-9]\b|bad gateway|service.{0,10}unavailable|internal server error|server.{0,10}error",
     ErrorCode.LLM_SERVICE_ERROR, True),
    (r"content.?filter|content.?policy|responsible.?ai|safety|flagged",
     ErrorCode.LLM_CONTENT_FILTERED, False),
    (r"403|forbidden|access.?denied|not.?allowed|insufficient.{0,10}permission",
     ErrorCode.ACCESS_DENIED, False),
]


def classify_and_wrap_llm_error(exc: Exception) -> AppError:
    """Convert a raw LLM / external-API exception into a structured AppError.

    Reuses ``classify_llm_error`` from ``sanitize.py`` for the safe
    user-facing message, then maps to an ``ErrorCode`` and retry flag.
    The original exception text is preserved in ``detail`` for server-side
    logging but is **never** included in the client-facing ``message``.
    """
    safe_message = classify_llm_error(exc)
    text = str(exc).lower()

    error_code = ErrorCode.LLM_UNKNOWN_ERROR
    retry = False
    for pattern, code, retryable in _LLM_CODE_PATTERNS:
        if re.search(pattern, text):
            error_code = code
            retry = retryable
            break

    return AppError(
        error_code,
        safe_message,
        detail=str(exc),
        retry=retry,
    )


# ---------------------------------------------------------------------------
# Streaming error event
# ---------------------------------------------------------------------------

def stream_error_event(error: AppError | Exception) -> str:
    """Format an error as a single NDJSON line for streaming endpoints.

    Returns a string ending with ``\\n`` that can be directly yielded
    from a Flask streaming generator.
    """
    if isinstance(error, AppError):
        include_detail = False
        try:
            include_detail = flask.current_app.debug
        except RuntimeError:
            pass
        err_dict = error.to_dict(include_detail=include_detail)
        if include_detail and "detail" in err_dict:
            err_dict["detail"] = sanitize_error_message(err_dict["detail"])
    else:
        logger.error("Unexpected error in stream", exc_info=error)
        err_dict = {
            "code": ErrorCode.INTERNAL_ERROR,
            "message": "An unexpected error occurred",
            "retry": False,
        }

    return json.dumps({"type": "error", "error": err_dict}, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Streaming warning event
# ---------------------------------------------------------------------------

def stream_warning_event(
    message: str,
    *,
    detail: str = "",
    message_code: str = "",
) -> str:
    """Format a non-fatal warning as a single NDJSON line.

    Unlike :func:`stream_error_event`, a warning does **not** abort the
    stream — it is an advisory notice (e.g. "table X unavailable, using
    degraded context") that the frontend can display as a toast / snackbar.

    Returns a string ending with ``\\n``.
    """
    warning: dict = {"message": message}
    if detail:
        warning["detail"] = detail
    if message_code:
        warning["message_code"] = message_code

    return json.dumps({"type": "warning", "warning": warning}, ensure_ascii=False) + "\n"


def collect_stream_warning(message: str, *, detail: str = "", message_code: str = "") -> None:
    """Accumulate a warning in the current request context.

    Stored on ``flask.g`` so that any code running within a request
    (including inside agent helper functions that cannot ``yield``) can
    emit warnings.  The streaming generator drains them via
    :func:`flush_stream_warnings`.
    """
    try:
        warnings = getattr(g, "_stream_warnings", None)
        if warnings is None:
            g._stream_warnings = warnings = []
        entry: dict = {"message": message}
        if detail:
            entry["detail"] = detail
        if message_code:
            entry["message_code"] = message_code
        warnings.append(entry)
    except RuntimeError:
        pass


def flush_stream_warnings() -> list[str]:
    """Return and clear all accumulated warning NDJSON lines.

    Call this inside a streaming generator (wrapped with
    ``stream_with_context``) to inject pending warnings into the stream.
    """
    try:
        warnings = getattr(g, "_stream_warnings", None)
        if not warnings:
            return []
        g._stream_warnings = []
        return [
            json.dumps({"type": "warning", "warning": w}, ensure_ascii=False) + "\n"
            for w in warnings
        ]
    except RuntimeError:
        return []


# ---------------------------------------------------------------------------
# JSON response helpers
# ---------------------------------------------------------------------------

def json_ok(data: object = None, *, status_code: int = 200) -> tuple:
    """Build a unified success JSON response.

    Returns ``(Response, status_code)`` for Flask.  The envelope uses
    ``"status": "success"`` (not legacy ``"ok"``) and wraps the payload
    in the ``"data"`` key::

        {"status": "success", "data": {...}}

    The response body must not include endpoint-specific top-level fields.
    """
    return jsonify({"status": "success", "data": data}), status_code


def stream_preflight_error(error: AppError) -> tuple:
    """Build an error response for streaming pre-flight validation failures.

    Streaming endpoints call this (instead of ``raise AppError()``) when
    validation fails *before* the NDJSON stream starts.  The frontend's
    ``streamRequest()`` detects the ``application/json`` content-type (vs
    expected ``application/x-ndjson``) and throws ``ApiRequestError``.

    **Always returns HTTP 200** — consistent with non-streaming error policy.
    """
    include_detail = False
    try:
        include_detail = flask.current_app.debug
    except RuntimeError:
        pass
    err_dict = error.to_dict(include_detail=include_detail)
    if include_detail and "detail" in err_dict:
        err_dict["detail"] = sanitize_error_message(err_dict["detail"])
    body = {
        "status": "error",
        "error": err_dict,
    }
    return jsonify(body), 200


# ---------------------------------------------------------------------------
# Global Flask error handlers + request-id middleware
# ---------------------------------------------------------------------------

def register_error_handlers(app: flask.Flask) -> None:
    """Register global error handlers and request-id middleware on *app*.

    Call this once during application setup (in ``app.py``).  It installs:

    * ``AppError`` handler — structured JSON, HTTP 200 for business errors,
      401/403 only for auth errors.
    * ``413`` handler — file too large.
    * ``404`` handler — JSON for ``/api/`` routes, SPA fallback otherwise.
    * Catch-all ``Exception`` handler — generic 500 JSON.
    * ``before_request`` / ``after_request`` hooks for ``X-Request-Id``.
    """

    # -- Request ID ----------------------------------------------------------

    @app.before_request
    def _inject_request_id():
        g.request_id = request.headers.get("X-Request-Id") or str(uuid4())

    @app.after_request
    def _attach_request_id(response):
        rid = getattr(g, "request_id", None)
        if rid:
            response.headers["X-Request-Id"] = rid
        return response

    def _current_request_id() -> str:
        rid = getattr(g, "request_id", None)
        if not rid:
            rid = str(uuid4())
            g.request_id = rid
        return rid

    def _with_request_id(error_body: dict) -> dict:
        return {**error_body, "request_id": _current_request_id()}

    # -- AppError ------------------------------------------------------------

    @app.errorhandler(AppError)
    def _handle_app_error(e: AppError):
        http_status = e.get_http_status()
        request_id = _current_request_id()
        logger.warning(
            "AppError [%s] HTTP %s request_id=%s: %s",
            e.code,
            http_status,
            request_id,
            e.message,
        )
        err_dict = e.to_dict(include_detail=app.debug)
        if app.debug and "detail" in err_dict:
            err_dict["detail"] = sanitize_error_message(err_dict["detail"])
        body = {
            "status": "error",
            "error": _with_request_id(err_dict),
        }
        return jsonify(body), http_status

    # -- 413 -----------------------------------------------------------------

    @app.errorhandler(413)
    def _handle_413(e):
        return jsonify({
            "status": "error",
            "error": _with_request_id({
                "code": ErrorCode.FILE_TOO_LARGE,
                "message": "File too large",
                "retry": False,
            }),
        }), 413

    # -- 404 -----------------------------------------------------------------

    @app.errorhandler(404)
    def _handle_404(e):
        if request.path.startswith("/api/"):
            return jsonify({
                "status": "error",
                "error": _with_request_id({
                    "code": "NOT_FOUND",
                    "message": "Resource not found",
                    "retry": False,
                }),
            }), 404
        # SPA fallback
        return app.send_static_file("index.html")

    # -- Catch-all -----------------------------------------------------------

    @app.errorhandler(Exception)
    def _handle_unexpected(e):
        request_id = _current_request_id()
        logger.error("Unhandled exception request_id=%s", request_id, exc_info=e)
        error_body: dict = {
            "code": ErrorCode.INTERNAL_ERROR,
            "message": "An unexpected error occurred",
            "retry": False,
            "request_id": request_id,
        }
        if app.debug:
            error_body["detail"] = sanitize_error_message(traceback.format_exc())
        return jsonify({"status": "error", "error": error_body}), 500
