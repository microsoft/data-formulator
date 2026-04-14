import json
import logging
import math
from typing import Any

import pyarrow as pa
import pyodbc

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, sanitize_table_name

log = logging.getLogger(__name__)


def _is_nan(value) -> bool:
    """Check if a value is NaN (works for float, int, None)."""
    if value is None:
        return True
    try:
        return math.isnan(float(value))
    except (TypeError, ValueError):
        return False


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
                "required": False,
                "default": "",
                "description": "Database name (leave empty to browse all databases)",
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
        return """**Example (SQL auth):** server: `localhost` · database: `mydb` · user: `sa` · password: `MyP@ss` · port: `1433`

**Example (Windows auth):** server: `localhost\\SQLEXPRESS` · database: `mydb` (leave user/password empty)

**Prerequisites (macOS/Linux only):**
Install ODBC driver: `brew install unixodbc msodbcsql17` (macOS) or `sudo apt-get install unixodbc-dev msodbcsql17` (Ubuntu/Debian). Windows usually has these pre-installed.

**Authentication:**
- **Windows Auth:** Leave user/password empty (recommended for local dev)
- **SQL Server Auth:** Provide username and password

**Troubleshooting:** Ensure SQL Server service is running. Verify TCP/IP is enabled in SQL Server Configuration Manager. Test with `sqlcmd -S <server> -d <database> -U <user> -P <password>`."""

    def __init__(self, params: dict[str, Any]):
        log.info(f"Initializing MSSQL DataLoader with parameters: {params}")

        self.params = params

        self.server = params.get("server", "localhost")
        self.database = params.get("database", "") or ""
        self.user = params.get("user", "").strip()
        self.password = params.get("password", "").strip()
        self.port = params.get("port", "1433")
        self.driver = params.get("driver", "ODBC Driver 17 for SQL Server")
        self.encrypt = params.get("encrypt", "yes")
        self.trust_server_certificate = params.get("trust_server_certificate", "no")
        self.connection_timeout = params.get("connection_timeout", "30")

        # When no database specified, connect to master for catalog browsing
        connect_db = self.database or "master"

        # Build ODBC connection string
        conn_str = (
            f"DRIVER={{{self.driver}}};"
            f"SERVER={self.server},{self.port};"
            f"DATABASE={connect_db};"
            f"Encrypt={self.encrypt};"
            f"TrustServerCertificate={self.trust_server_certificate};"
            f"Connection Timeout={self.connection_timeout};"
        )
        if self.user:
            conn_str += f"UID={self.user};PWD={self.password};"
        else:
            conn_str += "Trusted_Connection=yes;"

        try:
            self._conn = pyodbc.connect(conn_str)
            log.info(f"Successfully connected to SQL Server: {self.server}/{self.database}")
        except Exception as e:
            log.error(f"Failed to connect to SQL Server: {e}")
            raise ValueError(f"Failed to connect to SQL Server '{self.server}': {e}") from e

    # SQL Server types that may need special handling
    _CX_SPATIAL_TYPES = {'geometry', 'geography'}  # use .STAsText()
    _CX_OTHER_UNSUPPORTED = {'hierarchyid', 'xml', 'sql_variant', 'image', 'timestamp'}
    _CX_UNSUPPORTED_TYPES = _CX_SPATIAL_TYPES | _CX_OTHER_UNSUPPORTED

    def _safe_select_list(self, schema: str, table_name: str) -> str:
        """Build a SELECT column list that converts unsupported types to text.
        Uses .STAsText() for spatial types, CAST(... AS NVARCHAR(MAX)) for others.
        Returns '*' if no unsupported columns are found."""
        try:
            columns_query = f"""
                SELECT COLUMN_NAME, DATA_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table_name}'
                ORDER BY ORDINAL_POSITION
            """
            cols_df = self._execute_query_raw(columns_query).to_pandas()
            has_unsupported = any(r['DATA_TYPE'].lower() in self._CX_UNSUPPORTED_TYPES for _, r in cols_df.iterrows())
            if not has_unsupported:
                return "*"
            parts = []
            for _, r in cols_df.iterrows():
                col, dtype = r['COLUMN_NAME'], r['DATA_TYPE'].lower()
                if dtype in self._CX_SPATIAL_TYPES:
                    parts.append(f"[{col}].STAsText() AS [{col}]")
                elif dtype in self._CX_OTHER_UNSUPPORTED:
                    parts.append(f"CAST([{col}] AS NVARCHAR(MAX)) AS [{col}]")
                else:
                    parts.append(f"[{col}]")
            return ', '.join(parts)
        except Exception:
            return "*"

    def _read_sql(self, query: str) -> pa.Table:
        """Execute a query and return results as a PyArrow Table (no pandas)."""
        cur = self._conn.cursor()
        try:
            cur.execute(query)
            if cur.description is None:
                return pa.table({})
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
            if not rows:
                return pa.table({col: pa.array([], type=pa.null()) for col in columns})
            col_data = {col: [row[i] for row in rows] for i, col in enumerate(columns)}
            return pa.table(col_data)
        finally:
            cur.close()

    def _execute_query_raw(self, query: str) -> pa.Table:
        """Execute a query (no error wrapping)."""
        return self._read_sql(query)

    def _execute_query(self, query: str) -> pa.Table:
        """Execute a query and return results as a PyArrow Table."""
        try:
            return self._read_sql(query)
        except Exception as e:
            log.error(f"Failed to execute query: {e}")
            raise

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from SQL Server as a PyArrow Table.
        """
        opts = import_options or {}
        size = opts.get("size", 1000000)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")

        if not source_table:
            raise ValueError("source_table must be provided")
        
        # Parse table name
        if "." in source_table:
            schema, table = source_table.split(".", 1)
        else:
            schema = "dbo"
            table = source_table
        
        col_list = self._safe_select_list(schema.strip('[]'), table.strip('[]'))
        base_query = f"SELECT {col_list} FROM [{schema}].[{table}]"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'[{col}] {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        # SQL Server uses TOP instead of LIMIT
        query = f"SELECT TOP {size} * FROM ({base_query}{order_by_clause}) AS limited"
        
        log.info(f"Executing SQL Server query: {query[:200]}...")
        
        arrow_table = self._execute_query(query)
        log.info(f"Fetched {arrow_table.num_rows} rows from SQL Server")
        
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
                            and not _is_nan(col_row["CHARACTER_MAXIMUM_LENGTH"])
                        ):
                            try:
                                col_info["max_length"] = int(col_row["CHARACTER_MAXIMUM_LENGTH"])
                            except (ValueError, TypeError):
                                pass  # Skip if conversion fails

                        if (
                            col_row["NUMERIC_PRECISION"] is not None
                            and not _is_nan(col_row["NUMERIC_PRECISION"])
                        ):
                            try:
                                col_info["precision"] = int(col_row["NUMERIC_PRECISION"])
                            except (ValueError, TypeError):
                                pass  # Skip if conversion fails

                        if (
                            col_row["NUMERIC_SCALE"] is not None
                            and not _is_nan(col_row["NUMERIC_SCALE"])
                        ):
                            try:
                                col_info["scale"] = int(col_row["NUMERIC_SCALE"])
                            except (ValueError, TypeError):
                                pass  # Skip if conversion fails

                        columns.append(col_info)

                    # Build safe column list (casts unsupported types to NVARCHAR)
                    col_list = self._safe_select_list(schema, table_name)

                    # Get sample data (first 10 rows)
                    sample_rows = []
                    sample_query = f"SELECT TOP 10 {col_list} FROM [{schema}].[{table_name}]"
                    try:
                        sample_table = self._execute_query(sample_query)
                        sample_rows = sample_table.to_pydict()
                        # Convert to list-of-dicts format
                        if sample_table.num_rows > 0:
                            cols = sample_table.column_names
                            sample_rows = [
                                {c: str(sample_table.column(c)[i].as_py()) if sample_table.column(c)[i].as_py() is not None else None for c in cols}
                                for i in range(sample_table.num_rows)
                            ]
                        else:
                            sample_rows = []
                    except Exception as e:
                        log.warning(
                            f"Failed to sample table {schema}.{table_name}: {e}"
                        )

                    # Get row count
                    count_query = f"SELECT COUNT(*) as row_count FROM [{schema}].[{table_name}]"
                    count_table = self._execute_query(count_query)

                    # Handle NaN values in row count
                    raw_count = count_table.column("row_count")[0].as_py()
                    if _is_nan(raw_count):
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

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
            {"key": "schema", "label": "Schema"},
            {"key": "table", "label": "Table"},
        ]

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]

        if level_key == "database":
            query = """
                SELECT name FROM sys.databases
                WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
                  AND state_desc = 'ONLINE'
                ORDER BY name
            """
            rows = self._execute_query(query).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["name"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="namespace", path=path + [name]))
            return nodes

        if level_key == "schema":
            pinned = self.pinned_scope()
            db = pinned.get("database") or (path[0] if path else None)
            if not db:
                return []
            query = f"""
                SELECT DISTINCT TABLE_SCHEMA
                FROM [{db}].INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                  AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY TABLE_SCHEMA
            """
            rows = self._execute_query(query).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["TABLE_SCHEMA"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="namespace", path=path + [name]))
            return nodes

        if level_key == "table":
            pinned = self.pinned_scope()
            remaining = list(path)
            db = pinned.get("database")
            if not db:
                if not remaining:
                    return []
                db = remaining.pop(0)
            schema = pinned.get("schema")
            if not schema:
                if not remaining:
                    return []
                schema = remaining.pop(0)
            query = f"""
                SELECT TABLE_NAME
                FROM [{db}].INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = '{schema}'
                ORDER BY TABLE_NAME
            """
            rows = self._execute_query(query).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["TABLE_NAME"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="table", path=path + [name]))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        pinned = self.pinned_scope()
        remaining = list(path)
        db = pinned.get("database")
        if not db:
            if not remaining:
                return {}
            db = remaining.pop(0)
        schema = pinned.get("schema")
        if not schema:
            if not remaining:
                return {}
            schema = remaining.pop(0)
        if not remaining:
            return {}
        table_name = remaining[0]
        try:
            cols_df = self._execute_query(f"""
                SELECT COLUMN_NAME, DATA_TYPE
                FROM [{db}].INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table_name}'
                ORDER BY ORDINAL_POSITION
            """).to_pandas()
            columns = [{"name": r["COLUMN_NAME"], "type": r["DATA_TYPE"]} for _, r in cols_df.iterrows()]
            count_df = self._execute_query(
                f"SELECT COUNT(*) AS cnt FROM [{db}].[{schema}].[{table_name}]"
            ).to_pandas()
            row_count = int(count_df["cnt"].iloc[0])
            col_list = self._safe_select_list(schema, table_name)
            sample_df = self._execute_query(
                f"SELECT TOP 5 {col_list} FROM [{db}].[{schema}].[{table_name}]"
            ).to_pandas()
            sample_rows = json.loads(sample_df.fillna(value=None).to_json(orient="records", date_format="iso", default_handler=str))
            return {"row_count": row_count, "columns": columns, "sample_rows": sample_rows}
        except Exception as e:
            log.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self._execute_query("SELECT 1 AS ok")
            return True
        except Exception:
            return False
