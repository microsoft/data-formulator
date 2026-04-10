"""Tests for the AuthProvider chain initialisation and runtime dispatch.

Background
----------
The refactored ``auth.py`` delegates identity extraction to a pluggable
AuthProvider selected via the ``AUTH_PROVIDER`` environment variable.
These tests verify the chain's initialisation logic, provider dispatch,
anonymous fallback behaviour, and the ``get_sso_token()`` helper.
"""
from __future__ import annotations

import flask
import pytest

import data_formulator.security.auth as auth_module
from data_formulator.security.auth import (
    get_auth_result,
    get_identity_id,
    get_sso_token,
    init_auth,
)
from data_formulator.auth_providers.base import AuthProvider, AuthResult, AuthenticationError
from data_formulator.auth_providers import get_provider_class, list_available_providers

pytestmark = [pytest.mark.backend, pytest.mark.auth]


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------

@pytest.fixture
def app():
    """Minimal Flask app for request-context tests."""
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    return _app


@pytest.fixture(autouse=True)
def _reset_auth_state(monkeypatch):
    """Ensure each test starts with a clean auth module state."""
    monkeypatch.setattr(auth_module, "_provider", None)
    monkeypatch.setattr(auth_module, "_allow_anonymous", True)


# ------------------------------------------------------------------
# Provider discovery
# ------------------------------------------------------------------

class TestProviderDiscovery:

    def test_azure_easyauth_is_discovered(self):
        assert "azure_easyauth" in list_available_providers()

    def test_get_provider_class_returns_class(self):
        cls = get_provider_class("azure_easyauth")
        assert cls is not None
        assert issubclass(cls, AuthProvider)

    def test_unknown_provider_returns_none(self):
        assert get_provider_class("nonexistent") is None


# ------------------------------------------------------------------
# init_auth
# ------------------------------------------------------------------

class TestInitAuth:

    def test_no_env_var_stays_anonymous(self, app, monkeypatch):
        monkeypatch.delenv("AUTH_PROVIDER", raising=False)
        init_auth(app)
        assert auth_module._provider is None
        assert auth_module._allow_anonymous is True

    def test_explicit_anonymous_stays_anonymous(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "anonymous")
        init_auth(app)
        assert auth_module._provider is None

    def test_azure_easyauth_activates(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "azure_easyauth")
        init_auth(app)
        assert auth_module._provider is not None
        assert auth_module._provider.name == "azure_easyauth"

    def test_unknown_provider_logs_error_stays_none(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "totally_bogus")
        init_auth(app)
        assert auth_module._provider is None

    def test_allow_anonymous_false(self, app, monkeypatch):
        monkeypatch.setenv("ALLOW_ANONYMOUS", "false")
        monkeypatch.delenv("AUTH_PROVIDER", raising=False)
        init_auth(app)
        assert auth_module._allow_anonymous is False


# ------------------------------------------------------------------
# get_identity_id — provider dispatch
# ------------------------------------------------------------------

class TestProviderDispatch:

    def test_provider_authenticated_returns_user_prefix(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "azure_easyauth")
        init_auth(app)

        with app.test_request_context(
            headers={"X-MS-CLIENT-PRINCIPAL-ID": "azure-user-123"}
        ):
            identity = get_identity_id()
            assert identity == "user:azure-user-123"

    def test_provider_miss_falls_back_to_anonymous(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "azure_easyauth")
        init_auth(app)

        with app.test_request_context(
            headers={"X-Identity-Id": "550e8400-e29b-41d4-a716-446655440000"}
        ):
            identity = get_identity_id()
            assert identity == "browser:550e8400-e29b-41d4-a716-446655440000"

    def test_provider_miss_no_anonymous_raises(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "azure_easyauth")
        monkeypatch.setenv("ALLOW_ANONYMOUS", "false")
        init_auth(app)

        with app.test_request_context(
            headers={"X-Identity-Id": "some-uuid"}
        ):
            with pytest.raises(ValueError, match="Authentication required"):
                get_identity_id()


# ------------------------------------------------------------------
# get_identity_id — anonymous-only mode (no AUTH_PROVIDER)
# ------------------------------------------------------------------

class TestAnonymousMode:

    def test_browser_identity_works(self, app):
        with app.test_request_context(
            headers={"X-Identity-Id": "my-browser-uuid"}
        ):
            assert get_identity_id() == "browser:my-browser-uuid"

    def test_prefixed_identity_stripped(self, app):
        with app.test_request_context(
            headers={"X-Identity-Id": "browser:my-uuid"}
        ):
            assert get_identity_id() == "browser:my-uuid"

    def test_missing_header_raises(self, app):
        with app.test_request_context():
            with pytest.raises(ValueError, match="X-Identity-Id"):
                get_identity_id()

    def test_spoofed_user_prefix_forced_to_browser(self, app):
        with app.test_request_context(
            headers={"X-Identity-Id": "user:alice@corp.com"}
        ):
            identity = get_identity_id()
            assert identity.startswith("browser:")
            assert "alice@corp.com" in identity


# ------------------------------------------------------------------
# get_sso_token / get_auth_result
# ------------------------------------------------------------------

class TestSSOToken:

    def test_anonymous_mode_returns_none(self, app):
        with app.test_request_context(
            headers={"X-Identity-Id": "browser-uuid"}
        ):
            get_identity_id()
            assert get_sso_token() is None
            assert get_auth_result() is None

    def test_provider_without_token_returns_none(self, app, monkeypatch):
        """Azure EasyAuth does not supply raw_token."""
        monkeypatch.setenv("AUTH_PROVIDER", "azure_easyauth")
        init_auth(app)

        with app.test_request_context(
            headers={"X-MS-CLIENT-PRINCIPAL-ID": "azure-user"}
        ):
            get_identity_id()
            result = get_auth_result()
            assert result is not None
            assert result.user_id == "azure-user"
            assert get_sso_token() is None


# ------------------------------------------------------------------
# AuthenticationError propagation
# ------------------------------------------------------------------

class TestAuthenticationErrorPropagation:

    def test_authentication_error_becomes_value_error(self, app, monkeypatch):
        """When a provider raises AuthenticationError it should surface as ValueError."""

        class _FailingProvider(AuthProvider):
            @property
            def name(self): return "failing"
            def authenticate(self, request):
                raise AuthenticationError("token expired", provider="failing")

        monkeypatch.setattr(auth_module, "_provider", _FailingProvider())

        with app.test_request_context(
            headers={"Authorization": "Bearer bad-token"}
        ):
            with pytest.raises(ValueError, match="Authentication failed"):
                get_identity_id()
