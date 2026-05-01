"""Contract tests for mainstream OIDC SSO providers.

These tests simulate provider discovery, JWKS-backed JWT validation, and the
backend authorization-code flow without Docker or real IdP network calls.
"""
from __future__ import annotations

import time
import json
import urllib.parse
from unittest.mock import MagicMock, patch

import flask
import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from data_formulator.auth.gateways.oidc_gateway import (
    auth_tokens_bp,
    oidc_bp,
    oidc_callback_bp,
)
from data_formulator.auth.providers.oidc import OIDCProvider

from .provider_fixtures import CLIENT_ID, CLIENT_SECRET, OIDC_PROVIDER_CONTRACTS

pytestmark = [pytest.mark.backend, pytest.mark.auth]


def _contract_ids(contracts: list[dict]) -> list[str]:
    return [contract["id"] for contract in contracts]


@pytest.fixture(scope="module")
def rsa_private_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(scope="module")
def rsa_public_key_pem(rsa_private_key) -> bytes:
    return rsa_private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


@pytest.fixture
def app():
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"
    return _app


@pytest.fixture
def gateway_app(monkeypatch):
    monkeypatch.setenv("OIDC_CLIENT_SECRET", CLIENT_SECRET)
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test-secret"
    _app.register_blueprint(oidc_bp)
    _app.register_blueprint(oidc_callback_bp)
    _app.register_blueprint(auth_tokens_bp)
    from data_formulator.error_handler import register_error_handlers

    register_error_handlers(_app)
    return _app


def _discovery_doc(contract: dict) -> dict:
    doc = {
        "issuer": contract["issuer"],
        "authorization_endpoint": contract["authorize_url"],
        "token_endpoint": contract["token_url"],
        "jwks_uri": contract["jwks_url"],
        "id_token_signing_alg_values_supported": contract.get(
            "algorithms", ["RS256"],
        ),
    }
    if contract["userinfo_url"]:
        doc["userinfo_endpoint"] = contract["userinfo_url"]
    return doc


def _gateway_config(contract: dict) -> dict[str, str]:
    return {
        "authorize_url": contract["authorize_url"],
        "token_url": contract["token_url"],
        "userinfo_url": contract["userinfo_url"],
        "jwks_url": contract["jwks_url"],
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }


def _configure_provider(monkeypatch, contract: dict) -> OIDCProvider:
    monkeypatch.setenv("OIDC_ISSUER_URL", contract["issuer"])
    monkeypatch.setenv("OIDC_CLIENT_ID", CLIENT_ID)

    provider = OIDCProvider()
    monkeypatch.setattr(
        provider,
        "_try_discovery",
        lambda _discovery_url: _discovery_doc(contract),
    )
    provider.on_configure(flask.Flask(__name__))
    return provider


def _sign_contract_jwt(private_key, contract: dict) -> str:
    now = int(time.time())
    payload = {
        "iss": contract["issuer"],
        "aud": contract.get("audience", CLIENT_ID),
        "sub": contract["subject"],
        "iat": now - 60,
        "exp": now + 3600,
    }
    payload.update(contract["claims"])
    return pyjwt.encode(
        payload,
        private_key,
        algorithm=contract.get("signing_algorithm", "RS256"),
    )


def _urlopen_response(body: dict) -> MagicMock:
    response = MagicMock()
    response.__enter__.return_value.read.return_value = json.dumps(body).encode()
    return response


