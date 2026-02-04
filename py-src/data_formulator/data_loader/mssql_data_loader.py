import json
import logging
from typing import Any

import pandas as pd
import pyarrow as pa
import connectorx as cx

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

log = logging.getLogger(__name__)


class MSSQLDataLoader(ExternalDataLoader):
    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {
                "name": "server",
                "type": "string",
                "required": True,
                "default": "localhost",
                "description": "SQL Server host address or instance name",
            },
            {
                "name": "database",
                "type": "string",
                "required": True,
                "default": "master",
                "description": "Database name to connect to",
            },
            {
                "name": "user",
                "type": "string",
                "required": False,
                "default": "",
                "description": "Username (leave empty for Windows Authentication)",
            },
            {
                "name": "password",
                "type": "string",
                "required": False,
                "default": "",
                "description": "Password (leave empty for Windows Authentication)",
            },
            {
                "name": "port",
                "type": "string",
                "required": False,
                "default": "1433",
                "description": "SQL Server port (default: 1433)",
            },
            {
                "name": "driver",
                "type": "string",
                "required": False,
                "default": "ODBC Driver 17 for SQL Server",
                "description": "ODBC driver name",
            },
            {
                "name": "encrypt",
                "type": "string",
                "required": False,
                "default": "yes",
                "description": "Enable encryption (yes/no)",
            },
            {
                "name": "trust_server_certificate",
                "type": "string",
                "required": False,
                "default": "no",
                "description": "Trust server certificate (yes/no)",
            },
            {
                "name": "connection_timeout",
                "type": "string",
                "required": False,
                "default": "30",
                "description": "Connection timeout in seconds",
            },
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
SQL Server Connection Instructions:

1. Prerequisites:
   - Install connectorx: pip install connectorx (used for fast Arrow-native data access)
   - Install ODBC stack for connectorx:
     * macOS: brew install unixodbc
     * Linux: sudo apt-get install unixodbc-dev (Ubuntu/Debian) or sudo yum install unixODBC-devel (CentOS/RHEL)
     * Windows: Usually included with ODBC driver installation
   - Install Microsoft ODBC Driver for SQL Server:
     * Windows: Usually pre-installed with SQL Server
     * macOS: brew tap microsoft/mssql-release && brew install msodbcsql17
     * Linux: Install via package manager (msodbcsql17 or msodbcsql18)

2. Local SQL Server Setup:
   - Ensure SQL Server is running on your machine
   - Enable SQL Server Authentication if using username/password
   - Default connection: server='localhost' or '.' or '(local)'

3. Connection Parameters:
   - server: SQL Server instance (localhost, server\\instance, or IP address)
   - database: Target database name (default: master)
   - user: SQL Server username (leave empty for Windows Authentication)
   - password: SQL Server password (leave empty for Windows Authentication)
   - port: SQL Server port (default: 1433)
   - driver: ODBC driver name (default: 'ODBC Driver 17 for SQL Server')

4. Authentication Methods:
   - Windows Authentication: Leave user/password empty (recommended for local development)
   - SQL Server Authentication: Provide username and password
   - Azure AD Authentication: Use appropriate connection parameters

5. Connection Examples:
   - Local default instance: server='localhost' or server='.'
   - Named instance: server='localhost\\SQLEXPRESS'
   - Remote server: server='192.168.1.100' or server='sql-server.company.com'
   - Custom port: server='localhost,1434' (note the comma, not colon)

6. Common Issues & Troubleshooting:
   - If connectorx fails: Install unixodbc first (macOS/Linux)
   - Ensure SQL Server service is running
   - Check SQL Server Browser service for named instances
   - Verify TCP/IP protocol is enabled in SQL Server Configuration Manager
   - Check Windows Firewall settings for SQL Server port
   - Test connection: sqlcmd -S server -d database -U username -P password
   - For named instances, ensure SQL Server Browser service is running
   - Check ODBC drivers: odbcinst -q -d (on Unix/Linux)

