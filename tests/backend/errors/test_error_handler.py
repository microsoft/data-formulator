# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for the unified error handler (error_handler.py).

Covers three layers:
1. ``classify_and_wrap_llm_error`` — LLM exception → AppError with correct code
2. ``stream_error_event`` — AppError → valid NDJSON error line
3. ``register_error_handlers`` — Flask global handlers return unified JSON
"""
from __future__ import annotations

import json

import flask
import pytest

from data_formulator.errors import AppError, ErrorCode

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def app():
    """Minimal Flask app with error handlers registered."""
    test_app = flask.Flask(__name__)
    test_app.config["TESTING"] = True

    from data_formulator.error_handler import register_error_handlers
    register_error_handlers(test_app)

    @test_app.route("/raise-app-error")
    def raise_app_error():
        raise AppError(
            ErrorCode.TABLE_NOT_FOUND, "Table not found",
            status_code=404,
        )

    @test_app.route("/raise-app-error-retryable")
    def raise_app_error_retryable():
        raise AppError(
            ErrorCode.LLM_RATE_LIMIT, "Rate limited",
            status_code=429, retry=True, detail="retry-after: 30",
        )

    @test_app.route("/raise-unexpected")
    def raise_unexpected():
        raise RuntimeError("something broke")

    @test_app.route("/api/missing-resource")
    def missing():
        flask.abort(404)

    return test_app


@pytest.fixture()
def client(app):
    return app.test_client()


# ---------------------------------------------------------------------------
# classify_and_wrap_llm_error
# ---------------------------------------------------------------------------

class TestClassifyAndWrapLlmError:

    @pytest.fixture(autouse=True)
    def _import(self):
        from data_formulator.error_handler import classify_and_wrap_llm_error
        self.classify = classify_and_wrap_llm_error

    def test_auth_error(self) -> None:
        exc = Exception("Error code: 401 - Unauthorized, invalid api key")
        result = self.classify(exc)
        assert isinstance(result, AppError)
        assert result.code == ErrorCode.LLM_AUTH_FAILED
        assert result.retry is False

    def test_rate_limit(self) -> None:
        exc = Exception("Error code: 429 - Rate limit exceeded")
        result = self.classify(exc)
        assert result.code == ErrorCode.LLM_RATE_LIMIT
        assert result.retry is True

    def test_context_too_long(self) -> None:
        exc = Exception("This model's maximum context length is 128000 tokens")
        result = self.classify(exc)
        assert result.code == ErrorCode.LLM_CONTEXT_TOO_LONG

    def test_model_not_found(self) -> None:
        exc = Exception("The model 'gpt-99' does not exist")
        result = self.classify(exc)
        assert result.code == ErrorCode.LLM_MODEL_NOT_FOUND

    def test_timeout(self) -> None:
        exc = Exception("Connection timed out after 30s")
        result = self.classify(exc)
        assert result.code == ErrorCode.LLM_TIMEOUT
        assert result.retry is True

    def test_service_error_502(self) -> None:
        exc = Exception("502 Bad Gateway")
        result = self.classify(exc)
        assert result.code == ErrorCode.LLM_SERVICE_ERROR
        assert result.retry is True

    def test_content_filter(self) -> None:
        exc = Exception("The response was filtered due to content_filter policy")
        result = self.classify(exc)
        assert result.code == ErrorCode.LLM_CONTENT_FILTERED

    def test_access_denied(self) -> None:
        exc = Exception("403 Forbidden: access denied to this resource")
        result = self.classify(exc)
        assert result.code == ErrorCode.ACCESS_DENIED

    def test_bad_request(self) -> None:
        exc = Exception("400 Bad request - malformed JSON body")
        result = self.classify(exc)
        assert result.code == ErrorCode.LLM_UNKNOWN_ERROR  # 400 is ambiguous, falls to unknown

    def test_unknown_error(self) -> None:
        exc = Exception("Some completely unknown error xyz")
        result = self.classify(exc)
        assert result.code == ErrorCode.LLM_UNKNOWN_ERROR
        assert result.retry is False

    def test_message_never_contains_original_exception(self) -> None:
        secret = "api_key=sk-secret-12345-password"
        exc = Exception(f"Auth failure: {secret}")
        result = self.classify(exc)
        assert secret not in result.message
        assert "sk-secret" not in result.message

    def test_detail_contains_original_for_logging(self) -> None:
        exc = Exception("timeout connecting to endpoint")
        result = self.classify(exc)
        assert result.detail is not None
        assert "timeout" in result.detail


# ---------------------------------------------------------------------------
# stream_error_event
# ---------------------------------------------------------------------------

class TestStreamErrorEvent:

    @pytest.fixture(autouse=True)
    def _import(self, app):
        from data_formulator.error_handler import stream_error_event
        self.stream_error_event = stream_error_event
        self.app = app

    def test_output_is_valid_ndjson_line(self) -> None:
        with self.app.app_context():
            err = AppError(ErrorCode.TABLE_NOT_FOUND, "not found", status_code=404)
            line = self.stream_error_event(err)
            assert line.endswith("\n")
            assert "\n" not in line.rstrip("\n")
            parsed = json.loads(line)
            assert parsed["type"] == "error"

    def test_error_structure(self) -> None:
        with self.app.app_context():
            err = AppError(ErrorCode.LLM_RATE_LIMIT, "slow down", retry=True)
            parsed = json.loads(self.stream_error_event(err))
            assert parsed["error"]["code"] == "LLM_RATE_LIMIT"
            assert parsed["error"]["message"] == "slow down"
            assert parsed["error"]["retry"] is True

    def test_token_included_when_provided(self) -> None:
        with self.app.app_context():
            err = AppError(ErrorCode.INTERNAL_ERROR, "oops")
            parsed = json.loads(self.stream_error_event(err, token="abc-123"))
            assert parsed["token"] == "abc-123"

    def test_token_absent_when_empty(self) -> None:
        with self.app.app_context():
            err = AppError(ErrorCode.INTERNAL_ERROR, "oops")
            parsed = json.loads(self.stream_error_event(err))
            assert "token" not in parsed

    def test_raw_exception_wrapped(self) -> None:
        with self.app.app_context():
            line = self.stream_error_event(ValueError("db cursor broken"))
            parsed = json.loads(line)
            assert parsed["type"] == "error"
            assert parsed["error"]["code"] == ErrorCode.INTERNAL_ERROR
            assert "db cursor broken" not in parsed["error"]["message"]

    def test_unicode_safe(self) -> None:
        with self.app.app_context():
            err = AppError(ErrorCode.TABLE_NOT_FOUND, "表不存在")
            line = self.stream_error_event(err)
            parsed = json.loads(line)
            assert parsed["error"]["message"] == "表不存在"


# ---------------------------------------------------------------------------
# register_error_handlers — Flask integration
# ---------------------------------------------------------------------------

class TestRegisterErrorHandlers:

    def test_app_error_returns_200_with_error_body(self, client) -> None:
        resp = client.get("/raise-app-error")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == "TABLE_NOT_FOUND"
        assert data["error"]["message"] == "Table not found"
        assert data["error"]["retry"] is False

    def test_app_error_retryable(self, client) -> None:
        resp = client.get("/raise-app-error-retryable")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["error"]["retry"] is True
        assert "detail" not in data["error"]  # not debug mode

    def test_app_error_debug_mode_includes_detail(self, app) -> None:
        app.debug = True
        with app.test_client() as c:
            resp = c.get("/raise-app-error-retryable")
            data = resp.get_json()
            assert data["error"]["detail"] == "retry-after: 30"

    def test_unexpected_error_returns_500(self, client) -> None:
        resp = client.get("/raise-unexpected")
        assert resp.status_code == 500
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == ErrorCode.INTERNAL_ERROR
        assert "broke" not in data["error"]["message"]

    def test_unexpected_error_debug_includes_traceback(self, app) -> None:
        app.debug = True
        with app.test_client() as c:
            resp = c.get("/raise-unexpected")
            data = resp.get_json()
            assert "detail" in data["error"]
            assert "RuntimeError" in data["error"]["detail"]

    def test_413_returns_unified_format(self, app) -> None:
        @app.route("/api/upload", methods=["POST"])
        def upload():
            _ = flask.request.get_data()
            return "ok"

        app.config["MAX_CONTENT_LENGTH"] = 1
        with app.test_client() as c:
            resp = c.post("/api/upload", data=b"x" * 10,
                          content_type="application/octet-stream")
            assert resp.status_code == 413
            data = resp.get_json()
            assert data["status"] == "error"
            assert data["error"]["code"] == ErrorCode.FILE_TOO_LARGE

    def test_api_404_returns_json(self, client) -> None:
        resp = client.get("/api/nonexistent-route")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["error"]["code"] == "NOT_FOUND"

    def test_response_has_json_content_type(self, client) -> None:
        resp = client.get("/raise-app-error")
        assert "application/json" in resp.content_type


# ---------------------------------------------------------------------------
# Request ID middleware
# ---------------------------------------------------------------------------

class TestRequestIdMiddleware:

    def test_response_has_request_id_header(self, client) -> None:
        resp = client.get("/raise-app-error")
        assert "X-Request-Id" in resp.headers
        assert len(resp.headers["X-Request-Id"]) > 0

    def test_client_provided_request_id_is_echoed(self, client) -> None:
        resp = client.get("/raise-app-error", headers={"X-Request-Id": "my-trace-123"})
        assert resp.headers["X-Request-Id"] == "my-trace-123"

    def test_request_id_is_uuid_when_not_provided(self, client) -> None:
        resp = client.get("/raise-app-error")
        rid = resp.headers["X-Request-Id"]
        parts = rid.split("-")
        assert len(parts) == 5  # UUID4 format: 8-4-4-4-12


# ---------------------------------------------------------------------------
# stream_warning_event
# ---------------------------------------------------------------------------

class TestStreamWarningEvent:

    @pytest.fixture(autouse=True)
    def _import(self):
        from data_formulator.error_handler import stream_warning_event
        self.stream_warning_event = stream_warning_event

    def test_output_is_valid_ndjson_line(self) -> None:
        line = self.stream_warning_event("table unavailable")
        assert line.endswith("\n")
        assert "\n" not in line.rstrip("\n")
        parsed = json.loads(line)
        assert parsed["type"] == "warning"

    def test_warning_structure(self) -> None:
        parsed = json.loads(self.stream_warning_event("table unavailable"))
        assert parsed["warning"]["message"] == "table unavailable"
        assert "detail" not in parsed["warning"]

    def test_detail_included(self) -> None:
        parsed = json.loads(
            self.stream_warning_event("table unavailable", detail="FileNotFoundError")
        )
        assert parsed["warning"]["detail"] == "FileNotFoundError"

    def test_message_code_included(self) -> None:
        parsed = json.loads(
            self.stream_warning_event("table unavailable", message_code="TABLE_READ_FAILED")
        )
        assert parsed["warning"]["message_code"] == "TABLE_READ_FAILED"

    def test_unicode_safe(self) -> None:
        line = self.stream_warning_event("表数据不可用")
        parsed = json.loads(line)
        assert parsed["warning"]["message"] == "表数据不可用"


# ---------------------------------------------------------------------------
# collect_stream_warning / flush_stream_warnings
# ---------------------------------------------------------------------------

class TestCollectAndFlushStreamWarnings:

    @pytest.fixture(autouse=True)
    def _import(self, app):
        from data_formulator.error_handler import (
            collect_stream_warning,
            flush_stream_warnings,
        )
        self.collect = collect_stream_warning
        self.flush = flush_stream_warnings
        self.app = app

    def test_no_warnings_returns_empty(self) -> None:
        with self.app.test_request_context("/"):
            assert self.flush() == []

    def test_collect_then_flush(self) -> None:
        with self.app.test_request_context("/"):
            self.collect("warn 1")
            self.collect("warn 2", detail="extra")
            lines = self.flush()
            assert len(lines) == 2
            p1 = json.loads(lines[0])
            assert p1["type"] == "warning"
            assert p1["warning"]["message"] == "warn 1"
            p2 = json.loads(lines[1])
            assert p2["warning"]["detail"] == "extra"

    def test_flush_clears_accumulator(self) -> None:
        with self.app.test_request_context("/"):
            self.collect("x")
            self.flush()
            assert self.flush() == []

    def test_outside_request_context_is_noop(self) -> None:
        self.collect("should not crash")
        assert self.flush() == []


# ---------------------------------------------------------------------------
# json_ok — success response helper
# ---------------------------------------------------------------------------

class TestJsonOk:

    @pytest.fixture(autouse=True)
    def _import(self, app):
        from data_formulator.error_handler import json_ok
        self.json_ok = json_ok
        self.app = app

    def test_basic_success(self) -> None:
        with self.app.test_request_context("/"):
            resp, status = self.json_ok({"tables": ["a", "b"]})
            body = resp.get_json()
            assert status == 200
            assert body["status"] == "success"
            assert body["data"] == {"tables": ["a", "b"]}

    def test_none_data(self) -> None:
        with self.app.test_request_context("/"):
            resp, status = self.json_ok()
            body = resp.get_json()
            assert status == 200
            assert body["data"] is None

    def test_custom_status_code(self) -> None:
        with self.app.test_request_context("/"):
            resp, status = self.json_ok({"id": 1}, status_code=201)
            assert status == 201

    def test_extra_fields_merged(self) -> None:
        with self.app.test_request_context("/"):
            resp, status = self.json_ok({"x": 1}, token="tok-1")
            body = resp.get_json()
            assert body["token"] == "tok-1"
            assert body["data"] == {"x": 1}

    def test_status_field_is_success_not_ok(self) -> None:
        with self.app.test_request_context("/"):
            resp, _ = self.json_ok({})
            body = resp.get_json()
            assert body["status"] == "success"
            assert body["status"] != "ok"


# ---------------------------------------------------------------------------
# stream_preflight_error — streaming pre-check helper
# ---------------------------------------------------------------------------

class TestStreamPreflightError:

    @pytest.fixture(autouse=True)
    def _import(self, app):
        from data_formulator.error_handler import stream_preflight_error
        self.stream_preflight_error = stream_preflight_error
        self.app = app

    def test_always_returns_http_200(self) -> None:
        with self.app.test_request_context("/"):
            err = AppError(ErrorCode.INVALID_REQUEST, "Bad input")
            resp, status = self.stream_preflight_error(err)
            assert status == 200

    def test_error_envelope_structure(self) -> None:
        with self.app.test_request_context("/"):
            err = AppError(ErrorCode.VALIDATION_ERROR, "Missing field")
            resp, _ = self.stream_preflight_error(err)
            body = resp.get_json()
            assert body["status"] == "error"
            assert body["error"]["code"] == "VALIDATION_ERROR"
            assert body["error"]["message"] == "Missing field"
            assert body["error"]["retry"] is False

    def test_content_type_is_json_not_ndjson(self) -> None:
        with self.app.test_request_context("/"):
            err = AppError(ErrorCode.INVALID_REQUEST, "oops")
            resp, _ = self.stream_preflight_error(err)
            assert "application/json" in resp.content_type

    def test_debug_mode_includes_detail(self) -> None:
        self.app.debug = True
        with self.app.test_request_context("/"):
            err = AppError(ErrorCode.INTERNAL_ERROR, "Oops", detail="stack trace")
            resp, _ = self.stream_preflight_error(err)
            body = resp.get_json()
            assert body["error"]["detail"] == "stack trace"
        self.app.debug = False


# ---------------------------------------------------------------------------
# ERROR_CODE_HTTP_STATUS mapping completeness
# ---------------------------------------------------------------------------

class TestErrorCodeHttpStatusMapping:

    def test_auth_codes_have_non_200_http_status(self) -> None:
        from data_formulator.errors import ERROR_CODE_HTTP_STATUS
        assert ErrorCode.AUTH_REQUIRED in ERROR_CODE_HTTP_STATUS
        assert ErrorCode.AUTH_EXPIRED in ERROR_CODE_HTTP_STATUS
        assert ErrorCode.ACCESS_DENIED in ERROR_CODE_HTTP_STATUS

    def test_auth_http_statuses_are_valid(self) -> None:
        from data_formulator.errors import ERROR_CODE_HTTP_STATUS
        for code, status in ERROR_CODE_HTTP_STATUS.items():
            assert status in (401, 403), (
                f"{code} has unexpected HTTP status {status}; "
                "only auth codes should be non-200"
            )

    def test_non_auth_app_error_returns_200(self) -> None:
        err = AppError(ErrorCode.TABLE_NOT_FOUND, "not found")
        assert err.get_http_status() == 200

    def test_auth_app_error_returns_non_200(self) -> None:
        err = AppError(ErrorCode.ACCESS_DENIED, "forbidden")
        assert err.get_http_status() == 403

    def test_unknown_code_defaults_to_200(self) -> None:
        err = AppError("CUSTOM_CODE", "custom", status_code=418)
        assert err.get_http_status() == 200
