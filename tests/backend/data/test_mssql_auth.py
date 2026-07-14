"""Authentication contracts for separate SQL Server and Azure SQL loaders."""

from __future__ import annotations

import struct
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.data_loader import DATA_LOADERS
from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader
from data_formulator.data_loader.azure_sql_data_loader import AzureSQLDataLoader

pytestmark = [pytest.mark.backend]


class TestAzureSQLAuthentication:
    def test_access_token_uses_odbc_token_attribute(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            AzureSQLDataLoader({
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
            AzureSQLDataLoader({
                "server": "example.database.windows.net",
                "database": "analytics",
                "access_token": "abc",
            })

        packed = connect.call_args.kwargs["attrs_before"][1256]
        size = struct.unpack("=i", packed[:4])[0]
        assert size == 6
        assert packed[4:] == "abc".encode("utf-16-le")

    def test_access_token_is_not_retained_on_loader(self):
        params = {
            "server": "example.database.windows.net",
            "database": "analytics",
            "access_token": "token-value",
        }
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            loader = AzureSQLDataLoader(params)

        assert not hasattr(loader, "access_token")
        assert "access_token" not in loader.params
        assert params["access_token"] == "token-value"

    def test_connection_error_does_not_expose_token_or_raw_driver_message(self):
        with patch(
            "data_formulator.data_loader.mssql_data_loader.pyodbc.connect",
            side_effect=RuntimeError("driver echoed token-value"),
        ), pytest.raises(ValueError) as error:
            AzureSQLDataLoader({
                "server": "example.database.windows.net",
                "database": "analytics",
                "access_token": "token-value",
            })

        assert "token-value" not in str(error.value)
        assert "driver echoed" not in str(error.value)

    def test_requires_access_token(self):
        with pytest.raises(ValueError, match="Microsoft Entra sign-in is required"):
            AzureSQLDataLoader({
                "server": "example.database.windows.net",
                "database": "analytics",
            })

    def test_requires_database(self):
        with pytest.raises(ValueError, match="database is required"):
            AzureSQLDataLoader({
                "server": "example.database.windows.net",
                "access_token": "token-value",
            })

    def test_enforces_azure_sql_driver_and_tls_defaults(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            AzureSQLDataLoader({
                "server": "example.database.windows.net",
                "database": "analytics",
                "access_token": "token-value",
                "driver": "ODBC Driver 17 for SQL Server",
                "encrypt": "no",
                "trust_server_certificate": "yes",
            })

        connection_string = connect.call_args.args[0]
        assert "DRIVER={ODBC Driver 18 for SQL Server}" in connection_string
        assert "Encrypt=yes" in connection_string
        assert "TrustServerCertificate=no" in connection_string

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("port", "1433;TrustServerCertificate=yes"),
            ("port", "0"),
            ("port", "65536"),
            ("connection_timeout", "30;TrustServerCertificate=yes"),
            ("connection_timeout", "0"),
            ("connection_timeout", "301"),
        ],
    )
    def test_rejects_invalid_numeric_connection_attributes(self, field, value):
        params = {
            "server": "example.database.windows.net",
            "database": "analytics",
            "access_token": "token-value",
            field: value,
        }

        with patch(
            "data_formulator.data_loader.mssql_data_loader.pyodbc.connect"
        ) as connect, pytest.raises(ValueError):
            AzureSQLDataLoader(params)

        connect.assert_not_called()

    def test_preserves_fixed_tls_attributes_with_semicolon_in_database_name(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            AzureSQLDataLoader({
                "server": "example.database.windows.net",
                "database": "analytics;TrustServerCertificate=yes",
                "access_token": "token-value",
            })

        connection_string = connect.call_args.args[0]
        database_attribute = "DATABASE={analytics;TrustServerCertificate=yes};"
        assert database_attribute in connection_string
        fixed_attributes = connection_string.replace(database_attribute, "")
        assert fixed_attributes.count("TrustServerCertificate=") == 1
        assert ";TrustServerCertificate=no;" in fixed_attributes

    def test_semicolon_server_remains_one_odbc_value(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            AzureSQLDataLoader({
                "server": "example.database.windows.net;Encrypt=no",
                "database": "analytics",
                "access_token": "token-value",
            })

        connection_string = connect.call_args.args[0]
        server_attribute = "SERVER={example.database.windows.net;Encrypt=no,1433};"
        assert server_attribute in connection_string
        fixed_attributes = connection_string.replace(server_attribute, "")
        assert fixed_attributes.count("Encrypt=") == 1
        assert ";Encrypt=yes;" in fixed_attributes

    def test_delegated_config_declares_sql_audience_and_profile(self):
        config = AzureSQLDataLoader.auth_config()
        delegated = AzureSQLDataLoader.delegated_login_config()

        assert config["mode"] == "delegated"
        assert config["profile"] == "azure_sql"
        assert config["audience"] == "https://database.windows.net/"
        assert delegated["login_url"] == "/api/auth/azure-sql/login"
        assert delegated["label_key"] == "loader.azure_sql.entraSignIn"


class TestMSSQLAuthentication:
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

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("encrypt", "yes;TrustServerCertificate=yes"),
            ("trust_server_certificate", "no;Encrypt=no"),
            ("driver", "ODBC Driver 18 for SQL Server};Encrypt=no"),
        ],
    )
    def test_rejects_unrepresentable_connection_attributes(self, field, value):
        with patch(
            "data_formulator.data_loader.mssql_data_loader.pyodbc.connect"
        ) as connect, pytest.raises(ValueError):
            MSSQLDataLoader({field: value})

        connect.assert_not_called()

    def test_semicolon_credentials_remain_single_odbc_values(self):
        with patch("data_formulator.data_loader.mssql_data_loader.pyodbc.connect") as connect:
            connect.return_value = MagicMock()
            MSSQLDataLoader({
                "user": "analyst;Trusted_Connection=yes",
                "password": "secret;TrustServerCertificate=yes",
            })

        connection_string = connect.call_args.args[0]
        assert "UID={analyst;Trusted_Connection=yes};" in connection_string
        assert "PWD={secret;TrustServerCertificate=yes};" in connection_string

    def test_rejects_unrepresentable_closing_brace_in_password(self):
        with patch(
            "data_formulator.data_loader.mssql_data_loader.pyodbc.connect"
        ) as connect, pytest.raises(ValueError):
            MSSQLDataLoader({"user": "analyst", "password": "secret}"})

        connect.assert_not_called()

    def test_generic_sql_server_is_credentials_only(self):
        config = MSSQLDataLoader.auth_config()
        delegated = MSSQLDataLoader.delegated_login_config()

        assert config["mode"] == "credentials"
        assert "audience" not in config
        assert delegated is None


class TestSQLLoaderRegistry:
    def test_sql_server_and_azure_sql_are_distinct_connector_types(self):
        assert DATA_LOADERS["mssql"] is MSSQLDataLoader
        assert DATA_LOADERS["azure_sql"] is AzureSQLDataLoader
        assert MSSQLDataLoader is not AzureSQLDataLoader
