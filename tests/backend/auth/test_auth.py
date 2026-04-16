# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for authentication and identity management (auth.py).

Verifies that identity extraction, validation, and namespace isolation
work correctly — especially that client-provided headers cannot spoof
an authenticated user identity.
"""

from unittest.mock import patch

import flask
import pytest

import data_formulator.auth.identity as auth_module
from data_formulator.auth.identity import get_identity_id, _validate_identity_value
from data_formulator.auth.providers.azure_easyauth import AzureEasyAuthProvider

pytestmark = [pytest.mark.backend]


@pytest.fixture
def app():
    """Minimal Flask app for request-context tests."""
    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def azure_provider(monkeypatch):
    """Activate the Azure EasyAuth provider for the duration of a test."""
    monkeypatch.setattr(auth_module, "_provider", AzureEasyAuthProvider())


# ===================================================================
# _validate_identity_value
# ===================================================================

class TestValidateIdentityValue:

    def test_valid_uuid(self):
        val = _validate_identity_value("550e8400-e29b-41d4-a716-446655440000", "test")
        assert val == "550e8400-e29b-41d4-a716-446655440000"

    def test_valid_email(self):
        val = _validate_identity_value("alice@example.com", "test")
        assert val == "alice@example.com"

    def test_strips_whitespace(self):
        val = _validate_identity_value("  alice@example.com  ", "test")
        assert val == "alice@example.com"

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="Empty"):
            _validate_identity_value("", "test")

    def test_whitespace_only_raises(self):
        with pytest.raises(ValueError, match="Empty"):
            _validate_identity_value("   ", "test")

    def test_too_long_raises(self):
        with pytest.raises(ValueError, match="exceeds"):
            _validate_identity_value("a" * 300, "test")

    def test_path_separator_rejected(self):
        with pytest.raises(ValueError, match="disallowed"):
            _validate_identity_value("../../etc/passwd", "test")

    def test_shell_metachar_rejected(self):
        with pytest.raises(ValueError, match="disallowed"):
            _validate_identity_value("user; rm -rf /", "test")

    def test_control_chars_rejected(self):
        with pytest.raises(ValueError, match="disallowed"):
            _validate_identity_value("user\x00name", "test")


# ===================================================================
# get_identity_id — namespace isolation
# ===================================================================

class TestGetIdentityId:

    def test_azure_principal_returns_user_prefix(self, app, azure_provider):
        with app.test_request_context(
            headers={"X-MS-CLIENT-PRINCIPAL-ID": "azure-user-123"}
        ):
            identity = get_identity_id()
            assert identity == "user:azure-user-123"

    def test_browser_identity_returns_browser_prefix(self, app):
        with app.test_request_context(
            headers={"X-Identity-Id": "550e8400-e29b-41d4-a716-446655440000"}
        ):
            identity = get_identity_id()
            assert identity == "browser:550e8400-e29b-41d4-a716-446655440000"

    def test_client_cannot_spoof_user_prefix(self, app):
        """Even if X-Identity-Id sends 'user:alice', the result is browser:alice."""
        with app.test_request_context(
            headers={"X-Identity-Id": "user:alice@example.com"}
        ):
            identity = get_identity_id()
            assert identity.startswith("browser:")
            assert "alice@example.com" in identity

    def test_azure_header_takes_priority_over_browser(self, app, azure_provider):
        """When both headers are present, Azure provider wins."""
        with app.test_request_context(
            headers={
                "X-MS-CLIENT-PRINCIPAL-ID": "azure-user-456",
                "X-Identity-Id": "browser-uuid-789",
            }
        ):
            identity = get_identity_id()
            assert identity == "user:azure-user-456"

    def test_missing_all_headers_raises(self, app):
        with app.test_request_context():
            with pytest.raises(ValueError, match="X-Identity-Id"):
                get_identity_id()

    def test_malformed_azure_header_rejected(self, app, azure_provider):
        with app.test_request_context(
            headers={"X-MS-CLIENT-PRINCIPAL-ID": "../../etc/passwd"}
        ):
            with pytest.raises(ValueError, match="disallowed"):
                get_identity_id()

    def test_browser_identity_strips_prefix(self, app):
        """If client sends 'browser:abc', the 'browser:' prefix is stripped and re-added."""
        with app.test_request_context(
            headers={"X-Identity-Id": "browser:my-uuid-123"}
        ):
            identity = get_identity_id()
            assert identity == "browser:my-uuid-123"
