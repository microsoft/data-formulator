"""Route contracts for the backend Azure SQL delegated OAuth gateway."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import flask
import pytest
from werkzeug.middleware.proxy_fix import ProxyFix

from data_formulator.auth.gateways.azure_sql_gateway import azure_sql_bp
from data_formulator.data_connector import DataConnector
from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader
from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
from data_formulator.error_handler import register_error_handlers

pytestmark = [pytest.mark.backend, pytest.mark.auth]


@pytest.fixture
def app():
    app = flask.Flask(__name__)
    app.config.update(TESTING=True, SECRET_KEY="test-secret")
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    app.register_blueprint(azure_sql_bp)
    register_error_handlers(app)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def oidc_config():
    return {
        "authorize_url": "https://login.example.com/authorize",
        "token_url": "https://login.example.com/token",
        "client_id": "client-id",
        "client_secret": "client-secret",
    }


def _connector(loader_class):
    return DataConnector.from_loader(loader_class, source_id="connector:test")


class TestAzureSqlLogin:
    def test_login_binds_connector_identity_origin_and_sql_scope(self, client, oidc_config):
        with patch("data_formulator.auth.gateways.azure_sql_gateway._get_oidc_config", return_value=oidc_config), \
               patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(MSSQLDataLoader)), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=mssql:staging&df_origin=http://localhost"
            )

        assert response.status_code == 302
        query = parse_qs(urlparse(response.location).query)
        assert query["scope"] == ["https://database.windows.net/.default"]
        assert query["redirect_uri"] == ["http://localhost/api/auth/azure-sql/callback"]
        state = query["state"][0]
        with client.session_transaction() as session:
            record = session["_azure_sql_oauth_states"][state]
            assert record["connector_id"] == "mssql:staging"
            assert record["identity"] == "user:123"
            assert record["origin"] == "http://localhost"

    def test_login_rejects_untrusted_origin(self, client, oidc_config):
        with patch("data_formulator.auth.gateways.azure_sql_gateway._get_oidc_config", return_value=oidc_config), \
               patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(MSSQLDataLoader)), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=mssql:staging&df_origin=https://evil.example.com"
            )

        assert response.status_code == 200
        assert response.get_json()["status"] == "error"

    def test_login_uses_forwarded_public_https_origin(self, client, oidc_config):
        with patch("data_formulator.auth.gateways.azure_sql_gateway._get_oidc_config", return_value=oidc_config), \
             patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(MSSQLDataLoader)), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=mssql:staging&df_origin=https://data.example.com",
                headers={
                    "Host": "internal:5567",
                    "X-Forwarded-Proto": "https",
                    "X-Forwarded-Host": "data.example.com",
                },
            )

        assert response.status_code == 302
        query = parse_qs(urlparse(response.location).query)
        assert query["redirect_uri"] == ["https://data.example.com/api/auth/azure-sql/callback"]

    def test_login_rejects_non_sql_connector(self, client, oidc_config):
        with patch("data_formulator.auth.gateways.azure_sql_gateway._get_oidc_config", return_value=oidc_config), \
             patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(MySQLDataLoader)), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=mysql:test&df_origin=http://localhost"
            )

        assert response.status_code == 200
        assert response.get_json()["status"] == "error"


class TestAzureSqlCallback:
    def _begin(self, client, oidc_config):
        with patch("data_formulator.auth.gateways.azure_sql_gateway._get_oidc_config", return_value=oidc_config), \
               patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(MSSQLDataLoader)), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=mssql:staging&df_origin=http://localhost"
            )
        return parse_qs(urlparse(response.location).query)["state"][0]

    def test_callback_stores_token_by_connector_and_audience(self, client, oidc_config):
        state = self._begin(client, oidc_config)
        token_response = MagicMock(ok=True)
        token_response.json.return_value = {"access_token": "sql-token", "expires_in": 3600}

        with patch("data_formulator.auth.gateways.azure_sql_gateway._get_oidc_config", return_value=oidc_config), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.http.post", return_value=token_response), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.TokenStore.store_service_token") as store:
            response = client.get(f"/api/auth/azure-sql/callback?code=code-value&state={state}")

        store.assert_called_once_with(
            system_id="mssql:staging",
            access_token="sql-token",
            refresh_token=None,
            expires_in=3600,
            audience="https://database.windows.net/",
        )
        body = response.get_data(as_text=True)
        assert "authenticated" in body
        assert "sql-token" not in body
        assert "code-value" not in body
        assert "http://localhost" in body

    def test_callback_rejects_state_replay(self, client, oidc_config):
        state = self._begin(client, oidc_config)
        token_response = MagicMock(ok=True)
        token_response.json.return_value = {"access_token": "sql-token", "expires_in": 3600}

        with patch("data_formulator.auth.gateways.azure_sql_gateway._get_oidc_config", return_value=oidc_config), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"), \
             patch("data_formulator.auth.gateways.azure_sql_gateway.http.post", return_value=token_response):
            first = client.get(f"/api/auth/azure-sql/callback?code=first&state={state}")
            second = client.get(f"/api/auth/azure-sql/callback?code=second&state={state}")

        assert first.status_code == 200
        assert second.status_code == 200
        assert '"authenticated": false' in second.get_data(as_text=True)

    def test_pending_state_is_consumed_once_across_threads(self, app, client, oidc_config):
        state = self._begin(client, oidc_config)

        def consume():
            from data_formulator.auth.gateways.azure_sql_gateway import _consume_state
            with app.test_request_context():
                return _consume_state(state)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: consume(), range(2)))

        assert sum(result is not None for result in results) == 1
