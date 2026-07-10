"""DataConnector loader resource lifecycle regression tests."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import flask
import pyarrow as pa
import pytest

from data_formulator.data_connector import DATA_CONNECTORS, DataConnector, connectors_bp
from data_formulator.data_loader.external_data_loader import ExternalDataLoader

pytestmark = [pytest.mark.backend]

IDENTITY = "user:test"


class ClosableLoader(ExternalDataLoader):
    instances: list["ClosableLoader"] = []

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.closed = 0
        self.connection_ok = params.get("connection_ok", True)
        self.instances.append(self)

    def close(self) -> None:
        self.closed += 1

    def test_connection(self) -> bool:
        return self.connection_ok

    def list_tables(self, table_filter=None):
        return []

    def fetch_data_as_arrow(self, source_table, import_options=None):
        return pa.table({})

    @staticmethod
    def list_params():
        return [{"name": "host", "type": "string", "required": True}]

    @staticmethod
    def auth_instructions():
        return "Provide a host."


@pytest.fixture(autouse=True)
def clean_connectors():
    previous = dict(DATA_CONNECTORS)
    DATA_CONNECTORS.clear()
    ClosableLoader.instances.clear()
    yield
    DATA_CONNECTORS.clear()
    DATA_CONNECTORS.update(previous)


@pytest.fixture()
def source():
    connector = DataConnector.from_loader(
        ClosableLoader,
        source_id="closable",
        display_name="Closable",
    )
    DATA_CONNECTORS["closable"] = connector
    return connector


@pytest.fixture()
def client(source):
    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.secret_key = "test-secret"
    app.register_blueprint(connectors_bp)
    from data_formulator.error_handler import register_error_handlers

    register_error_handlers(app)
    return app.test_client()


def test_reconnecting_closes_replaced_loader(source) -> None:
    with patch.object(DataConnector, "_get_identity", return_value=IDENTITY):
        first = source._connect({"host": "first"})
        second = source._connect({"host": "second"})

    assert first.closed == 1
    assert second.closed == 0
    assert source._get_loader(IDENTITY) is second


def test_disconnect_closes_active_loader(client, source) -> None:
    with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
         patch.object(DataConnector, "_get_vault", return_value=None):
        loader = source._connect({"host": "db"})
        response = client.post(
            "/api/connectors/disconnect",
            json={"connector_id": "closable"},
        )

    assert response.status_code == 200
    assert loader.closed == 1


def test_failed_connection_validation_closes_new_loader(client, source) -> None:
    with patch.object(DataConnector, "_get_identity", return_value=IDENTITY), \
         patch.object(DataConnector, "_get_vault", return_value=None):
        response = client.post(
            "/api/connectors/connect",
            json={
                "connector_id": "closable",
                "params": {"host": "db", "connection_ok": False},
            },
        )

    assert response.get_json()["status"] == "error"
    assert ClosableLoader.instances[-1].closed == 1
