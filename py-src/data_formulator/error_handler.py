# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unified error handling for the Data Formulator Flask application.

Three public entry points:

* ``register_error_handlers(app)`` — call once during app setup to install
  global error handlers and the request-id middleware.
* ``classify_and_wrap_llm_error(exc)`` — convert a raw LLM / external-API
  exception into a structured ``AppError``.
* ``stream_error_event(error, *, token)`` — format an error as a single
  NDJSON line for streaming endpoints.
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
from data_formulator.security.sanitize import classify_llm_error

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
        status_code=502,
        detail=str(exc),
        retry=retry,
    )


# ---------------------------------------------------------------------------
# Streaming error event
# ---------------------------------------------------------------------------

def stream_error_event(
    error: AppError | Exception,
    *,
    token: str = "",
) -> str:
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
    else:
        logger.error("Unexpected error in stream", exc_info=error)
        err_dict = {
            "code": ErrorCode.INTERNAL_ERROR,
            "message": "An unexpected error occurred",
            "retry": False,
        }

    payload: dict = {"type": "error", "error": err_dict}
    if token:
        payload["token"] = token

    return json.dumps(payload, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Global Flask error handlers + request-id middleware
# ---------------------------------------------------------------------------

def register_error_handlers(app: flask.Flask) -> None:
    """Register global error handlers and request-id middleware on *app*.

    Call this once during application setup (in ``app.py``).  It installs:

    * ``AppError`` handler — structured JSON with the appropriate HTTP status.
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

    # -- AppError ------------------------------------------------------------

    @app.errorhandler(AppError)
    def _handle_app_error(e: AppError):
        logger.warning("AppError [%s] %s: %s", e.code, e.status_code, e.message)
        body = {
            "status": "error",
            "error": e.to_dict(include_detail=app.debug),
        }
        return jsonify(body), e.status_code

    # -- 413 -----------------------------------------------------------------

    @app.errorhandler(413)
    def _handle_413(e):
        return jsonify({
            "status": "error",
            "error": {
                "code": ErrorCode.FILE_TOO_LARGE,
                "message": "File too large",
                "retry": False,
            },
        }), 413

    # -- 404 -----------------------------------------------------------------

    @app.errorhandler(404)
    def _handle_404(e):
        if request.path.startswith("/api/"):
            return jsonify({
                "status": "error",
                "error": {
                    "code": "NOT_FOUND",
                    "message": "Resource not found",
                    "retry": False,
                },
            }), 404
        # SPA fallback
        return app.send_static_file("index.html")

    # -- Catch-all -----------------------------------------------------------

    @app.errorhandler(Exception)
    def _handle_unexpected(e):
        logger.error("Unhandled exception", exc_info=e)
        error_body: dict = {
            "code": ErrorCode.INTERNAL_ERROR,
            "message": "An unexpected error occurred",
            "retry": False,
        }
        if app.debug:
            error_body["detail"] = traceback.format_exc()
        return jsonify({"status": "error", "error": error_body}), 500
