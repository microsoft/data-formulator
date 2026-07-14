"""Azure SQL connector with delegated Microsoft Entra authentication."""

from __future__ import annotations

from typing import Any

from data_formulator.data_loader.mssql_data_loader import MSSQLDataLoader


class AzureSQLDataLoader(MSSQLDataLoader):
    """Azure SQL product connector backed by the shared MSSQL data plane."""

    DISPLAY_NAME = "Azure SQL (Microsoft Entra)"

    @staticmethod
    def auth_config() -> dict[str, Any]:
        return {
            "mode": "delegated",
            "profile": "azure_sql",
            "display_name": "Microsoft Entra",
            "audience": "https://database.windows.net/",
            "login_url": "/api/auth/azure-sql/login",
            "supports_refresh": False,
        }

    @staticmethod
    def delegated_login_config() -> dict[str, str]:
        return {
            "login_url": "/api/auth/azure-sql/login",
            "label_key": "loader.azure_sql.entraSignIn",
        }

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {
                "name": "server",
                "type": "string",
                "required": True,
                "default": "",
                "tier": "connection",
                "description": "Azure SQL logical server hostname",
            },
            {
                "name": "database",
                "type": "string",
                "required": True,
                "default": "",
                "tier": "filter",
                "description": "Azure SQL database name",
            },
            {
                "name": "port",
                "type": "string",
                "required": False,
                "default": "1433",
                "tier": "connection",
                "description": "Azure SQL port",
            },
            {
                "name": "connection_timeout",
                "type": "string",
                "required": False,
                "default": "30",
                "tier": "connection",
                "description": "Connection timeout in seconds",
            },
        ]

    @staticmethod
    def auth_instructions() -> str:
        return """**Microsoft Entra delegated authentication**

Enter the Azure SQL logical server hostname and target database, then select **Sign in with Microsoft Entra**. Conditional Access determines whether MFA is required.

**Prerequisites:** ODBC Driver 18, an Azure SQL Microsoft Entra administrator, and a contained database user or group with least-privilege access.

Tokens remain server-side and are never persisted in connector configuration or the credential vault."""

    def __init__(self, params: dict[str, Any]):
        server = str(params.get("server", "")).strip()
        database = str(params.get("database", "")).strip()
        access_token = str(params.get("access_token", "")).strip()
        if not server:
            raise ValueError("Azure SQL server is required")
        if not database:
            raise ValueError("Azure SQL database is required")
        if not access_token:
            raise ValueError("Microsoft Entra sign-in is required")

        azure_params = {
            **params,
            "server": server,
            "database": database,
            "driver": "ODBC Driver 18 for SQL Server",
            "encrypt": "yes",
            "trust_server_certificate": "no",
            "user": "",
            "password": "",
        }
        super().__init__(azure_params)
