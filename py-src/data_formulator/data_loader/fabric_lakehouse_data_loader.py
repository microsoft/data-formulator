import json
import logging
import struct
from typing import Any

import pandas as pd
import pyarrow as pa

from data_formulator.data_loader.external_data_loader import ExternalDataLoader

log = logging.getLogger(__name__)

# Token resource for Microsoft Fabric SQL Analytics Endpoints
_FABRIC_SQL_RESOURCE = "https://analysis.windows.net/powerbi/api/.default"

# Attribute ID for injecting an AAD access token into an ODBC connection
_SQL_COPT_SS_ACCESS_TOKEN = 1256


def _esc(value: str) -> str:
    """Escape a string value for safe embedding in a T-SQL string literal.

    Replaces each single-quote with two single-quotes, which is the standard
    T-SQL method for escaping string literals.  Values are sourced from
    INFORMATION_SCHEMA (database object names), so this is an extra safety
    measure against edge-case object names.
    """
    return value.replace("'", "''")


def _token_bytes(access_token: str) -> bytes:
    """Encode an AAD access token as a length-prefixed UTF-16-LE byte string
    expected by the SQL Server ODBC driver (SQL_COPT_SS_ACCESS_TOKEN)."""
    encoded = access_token.encode("UTF-16-LE")
    return struct.pack(f"<I{len(encoded)}s", len(encoded), encoded)


