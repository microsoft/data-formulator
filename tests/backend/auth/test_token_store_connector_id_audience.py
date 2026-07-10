"""Connector-instance and audience isolation tests for delegated service tokens."""

from __future__ import annotations

import time

import flask
import pytest

from data_formulator.auth.token_store import TokenStore

pytestmark = [pytest.mark.backend, pytest.mark.auth]


@pytest.fixture
def app():
    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.secret_key = "test-secret"
    return app


class TestAudienceAwareServiceTokens:
    def test_tokens_are_isolated_by_connector_and_audience(self, app):
        with app.test_request_context():
            flask.session.clear()
            store = TokenStore()
            store.store_service_token(
                "mssql:finance",
                "sql-token",
                audience="https://database.windows.net/",
            )
            store.store_service_token(
                "mssql:finance",
                "fabric-token",
                audience="https://api.fabric.microsoft.com",
            )

            assert store.get_service_token(
                "mssql:finance", "https://database.windows.net/"
            ) == "sql-token"
            assert store.get_service_token(
                "mssql:finance", "https://api.fabric.microsoft.com"
            ) == "fabric-token"

    def test_tokens_are_isolated_between_connector_instances(self, app):
        with app.test_request_context():
            flask.session.clear()
            store = TokenStore()
            audience = "https://database.windows.net/"
            store.store_service_token("mssql:finance", "finance-token", audience=audience)
            store.store_service_token("mssql:operations", "ops-token", audience=audience)

            assert store.get_service_token("mssql:finance", audience) == "finance-token"
            assert store.get_service_token("mssql:operations", audience) == "ops-token"

    def test_expired_audience_token_is_not_returned(self, app):
        with app.test_request_context():
            flask.session.clear()
            store = TokenStore()
            store.store_service_token(
                "mssql:finance",
                "expired-token",
                expires_in=-1,
                audience="https://database.windows.net/",
            )

            assert store.get_service_token(
                "mssql:finance", "https://database.windows.net/"
            ) is None

    def test_legacy_token_is_read_when_audience_entry_is_missing(self, app):
        with app.test_request_context():
            flask.session.clear()
            flask.session["service_tokens"] = {
                "superset": {
                    "access_token": "legacy-token",
                    "expires_at": time.time() + 3600,
                }
            }

            assert TokenStore().get_service_token(
                "superset", "https://superset.example.com"
            ) == "legacy-token"

    def test_legacy_token_is_not_reused_across_audiences_after_migration(self, app):
        with app.test_request_context():
            flask.session.clear()
            store = TokenStore()
            store.store_service_token("mssql:finance", "legacy-token")
            store.store_service_token(
                "mssql:finance",
                "sql-token",
                audience="https://database.windows.net/",
            )

            assert store.get_service_token(
                "mssql:finance", "https://api.fabric.microsoft.com"
            ) is None

    def test_clear_removes_all_audiences_for_connector(self, app):
        with app.test_request_context():
            flask.session.clear()
            store = TokenStore()
            store.store_service_token("mssql:finance", "sql-token", audience="sql")
            store.store_service_token("mssql:finance", "fabric-token", audience="fabric")

            store.clear_service_token("mssql:finance")

            assert store.get_service_token("mssql:finance", "sql") is None
            assert store.get_service_token("mssql:finance", "fabric") is None
