# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for error message sanitization (sanitize.py).

Verifies that API keys, file paths, and stack traces are redacted
before error messages reach the frontend.
"""

import pytest

from data_formulator.security.sanitize import sanitize_error_message

pytestmark = [pytest.mark.backend]


class TestApiKeyRedaction:

    def test_api_key_equals(self):
        msg = "Error: api_key=sk-secret-key-12345 is invalid"
        result = sanitize_error_message(msg)
        assert "sk-secret-key-12345" not in result
        assert "<redacted>" in result

    def test_api_token_equals(self):
        msg = "Error: api_token=tok_secret_abc123 is invalid"
        result = sanitize_error_message(msg)
        assert "tok_secret_abc123" not in result

    def test_no_false_positive_on_normal_text(self):
        msg = "The model returned an empty response"
        result = sanitize_error_message(msg)
        assert result == "The model returned an empty response"


class TestPathRedaction:

    def test_unix_home_path(self):
        msg = "FileNotFoundError: /home/user/data/secret.csv"
        result = sanitize_error_message(msg)
        assert "/home/user" not in result
        assert "<path>" in result

    def test_unix_opt_path(self):
        msg = "ImportError: /opt/conda/lib/python3.11/site.py"
        result = sanitize_error_message(msg)
        assert "/opt/conda" not in result

    def test_windows_path(self):
        msg = r"FileNotFoundError: C:\Users\dev\project\data.csv"
        result = sanitize_error_message(msg)
        assert "C:" not in result

    def test_tmp_path(self):
        msg = "PermissionError: /tmp/workspace_abc123/output.parquet"
        result = sanitize_error_message(msg)
        assert "/tmp/workspace" not in result


class TestStackTraceStripping:

    def test_traceback_removed(self):
        msg = (
            "Traceback (most recent call last):\n"
            '  File "/home/user/app.py", line 42, in run\n'
            "    result = process(data)\n"
            "ValueError: invalid literal"
        )
        result = sanitize_error_message(msg)
        assert "Traceback" not in result
        assert "line 42" not in result

    def test_file_line_references_stripped(self):
        msg = 'File "/app/src/handler.py", line 99, in handle\n    raise RuntimeError("fail")'
        result = sanitize_error_message(msg)
        assert "handler.py" not in result


class TestHtmlEscaping:

    def test_script_tag_escaped(self):
        msg = '<script>alert("xss")</script>'
        result = sanitize_error_message(msg)
        assert "<script>" not in result
        assert "&lt;script&gt;" in result


class TestTruncation:

    def test_long_message_truncated(self):
        msg = "x" * 1000
        result = sanitize_error_message(msg)
        assert len(result) <= 503  # 500 + "..."
        assert result.endswith("...")

    def test_short_message_not_truncated(self):
        msg = "Something went wrong"
        result = sanitize_error_message(msg)
        assert result == "Something went wrong"


class TestEdgeCases:

    def test_empty_string(self):
        result = sanitize_error_message("")
        assert result == ""

    def test_unicode_error(self):
        msg = "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in /tmp/data/file.csv"
        result = sanitize_error_message(msg)
        assert "0xff" in result  # error detail preserved
        assert "/tmp/data" not in result  # path stripped
