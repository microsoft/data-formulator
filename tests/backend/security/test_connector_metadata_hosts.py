"""User-supplied connector hosts must not reach cloud instance metadata (SSRF)."""
from __future__ import annotations

from unittest.mock import Mock

import pytest
from flask import Flask

from data_formulator import data_connector
from data_formulator.errors import AppError, ErrorCode

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def source(monkeypatch):
    loader_class = Mock()
    connector = data_connector.DataConnector(loader_class, "user-db", default_params={})
    monkeypatch.setattr(connector, "_get_identity", lambda: "user:test")
    monkeypatch.setattr(connector, "_inject_credentials", lambda params: None)
    monkeypatch.setattr(connector, "_uses_configured_params", lambda: False)
    return connector


@pytest.mark.parametrize("params", [
    {"host": "169.254.169.254"},
    {"server": "tcp:169.254.169.254,1433"},
    {"url": "http://169.254.169.254/latest/meta-data/"},
    {"api_url": "http://168.63.129.16/machine"},
    {"endpoint": "http://[fd00:ec2::254]/"},
])
def test_connect_rejects_metadata_hosts(source, params):
    with Flask(__name__).test_request_context():
        with pytest.raises(AppError) as exc:
            source._connect({**params, "port": "80"})
    assert exc.value.code == ErrorCode.ACCESS_DENIED
    source._loader_class.assert_not_called()


@pytest.mark.parametrize("host", ["db.internal.example", "10.1.2.3", "localhost", "192.168.0.10:5432"])
def test_connect_allows_ordinary_and_private_hosts(source, host):
    with Flask(__name__).test_request_context():
        assert source._connect({"host": host}) is source._loader_class.return_value


def test_administrator_configured_hosts_are_not_checked(source, monkeypatch):
    monkeypatch.setattr(source, "_uses_configured_params", lambda: True)
    source._default_params = {"host": "configured-host"}
    with Flask(__name__).test_request_context():
        source._connect({"host": "169.254.169.254"})
    source._loader_class.assert_called_with({"host": "configured-host"})


def test_discover_options_rejects_metadata_hosts(monkeypatch):
    from data_formulator.data_loader import DATA_LOADERS
    from data_formulator.error_handler import register_error_handlers

    loader_class = Mock()
    monkeypatch.setitem(DATA_LOADERS, "metadata_test", loader_class)
    monkeypatch.setattr("data_formulator.configuration.user_connectors_disabled", lambda: False)
    app = Flask(__name__)
    app.register_blueprint(data_connector.connectors_bp)
    register_error_handlers(app)
    response = app.test_client().post("/api/data-loaders/discover-options", json={
        "loader_type": "metadata_test", "param_name": "database", "params": {"host": "169.254.169.254"},
    })
    assert response.get_json()["error"]["code"] == ErrorCode.ACCESS_DENIED
    loader_class.discover_param_options.assert_not_called()
