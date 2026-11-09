"""Unit tests for the Azure EasyAuth authentication provider.

Background
----------
``AzureEasyAuthProvider`` extracts user identity from the
``X-MS-CLIENT-PRINCIPAL-ID`` header injected by Azure App Service.
These tests validate the provider in isolation, without Flask app
configuration or the auth chain.
"""
from __future__ import annotations

import flask
import pytest

from data_formulator.auth.providers.azure_easyauth import AzureEasyAuthProvider

pytestmark = [pytest.mark.backend, pytest.mark.auth]


@pytest.fixture
def provider():
    return AzureEasyAuthProvider()


@pytest.fixture
def app():
    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    return _app


class TestAzureEasyAuthAuthenticate:

    def test_principal_header_with_display_name(self, app, provider):
        with app.test_request_context(
            headers={
                "X-MS-CLIENT-PRINCIPAL-ID": "abc-123",
                "X-MS-CLIENT-PRINCIPAL-NAME": "Alice",
            }
        ):
            result = provider.authenticate(flask.request)
            assert result.user_id == "abc-123"
            assert result.display_name == "Alice"

    def test_empty_display_name_becomes_none(self, app, provider):
        with app.test_request_context(
            headers={
                "X-MS-CLIENT-PRINCIPAL-ID": "abc-123",
                "X-MS-CLIENT-PRINCIPAL-NAME": "  ",
            }
        ):
            result = provider.authenticate(flask.request)
            assert result.display_name is None

    def test_no_header_returns_none(self, app, provider):
        with app.test_request_context():
            result = provider.authenticate(flask.request)
            assert result is None

    def test_strips_whitespace_from_user_id(self, app, provider):
        with app.test_request_context(
            headers={"X-MS-CLIENT-PRINCIPAL-ID": "  abc-123  "}
        ):
            result = provider.authenticate(flask.request)
            assert result.user_id == "abc-123"

    def test_raw_token_is_none(self, app, provider):
        with app.test_request_context(
            headers={"X-MS-CLIENT-PRINCIPAL-ID": "abc-123"}
        ):
            result = provider.authenticate(flask.request)
            assert result.raw_token is None
