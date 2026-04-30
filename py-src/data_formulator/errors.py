# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unified error types for the Data Formulator backend.

Every business error raised in routes / agents / data layer should be an
``AppError`` (or a subclass).  The global error handlers registered by
``error_handler.register_error_handlers`` convert ``AppError`` instances
into a consistent JSON envelope before they reach the client.

``ErrorCode`` provides machine-readable codes that the frontend maps to
localised user-facing messages via the i18n ``errors`` namespace.
"""

from __future__ import annotations


class ErrorCode:
    """Machine-readable error codes.

    The frontend uses these codes for:
    * Differential error handling (auth errors → redirect, rate-limit → retry)
    * i18n lookup (code → translated user message)

    Convention: values are ``UPPER_SNAKE_CASE`` strings identical to the
    attribute name so that ``ErrorCode.TABLE_NOT_FOUND == "TABLE_NOT_FOUND"``.
    """

    # --- Auth / authorisation ---
    AUTH_REQUIRED = "AUTH_REQUIRED"
    AUTH_EXPIRED = "AUTH_EXPIRED"
    ACCESS_DENIED = "ACCESS_DENIED"

    # --- Input / validation ---
    INVALID_REQUEST = "INVALID_REQUEST"
    TABLE_NOT_FOUND = "TABLE_NOT_FOUND"
    FILE_PARSE_ERROR = "FILE_PARSE_ERROR"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    VALIDATION_ERROR = "VALIDATION_ERROR"

    # --- LLM / model ---
    LLM_AUTH_FAILED = "LLM_AUTH_FAILED"
    LLM_RATE_LIMIT = "LLM_RATE_LIMIT"
    LLM_CONTEXT_TOO_LONG = "LLM_CONTEXT_TOO_LONG"
    LLM_MODEL_NOT_FOUND = "LLM_MODEL_NOT_FOUND"
    LLM_TIMEOUT = "LLM_TIMEOUT"
    LLM_SERVICE_ERROR = "LLM_SERVICE_ERROR"
    LLM_CONTENT_FILTERED = "LLM_CONTENT_FILTERED"
    LLM_UNKNOWN_ERROR = "LLM_UNKNOWN_ERROR"

    # --- Data / connector ---
    DB_CONNECTION_FAILED = "DB_CONNECTION_FAILED"
    DB_QUERY_ERROR = "DB_QUERY_ERROR"
    DATA_LOAD_ERROR = "DATA_LOAD_ERROR"
    CONNECTOR_ERROR = "CONNECTOR_ERROR"

    # --- Code execution ---
    CODE_EXECUTION_ERROR = "CODE_EXECUTION_ERROR"
    AGENT_ERROR = "AGENT_ERROR"

    # --- Catalog / annotations ---
    CATALOG_SYNC_TIMEOUT = "CATALOG_SYNC_TIMEOUT"
    CATALOG_NOT_FOUND = "CATALOG_NOT_FOUND"
    ANNOTATION_CONFLICT = "ANNOTATION_CONFLICT"
    ANNOTATION_INVALID_PATCH = "ANNOTATION_INVALID_PATCH"

    # --- System ---
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"


# HTTP status code mapping for application errors.
#
# Design principle: application-level (deliberate) errors return HTTP 200 with
# {"status": "error", ...} in the body.  This unifies behavior with streaming
# APIs (which always start at HTTP 200) and avoids proxies/monitoring
# misinterpreting business-logic errors as infrastructure failures.
#
# Only *authentication/authorization* errors use non-200 so that browsers,
# proxies, and middleware can react to them at the transport layer.
# Truly uncontrolled errors (no matching route, body too large, unhandled crash)
# use 404/413/500 via Flask's built-in handlers—not this mapping.
ERROR_CODE_HTTP_STATUS: dict[str, int] = {
    # Auth — non-200 so transport layer can intercept
    ErrorCode.AUTH_REQUIRED: 401,
    ErrorCode.AUTH_EXPIRED: 401,
    ErrorCode.ACCESS_DENIED: 403,
}


class AppError(Exception):
    """Unified business exception for the Data Formulator backend.

    Parameters
    ----------
    code:
        A machine-readable ``ErrorCode`` constant.
    message:
        A safe, user-readable description (English).  This is the *fallback*
        text shown to the user when the frontend has no i18n translation for
        *code*.  **Must not** contain secrets, paths, or stack traces.
    status_code:
        The HTTP status code to return.  Defaults to 500.
    detail:
        Optional internal detail (stack trace, raw SQL, etc.).  Only
        included in the response when the server runs in debug mode.
    retry:
        Hint for the frontend: ``True`` means the operation may succeed
        if retried (e.g. rate-limit, transient timeout).
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 200,
        detail: str | None = None,
        retry: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.detail = detail
        self.retry = retry

    def get_http_status(self) -> int:
        """Return the HTTP status code for this error.

        Only auth-related codes (AUTH_REQUIRED, AUTH_EXPIRED, ACCESS_DENIED)
        return non-200.  All other application errors return HTTP 200 so that
        the protocol is consistent with streaming APIs and proxies/monitoring
        do not misinterpret business errors as infrastructure failures.
        """
        return ERROR_CODE_HTTP_STATUS.get(self.code, 200)

    def to_dict(self, include_detail: bool = False) -> dict:
        """Serialise to the ``error`` object in the JSON response envelope."""
        d: dict = {
            "code": self.code,
            "message": self.message,
            "retry": self.retry,
        }
        if include_detail and self.detail is not None:
            d["detail"] = self.detail
        return d