@pytest.mark.parametrize(
    "contract",
    OIDC_PROVIDER_CONTRACTS,
    ids=_contract_ids(OIDC_PROVIDER_CONTRACTS),
)
class TestMainstreamOIDCProviderContracts:
    def test_discovery_metadata_resolves_provider_endpoints(
        self,
        monkeypatch,
        contract,
    ):
        provider = _configure_provider(monkeypatch, contract)

        resolved = provider.get_resolved_config()
        assert resolved["authorize_url"] == contract["authorize_url"]
        assert resolved["token_url"] == contract["token_url"]
        assert resolved["userinfo_url"] == contract["userinfo_url"]
        assert resolved["jwks_url"] == contract["jwks_url"]

        auth_info = provider.get_auth_info()
        assert auth_info["action"] == "frontend"
        assert auth_info["oidc"]["authority"] == contract["issuer"]
        assert auth_info["oidc"]["metadata"]["jwks_uri"] == contract["jwks_url"]

    def test_jwks_jwt_validation_accepts_provider_claim_shape(
        self,
        app,
        monkeypatch,
        rsa_private_key,
        rsa_public_key_pem,
        contract,
    ):
        provider = _configure_provider(monkeypatch, contract)
        mock_jwks = MagicMock()
        mock_signing_key = MagicMock()
        mock_signing_key.key = serialization.load_pem_public_key(
            rsa_public_key_pem,
        )
        mock_jwks.get_signing_key_from_jwt.return_value = mock_signing_key
        provider._jwks_client = mock_jwks

        token = _sign_contract_jwt(rsa_private_key, contract)
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"},
        ):
            result = provider.authenticate(flask.request)

        assert result is not None
        assert result.user_id == contract["subject"]
        assert result.display_name == contract["claims"]["name"]
        assert result.email == contract["claims"]["email"]
        assert result.raw_token == token

    def test_jwks_jwt_validation_accepts_missing_optional_email_claim(
        self,
        app,
        monkeypatch,
        rsa_private_key,
        rsa_public_key_pem,
        contract,
    ):
        provider = _configure_provider(monkeypatch, contract)
        mock_jwks = MagicMock()
        mock_signing_key = MagicMock()
        mock_signing_key.key = serialization.load_pem_public_key(
            rsa_public_key_pem,
        )
        mock_jwks.get_signing_key_from_jwt.return_value = mock_signing_key
        provider._jwks_client = mock_jwks

        optional_email_contract = {
            **contract,
            "claims": {
                key: value for key, value in contract["claims"].items()
                if key != "email"
            },
        }
        token = _sign_contract_jwt(rsa_private_key, optional_email_contract)
        with app.test_request_context(
            headers={"Authorization": f"Bearer {token}"},
        ):
            result = provider.authenticate(flask.request)

        assert result is not None
        assert result.user_id == contract["subject"]
        assert result.email is None

    def test_userinfo_fallback_accepts_provider_userinfo_response(
        self,
        app,
        monkeypatch,
        contract,
    ):
        if not contract["userinfo_url"]:
            pytest.skip(f"{contract['id']} does not expose a UserInfo endpoint")

        monkeypatch.setenv("OIDC_ISSUER_URL", contract["issuer"])
        monkeypatch.setenv("OIDC_CLIENT_ID", CLIENT_ID)
        monkeypatch.setenv("OIDC_USERINFO_URL", contract["userinfo_url"])
        provider = OIDCProvider()

        userinfo = {
            "sub": contract["subject"],
            "name": contract["claims"]["name"],
            "email": contract["claims"]["email"],
        }
        with patch(
            "data_formulator.auth.providers.oidc.urllib.request.urlopen",
            return_value=_urlopen_response(userinfo),
        ) as urlopen:
            with app.test_request_context(
                headers={"Authorization": "Bearer opaque-access-token"},
            ):
                result = provider.authenticate(flask.request)

        assert result is not None
        assert result.user_id == contract["subject"]
        assert result.email == contract["claims"]["email"]
        request = urlopen.call_args[0][0]
        assert request.full_url == contract["userinfo_url"]
        assert request.headers["Authorization"] == "Bearer opaque-access-token"

    def test_backend_gateway_uses_provider_authorization_endpoint(
        self,
        gateway_app,
        contract,
    ):
        client = gateway_app.test_client()
        with patch(
            "data_formulator.auth.gateways.oidc_gateway._get_oidc_config",
            return_value=_gateway_config(contract),
        ):
            resp = client.get("/api/auth/oidc/login")

        assert resp.status_code == 302
        location = resp.headers["Location"]
        parsed = urllib.parse.urlparse(location)
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == (
            contract["authorize_url"]
        )

        query = urllib.parse.parse_qs(parsed.query)
        assert query["client_id"] == [CLIENT_ID]
        assert query["response_type"] == ["code"]
        assert query["scope"] == ["openid profile email offline_access"]
        assert query["redirect_uri"][0].endswith("/auth/callback")
        assert query["state"][0]

    def test_backend_gateway_exchanges_code_and_stores_userinfo(
        self,
        gateway_app,
        contract,
    ):
        client = gateway_app.test_client()
        with client.session_transaction() as sess:
            sess["_oauth_state"] = "contract-state"

        token_resp = MagicMock()
        token_resp.ok = True
        token_resp.json.return_value = {
            "access_token": f"{contract['id']}-access-token",
            "refresh_token": f"{contract['id']}-refresh-token",
            "expires_in": 3600,
        }
        userinfo_resp = MagicMock()
        userinfo_resp.ok = True
        userinfo_resp.json.return_value = (
            {
                "sub": contract["subject"],
                "name": contract["claims"]["name"],
                "email": contract["claims"]["email"],
            }
            if contract["userinfo_url"]
            else None
        )

        with patch(
            "data_formulator.auth.gateways.oidc_gateway._get_oidc_config",
            return_value=_gateway_config(contract),
        ), patch(
            "data_formulator.auth.gateways.oidc_gateway.http.post",
            return_value=token_resp,
        ) as post, patch(
            "data_formulator.auth.gateways.oidc_gateway.http.get",
            return_value=userinfo_resp,
        ) as get, patch(
            "data_formulator.auth.token_store.TokenStore._all_auth_configs",
            return_value={},
        ):
            resp = client.get(
                "/auth/callback?code=contract-code&state=contract-state",
            )

        assert resp.status_code == 302
        assert resp.headers["Location"].endswith("/")
        assert post.call_args[0][0] == contract["token_url"]
        if contract["userinfo_url"]:
            assert get.call_args[0][0] == contract["userinfo_url"]
        else:
            get.assert_not_called()

        with client.session_transaction() as sess:
            sso = sess["sso"]
            assert sso["access_token"] == f"{contract['id']}-access-token"
            if contract["userinfo_url"]:
                assert sso["user"]["sub"] == contract["subject"]
            else:
                assert sso["user"] is None