7. Driver Installation:
   - macOS: brew install msodbcsql17 or download from Microsoft
   - Ubuntu/Debian: sudo apt-get install msodbcsql17
   - CentOS/RHEL: sudo yum install msodbcsql17
   - Windows: Install SQL Server or download ODBC driver separately
"""

    def __init__(self, params: dict[str, Any]):
        log.info(f"Initializing MSSQL DataLoader with parameters: {params}")

        self.params = params

        self.server = params.get("server", "localhost")
        self.database = params.get("database", "master")
        self.user = params.get("user", "").strip()
        self.password = params.get("password", "").strip()
        self.port = params.get("port", "1433")

        # Build connection URL for connectorx: mssql://user:password@host:port/database
        # - Use explicit empty password (user:@host) when user is set but password is blank.
        # - Use 127.0.0.1 when server is localhost to force IPv4 TCP and avoid IPv6 ::1 connection issues.
        server_for_url = "127.0.0.1" if (self.server or "").strip().lower() == "localhost" else self.server
        if self.user:
            self.connection_url = f"mssql://{self.user}:{self.password}@{server_for_url}:{self.port}/{self.database}?TrustServerCertificate=true"
        else:
            self.connection_url = f"mssql://{server_for_url}:{self.port}/{self.database}?TrustServerCertificate=true&IntegratedSecurity=true"

        try:
            cx.read_sql(self.connection_url, "SELECT 1", return_type="arrow")
            log.info(f"Successfully connected to SQL Server: {self.server}/{self.database}")
        except Exception as e:
            log.error(f"Failed to connect to SQL Server: {e}")
            raise ValueError(f"Failed to connect to SQL Server '{self.server}': {e}") from e

    def _execute_query(self, query: str) -> pa.Table:
        """Execute a query and return results as a PyArrow Table (via connectorx)."""
        try:
            return cx.read_sql(self.connection_url, query, return_type="arrow")
        except Exception as e:
            log.error(f"Failed to execute query: {e}")
            raise

    def fetch_data_as_arrow(
        self,
        source_table: str,
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = 'asc'
    ) -> pa.Table:
        """
        Fetch data from SQL Server as a PyArrow Table using connectorx.
        """
        if not source_table:
            raise ValueError("source_table must be provided")
        
        # Parse table name
        if "." in source_table:
            schema, table = source_table.split(".", 1)
        else:
            schema = "dbo"
            table = source_table
        
        base_query = f"SELECT * FROM [{schema}].[{table}]"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'[{col}] {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        # SQL Server uses TOP instead of LIMIT
        query = f"SELECT TOP {size} * FROM ({base_query}{order_by_clause}) AS limited"
        
        log.info(f"Executing SQL Server query: {query[:200]}...")
        
        arrow_table = cx.read_sql(self.connection_url, query, return_type="arrow")
        log.info(f"Fetched {arrow_table.num_rows} rows from SQL Server [Arrow-native]")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List all tables from SQL Server database."""
        try:
            tables_query = """
                SELECT 
                    TABLE_SCHEMA, 
                    TABLE_NAME,
                    TABLE_TYPE
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_TYPE = 'BASE TABLE' 
                AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            """

            tables_df = self._execute_query(tables_query).to_pandas()
            results = []

            for _, row in tables_df.iterrows():
                schema = row["TABLE_SCHEMA"]
                table_name = row["TABLE_NAME"]
                table_type = row.get("TABLE_TYPE", "BASE TABLE")
                full_table_name = f"{schema}.{table_name}"

                if table_filter and table_filter.lower() not in full_table_name.lower():
                    continue

                try:
                    # Get column information
                    columns_query = f"""
                        SELECT 
                            COLUMN_NAME, 
                            DATA_TYPE, 
                            IS_NULLABLE, 
                            COLUMN_DEFAULT,
                            CHARACTER_MAXIMUM_LENGTH,
                            NUMERIC_PRECISION,
                            NUMERIC_SCALE
                        FROM INFORMATION_SCHEMA.COLUMNS 
                        WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table_name}'
                        ORDER BY ORDINAL_POSITION
                    """
                    columns_df = self._execute_query(columns_query).to_pandas()

                    columns = []
                    for _, col_row in columns_df.iterrows():
                        col_info = {
                            "name": col_row["COLUMN_NAME"],
                            "type": col_row["DATA_TYPE"],
                            "nullable": col_row["IS_NULLABLE"] == "YES",
                            "default": col_row["COLUMN_DEFAULT"],
                        }

                        # Add length/precision info for relevant types with NaN handling
                        if (
                            col_row["CHARACTER_MAXIMUM_LENGTH"] is not None
                            and not pd.isna(col_row["CHARACTER_MAXIMUM_LENGTH"])
                        ):
                            try:
                                col_info["max_length"] = int(col_row["CHARACTER_MAXIMUM_LENGTH"])
                            except (ValueError, TypeError):
                                pass  # Skip if conversion fails

                        if (
                            col_row["NUMERIC_PRECISION"] is not None
                            and not pd.isna(col_row["NUMERIC_PRECISION"])
                        ):
                            try:
                                col_info["precision"] = int(col_row["NUMERIC_PRECISION"])
                            except (ValueError, TypeError):
                                pass  # Skip if conversion fails

                        if (
                            col_row["NUMERIC_SCALE"] is not None
                            and not pd.isna(col_row["NUMERIC_SCALE"])
                        ):
                            try:
                                col_info["scale"] = int(col_row["NUMERIC_SCALE"])
                            except (ValueError, TypeError):
                                pass  # Skip if conversion fails

                        columns.append(col_info)

                    # Get sample data (first 10 rows)
                    sample_query = f"SELECT TOP 10 * FROM [{schema}].[{table_name}]"
                    sample_df = self._execute_query(sample_query).to_pandas()

                    # Handle NaN values in sample data for JSON serialization
                    try:
                        # Replace NaN with None for proper JSON serialization
                        sample_df_clean = sample_df.fillna(value=None)
                        sample_rows = json.loads(
                            sample_df_clean.to_json(
                                orient="records", date_format="iso", default_handler=str
                            )
                        )
                    except Exception as e:
                        log.warning(
                            f"Failed to serialize sample data for table {schema}.{table_name}: {e}"
                        )
                        sample_rows = []

                    # Get row count
                    count_query = f"SELECT COUNT(*) as row_count FROM [{schema}].[{table_name}]"
                    count_df = self._execute_query(count_query).to_pandas()

                    # Handle NaN values in row count
                    raw_count = count_df.iloc[0]["row_count"]
                    if pd.isna(raw_count):
                        row_count = 0
                        log.warning(
                            f"Row count for table {schema}.{table_name} returned NaN, using 0"
                        )
                    else:
                        try:
                            row_count = int(raw_count)
                        except (ValueError, TypeError):
                            row_count = 0
                            log.warning(
                                f"Could not convert row count '{raw_count}' to integer for table {schema}.{table_name}, using 0"
                            )

                    table_metadata = {
                        "row_count": row_count,
                        "columns": columns,
                        "sample_rows": sample_rows,
                        "table_type": table_type,
                    }

                    results.append({"name": full_table_name, "metadata": table_metadata})

                except Exception as e:
                    log.warning(f"Failed to get metadata for table {full_table_name}: {e}")
                    # Add table without detailed metadata
                    results.append(
                        {
                            "name": full_table_name,
                            "metadata": {
                                "row_count": 0,
                                "columns": [],
                                "sample_rows": [],
                                "table_type": table_type,
                            },
                        }
                    )

        except Exception as e:
            log.error(f"Failed to list tables from SQL Server: {e}")
            results = []

        return results
