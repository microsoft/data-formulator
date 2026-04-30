from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from data_formulator.data_loader.external_data_loader import ConnectorParamError
from data_formulator.errors import AppError, ErrorCode
from data_formulator.security.sanitize import sanitize_error_message


@dataclass(frozen=True)
class ConnectorErrorInfo:
    code: str
    message: str
    retry: bool = False
    detail: str = ""

    def to_app_error(self) -> AppError:
        return AppError(
            self.code,
            self.message,
            detail=self.detail or None,
            retry=self.retry,
        )

    def to_error_dict(self, *, include_detail: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retry": self.retry,
        }
        if include_detail and self.detail:
            payload["detail"] = self.detail
        return payload


def classify_connector_error(error: Exception, *, operation: str = "") -> ConnectorErrorInfo:
    """Map loader/connector failures to a small set of stable error codes."""
    chain = _exception_chain(error)
    raw_detail = "\n".join(str(exc) for exc in chain if str(exc))
    safe_detail = sanitize_error_message(raw_detail)
    text = raw_detail.lower()
    http_status = _http_status(chain)

    if any(isinstance(exc, ConnectorParamError) for exc in chain):
        return ConnectorErrorInfo(
            ErrorCode.INVALID_REQUEST,
            safe_detail or "Invalid connector parameters",
            detail=safe_detail,
        )

    if http_status == 401 or _has_any(
        text,
        "unauthorized",
        "authentication failed",
        "login failed",
        "invalid api key",
        "invalid token",
        "missing access_token",
    ):
        return ConnectorErrorInfo(
            ErrorCode.CONNECTOR_AUTH_FAILED,
            "Data source authentication failed",
            detail=safe_detail,
        )

    if _has_any(text, "expired token", "token expired", "session expired", "expired credential"):
        return ConnectorErrorInfo(
            ErrorCode.AUTH_EXPIRED,
            "Data source authentication expired",
            detail=safe_detail,
        )

    if http_status == 403 or _has_any(text, "forbidden", "access denied", "permission denied", "not authorized"):
        return ConnectorErrorInfo(
            ErrorCode.ACCESS_DENIED,
            "Access denied",
            detail=safe_detail,
        )

    if (
        http_status in {408, 502, 503, 504}
        or any(isinstance(exc, TimeoutError) for exc in chain)
        or _has_any(text, "timeout", "timed out")
    ):
        return ConnectorErrorInfo(
            ErrorCode.DB_CONNECTION_FAILED,
            "Data source connection timed out",
            retry=True,
            detail=safe_detail,
        )

    if _has_any(
        text,
        "lost connection",
        "server has gone away",
        "connection reset",
        "connection refused",
        "failed to connect",
        "could not connect",
        "unreachable",
        "network",
        "socket",
        "dns",
        "name resolution",
        "resolve",
    ):
        return ConnectorErrorInfo(
            ErrorCode.DB_CONNECTION_FAILED,
            "Data source connection failed",
            retry=True,
            detail=safe_detail,
        )

    if _has_any(text, "required", "must be provided", "missing", "invalid identifier", "invalid request"):
        return ConnectorErrorInfo(
            ErrorCode.INVALID_REQUEST,
            safe_detail or "Invalid connector request",
            detail=safe_detail,
        )

    if _has_any(
        text,
        "syntax error",
        "sql error",
        "query failed",
        "database error",
        "invalid column",
        "unknown column",
        "relation does not exist",
        "table does not exist",
        "generic_db_engine_error",
    ):
        return ConnectorErrorInfo(
            ErrorCode.DB_QUERY_ERROR,
            "Data source query failed",
            detail=safe_detail,
        )

    if _has_any(
        text,
        "unsupported file type",
        "file not found",
        "no such file",
        "resource not found",
        "not found",
        "parse",
        "decode",
        "format",
        "bucket",
        "blob",
        "container",
    ):
        return ConnectorErrorInfo(
            ErrorCode.DATA_LOAD_ERROR,
            "Failed to load data from the data source",
            detail=safe_detail,
        )

    if operation in {"preview", "import", "refresh", "column_values"}:
        return ConnectorErrorInfo(
            ErrorCode.DATA_LOAD_ERROR,
            "Failed to load data from the data source",
            detail=safe_detail,
        )

    return ConnectorErrorInfo(
        ErrorCode.CONNECTOR_ERROR,
        "Data connector error",
        detail=safe_detail,
    )


def raise_connector_error(error: Exception, *, operation: str = "") -> None:
    raise classify_connector_error(error, operation=operation).to_app_error() from error


def _exception_chain(error: Exception) -> list[BaseException]:
    chain: list[BaseException] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        chain.append(current)
        seen.add(id(current))
        current = current.__cause__ or current.__context__
    return chain


def _http_status(chain: list[BaseException]) -> int | None:
    for exc in chain:
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None)
        if isinstance(status, int):
            return status
    return None


def _has_any(text: str, *needles: str) -> bool:
    return any(needle in text for needle in needles)
