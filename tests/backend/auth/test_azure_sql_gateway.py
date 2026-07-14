"""Route contracts for the backend Azure SQL delegated OAuth gateway."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import flask
import pytest
from werkzeug.middleware.proxy_fix import ProxyFix

from data_formulator.auth.gateways import azure_sql_gateway
from data_formulator.auth.gateways.azure_sql_gateway import azure_sql_bp
from data_formulator.data_connector import DataConnector
from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader
from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader
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


@pytest.fixture(autouse=True)
def clear_pending_states():
    with azure_sql_gateway._STATE_LOCK:
        azure_sql_gateway._PENDING_STATES.clear()
    yield
    with azure_sql_gateway._STATE_LOCK:
        azure_sql_gateway._PENDING_STATES.clear()


class TestAzureSqlEntraConfig:
    def test_resolves_connector_specific_tenant_endpoints(self, monkeypatch):
        monkeypatch.setenv("AZURE_SQL_ENTRA_TENANT_ID", "72f988bf-86f1-41af-91ab-2d7cd011db47")
        monkeypatch.setenv("AZURE_SQL_ENTRA_CLIENT_ID", "client-id")
        monkeypatch.setenv("AZURE_SQL_ENTRA_CLIENT_SECRET", "client-secret")

        config = azure_sql_gateway._get_azure_sql_entra_config()

        authority = "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47"
        assert config == {
            "authorize_url": f"{authority}/oauth2/v2.0/authorize",
            "token_url": f"{authority}/oauth2/v2.0/token",
            "client_id": "client-id",
            "client_secret": "client-secret",
            "managed_identity_client_id": "",
        }

    def test_resolves_managed_identity_federation_config(self, monkeypatch):
        monkeypatch.setenv("AZURE_SQL_ENTRA_TENANT_ID", "72f988bf-86f1-41af-91ab-2d7cd011db47")
        monkeypatch.setenv("AZURE_SQL_ENTRA_CLIENT_ID", "client-id")
        monkeypatch.delenv("AZURE_SQL_ENTRA_CLIENT_SECRET", raising=False)
        monkeypatch.setenv("AZURE_SQL_ENTRA_MANAGED_IDENTITY_CLIENT_ID", "managed-identity-id")

        config = azure_sql_gateway._get_azure_sql_entra_config()

        assert config["client_secret"] == ""
        assert config["managed_identity_client_id"] == "managed-identity-id"

    @pytest.mark.parametrize(
        "missing_name",
        [
            "AZURE_SQL_ENTRA_TENANT_ID",
            "AZURE_SQL_ENTRA_CLIENT_ID",
        ],
    )
    def test_incomplete_connector_config_is_disabled(self, monkeypatch, missing_name):
        monkeypatch.setenv("AZURE_SQL_ENTRA_TENANT_ID", "72f988bf-86f1-41af-91ab-2d7cd011db47")
        monkeypatch.setenv("AZURE_SQL_ENTRA_CLIENT_ID", "client-id")
        monkeypatch.setenv("AZURE_SQL_ENTRA_CLIENT_SECRET", "client-secret")
        monkeypatch.delenv("AZURE_SQL_ENTRA_MANAGED_IDENTITY_CLIENT_ID", raising=False)
        monkeypatch.delenv(missing_name)

        assert azure_sql_gateway._get_azure_sql_entra_config() == {}

    def test_config_without_secret_or_managed_identity_is_disabled(self, monkeypatch):
        monkeypatch.setenv("AZURE_SQL_ENTRA_TENANT_ID", "72f988bf-86f1-41af-91ab-2d7cd011db47")
        monkeypatch.setenv("AZURE_SQL_ENTRA_CLIENT_ID", "client-id")
        monkeypatch.delenv("AZURE_SQL_ENTRA_CLIENT_SECRET", raising=False)
        monkeypatch.delenv("AZURE_SQL_ENTRA_MANAGED_IDENTITY_CLIENT_ID", raising=False)

        assert azure_sql_gateway._get_azure_sql_entra_config() == {}


def _connector(loader_class):
    return DataConnector.from_loader(loader_class, source_id="connector:test")


class TestAzureSqlLogin:
    def test_login_can_prepare_authorization_url_for_identity_bearing_api_request(
        self, client, oidc_config
    ):
        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(AzureSQLDataLoader)),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="browser:123"),
        ):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=azure_sql:staging&df_origin=http://localhost",
                headers={"Accept": "application/json", "X-Identity-Id": "123"},
            )

        assert response.status_code == 200
        authorize_url = response.get_json()["data"]["authorize_url"]
        query = parse_qs(urlparse(authorize_url).query)
        assert query["state"]
        with client.session_transaction() as session:
            state = query["state"][0]
            assert session["_azure_sql_oauth_states"][state]["identity"] == "browser:123"

    def test_login_binds_connector_identity_origin_scope_and_pkce(self, client, oidc_config):
        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(AzureSQLDataLoader)),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"),
        ):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=azure_sql:staging&df_origin=http://localhost"
            )

        assert response.status_code == 302
        query = parse_qs(urlparse(response.location).query)
        assert query["scope"] == ["https://database.windows.net/.default"]
        assert query["redirect_uri"] == ["http://localhost/api/auth/azure-sql/callback"]
        assert query["code_challenge_method"] == ["S256"]
        assert len(query["code_challenge"][0]) >= 43
        state = query["state"][0]
        with client.session_transaction() as session:
            record = session["_azure_sql_oauth_states"][state]
            assert record["connector_id"] == "azure_sql:staging"
            assert record["identity"] == "user:123"
            assert record["origin"] == "http://localhost"
            assert len(record["code_verifier"]) >= 43

    def test_login_rejects_untrusted_origin(self, client, oidc_config):
        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(AzureSQLDataLoader)),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"),
        ):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=azure_sql:staging&df_origin=https://evil.example.com"
            )

        assert response.status_code == 200
        assert response.get_json()["status"] == "error"

    def test_login_uses_forwarded_public_https_origin(self, client, oidc_config):
        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(AzureSQLDataLoader)),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"),
        ):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=azure_sql:staging&df_origin=https://data.example.com",
                headers={
                    "Host": "internal:5567",
                    "X-Forwarded-Proto": "https",
                    "X-Forwarded-Host": "data.example.com",
                },
            )

        assert response.status_code == 302
        query = parse_qs(urlparse(response.location).query)
        assert query["redirect_uri"] == ["https://data.example.com/api/auth/azure-sql/callback"]

    def test_login_rejects_generic_sql_server_connector(self, client, oidc_config):
        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(MSSQLDataLoader)),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"),
        ):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=mssql:test&df_origin=http://localhost"
            )

        assert response.status_code == 200
        assert response.get_json()["status"] == "error"


class TestAzureSqlCallback:
    def _begin(self, client, oidc_config):
        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway._resolve_connector", return_value=_connector(AzureSQLDataLoader)),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"),
        ):
            response = client.get(
                "/api/auth/azure-sql/login?connector_id=azure_sql:staging&df_origin=http://localhost"
            )
        return parse_qs(urlparse(response.location).query)["state"][0]

    def test_callback_stores_token_by_connector_and_audience_with_pkce(self, client, oidc_config):
        state = self._begin(client, oidc_config)
        token_response = MagicMock(ok=True)
        token_response.json.return_value = {"access_token": "sql-token", "expires_in": 3600}

        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"),
            patch("data_formulator.auth.gateways.azure_sql_gateway.http.post", return_value=token_response) as post,
            patch("data_formulator.auth.gateways.azure_sql_gateway.TokenStore.store_service_token") as store,
        ):
            response = client.get(f"/api/auth/azure-sql/callback?code=code-value&state={state}")

        store.assert_called_once_with(
            system_id="azure_sql:staging",
            access_token="sql-token",
            refresh_token=None,
            expires_in=3600,
            audience="https://database.windows.net/",
        )
        token_data = post.call_args.kwargs["data"]
        assert len(token_data["code_verifier"]) >= 43
        body = response.get_data(as_text=True)
        assert "authenticated" in body
        assert "sql-token" not in body
        assert "code-value" not in body
        assert "http://localhost" in body

    def test_callback_uses_managed_identity_client_assertion(self, client, oidc_config):
        federated_config = {
            **oidc_config,
            "client_secret": "",
            "managed_identity_client_id": "managed-identity-id",
        }
        state = self._begin(client, federated_config)
        token_response = MagicMock(ok=True)
        token_response.json.return_value = {"access_token": "sql-token", "expires_in": 3600}
        assertion_credential = MagicMock()
        assertion_credential.get_token.return_value.token = "managed-identity-assertion"

        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=federated_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"),
            patch("data_formulator.auth.gateways.azure_sql_gateway.ManagedIdentityCredential", return_value=assertion_credential) as credential_class,
            patch("data_formulator.auth.gateways.azure_sql_gateway.http.post", return_value=token_response) as post,
            patch("data_formulator.auth.gateways.azure_sql_gateway.TokenStore.store_service_token"),
        ):
            response = client.get(f"/api/auth/azure-sql/callback?code=code-value&state={state}")

        assert response.status_code == 200
        credential_class.assert_called_once_with(client_id="managed-identity-id")
        assertion_credential.get_token.assert_called_once_with(
            "api://AzureADTokenExchange/.default"
        )
        token_data = post.call_args.kwargs["data"]
        assert token_data["client_assertion"] == "managed-identity-assertion"
        assert token_data["client_assertion_type"] == (
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
        )
        assert "client_secret" not in token_data

    def test_callback_uses_session_binding_when_request_has_no_anonymous_identity_header(
        self, client, oidc_config
    ):
        state = self._begin(client, oidc_config)
        token_response = MagicMock(ok=True)
        token_response.json.return_value = {"access_token": "sql-token", "expires_in": 3600}

        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", side_effect=ValueError("header required")),
            patch("data_formulator.auth.gateways.azure_sql_gateway.http.post", return_value=token_response),
            patch("data_formulator.auth.gateways.azure_sql_gateway.TokenStore.store_service_token") as store,
        ):
            response = client.get(f"/api/auth/azure-sql/callback?code=code-value&state={state}")

        assert response.status_code == 200
        store.assert_called_once()
        assert '"authenticated": true' in response.get_data(as_text=True)

    def test_callback_rejects_state_from_different_browser_session(self, app, client, oidc_config):
        state = self._begin(client, oidc_config)
        other_client = app.test_client()

        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", side_effect=ValueError("header required")),
            patch("data_formulator.auth.gateways.azure_sql_gateway.http.post") as post,
        ):
            response = other_client.get(
                f"/api/auth/azure-sql/callback?code=code-value&state={state}"
            )

        assert '"authenticated": false' in response.get_data(as_text=True)
        post.assert_not_called()

    def test_callback_rejects_state_replay(self, client, oidc_config):
        state = self._begin(client, oidc_config)
        token_response = MagicMock(ok=True)
        token_response.json.return_value = {"access_token": "sql-token", "expires_in": 3600}

        with (
            patch("data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config", return_value=oidc_config),
            patch("data_formulator.auth.gateways.azure_sql_gateway.get_identity_id", return_value="user:123"),
            patch("data_formulator.auth.gateways.azure_sql_gateway.http.post", return_value=token_response),
        ):
            first = client.get(f"/api/auth/azure-sql/callback?code=first&state={state}")
            second = client.get(f"/api/auth/azure-sql/callback?code=second&state={state}")

        assert first.status_code == 200
        assert second.status_code == 200
        assert '"authenticated": false' in second.get_data(as_text=True)

    def test_pending_state_capacity_isolated_across_browser_sessions(
        self, app, oidc_config
    ):
        clients = [app.test_client() for _ in range(9)]
        states = [self._begin(browser, oidc_config) for browser in clients]
        token_response = MagicMock(ok=True)
        token_response.json.return_value = {
            "access_token": "sql-token",
            "expires_in": 3600,
        }

        with (
            patch(
                "data_formulator.auth.gateways.azure_sql_gateway._get_azure_sql_entra_config",
                return_value=oidc_config,
            ),
            patch(
                "data_formulator.auth.gateways.azure_sql_gateway.get_identity_id",
                return_value="user:123",
            ),
            patch(
                "data_formulator.auth.gateways.azure_sql_gateway.http.post",
                return_value=token_response,
            ),
            patch(
                "data_formulator.auth.gateways.azure_sql_gateway.TokenStore.store_service_token"
            ) as store,
        ):
            responses = [
                browser.get(
                    f"/api/auth/azure-sql/callback?code=code-{index}&state={state}"
                )
                for index, (browser, state) in enumerate(zip(clients, states))
            ]

        assert all(
            '"authenticated": true' in response.get_data(as_text=True)
            for response in responses
        )
        assert store.call_count == 9

    def test_pending_state_capacity_is_bounded_per_browser_session(
        self, app
    ):
        state_names = ["z-state", "a-state", "b-state", "c-state", "d-state",
                       "e-state", "f-state", "g-state", "h-state"]
        with app.test_request_context(), patch(
            "data_formulator.auth.gateways.azure_sql_gateway.time.time",
            return_value=1000.0,
        ):
            for index, state_name in enumerate(state_names):
                azure_sql_gateway._store_state(
                    state_name,
                    {"code_verifier": f"verifier-{index}"},
                )
                serialized = flask.session["_azure_sql_oauth_states"]
                flask.session["_azure_sql_oauth_states"] = dict(
                    sorted(serialized.items())
                )
            pending = dict(flask.session["_azure_sql_oauth_states"])

        assert len(pending) == 8
        assert state_names[0] not in pending
        assert state_names[-1] in pending

    def test_missing_process_state_is_removed_from_browser_session(
        self, client, oidc_config
    ):
        state = self._begin(client, oidc_config)
        with azure_sql_gateway._STATE_LOCK:
            azure_sql_gateway._PENDING_STATES.pop(state)

        response = client.get(
            f"/api/auth/azure-sql/callback?code=code-value&state={state}"
        )

        assert '"authenticated": false' in response.get_data(as_text=True)
        with client.session_transaction() as browser_session:
            assert state not in browser_session["_azure_sql_oauth_states"]

    def test_pending_state_is_consumed_once_across_threads(self, app, client, oidc_config):
        state = self._begin(client, oidc_config)

        def consume():
            from data_formulator.auth.gateways.azure_sql_gateway import _consume_state
            with app.test_request_context():
                flask.session["_azure_sql_oauth_states"] = {state: {}}
                return _consume_state(state)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: consume(), range(2)))

        assert sum(result is not None for result in results) == 1
