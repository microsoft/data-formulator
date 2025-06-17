import json
import logging
from typing import Dict, Any

import duckdb
import pandas as pd

try:
    import pyodbc
    PYODBC_AVAILABLE = True
except ImportError:
    PYODBC_AVAILABLE = False

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

log = logging.getLogger(__name__)


class MSSQLDataLoader(ExternalDataLoader):
    @staticmethod
    def list_params() -> bool:
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
   - Install pyodbc dependencies:
     * macOS: brew install unixodbc
     * Linux: sudo apt-get install unixodbc-dev (Ubuntu/Debian) or sudo yum install unixODBC-devel (CentOS/RHEL)
     * Windows: Usually included with pyodbc installation
   - Install pyodbc: pip install pyodbc
   - Install Microsoft ODBC Driver for SQL Server:
     * Windows: Usually pre-installed with SQL Server
     * macOS: Download from Microsoft's official site or use: brew tap microsoft/mssql-release && brew install msodbcsql17
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
   - If pyodbc import fails: Install unixodbc first (macOS/Linux)
   - Ensure SQL Server service is running
   - Check SQL Server Browser service for named instances
   - Verify TCP/IP protocol is enabled in SQL Server Configuration Manager
   - Check Windows Firewall settings for SQL Server port
   - Test connection: `sqlcmd -S server -d database -U username -P password`
   - For named instances, ensure SQL Server Browser service is running
   - Check ODBC drivers: `odbcinst -q -d` (on Unix/Linux)

7. Driver Installation:
   - macOS: `brew install msodbcsql17` or download from Microsoft
   - Ubuntu/Debian: `sudo apt-get install msodbcsql17`
   - CentOS/RHEL: `sudo yum install msodbcsql17`
   - Windows: Install SQL Server or download ODBC driver separately
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        log.info("Initializing MSSQL DataLoader with parameters: %s", params)

        if not PYODBC_AVAILABLE:
            error_msg = """
pyodbc is required for MSSQL connections but is not properly installed.

Installation steps for macOS:
1. Install unixodbc: brew install unixodbc
2. Install pyodbc: pip install pyodbc
3. Install Microsoft ODBC Driver for SQL Server

For other platforms, see: https://github.com/mkleehammer/pyodbc/wiki
"""
            raise ImportError(error_msg.strip())

        self.params = params
        self.duck_db_conn = duck_db_conn

        # Build connection string for pyodbc
        self.connection_string = self._build_connection_string()
        log.info("SQL Server connection string built")

        # Test the connection
        self._test_connection()

    def _build_connection_string(self) -> str:
        """Build ODBC connection string from parameters"""
        conn_parts = []

        # Driver
        driver = self.params.get("driver", "ODBC Driver 17 for SQL Server")
        conn_parts.append(f"DRIVER={{{driver}}}")

        # Server (handle different server formats)
        server = self.params.get("server", "localhost")
        port = self.params.get("port", "1433")

        # Handle different server formats
        if "\\" in server:
            # Named instance format: server\instance
            conn_parts.append(f"SERVER={server}")
        elif "," in server:
            # Port already specified in server: server,port
            conn_parts.append(f"SERVER={server}")
        else:
            # Standard format: add port if not default
            if port and port != "1433":
                conn_parts.append(f"SERVER={server},{port}")
            else:
                conn_parts.append(f"SERVER={server}")

        # Database
        database = self.params.get("database", "master")
        conn_parts.append(f"DATABASE={database}")

        # Authentication
        user = self.params.get("user", "").strip()
        password = self.params.get("password", "").strip()

        if user:
            conn_parts.append(f"UID={user}")
            conn_parts.append(f"PWD={password}")
        else:
            # Use Windows Authentication
            conn_parts.append("Trusted_Connection=yes")

        # Connection settings
        encrypt = self.params.get("encrypt", "yes")
        trust_cert = self.params.get("trust_server_certificate", "no")
        timeout = self.params.get("connection_timeout", "30")

        conn_parts.append(f"Encrypt={encrypt}")
        conn_parts.append(f"TrustServerCertificate={trust_cert}")
        conn_parts.append(f"Connection Timeout={timeout}")

        return ";".join(conn_parts)

    def _test_connection(self):
        """Test the SQL Server connection"""
        try:
            with pyodbc.connect(self.connection_string, timeout=10) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT @@VERSION")
                version = cursor.fetchone()[0]
                log.info(f"SQL Server connection successful. Version: {version[:50]}...")
        except Exception as e:
            log.error(f"SQL Server connection test failed: {e}")
            raise ConnectionError(f"Failed to connect to SQL Server: {e}")

    def _execute_query(self, query: str) -> pd.DataFrame:
        """Execute a query and return results as DataFrame"""
        try:
            with pyodbc.connect(self.connection_string) as conn:
                return pd.read_sql(query, conn)
        except Exception as e:
            log.error(f"Failed to execute query: {e}")
            raise

    def list_tables(self):
        """List all tables from SQL Server database"""
        try:
            # Query SQL Server system tables to get table information
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

            tables_df = self._execute_query(tables_query)
            results = []

            for _, row in tables_df.iterrows():
                schema = row["TABLE_SCHEMA"]
                table_name = row["TABLE_NAME"]
                table_type = row.get("TABLE_TYPE", "BASE TABLE")
                full_table_name = f"{schema}.{table_name}"

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
                    columns_df = self._execute_query(columns_query)

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
                    sample_df = self._execute_query(sample_query)

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
                    count_df = self._execute_query(count_query)

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

    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 1000000):
        """Ingest data from SQL Server table into DuckDB"""
        # Parse table name (assuming format: schema.table)
        if "." in table_name:
            schema, table = table_name.split(".", 1)
        else:
            schema = "dbo"  # Default schema
            table = table_name

        if name_as is None:
            name_as = table

        name_as = sanitize_table_name(name_as)

        try:
            # Query data from SQL Server with limit
            query = f"SELECT TOP {size} * FROM [{schema}].[{table}]"
            df = self._execute_query(query)

            # Use the base class method to ingest DataFrame into DuckDB
            self.ingest_df_to_duckdb(df, name_as)
            log.info(f"Successfully ingested {len(df)} rows from {schema}.{table} to {name_as}")
        except Exception as e:
            log.error(f"Failed to ingest data from {table_name}: {e}")
            raise

    def view_query_sample(self, query: str) -> str:
        """Execute a custom query and return sample results"""
        try:
            # Add TOP 10 if not already present for SELECT queries
            modified_query = query.strip()
            if (
                modified_query.upper().startswith("SELECT")
                and not modified_query.upper().startswith("SELECT TOP")
                and "TOP " not in modified_query.upper()[:50]
            ):  # Check first 50 chars
                modified_query = modified_query.replace("SELECT", "SELECT TOP 10", 1)

            df = self._execute_query(modified_query)

            # Handle NaN values for JSON serialization
            df_clean = df.fillna(value=None)
            return json.loads(
                df_clean.head(10).to_json(orient="records", date_format="iso", default_handler=str)
            )
        except Exception as e:
            log.error(f"Failed to execute query sample: {e}")
            raise

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        """Execute a custom query and ingest results into DuckDB"""
        try:
            df = self._execute_query(query)
            # Use the base class's method to ingest the DataFrame
            self.ingest_df_to_duckdb(df, name_as)
            log.info(f"Successfully ingested {len(df)} rows from custom query to {name_as}")
            return df
        except Exception as e:
            log.error(f"Failed to execute and ingest custom query: {e}")
            raise
