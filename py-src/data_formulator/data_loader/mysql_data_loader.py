import json
import logging
import threading
from typing import Any

import pyarrow as pa
import pymysql

from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
    build_source_filter_where_clause_inline,
    build_where_clause_inline,
    _esc_id,
    _esc_str,
)

logger = logging.getLogger(__name__)


class MySQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "root", "tier": "auth", "description": "MySQL username"}, 
            {"name": "password", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "leave blank for no password"}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost", "tier": "connection", "description": "server address"}, 
            {"name": "port", "type": "int", "required": False, "default": 3306, "tier": "connection", "description": "server port"},
            {"name": "database", "type": "string", "required": False, "default": "", "tier": "filter", "description": "Database name (leave empty to browse all databases)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """**Example:** user: `root` · host: `localhost` · port: `3306` · database: `mydb`

**Local setup:** Ensure MySQL is running — `brew services list` (macOS) or `systemctl status mysql` (Linux). Leave password blank if none is set.

**Remote setup:** Get host, port, username, and password from your database administrator. Ensure the server allows remote connections and your IP is whitelisted.

**Scope:** Leave *database* empty to browse all databases on the server, or fill it in to go straight to tables in that database.

**Troubleshooting:** Test with `mysql -u <user> -p -h <host> -P <port> <database>`"""

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.host = self.params.get("host", "")
        self.user = self.params.get("user", "")
        self.password = self.params.get("password", "")
        self.database = self.params.get("database", "")

        if not self.host:
            raise ValueError("MySQL host is required")
        if not self.user:
            raise ValueError("MySQL user is required")

        port = self.params.get("port", "")
        if isinstance(port, str):
            self.port = int(port) if port else 3306
        elif not port:
            self.port = 3306
        else:
            self.port = int(port)
        
        # Build pymysql connection
        # Use 127.0.0.1 when host is localhost to force IPv4 TCP and avoid IPv6 ::1 connection issues.
        host_for_conn = "127.0.0.1" if (self.host or "").strip().lower() == "localhost" else self.host
        
        self._sanitized_url = f"mysql://{self.user}:***@{self.host}:{self.port}/{self.database or '(all)'}"
        
        # Connect — database is optional (can be None for server-level browsing)
        connect_kwargs: dict[str, Any] = {
            "host": host_for_conn,
            "user": self.user,
            "password": self.password or "",
            "port": self.port,
        }
        if self.database:
            connect_kwargs["database"] = self.database
        
        try:
            self._conn = pymysql.connect(**connect_kwargs)
        except Exception as e:
            logger.error(f"Failed to connect to MySQL ({self._sanitized_url}): {e}")
            raise ValueError(f"Failed to connect to MySQL on host '{self.host}': {e}") from e
        self._connect_kwargs = connect_kwargs
        self._lock = threading.Lock()
        logger.info(f"Successfully connected to MySQL: {self._sanitized_url}")

    def _get_conn(self) -> pymysql.connections.Connection:
        """Return a live connection, reconnecting if the previous one was lost."""
        try:
            self._conn.ping(reconnect=True)
        except Exception:
            self._conn = pymysql.connect(**self._connect_kwargs)
        return self._conn

    # MySQL types that may need special handling
    _GEOMETRY_TYPES = {'geometry', 'point', 'linestring', 'polygon',
                           'multipoint', 'multilinestring', 'multipolygon',
                           'geometrycollection'}
    _OTHER_UNSUPPORTED = {'bit', 'blob', 'tinyblob', 'mediumblob', 'longblob', 'binary', 'varbinary'}
    _UNSUPPORTED_TYPES = _GEOMETRY_TYPES | _OTHER_UNSUPPORTED

    def _read_sql(self, query: str) -> pa.Table:
        """Execute a query and return results as a PyArrow Table (no pandas).
        
        Caller must hold self._lock if thread safety is needed.
        """
        conn = self._get_conn()
        cur = conn.cursor()
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

    def _safe_select_list(self, schema: str, table_name: str) -> str:
        """Build a SELECT column list that converts unsupported types to text.
        Uses ST_AsText() for geometry types, CAST(... AS CHAR) for others.
        Returns '*' if no unsupported columns are found."""
        try:
            columns_query = f"""
                SELECT COLUMN_NAME, DATA_TYPE
                FROM information_schema.columns
                WHERE TABLE_SCHEMA = '{_esc_str(schema)}' AND TABLE_NAME = '{_esc_str(table_name)}'
                ORDER BY ORDINAL_POSITION
            """
            cols_arrow = self._read_sql(columns_query)
            cols_df = cols_arrow.to_pandas()
            has_unsupported = any(r['DATA_TYPE'].lower() in self._UNSUPPORTED_TYPES for _, r in cols_df.iterrows())
            if not has_unsupported:
                return "*"
            parts = []
            for _, r in cols_df.iterrows():
                col, dtype = r['COLUMN_NAME'], r['DATA_TYPE'].lower()
                if dtype in self._GEOMETRY_TYPES:
                    parts.append(f"ST_AsText(`{col}`) AS `{col}`")
                elif dtype in self._OTHER_UNSUPPORTED:
                    parts.append(f"CAST(`{col}` AS CHAR) AS `{col}`")
                else:
                    parts.append(f"`{col}`")
            return ', '.join(parts)
        except Exception:
            return "*"

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from MySQL as a PyArrow Table.
        """
        with self._lock:
            return self._fetch_data_as_arrow(source_table, import_options)

    def _fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        opts = import_options or {}
        size = opts.get("size", 1000000)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")
        conditions = opts.get("conditions", [])
        source_filters = opts.get("source_filters", [])

        if not source_table:
            raise ValueError("source_table must be provided")
        
        # Handle table names and build safe column list
        if '.' in source_table:
            parts = source_table.split('.', 1)
            col_list = self._safe_select_list(parts[0].strip('`'), parts[1].strip('`'))
            base_query = f"SELECT {col_list} FROM {source_table}"
        else:
            col_list = self._safe_select_list(self.database, source_table.strip('`'))
            base_query = f"SELECT {col_list} FROM `{source_table}`"
        
        # Add WHERE clause from source filters, falling back to legacy conditions.
        where_clause = build_source_filter_where_clause_inline(
            source_filters, quote_char='`', dialect="mysql"
        ) or build_where_clause_inline(conditions, quote_char='`')
        if where_clause:
            base_query = f"{base_query} {where_clause}"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'{_esc_id(col, "`")} {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        query = f"{base_query}{order_by_clause} LIMIT {int(size)}"
        
        logger.info(f"Executing MySQL query: {query[:200]}...")
        
        arrow_table = self._read_sql(query)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from MySQL")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List available tables from MySQL database."""
        with self._lock:
            return self._list_tables(table_filter)
    
    def _list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables from MySQL database(s) within pinned scope."""
        try:
            # If database is pinned, list only that database; otherwise all user-accessible DBs
            if self.database:
                db_filter = f"TABLE_SCHEMA = '{_esc_str(self.database)}'"
            else:
                db_filter = "TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
            tables_query = f"""
                SELECT TABLE_SCHEMA, TABLE_NAME 
                FROM information_schema.tables 
                WHERE {db_filter}
                AND TABLE_TYPE = 'BASE TABLE'
            """
            tables_arrow = self._read_sql(tables_query)
            tables_df = tables_arrow.to_pandas()
            
            if tables_df.empty:
                return []
            
            results = []
            
            for _, row in tables_df.iterrows():
                schema = row['TABLE_SCHEMA']
                table_name = row['TABLE_NAME']
                
                if table_filter and table_filter.lower() not in table_name.lower():
                    continue
                
                full_table_name = f"{schema}.{table_name}"
                
                try:
                    # Get column information
                    columns_query = f"""
                        SELECT COLUMN_NAME, DATA_TYPE 
                        FROM information_schema.columns 
                        WHERE TABLE_SCHEMA = '{_esc_str(schema)}' AND TABLE_NAME = '{_esc_str(table_name)}'
                        ORDER BY ORDINAL_POSITION
                    """
                    columns_arrow = self._read_sql(columns_query)
                    columns_df = columns_arrow.to_pandas()
                    columns = [{
                        'name': col_row['COLUMN_NAME'],
                        'type': col_row['DATA_TYPE']
                    } for _, col_row in columns_df.iterrows()]
                    
                    # Build safe column list (casts unsupported types to CHAR)
                    col_list = self._safe_select_list(schema, table_name)
                    
                    # Get sample data
                    sample_rows = []
                    sample_query = f"SELECT {col_list} FROM {_esc_id(schema, '`')}.{_esc_id(table_name, '`')} LIMIT 10"
                    try:
                        sample_arrow = self._read_sql(sample_query)
                        sample_df = sample_arrow.to_pandas()
                        sample_rows = json.loads(sample_df.to_json(orient="records", date_format='iso'))
                    except Exception as sample_err:
                        logger.warning(f"Could not sample {full_table_name}: {sample_err}")
                    
                    # Get row count
                    count_query = f"SELECT COUNT(*) as cnt FROM {_esc_id(schema, '`')}.{_esc_id(table_name, '`')}"
                    count_arrow = self._read_sql(count_query)
                    row_count = int(count_arrow.to_pandas()['cnt'].iloc[0])
                    
                    table_metadata = {
                        "row_count": row_count,
                        "columns": columns,
                        "sample_rows": sample_rows
                    }
                    
                    results.append({
                        "name": full_table_name,
                        "path": [schema, table_name],
                        "metadata": table_metadata
                    })
                except Exception as e:
                    logger.warning(f"Error processing table {full_table_name}: {e}")
                    continue
            
            return results

        except Exception as e:
            logger.error(f"Error listing tables: {e}")
            return []

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
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
                SELECT SCHEMA_NAME
                FROM information_schema.schemata
                WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                ORDER BY SCHEMA_NAME
            """
            rows = self._read_sql(query).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["SCHEMA_NAME"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=name, node_type="namespace", path=path + [name],
                ))
            return nodes

        if level_key == "table":
            pinned = self.pinned_scope()
            db = pinned.get("database") or (path[0] if path else None)
            if not db:
                return []
            query = f"""
                SELECT TABLE_NAME
                FROM information_schema.tables
                WHERE TABLE_SCHEMA = '{_esc_str(db)}' AND TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_NAME
            """
            rows = self._read_sql(query).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["TABLE_NAME"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=name, node_type="table", path=path + [name],
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
        if not remaining:
            return {}
        table_name = remaining[0]
        try:
            cols_query = f"""
                SELECT COLUMN_NAME, DATA_TYPE
                FROM information_schema.columns
                WHERE TABLE_SCHEMA = '{_esc_str(db)}' AND TABLE_NAME = '{_esc_str(table_name)}'
                ORDER BY ORDINAL_POSITION
            """
            cols_df = self._read_sql(cols_query).to_pandas()
            columns = [
                {"name": r["COLUMN_NAME"], "type": r["DATA_TYPE"]}
                for _, r in cols_df.iterrows()
            ]
            count_df = self._read_sql(
                f"SELECT COUNT(*) AS cnt FROM {_esc_id(db, '`')}.{_esc_id(table_name, '`')}"
            ).to_pandas()
            row_count = int(count_df["cnt"].iloc[0])
            col_list = self._safe_select_list(db, table_name)
            sample_df = self._read_sql(
                f"SELECT {col_list} FROM {_esc_id(db, '`')}.{_esc_id(table_name, '`')} LIMIT 5"
            ).to_pandas()
            sample_rows = json.loads(sample_df.to_json(orient="records", date_format="iso"))
            return {
                "row_count": row_count,
                "columns": columns,
                "sample_rows": sample_rows,
            }
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        with self._lock:
            try:
                self._read_sql("SELECT 1")
                return True
            except Exception:
                return False