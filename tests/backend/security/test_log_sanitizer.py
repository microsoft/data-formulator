# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for log sanitization utilities (log_sanitizer.py).

Covers URL credential masking, dict parameter sanitization, token redaction,
the SensitiveDataFilter safety net, and edge cases.
"""

import logging
import os

import pytest

from data_formulator.security.log_sanitizer import (
    SensitiveDataFilter,
    _apply_patterns,
    redact_token,
    sanitize_params,
    sanitize_url,
)

pytestmark = [pytest.mark.backend]


# ── sanitize_url ──────────────────────────────────────────────────────────


class TestSanitizeUrl:

    def test_url_with_password(self):
        url = "https://admin:s3cret@idp.example.com/realms/main"
        result = sanitize_url(url)
        assert "s3cret" not in result
        assert "admin" in result
        assert "***@idp.example.com" in result

    def test_url_without_credentials(self):
        url = "https://idp.example.com/.well-known/openid-configuration"
        assert sanitize_url(url) == url

    def test_url_with_port(self):
        url = "postgresql://user:P@ssw0rd@db.host:5432/mydb"
        result = sanitize_url(url)
        assert "P@ssw0rd" not in result
        assert "user:***@" in result
        assert "db.host:5432" in result

    def test_empty_string(self):
        assert sanitize_url("") == ""

    def test_non_url_string(self):
        assert sanitize_url("just a plain string") == "just a plain string"

    def test_s3_url_no_creds(self):
        url = "s3://my-bucket/path/to/file.parquet"
        assert sanitize_url(url) == url

    def test_multiple_urls_in_string(self):
        text = "primary=https://a:secret1@host1 fallback=https://b:secret2@host2"
        result = sanitize_url(text)
        assert "secret1" not in result
        assert "secret2" not in result

    def test_url_with_sensitive_query_params(self):
        url = (
            "https://idp.example.com/callback?"
            "client_secret=supersecret&access-token=tok123&redirect_uri=https%3A%2F%2Fapp.example.com"
        )
        result = sanitize_url(url)
        assert "supersecret" not in result
        assert "tok123" not in result
        assert "client_secret=***" in result
        assert "access-token=***" in result
        assert "redirect_uri=https%3A%2F%2Fapp.example.com" in result

    def test_url_without_sensitive_query_params_preserves_query(self):
        url = "https://idp.example.com/callback?redirect_uri=https%3A%2F%2Fapp.example.com&state=a%2Bb"
        assert sanitize_url(url) == url


# ── sanitize_params ───────────────────────────────────────────────────────


class TestSanitizeParams:

    def test_masks_password(self):
        params = {"server": "db01", "user": "admin", "password": "P@ssw0rd!"}
        result = sanitize_params(params)
        assert result["password"] == "***"
        assert result["server"] == "db01"
        assert result["user"] == "admin"

    def test_masks_multiple_keys(self):
        params = {
            "host": "localhost",
            "api_key": "sk-abcdef",
            "secret": "mysecret",
            "token": "tok123",
        }
        result = sanitize_params(params)
        assert result["api_key"] == "***"
        assert result["secret"] == "***"
        assert result["token"] == "***"
        assert result["host"] == "localhost"

    def test_case_insensitive(self):
        params = {"Password": "secret", "API_KEY": "key123"}
        result = sanitize_params(params)
        assert result["Password"] == "***"
        assert result["API_KEY"] == "***"

    def test_nested_dict(self):
        params = {
            "db": {
                "host": "localhost",
                "password": "nested_secret",
            },
            "name": "test",
        }
        result = sanitize_params(params)
        assert result["db"]["password"] == "***"
        assert result["db"]["host"] == "localhost"

    def test_does_not_mutate_original(self):
        params = {"password": "original"}
        result = sanitize_params(params)
        assert params["password"] == "original"
        assert result["password"] == "***"

    def test_extra_keys(self):
        params = {"custom_secret_field": "val", "normal": "ok"}
        result = sanitize_params(params, extra_keys={"custom_secret_field"})
        assert result["custom_secret_field"] == "***"
        assert result["normal"] == "ok"

    def test_empty_dict(self):
        assert sanitize_params({}) == {}

    def test_connection_string(self):
        params = {"connection_string": "Server=db;Password=secret;"}
        result = sanitize_params(params)
        assert result["connection_string"] == "***"


# ── redact_token ──────────────────────────────────────────────────────────


class TestRedactToken:

    def test_long_token(self):
        token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature"
        result = redact_token(token)
        assert result == "eyJh...ture"
        assert len(result) < len(token)

    def test_short_token_fully_masked(self):
        assert redact_token("abc") == "[REDACTED]"
        assert redact_token("12345678") == "[REDACTED]"

    def test_empty_token(self):
        assert redact_token("") == ""

    def test_custom_visible(self):
        token = "abcdefghijklmnop"
        result = redact_token(token, visible=6)
        assert result == "abcdef...klmnop"

    def test_boundary_length(self):
        assert redact_token("12345678", visible=4) == "[REDACTED]"
        assert redact_token("123456789", visible=4) == "1234...6789"


# ── _apply_patterns (filter internals) ────────────────────────────────────


class TestApplyPatterns:

    def test_url_credentials(self):
        text = "Connecting to https://user:mypassword@db.example.com:5432/db"
        result = _apply_patterns(text)
        assert "mypassword" not in result
        assert "***@db.example.com" in result

    def test_url_query_credentials(self):
        text = "Redirecting to https://idp.example.com/cb?token=secret-token&state=keep"
        result = _apply_patterns(text)
        assert "secret-token" not in result
        assert "token=***" in result
        assert "state=keep" in result

    def test_key_value_password(self):
        text = "Config: password=SuperSecret123"
        result = _apply_patterns(text)
        assert "SuperSecret123" not in result
        assert "password=***" in result

    def test_key_value_api_key(self):
        text = "Using api_key=sk-proj-abc123def456"
        result = _apply_patterns(text)
        assert "sk-proj-abc123def456" not in result

    def test_key_value_with_colon(self):
        text = "secret: my_secret_value"
        result = _apply_patterns(text)
        assert "my_secret_value" not in result

    def test_bearer_token(self):
        token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature"
        text = f"Authorization: Bearer {token}"
        result = _apply_patterns(text)
        assert token not in result

    def test_bare_jwt(self):
        jwt_str = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9"
        text = f"Validating token {jwt_str}"
        result = _apply_patterns(text)
        assert jwt_str not in result

    def test_dict_repr_with_password(self):
        text = "Params: {'password': 'secret123', 'host': 'localhost'}"
        result = _apply_patterns(text)
        assert "secret123" not in result
        assert "localhost" in result

    def test_dict_repr_double_quotes(self):
        text = '{"password": "secret123", "host": "localhost"}'
        result = _apply_patterns(text)
        assert "secret123" not in result

    def test_no_false_positive(self):
        text = "Processing 42 records from table users"
        assert _apply_patterns(text) == text

    def test_no_false_positive_on_normal_url(self):
        text = "Fetching https://api.example.com/v1/data"
        assert _apply_patterns(text) == text

    def test_mixed_patterns(self):
        text = (
            "Connecting to https://admin:pass@host "
            "with api_key=sk-12345 "
            "and Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig"
        )
        result = _apply_patterns(text)
        assert "pass" not in result.split("@")[0].split(":")[-1]
        assert "sk-12345" not in result
        assert "eyJhbGciOiJSUzI1NiJ9.payload.sig" not in result


# ── SensitiveDataFilter (integration) ─────────────────────────────────────


class TestSensitiveDataFilter:

    @pytest.fixture()
    def logger_with_filter(self):
        """Create an isolated logger with SensitiveDataFilter attached."""
        test_logger = logging.getLogger("test.log_sanitizer")
        test_logger.setLevel(logging.DEBUG)
        handler = logging.StreamHandler()
        handler.addFilter(SensitiveDataFilter())
        formatter = logging.Formatter("%(message)s")
        handler.setFormatter(formatter)
        test_logger.addHandler(handler)
        yield test_logger
        test_logger.removeHandler(handler)

    def test_filter_redacts_password_in_message(self, logger_with_filter, capsys):
        logger_with_filter.info("password=SuperSecret")
        captured = capsys.readouterr()
        assert "SuperSecret" not in captured.err
        # Filter formats the message, handler outputs via formatter

    def test_filter_redacts_url_creds(self, logger_with_filter, capsys):
        logger_with_filter.warning(
            "Failed for %s", "https://u:secret@host/path"
        )
        captured = capsys.readouterr()
        assert "secret" not in captured.err.replace("***", "")

    def test_filter_percent_style_args(self, logger_with_filter, capsys):
        logger_with_filter.info("key=%s secret=%s", "mykey", "mysecret")
        captured = capsys.readouterr()
        assert "mysecret" not in captured.err.replace("***", "")

    def test_filter_disabled_by_env(self, logger_with_filter, capsys, monkeypatch):
        monkeypatch.setenv("LOG_SANITIZE", "false")
        logger_with_filter.info("password=visible_secret")
        captured = capsys.readouterr()
        # When disabled, the raw message should pass through.
        # The filter still returns True (record passes), but no redaction.
        # Note: the output depends on handler config; we just verify the
        # filter didn't raise.

    def test_filter_always_returns_true(self):
        f = SensitiveDataFilter()
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="", lineno=0,
            msg="password=secret", args=None, exc_info=None,
        )
        assert f.filter(record) is True
        assert "secret" not in record.msg

    def test_filter_handles_bad_format_args(self):
        """Filter should not crash on mismatched %-style args."""
        f = SensitiveDataFilter()
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="", lineno=0,
            msg="value is %d", args=("not_a_number",), exc_info=None,
        )
        assert f.filter(record) is True

    def test_filter_sanitizes_exc_text(self):
        f = SensitiveDataFilter()
        record = logging.LogRecord(
            name="test", level=logging.ERROR, pathname="", lineno=0,
            msg="Error occurred", args=None, exc_info=None,
        )
        record.exc_text = "ConnectionError: https://user:leaked@host/db"
        f.filter(record)
        assert "leaked" not in record.exc_text
        assert "***" in record.exc_text
