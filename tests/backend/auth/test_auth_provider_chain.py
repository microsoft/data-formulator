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

import data_formulator.auth.identity as auth_module
from data_formulator.auth.identity import (
    get_auth_result,
    get_identity_id,
    get_sso_token,
    init_auth,
)
from data_formulator.auth.providers.base import AuthProvider, AuthResult, AuthenticationError
from data_formulator.auth.providers import get_provider_class, list_available_providers
from data_formulator.auth.identity import _validate_identity_value

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
    monkeypatch.setattr(auth_module, "_localhost_identity", None)


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


# ------------------------------------------------------------------
# Provider discovery — all Phase 1 providers
# ------------------------------------------------------------------

class TestAllPhase1ProvidersDiscovered:

    def test_github_discovered(self):
        assert "github" in list_available_providers()


# ------------------------------------------------------------------
# OIDC provider via init_auth (end-to-end without real IdP)
# ------------------------------------------------------------------

class TestOIDCViaInitAuth:
    """Verify that AUTH_PROVIDER=oidc activates OIDCProvider.

    These tests don't verify JWT validation (see test_oidc_provider.py);
    they only confirm init_auth wiring and the chain's behaviour when
    the OIDC provider is active but the request has no Bearer token.
    """

    def test_oidc_activates_when_configured(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "oidc")
        monkeypatch.setenv("OIDC_ISSUER_URL", "https://idp.example.com")
        monkeypatch.setenv("OIDC_CLIENT_ID", "test-client")
        init_auth(app)
        assert auth_module._provider is not None
        assert auth_module._provider.name == "oidc"

    def test_oidc_disabled_without_env_vars(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "oidc")
        monkeypatch.delenv("OIDC_ISSUER_URL", raising=False)
        monkeypatch.delenv("OIDC_CLIENT_ID", raising=False)
        init_auth(app)
        assert auth_module._provider is None

    def test_oidc_no_bearer_falls_back_to_anonymous(self, app, monkeypatch):
        monkeypatch.setenv("AUTH_PROVIDER", "oidc")
        monkeypatch.setenv("OIDC_ISSUER_URL", "https://idp.example.com")
        monkeypatch.setenv("OIDC_CLIENT_ID", "test-client")
        init_auth(app)

        with app.test_request_context(
            headers={"X-Identity-Id": "browser-uuid-123"}
        ):
            identity = get_identity_id()
            assert identity == "browser:browser-uuid-123"


# ------------------------------------------------------------------
# Identity regex — OIDC sub claim characters
# ------------------------------------------------------------------

class TestIdentityRegexExpansion:

    @pytest.mark.parametrize("value", [
        "auth0|5f1234abc",
        "github:12345",
        "user+tag@example.com",
    ])
    def test_oidc_style_sub_claims_accepted(self, value):
        assert _validate_identity_value(value, "test") == value

    def test_space_still_rejected(self):
        with pytest.raises(ValueError, match="disallowed"):
            _validate_identity_value("user name", "test")


# ------------------------------------------------------------------
# Single-user localhost mode follows the listening address
# ------------------------------------------------------------------

class TestSingleUserMode:
    """Single-user mode treats every request as the machine's owner, so it
    must not apply to a server other machines can reach (MSRC 168681)."""

    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch):
        for name in ("AUTH_PROVIDER", "HOST", "DF_SINGLE_USER"):
            monkeypatch.delenv(name, raising=False)

    @pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
    def test_loopback_host_is_single_user(self, app, host):
        app.config["CLI_ARGS"] = {"host": host}
        init_auth(app)
        assert auth_module.is_local_mode()

    def test_network_host_is_anonymous(self, app):
        app.config["CLI_ARGS"] = {"host": "0.0.0.0"}
        init_auth(app)
        assert not auth_module.is_local_mode()
        with app.test_request_context(headers={"X-Identity-Id": "550e8400-e29b-41d4-a716-446655440000"}):
            assert get_identity_id() == "browser:550e8400-e29b-41d4-a716-446655440000"

    def test_unknown_listening_address_is_anonymous(self, app):
        """A WSGI server's bind address is unknown; HOST must name loopback explicitly."""
        app.config["CLI_ARGS"] = {"host": None}
        init_auth(app)
        assert not auth_module.is_local_mode()

    def test_loopback_host_env_is_single_user(self, app, monkeypatch):
        monkeypatch.setenv("HOST", "127.0.0.1")
        init_auth(app)
        assert auth_module.is_local_mode()

    def test_cli_host_decides_after_import(self, app):
        """The CLI parses --host after import; re-deciding drops single-user mode."""
        app.config["CLI_ARGS"] = {"host": "127.0.0.1"}
        init_auth(app)
        assert auth_module.is_local_mode()
        app.config["CLI_ARGS"] = {"host": "0.0.0.0"}
        auth_module.configure_local_mode(app)
        assert not auth_module.is_local_mode()

    def test_explicit_opt_in_keeps_single_user_on_a_network_host(self, app, monkeypatch):
        monkeypatch.setenv("DF_SINGLE_USER", "1")
        app.config["CLI_ARGS"] = {"host": "0.0.0.0"}
        init_auth(app)
        assert auth_module.is_local_mode()

    def test_opt_in_does_not_override_a_provider(self, app, monkeypatch):
        monkeypatch.setenv("DF_SINGLE_USER", "1")
        monkeypatch.setenv("AUTH_PROVIDER", "azure_easyauth")
        app.config["CLI_ARGS"] = {"host": "127.0.0.1"}
        init_auth(app)
        assert not auth_module.is_local_mode()
