"""Authentication contracts for the SQL Server and Azure SQL loader."""

from __future__ import annotations

import struct
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader

pytestmark = [pytest.mark.backend]


class TestMSSQLAuthentication:
    def test_access_token_uses_odbc_token_attribute(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            MSSQLDataLoader({
                "server": "example.database.windows.net",
                "database": "analytics",
                "access_token": "token-value",
                "driver": "ODBC Driver 18 for SQL Server",
            })

        connection_string = connect.call_args.args[0]
        attributes = connect.call_args.kwargs["attrs_before"]
        assert "UID=" not in connection_string
        assert "PWD=" not in connection_string
        assert "Trusted_Connection=" not in connection_string
        assert "Authentication=" not in connection_string
        assert 1256 in attributes

    def test_access_token_is_encoded_for_odbc(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            MSSQLDataLoader({"access_token": "abc", "driver": "ODBC Driver 18 for SQL Server"})

        packed = connect.call_args.kwargs["attrs_before"][1256]
        size = struct.unpack("=i", packed[:4])[0]
        assert size == 6
        assert packed[4:] == "abc".encode("utf-16-le")

    def test_access_token_is_not_retained_on_loader(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            loader = MSSQLDataLoader({"access_token": "token-value"})

        assert not hasattr(loader, "access_token")

    def test_connection_error_does_not_expose_token_or_raw_driver_message(self):
        with patch(
            "data_formulator.data_loader.mssql_data_loader.pyodbc.connect",
            side_effect=RuntimeError("driver echoed token-value"),
        ), pytest.raises(ValueError) as error:
            MSSQLDataLoader({
                "server": "example.database.windows.net",
                "access_token": "token-value",
            })

        assert "token-value" not in str(error.value)
        assert "driver echoed" not in str(error.value)

    def test_sql_credentials_preserve_existing_connection_string(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            MSSQLDataLoader({"user": "analyst", "password": "secret"})

        connection_string = connect.call_args.args[0]
        assert "UID=analyst;PWD=secret;" in connection_string
        assert "attrs_before" not in connect.call_args.kwargs

    def test_empty_username_preserves_trusted_connection(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            MSSQLDataLoader({})

        assert "Trusted_Connection=yes;" in connect.call_args.args[0]
        assert "attrs_before" not in connect.call_args.kwargs

    def test_delegated_config_declares_sql_audience(self):
        config = MSSQLDataLoader.auth_config()
        delegated = MSSQLDataLoader.delegated_login_config()

        assert config["mode"] == "delegated"
        assert config["audience"] == "https://database.windows.net/"
        assert delegated["login_url"] == "/api/auth/azure-sql/login"
        assert delegated["label_key"] == "loader.mssql.entraSignIn"