class FabricLakehouseDataLoader(ExternalDataLoader):
    """Microsoft Fabric Lakehouse / Data Warehouse SQL Analytics Endpoint loader.

    Connects to the SQL Analytics Endpoint of a Fabric Lakehouse or Warehouse
    and reads Delta Lake tables or views as PyArrow Tables.

    Authentication is always via Entra ID (Azure AD) — SQL authentication is not
    supported on Fabric SQL Analytics Endpoints. Two modes are available:

    - **Service Principal**: provide ``client_id``, ``client_secret``, and
      ``tenant_id``. The service principal must be a Fabric workspace member with
      at least the *Viewer* role.
    - **Azure CLI / DefaultAzureCredential**: run ``az login`` first and leave
      the credential fields empty.

    The SQL endpoint URL is available in the Fabric portal under
    *Lakehouse settings → SQL Analytics Endpoint*.
    """

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {
                "name": "server",
                "type": "string",
                "required": True,
                "default": "",
                "description": (
                    "Fabric SQL Analytics Endpoint hostname "
                    "(e.g. <workspace-id>.datawarehouse.fabric.microsoft.com)"
                ),
            },
            {
                "name": "database",
                "type": "string",
                "required": True,
                "default": "",
                "description": "Lakehouse or Warehouse name in the Fabric workspace",
            },
            {
                "name": "client_id",
                "type": "string",
                "required": False,
                "default": "",
                "description": "Entra ID application (client) ID for service principal auth",
            },
            {
                "name": "client_secret",
                "type": "string",
                "required": False,
                "default": "",
                "description": "Entra ID client secret for service principal auth",
            },
            {
                "name": "tenant_id",
                "type": "string",
                "required": False,
                "default": "",
                "description": "Entra ID tenant ID for service principal auth",
            },
            {
                "name": "driver",
                "type": "string",
                "required": False,
                "default": "ODBC Driver 18 for SQL Server",
                "description": "ODBC driver name (ODBC Driver 17 or 18 for SQL Server)",
            },
        ]

    @staticmethod
    def auth_instructions() -> str:
        return """**Example (Service Principal):** server: `<workspace-id>.datawarehouse.fabric.microsoft.com` · database: `MyLakehouse` · client_id: `abc-123...` · client_secret: `xyz...` · tenant_id: `def-456...`

**Example (Azure CLI):** server: `<workspace-id>.datawarehouse.fabric.microsoft.com` · database: `MyLakehouse` (run `az login` first, leave credential fields empty)

**How to find your SQL endpoint:**
Open the Fabric portal → select your Lakehouse → click *SQL Analytics Endpoint* → copy the server hostname shown in the connection details.

**Authentication Options:**
- **Service Principal (Entra ID):** Register an Azure AD application, generate a client secret, and add it as a workspace member with at least the *Viewer* role in the Fabric portal (Workspace settings → Manage access).
- **Azure CLI / DefaultAzureCredential:** Run `az login` in your terminal. Leave client_id, client_secret, and tenant_id empty.

**Prerequisites:** ODBC Driver 17 or 18 for SQL Server must be installed. See [Microsoft Docs](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server)."""

    def __init__(self, params: dict[str, Any]):
        log.info(f"Initializing FabricLakehouse DataLoader with parameters: {params}")
        self.params = params

        self.server = params.get("server", "").strip()
        self.database = params.get("database", "").strip()
        self.client_id = params.get("client_id", "").strip()
        self.client_secret = params.get("client_secret", "").strip()
        self.tenant_id = params.get("tenant_id", "").strip()
        self.driver = (
            params.get("driver", "ODBC Driver 18 for SQL Server").strip()
            or "ODBC Driver 18 for SQL Server"
        )

        if not self.server:
            raise ValueError("Fabric SQL Analytics Endpoint hostname is required")
        if not self.database:
            raise ValueError("Lakehouse or Warehouse name (database) is required")

        # Verify the connection on initialisation
        try:
            conn = self._get_pyodbc_connection()
            conn.close()
            log.info(
                f"Connected to Fabric SQL endpoint: {self.server}/{self.database}"
            )
        except Exception as e:
            raise ValueError(
                f"Failed to connect to Fabric SQL endpoint '{self.server}': {e}"
            ) from e

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_access_token(self) -> str:
        """Obtain an AAD access token for the Fabric SQL Analytics Endpoint."""
        from azure.identity import ClientSecretCredential, DefaultAzureCredential

        if self.client_id and self.client_secret and self.tenant_id:
            credential = ClientSecretCredential(
                tenant_id=self.tenant_id,
                client_id=self.client_id,
                client_secret=self.client_secret,
            )
        else:
            credential = DefaultAzureCredential()

        return credential.get_token(_FABRIC_SQL_RESOURCE).token

    def _get_pyodbc_connection(self):
        """Create a pyodbc connection to the Fabric SQL endpoint using AAD token auth."""
        import pyodbc

        conn_str = (
            f"DRIVER={{{self.driver}}};"
            f"SERVER={self.server};"
            f"DATABASE={self.database};"
            "Encrypt=yes;"
            "TrustServerCertificate=no;"
        )
        token = _token_bytes(self._get_access_token())
        return pyodbc.connect(conn_str, attrs_before={_SQL_COPT_SS_ACCESS_TOKEN: token})

    def _execute_query(self, query: str) -> pa.Table:
        """Execute a T-SQL query against the Fabric endpoint and return an Arrow table."""
        conn = self._get_pyodbc_connection()
        try:
            df = pd.read_sql(query, conn)
            return pa.Table.from_pandas(df, preserve_index=False)
        finally:
            conn.close()

    def _safe_select_list(self, schema: str, table_name: str) -> str:
        """Build a SELECT column list that casts unsupported types to NVARCHAR.

        Returns ``'*'`` when no unsupported columns are present.
        """
        _spatial = {"geometry", "geography"}
        _other = {"hierarchyid", "xml", "sql_variant", "image", "timestamp"}
        _unsupported = _spatial | _other
        try:
            cols_df = self._execute_query(
                f"""
                SELECT COLUMN_NAME, DATA_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = '{_esc(schema)}' AND TABLE_NAME = '{_esc(table_name)}'
                ORDER BY ORDINAL_POSITION
                """
            ).to_pandas()
            if not any(
                r["DATA_TYPE"].lower() in _unsupported
                for _, r in cols_df.iterrows()
            ):
                return "*"
            parts = []
            for _, r in cols_df.iterrows():
                col, dtype = r["COLUMN_NAME"], r["DATA_TYPE"].lower()
                if dtype in _spatial:
                    parts.append(f"[{col}].STAsText() AS [{col}]")
                elif dtype in _other:
                    parts.append(f"CAST([{col}] AS NVARCHAR(MAX)) AS [{col}]")
                else:
                    parts.append(f"[{col}]")
            return ", ".join(parts)
        except Exception:
            return "*"

    # ------------------------------------------------------------------
    # ExternalDataLoader interface
    # ------------------------------------------------------------------

    def fetch_data_as_arrow(
        self,
        source_table: str,
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = "asc",
    ) -> pa.Table:
        """Fetch data from the Fabric Lakehouse SQL endpoint as a PyArrow Table."""
        if not source_table:
            raise ValueError("source_table must be provided")

        if "." in source_table:
            schema, table = source_table.split(".", 1)
        else:
            schema, table = "dbo", source_table

        schema = schema.strip("[]")
        table = table.strip("[]")

        col_list = self._safe_select_list(schema, table)
        base_query = f"SELECT {col_list} FROM [{schema}].[{table}]"

        order_by_clause = ""
        if sort_columns:
            direction = "DESC" if sort_order == "desc" else "ASC"
            order_by_clause = (
                " ORDER BY "
                + ", ".join(f"[{col}] {direction}" for col in sort_columns)
            )

        query = f"SELECT TOP {size} * FROM ({base_query}{order_by_clause}) AS _limited"

        log.info(f"Executing Fabric SQL query: {query[:200]}...")
        arrow_table = self._execute_query(query)
        log.info(f"Fetched {arrow_table.num_rows} rows from Fabric Lakehouse")
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List all tables from the Fabric Lakehouse SQL Analytics Endpoint."""
        try:
            tables_df = self._execute_query(
                """
                SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE IN ('BASE TABLE', 'VIEW')
                  AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY TABLE_SCHEMA, TABLE_NAME
                """
            ).to_pandas()
        except Exception as e:
            log.error(f"Failed to list tables from Fabric SQL endpoint: {e}")
            return []

        results = []
        for _, row in tables_df.iterrows():
            schema = row["TABLE_SCHEMA"]
            table_name = row["TABLE_NAME"]
            table_type = row.get("TABLE_TYPE", "BASE TABLE")
            full_name = f"{schema}.{table_name}"

            if table_filter and table_filter.lower() not in full_name.lower():
                continue

            try:
                columns_df = self._execute_query(
                    f"""
                    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
                           CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = '{_esc(schema)}' AND TABLE_NAME = '{_esc(table_name)}'
                    ORDER BY ORDINAL_POSITION
                    """
                ).to_pandas()

                columns = []
                for _, col_row in columns_df.iterrows():
                    col_info: dict[str, Any] = {
                        "name": col_row["COLUMN_NAME"],
                        "type": col_row["DATA_TYPE"],
                        "nullable": col_row["IS_NULLABLE"] == "YES",
                        "default": col_row["COLUMN_DEFAULT"],
                    }
                    for field, key in [
                        ("CHARACTER_MAXIMUM_LENGTH", "max_length"),
                        ("NUMERIC_PRECISION", "precision"),
                        ("NUMERIC_SCALE", "scale"),
                    ]:
                        val = col_row[field]
                        if val is not None and not pd.isna(val):
                            try:
                                col_info[key] = int(val)
                            except (ValueError, TypeError):
                                pass
                    columns.append(col_info)

                col_list = self._safe_select_list(schema, table_name)

                sample_rows: list = []
                try:
                    sample_df = self._execute_query(
                        f"SELECT TOP 10 {col_list} FROM [{schema}].[{table_name}]"
                    ).to_pandas()
                    sample_rows = json.loads(
                        sample_df.fillna(value=None).to_json(
                            orient="records", date_format="iso", default_handler=str
                        )
                    )
                except Exception as e:
                    log.warning(f"Failed to sample table {full_name}: {e}")

                count_df = self._execute_query(
                    f"SELECT COUNT(*) AS row_count FROM [{schema}].[{table_name}]"
                ).to_pandas()
                raw_count = count_df.iloc[0]["row_count"]
                try:
                    row_count = 0 if pd.isna(raw_count) else int(raw_count)
                except (ValueError, TypeError):
                    row_count = 0

                results.append(
                    {
                        "name": full_name,
                        "metadata": {
                            "row_count": row_count,
                            "columns": columns,
                            "sample_rows": sample_rows,
                            "table_type": table_type,
                        },
                    }
                )
            except Exception as e:
                log.warning(f"Failed to get metadata for table {full_name}: {e}")
                results.append(
                    {
                        "name": full_name,
                        "metadata": {
                            "row_count": 0,
                            "columns": [],
                            "sample_rows": [],
                            "table_type": table_type,
                        },
                    }
                )

        return results
