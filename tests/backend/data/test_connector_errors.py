from __future__ import annotations

import requests

import pytest

from data_formulator.data_loader.connector_errors import classify_connector_error
from data_formulator.data_loader.external_data_loader import ConnectorParamError
from data_formulator.errors import ErrorCode

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


@pytest.mark.parametrize(
    "error,operation,expected_code,retry",
    [
        (ConnectorParamError(["host"], "MockLoader"), "", ErrorCode.INVALID_REQUEST, False),
        (ConnectionError("Lost connection to MySQL server"), "preview", ErrorCode.DB_CONNECTION_FAILED, True),
        (TimeoutError("timed out while connecting"), "connect", ErrorCode.DB_CONNECTION_FAILED, True),
        (PermissionError("permission denied"), "catalog", ErrorCode.ACCESS_DENIED, False),
        (RuntimeError("SQL syntax error near SELECT"), "preview", ErrorCode.DB_QUERY_ERROR, False),
        (ValueError("Unsupported file type: .exe"), "import", ErrorCode.DATA_LOAD_ERROR, False),
        (RuntimeError("something strange"), "preview", ErrorCode.DATA_LOAD_ERROR, False),
        (RuntimeError("something strange"), "catalog", ErrorCode.CONNECTOR_ERROR, False),
    ],
)
def test_classify_connector_error(error, operation, expected_code, retry):
    info = classify_connector_error(error, operation=operation)
    assert info.code == expected_code
    assert info.retry is retry
    assert info.message


def test_http_401_maps_to_connector_auth_failed():
    response = requests.Response()
    response.status_code = 401
    error = requests.HTTPError("401 Unauthorized", response=response)

    info = classify_connector_error(error, operation="connect")

    assert info.code == ErrorCode.CONNECTOR_AUTH_FAILED
    assert info.retry is False


def test_http_500_with_lost_connection_maps_to_connection_failed():
    response = requests.Response()
    response.status_code = 500
    error = requests.HTTPError(
        "500 Server Error detail=Lost connection to MySQL server",
        response=response,
    )

    info = classify_connector_error(error, operation="preview")

    assert info.code == ErrorCode.DB_CONNECTION_FAILED
    assert info.retry is True


def test_azure_sql_firewall_denial_exposes_safe_client_ip():
    error = RuntimeError(
        "Cannot open server 'example' requested by the login. Client with IP "
        "address '131.107.1.158' is not allowed to access the server."
    )

    info = classify_connector_error(error, operation="connect")

    assert info.code == ErrorCode.DB_FIREWALL_BLOCKED
    assert info.retry is False
    assert "131.107.1.158" in info.message
    assert "SQL server firewall" in info.message
    assert "example" not in info.message


