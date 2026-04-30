"""Contract tests for /api/credentials/ endpoints.

Validates the Phase 2 unified response envelope:
- Success: HTTP 200 + {"status": "success", "data": {...}}
- Error: HTTP 4xx/5xx + {"status": "error", "error": {code, message, retry}}
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.errors import ErrorCode

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def app():
    test_app = flask.Flask(__name__)
    test_app.config["TESTING"] = True

    from data_formulator.error_handler import register_error_handlers
    from data_formulator.routes.credentials import credential_bp
    test_app.register_blueprint(credential_bp)
    register_error_handlers(test_app)

    return test_app


@pytest.fixture()
def client(app):
    return app.test_client()


class TestListCredentials:

    @patch("data_formulator.routes.credentials.get_credential_vault", return_value=None)
    @patch("data_formulator.routes.credentials.get_identity_id", return_value="test-user")
    def test_no_vault_returns_empty_sources(self, _id, _vault, client):
        resp = client.get("/api/credentials/list")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert body["data"]["sources"] == []

    @patch("data_formulator.routes.credentials.get_credential_vault")
    @patch("data_formulator.routes.credentials.get_identity_id", return_value="test-user")
    def test_vault_returns_sources(self, _id, mock_vault, client):
        vault = MagicMock()
        vault.list_sources.return_value = ["src-a", "src-b"]
        mock_vault.return_value = vault

        resp = client.get("/api/credentials/list")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert body["data"]["sources"] == ["src-a", "src-b"]


class TestStoreCredential:

    @patch("data_formulator.routes.credentials.get_credential_vault", return_value=None)
    def test_no_vault_returns_service_unavailable(self, _vault, client):
        resp = client.post("/api/credentials/store", json={"source_key": "a", "credentials": {}})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.SERVICE_UNAVAILABLE

    @patch("data_formulator.routes.credentials.get_credential_vault")
    def test_missing_fields_returns_invalid_request(self, mock_vault, client):
        mock_vault.return_value = MagicMock()
        resp = client.post("/api/credentials/store", json={"source_key": "a"})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST

    @patch("data_formulator.routes.credentials.get_credential_vault")
    @patch("data_formulator.routes.credentials.get_identity_id", return_value="test-user")
    def test_success_returns_source_key(self, _id, mock_vault, client):
        vault = MagicMock()
        mock_vault.return_value = vault

        resp = client.post("/api/credentials/store", json={
            "source_key": "my-db",
            "credentials": {"password": "secret"},
        })
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert body["data"]["source_key"] == "my-db"
        vault.store.assert_called_once()


class TestDeleteCredential:

    @patch("data_formulator.routes.credentials.get_credential_vault", return_value=None)
    def test_no_vault_returns_service_unavailable(self, _vault, client):
        resp = client.post("/api/credentials/delete", json={"source_key": "a"})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.SERVICE_UNAVAILABLE

    @patch("data_formulator.routes.credentials.get_credential_vault")
    def test_missing_source_key_returns_invalid_request(self, mock_vault, client):
        mock_vault.return_value = MagicMock()
        resp = client.post("/api/credentials/delete", json={})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST

    @patch("data_formulator.routes.credentials.get_credential_vault")
    @patch("data_formulator.routes.credentials.get_identity_id", return_value="test-user")
    def test_success_returns_source_key(self, _id, mock_vault, client):
        vault = MagicMock()
        mock_vault.return_value = vault

        resp = client.post("/api/credentials/delete", json={"source_key": "my-db"})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert body["data"]["source_key"] == "my-db"
        vault.delete.assert_called_once()
