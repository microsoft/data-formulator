"""Unit tests for the OIDC authentication provider.

Background
----------
``OIDCProvider`` verifies JWT access-tokens against a JWKS endpoint and
extracts identity from the ``sub`` claim.  Tests use a locally-generated
RSA key pair: the private key signs test JWTs, the public key is injected
into the provider via monkeypatch (no real IdP needed).
"""
from __future__ import annotations

import time
from unittest.mock import MagicMock

import flask
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

from data_formulator.auth.providers.base import AuthenticationError
from data_formulator.auth.providers.oidc import OIDCProvider

pytestmark = [pytest.mark.backend, pytest.mark.auth]

ISSUER = "https://idp.example.com/realms/test"
CLIENT_ID = "df-test-client"


# ------------------------------------------------------------------
# RSA key fixtures
# ------------------------------------------------------------------

@pytest.fixture(scope="module")
def rsa_private_key():
    """Generate a 2048-bit RSA private key (once per module)."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def rsa_public_key(rsa_private_key):
    return rsa_private_key.public_key()


@pytest.fixture(scope="module")
def rsa_public_key_pem(rsa_public_key) -> bytes:
    return rsa_public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


# ------------------------------------------------------------------
# Provider fixture with mocked JWKS client
# ------------------------------------------------------------------

@pytest.fixture
def provider(monkeypatch, rsa_public_key_pem) -> OIDCProvider:
    """OIDCProvider wired to our test RSA key (no OIDC Discovery needed)."""
    monkeypatch.setenv("OIDC_ISSUER_URL", ISSUER)
    monkeypatch.setenv("OIDC_CLIENT_ID", CLIENT_ID)

    p = OIDCProvider()

    mock_jwks = MagicMock()
    mock_signing_key = MagicMock()
    mock_signing_key.key = serialization.load_pem_public_key(rsa_public_key_pem)
    mock_jwks.get_signing_key_from_jwt.return_value = mock_signing_key

    p._jwks_client = mock_jwks
    p._algorithms = ["RS256"]
    return p


@pytest.fixture
def app():
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    return _app


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _sign_jwt(private_key, payload: dict, headers: dict | None = None) -> str:
    """Sign a JWT with the test RSA private key."""
    return pyjwt.encode(payload, private_key, algorithm="RS256", headers=headers)


def _valid_payload(**overrides) -> dict:
    now = int(time.time())
    payload = {
        "iss": ISSUER,
        "aud": CLIENT_ID,
        "sub": "test-user-42",
        "name": "Alice",
        "email": "alice@example.com",
        "iat": now - 60,
        "exp": now + 3600,
    }
    payload.update(overrides)
    return payload


# ------------------------------------------------------------------
# Metadata tests
# ------------------------------------------------------------------

class TestOIDCProviderMetadata:

    def test_name(self, provider):
        assert provider.name == "oidc"

    def test_enabled_with_config(self, provider):
        assert provider.enabled is True

    def test_disabled_without_issuer(self, monkeypatch):
        monkeypatch.setenv("OIDC_CLIENT_ID", CLIENT_ID)
        monkeypatch.delenv("OIDC_ISSUER_URL", raising=False)
        p = OIDCProvider()
        assert p.enabled is False

    def test_disabled_without_client_id(self, monkeypatch):
        monkeypatch.setenv("OIDC_ISSUER_URL", ISSUER)
        monkeypatch.delenv("OIDC_CLIENT_ID", raising=False)
        p = OIDCProvider()
        assert p.enabled is False

    def test_get_auth_info_action_is_frontend(self, provider):
        info = provider.get_auth_info()
        assert info["action"] == "frontend"
        assert info["oidc"]["authority"] == ISSUER
        assert info["oidc"]["clientId"] == CLIENT_ID

    def test_default_scopes_include_offline_access(self, provider):
        info = provider.get_auth_info()
        scopes = info["oidc"]["scopes"]
        assert "offline_access" in scopes

    def test_custom_scopes_override_defaults(self, monkeypatch):
        monkeypatch.setenv("OIDC_ISSUER_URL", ISSUER)
        monkeypatch.setenv("OIDC_CLIENT_ID", CLIENT_ID)
        monkeypatch.setenv("OIDC_SCOPES", "openid profile")
        p = OIDCProvider()
        info = p.get_auth_info()
        assert info["oidc"]["scopes"] == "openid profile"


# ------------------------------------------------------------------
# Successful authentication
# ------------------------------------------------------------------

class TestOIDCAuthenticate:

    def test_valid_jwt_returns_auth_result(self, app, provider, rsa_private_key):
        token = _sign_jwt(rsa_private_key, _valid_payload())
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"}
        ):
            result = provider.authenticate(flask.request)
            assert result is not None
            assert result.user_id == "test-user-42"
            assert result.display_name == "Alice"
            assert result.email == "alice@example.com"
            assert result.raw_token == token

    def test_sub_is_stringified(self, app, provider, rsa_private_key):
        token = _sign_jwt(rsa_private_key, _valid_payload(sub=12345))
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"}
        ):
            result = provider.authenticate(flask.request)
            assert result.user_id == "12345"


# ------------------------------------------------------------------
# Authentication failures
# ------------------------------------------------------------------

class TestOIDCAuthErrors:

    def test_expired_token_raises(self, app, provider, rsa_private_key):
        payload = _valid_payload(exp=int(time.time()) - 600)
        token = _sign_jwt(rsa_private_key, payload)
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"}
        ):
            with pytest.raises(AuthenticationError, match="expired"):
                provider.authenticate(flask.request)

    def test_wrong_issuer_raises(self, app, provider, rsa_private_key):
        payload = _valid_payload(iss="https://evil.example.com")
        token = _sign_jwt(rsa_private_key, payload)
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"}
        ):
            with pytest.raises(AuthenticationError, match="Invalid OIDC token"):
                provider.authenticate(flask.request)

    def test_wrong_audience_raises(self, app, provider, rsa_private_key):
        payload = _valid_payload(aud="wrong-client")
        token = _sign_jwt(rsa_private_key, payload)
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"}
        ):
            with pytest.raises(AuthenticationError, match="Invalid OIDC token"):
                provider.authenticate(flask.request)

    def test_wrong_key_raises(self, app, provider):
        """Token signed with a different private key → verification fails."""
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        token = _sign_jwt(other_key, _valid_payload())

        bad_pub = other_key.public_key()
        mock_signing_key = MagicMock()
        mock_signing_key.key = bad_pub
        # But the provider's JWKS still returns the *original* public key,
        # so we need to simulate a signature mismatch.
        # Actually, if we sign with other_key but provider verifies with
        # original key, it will fail.  The mock returns the original key,
        # so signing with other_key will cause a mismatch.
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"}
        ):
            with pytest.raises(AuthenticationError, match="Invalid OIDC token"):
                provider.authenticate(flask.request)

    def test_missing_sub_claim_raises(self, app, provider, rsa_private_key):
        payload = _valid_payload()
        del payload["sub"]
        token = _sign_jwt(rsa_private_key, payload)
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"}
        ):
            with pytest.raises(AuthenticationError, match="sub"):
                provider.authenticate(flask.request)


# ------------------------------------------------------------------
# Non-applicable requests (should return None, not raise)
# ------------------------------------------------------------------

class TestOIDCSkip:

    def test_no_authorization_header(self, app, provider):
        with app.test_request_context():
            assert provider.authenticate(flask.request) is None

    def test_non_bearer_authorization(self, app, provider):
        with app.test_request_context(
            headers={"Authorization": "Basic dXNlcjpwYXNz"}
        ):
            assert provider.authenticate(flask.request) is None

    def test_empty_bearer_token(self, app, provider):
        with app.test_request_context(
            headers={"Authorization": "Bearer "}
        ):
            assert provider.authenticate(flask.request) is None

    def test_no_jwks_client_returns_none(self, app, monkeypatch):
        """Before on_configure() or when OIDC Discovery fails."""
        monkeypatch.setenv("OIDC_ISSUER_URL", ISSUER)
        monkeypatch.setenv("OIDC_CLIENT_ID", CLIENT_ID)
        for var in ("OIDC_USERINFO_URL", "OIDC_JWKS_URL", "OIDC_AUTHORIZE_URL",
                     "OIDC_TOKEN_URL", "OIDC_CLIENT_SECRET", "OIDC_SCOPES"):
            monkeypatch.delenv(var, raising=False)
        p = OIDCProvider()
        # No strategy available: _jwks_client is None, _userinfo_url is empty
        with app.test_request_context(
            headers={"Authorization": "Bearer some.jwt.token"}
        ):
            assert p.authenticate(flask.request) is None
