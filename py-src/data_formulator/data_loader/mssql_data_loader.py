import json
import logging
import math
from typing import Any

import pyarrow as pa
import pyodbc

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS, sanitize_table_name
from data_formulator.datalake.parquet_utils import df_to_safe_records

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
                "tier": "connection",
                "description": "SQL Server host address or instance name",
            },
            {
                "name": "database",
                "type": "string",
                "required": False,
                "default": "",
                "tier": "filter",
                "description": "Database name (leave empty to browse all databases)",
            },
            {
                "name": "user",
                "type": "string",
                "required": False,
                "default": "",
                "tier": "auth",
                "description": "Username (leave empty for Windows Authentication)",
            },
            {
                "name": "password",
                "type": "string",
                "required": False,
                "default": "",
                "sensitive": True,
                "tier": "auth",
                "description": "Password (leave empty for Windows Authentication)",
            },
            {
                "name": "port",
                "type": "string",
                "required": False,
                "default": "1433",
                "tier": "connection",
                "description": "SQL Server port (default: 1433)",
            },
            {
                "name": "driver",
                "type": "string",
                "required": False,
                "default": "ODBC Driver 17 for SQL Server",
                "tier": "connection",
                "description": "ODBC driver name",
            },
            {
                "name": "encrypt",
                "type": "string",
                "required": False,
                "default": "yes",
                "tier": "connection",
                "description": "Enable encryption (yes/no)",
            },
            {
                "name": "trust_server_certificate",
                "type": "string",
                "required": False,
                "default": "no",
                "tier": "connection",
                "description": "Trust server certificate (yes/no)",
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
        from data_formulator.security.log_sanitizer import sanitize_params
        log.info("Initializing MSSQL DataLoader with parameters: %s", sanitize_params(params))

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
        size = min(opts.get("size", MAX_IMPORT_ROWS), MAX_IMPORT_ROWS)
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
        """List all tables from SQL Server database.

        Only queries INFORMATION_SCHEMA in batch; does NOT run per-table
        SELECT TOP or COUNT(*) to keep catalog browsing fast.
        """
        try:
            tables_query = """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_TYPE = 'BASE TABLE' 
                AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            """
            tables_df = self._execute_query(tables_query).to_pandas()

            columns_query = """
                SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
            """
            cols_df = self._execute_query(columns_query).to_pandas()

            col_map: dict[str, list[dict]] = {}
            for _, cr in cols_df.iterrows():
                key = f"{cr['TABLE_SCHEMA']}.{cr['TABLE_NAME']}"
                col_map.setdefault(key, []).append({
                    "name": cr["COLUMN_NAME"],
                    "type": cr["DATA_TYPE"],
                })

            # Batch-fetch MS_Description for tables and columns
            table_desc_map: dict[str, str] = {}
            col_desc_map: dict[str, str] = {}
            try:
                table_desc_query = """
                    SELECT s.name AS schema_name, t.name AS table_name,
                           CAST(ep.value AS NVARCHAR(4000)) AS description
                    FROM sys.tables t
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    JOIN sys.extended_properties ep
                      ON ep.major_id = t.object_id AND ep.minor_id = 0
                         AND ep.name = 'MS_Description'
                """
                td_df = self._execute_query(table_desc_query).to_pandas()
                for _, r in td_df.iterrows():
                    desc = str(r["description"]).strip() if r["description"] else ""
                    if desc:
                        table_desc_map[f"{r['schema_name']}.{r['table_name']}"] = desc
            except Exception:
                pass

            try:
                col_desc_query = """
                    SELECT s.name AS schema_name, t.name AS table_name,
                           c.name AS column_name,
                           CAST(ep.value AS NVARCHAR(4000)) AS description
                    FROM sys.columns c
                    JOIN sys.tables t ON c.object_id = t.object_id
                    JOIN sys.schemas s ON t.schema_id = s.schema_id
                    JOIN sys.extended_properties ep
                      ON ep.major_id = c.object_id AND ep.minor_id = c.column_id
                         AND ep.name = 'MS_Description'
                """
                cd_df = self._execute_query(col_desc_query).to_pandas()
                for _, r in cd_df.iterrows():
                    desc = str(r["description"]).strip() if r["description"] else ""
                    if desc:
                        col_desc_map[f"{r['schema_name']}.{r['table_name']}.{r['column_name']}"] = desc
            except Exception:
                pass

            results = []
            for _, row in tables_df.iterrows():
                schema = row["TABLE_SCHEMA"]
                table_name = row["TABLE_NAME"]
                full_table_name = f"{schema}.{table_name}"

                if table_filter and table_filter.lower() not in full_table_name.lower():
                    continue

                columns = col_map.get(full_table_name, [])
                for col_entry in columns:
                    cd_key = f"{full_table_name}.{col_entry['name']}"
                    if cd_key in col_desc_map:
                        col_entry["description"] = col_desc_map[cd_key]

                metadata: dict[str, Any] = {"columns": columns}
                if full_table_name in table_desc_map:
                    metadata["description"] = table_desc_map[full_table_name]

                results.append({
                    "name": full_table_name,
                    "path": [schema, table_name],
                    "metadata": metadata,
                })

        except Exception as e:
            log.error(f"Failed to list tables from SQL Server: {e}")
            results = []

        return results

    # -- Cross-database sync -----------------------------------------------

    def _list_tables_for_db(
        self, db: str, table_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """List tables in a specific database using three-part naming.

        Like ``list_tables`` but queries *[db].INFORMATION_SCHEMA* and
        returns three-part ``database.schema.table`` identifiers.
        """
        tables_query = f"""
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM [{db}].INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
              AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        """
        tables_df = self._execute_query(tables_query).to_pandas()
        if tables_df.empty:
            return []

        columns_query = f"""
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM [{db}].INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
        """
        cols_df = self._execute_query(columns_query).to_pandas()

        col_map: dict[str, list[dict]] = {}
        for _, cr in cols_df.iterrows():
            key = f"{cr['TABLE_SCHEMA']}.{cr['TABLE_NAME']}"
            col_map.setdefault(key, []).append({
                "name": cr["COLUMN_NAME"],
                "type": cr["DATA_TYPE"],
            })

        table_desc_map: dict[str, str] = {}
        col_desc_map: dict[str, str] = {}
        try:
            table_desc_query = f"""
                SELECT s.name AS schema_name, t.name AS table_name,
                       CAST(ep.value AS NVARCHAR(4000)) AS description
                FROM [{db}].sys.tables t
                JOIN [{db}].sys.schemas s ON t.schema_id = s.schema_id
                JOIN [{db}].sys.extended_properties ep
                  ON ep.major_id = t.object_id AND ep.minor_id = 0
                     AND ep.name = 'MS_Description'
            """
            td_df = self._execute_query(table_desc_query).to_pandas()
            for _, r in td_df.iterrows():
                desc = str(r["description"]).strip() if r["description"] else ""
                if desc:
                    table_desc_map[f"{r['schema_name']}.{r['table_name']}"] = desc
        except Exception:
            pass

        try:
            col_desc_query = f"""
                SELECT s.name AS schema_name, t.name AS table_name,
                       c.name AS column_name,
                       CAST(ep.value AS NVARCHAR(4000)) AS description
                FROM [{db}].sys.columns c
                JOIN [{db}].sys.tables t ON c.object_id = t.object_id
                JOIN [{db}].sys.schemas s ON t.schema_id = s.schema_id
                JOIN [{db}].sys.extended_properties ep
                  ON ep.major_id = c.object_id AND ep.minor_id = c.column_id
                     AND ep.name = 'MS_Description'
            """
            cd_df = self._execute_query(col_desc_query).to_pandas()
            for _, r in cd_df.iterrows():
                desc = str(r["description"]).strip() if r["description"] else ""
                if desc:
                    col_desc_map[f"{r['schema_name']}.{r['table_name']}.{r['column_name']}"] = desc
        except Exception:
            pass

        results: list[dict[str, Any]] = []
        for _, row in tables_df.iterrows():
            schema = row["TABLE_SCHEMA"]
            table_name = row["TABLE_NAME"]
            schema_table = f"{schema}.{table_name}"
            full_source = f"{db}.{schema}.{table_name}"

            if table_filter and table_filter.lower() not in full_source.lower():
                continue

            columns = col_map.get(schema_table, [])
            for col_entry in columns:
                cd_key = f"{schema_table}.{col_entry['name']}"
                if cd_key in col_desc_map:
                    col_entry["description"] = col_desc_map[cd_key]

            metadata: dict[str, Any] = {
                "_source_name": full_source,
                "columns": columns,
            }
            if schema_table in table_desc_map:
                metadata["description"] = table_desc_map[schema_table]

            results.append({
                "name": full_source,
                "path": [db, schema, table_name],
                "metadata": metadata,
            })

        return results

    def sync_catalog_metadata(
        self, table_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """Full metadata sync across all accessible databases.

        When ``database`` is specified in connection params, behaves like
        the base class (delegates to ``list_tables``).  When ``database``
        is empty, iterates every online user database on the server.
        """
        if self.database:
            tables = self.list_tables(table_filter)
            self.ensure_table_keys(tables)
            return tables

        db_rows = self._execute_query("""
            SELECT name FROM sys.databases
            WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
              AND state_desc = 'ONLINE'
            ORDER BY name
        """).to_pandas()

        all_tables: list[dict[str, Any]] = []
        for _, r in db_rows.iterrows():
            db = r["name"]
            try:
                all_tables.extend(self._list_tables_for_db(db, table_filter))
            except Exception:
                log.debug(
                    "sync_catalog_metadata skipped database %s", db,
                    exc_info=True,
                )

        log.info("sync_catalog_metadata found %d tables across all databases", len(all_tables))
        self.ensure_table_keys(all_tables)
        return all_tables

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
                full_source = f"{db}.{schema}.{name}"
                nodes.append(CatalogNode(
                    name=name, node_type="table", path=path + [name],
                    metadata={"_source_name": full_source},
                ))
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

            # Column descriptions from MS_Description
            try:
                cd_df = self._execute_query(f"""
                    SELECT c.name AS column_name,
                           CAST(ep.value AS NVARCHAR(4000)) AS description
                    FROM [{db}].sys.columns c
                    JOIN [{db}].sys.tables t ON c.object_id = t.object_id
                    JOIN [{db}].sys.schemas s ON t.schema_id = s.schema_id
                    JOIN [{db}].sys.extended_properties ep
                      ON ep.major_id = c.object_id AND ep.minor_id = c.column_id
                         AND ep.name = 'MS_Description'
                    WHERE s.name = '{schema}' AND t.name = '{table_name}'
                """).to_pandas()
                col_descs = {r["column_name"]: str(r["description"]).strip()
                             for _, r in cd_df.iterrows() if r["description"]}
                for col_entry in columns:
                    if col_entry["name"] in col_descs:
                        col_entry["description"] = col_descs[col_entry["name"]]
            except Exception:
                pass

            # Table description
            table_description = None
            try:
                td_df = self._execute_query(f"""
                    SELECT CAST(ep.value AS NVARCHAR(4000)) AS description
                    FROM [{db}].sys.tables t
                    JOIN [{db}].sys.schemas s ON t.schema_id = s.schema_id
                    JOIN [{db}].sys.extended_properties ep
                      ON ep.major_id = t.object_id AND ep.minor_id = 0
                         AND ep.name = 'MS_Description'
                    WHERE s.name = '{schema}' AND t.name = '{table_name}'
                """).to_pandas()
                if not td_df.empty and td_df["description"].iloc[0]:
                    table_description = str(td_df["description"].iloc[0]).strip() or None
            except Exception:
                pass

            count_df = self._execute_query(
                f"SELECT COUNT(*) AS cnt FROM [{db}].[{schema}].[{table_name}]"
            ).to_pandas()
            row_count = int(count_df["cnt"].iloc[0])
            col_list = self._safe_select_list(schema, table_name)
            sample_df = self._execute_query(
                f"SELECT TOP 5 {col_list} FROM [{db}].[{schema}].[{table_name}]"
            ).to_pandas()
            sample_rows = df_to_safe_records(sample_df.fillna(value=None))
            result: dict[str, Any] = {"row_count": row_count, "columns": columns, "sample_rows": sample_rows}
            if table_description:
                result["description"] = table_description
            return result
        except Exception as e:
            log.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self._execute_query("SELECT 1 AS ok")
            return True
        except Exception:
            return False
