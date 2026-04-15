import json
import logging
from typing import Any

import pyarrow as pa
import psycopg2

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode

logger = logging.getLogger(__name__)


class PostgreSQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "postgres", "tier": "auth", "description": "PostgreSQL username"}, 
            {"name": "password", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "leave blank for no password"}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost", "tier": "connection", "description": "PostgreSQL host"}, 
            {"name": "port", "type": "string", "required": False, "default": "5432", "tier": "connection", "description": "PostgreSQL port"},
            {"name": "database", "type": "string", "required": False, "default": "", "tier": "filter", "description": "Database name (leave empty to browse all databases)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """**Example:** user: `postgres` · host: `localhost` · port: `5432` · database: `mydb`

**Local setup:** Ensure PostgreSQL is running — `brew services list` (macOS) or `systemctl status postgresql` (Linux). Leave password blank if none is set.

**Remote setup:** Get host, port, username, and password from your database administrator. The user must have SELECT permissions on the tables you want to access.

**Scope:** Leave *database* empty to browse all databases on the server, or fill it in to go straight to schemas/tables in that database.

**Troubleshooting:** Test with `psql -U <user> -h <host> -p <port> -d <database>`"""

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.host = self.params.get("host", "")
        self.port = self.params.get("port", "") or "5432"
        self.user = self.params.get("user", "")
        self.database = self.params.get("database", "")
        self.password = self.params.get("password", "")

        if not self.host:
            raise ValueError("PostgreSQL host is required")
        if not self.user:
            raise ValueError("PostgreSQL user is required")

        # When no database is specified, connect to the default "postgres" DB
        # for catalog browsing. The user can browse all databases via ls().
        connect_db = self.database or "postgres"

        # Build psycopg2 connection
        # Use 127.0.0.1 when host is localhost to force IPv4 TCP and avoid IPv6 ::1 connection issues.
        host_for_conn = "127.0.0.1" if (self.host or "").strip().lower() == "localhost" else self.host

        try:
            self._conn = psycopg2.connect(
                host=host_for_conn,
                port=int(self.port),
                user=self.user,
                password=self.password or "",
                dbname=connect_db,
            )
            self._conn.autocommit = True
        except Exception as e:
            logger.error(f"Failed to connect to PostgreSQL (postgresql://{self.user}:***@{self.host}:{self.port}/{connect_db}): {e}")
            raise ValueError(f"Failed to connect to PostgreSQL database '{connect_db}' on host '{self.host}': {e}") from e
        logger.info(f"Successfully connected to PostgreSQL: postgresql://{self.user}:***@{self.host}:{self.port}/{connect_db}")

    # PostgreSQL types that may need special handling
    _SPATIAL_TYPES = {'geometry', 'geography'}  # PostGIS types → ST_AsText()
    _OTHER_UNSUPPORTED = {'box', 'circle', 'line', 'lseg', 'path', 'point',
                              'polygon', 'bit', 'bit varying', 'xml', 'tsvector', 'tsquery'}
    _UNSUPPORTED_TYPES = _SPATIAL_TYPES | _OTHER_UNSUPPORTED

    def _read_sql(self, query: str) -> pa.Table:
        """Execute a query and return results as a PyArrow Table (no pandas)."""
        return self._execute_on_conn(self._conn, query)

    @staticmethod
    def _execute_on_conn(conn, query: str) -> pa.Table:
        """Run *query* on *conn* and return a PyArrow Table."""
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
        Uses ST_AsText() for PostGIS types, ::text for others.
        Returns '*' if no unsupported columns are found."""
        try:
            columns_query = f"""
                SELECT column_name, udt_name
                FROM information_schema.columns
                WHERE table_schema = '{schema}' AND table_name = '{table_name}'
                ORDER BY ordinal_position
            """
            cols_arrow = self._read_sql(columns_query)
            cols_df = cols_arrow.to_pandas()
            has_unsupported = any(r['udt_name'].lower() in self._UNSUPPORTED_TYPES for _, r in cols_df.iterrows())
            if not has_unsupported:
                return "*"
            parts = []
            for _, r in cols_df.iterrows():
                col, dtype = r['column_name'], r['udt_name'].lower()
                if dtype in self._SPATIAL_TYPES:
                    parts.append(f'ST_AsText("{col}") AS "{col}"')
                elif dtype in self._OTHER_UNSUPPORTED:
                    parts.append(f'"{col}"::text AS "{col}"')
                else:
                    parts.append(f'"{col}"')
            return ', '.join(parts)
        except Exception:
            return "*"

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from PostgreSQL as a PyArrow Table.
        """
        opts = import_options or {}
        size = opts.get("size", 1000000)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")

        if not source_table:
            raise ValueError("source_table must be provided")
        
        # Handle table names like "mypostgresdb.schema.table" -> "schema.table"
        table_ref = source_table
        if source_table.startswith("mypostgresdb."):
            table_ref = source_table[len("mypostgresdb."):]
        # Build safe column list for the resolved schema.table
        if '.' in table_ref:
            s, t = table_ref.split('.', 1)
            col_list = self._safe_select_list(s.strip('"'), t.strip('"'))
        else:
            col_list = self._safe_select_list('public', table_ref.strip('"'))
        base_query = f"SELECT {col_list} FROM {table_ref}"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'"{col}" {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        # Build full query with limit
        query = f"{base_query}{order_by_clause} LIMIT {size}"
        
        logger.info(f"Executing PostgreSQL query: {query[:200]}...")
        
        # Execute query — returns Arrow table
        arrow_table = self._read_sql(query)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from PostgreSQL")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List available tables from PostgreSQL."""
        return self._list_tables(table_filter)

    def _list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables from PostgreSQL."""
        try:
            # Query tables from information_schema
            query = """
                SELECT table_schema as schemaname, table_name as tablename 
                FROM information_schema.tables 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast') 
                AND table_schema NOT LIKE '%_intern%' 
                AND table_schema NOT LIKE '%timescaledb%'
                AND table_name NOT LIKE '%/%'
                AND table_type = 'BASE TABLE'
                ORDER BY table_schema, table_name
            """
            tables_arrow = self._read_sql(query)
            tables_df = tables_arrow.to_pandas()
            
            logger.info(f"Found {len(tables_df)} tables")
            
            results = []
            
            for _, row in tables_df.iterrows():
                schema = row['schemaname']
                table_name = row['tablename']
                full_table_name = f"{schema}.{table_name}"
                
                # Apply filter if provided
                if table_filter and table_filter.lower() not in full_table_name.lower():
                    continue
                
                try:
                    # Get column information
                    columns_query = f"""
                        SELECT column_name, data_type 
                        FROM information_schema.columns 
                        WHERE table_schema = '{schema}' AND table_name = '{table_name}'
                        ORDER BY ordinal_position
                    """
                    columns_arrow = self._read_sql(columns_query)
                    columns_df = columns_arrow.to_pandas()
                    columns = [{
                        'name': col_row['column_name'],
                        'type': col_row['data_type']
                    } for _, col_row in columns_df.iterrows()]
                    
                    # Build safe column list (casts unsupported types to TEXT)
                    col_list = self._safe_select_list(schema, table_name)
                    
                    # Get sample data
                    sample_rows = []
                    sample_query = f'SELECT {col_list} FROM "{schema}"."{table_name}" LIMIT 10'
                    try:
                        sample_arrow = self._read_sql(sample_query)
                        sample_df = sample_arrow.to_pandas()
                        sample_rows = json.loads(sample_df.to_json(orient="records"))
                    except Exception as sample_err:
                        logger.warning(f"Could not sample {full_table_name}: {sample_err}")
                    
                    # Get row count
                    count_query = f'SELECT COUNT(*) as cnt FROM "{schema}"."{table_name}"'
                    count_arrow = self._read_sql(count_query)
                    row_count = count_arrow.to_pandas()['cnt'].iloc[0]
                    
                    table_metadata = {
                        "row_count": int(row_count),
                        "columns": columns,
                        "sample_rows": sample_rows
                    }
                    
                    results.append({
                        "name": full_table_name,
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
            {"key": "schema", "label": "Schema"},
            {"key": "table", "label": "Table"},
        ]

    def _connect_to_db(self, dbname: str):
        """Open a new connection to a specific database on the same server."""
        host_for_conn = "127.0.0.1" if (self.host or "").strip().lower() == "localhost" else self.host
        conn = psycopg2.connect(
            host=host_for_conn,
            port=int(self.port),
            user=self.user,
            password=self.password or "",
            dbname=dbname,
        )
        conn.autocommit = True
        return conn

    def _read_sql_on(self, query: str, dbname: str | None = None) -> pa.Table:
        """Run a query, optionally on a different database."""
        if dbname and dbname != (self.database or "postgres"):
            conn = self._connect_to_db(dbname)
            try:
                return self._execute_on_conn(conn, query)
            finally:
                conn.close()
        else:
            return self._execute_on_conn(self._conn, query)

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()

        if len(path) >= len(eff):
            return []

        level_key = eff[len(path)]["key"]

        # --- database level ---
        if level_key == "database":
            query = """
                SELECT datname FROM pg_database
                WHERE datistemplate = false AND datallowconn = true
                ORDER BY datname
            """
            rows = self._read_sql(query).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["datname"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=name, node_type="namespace",
                    path=path + [name],
                ))
            return nodes

        # --- schema level ---
        if level_key == "schema":
            # Determine which database to query
            pinned = self.pinned_scope()
            db = pinned.get("database") or (path[0] if path else None)
            if not db:
                return []
            query = """
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
                  AND schema_name NOT LIKE '%%_intern%%'
                  AND schema_name NOT LIKE '%%timescaledb%%'
                ORDER BY schema_name
            """
            rows = self._read_sql_on(query, db).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["schema_name"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=name, node_type="namespace",
                    path=path + [name],
                ))
            return nodes

        # --- table level ---
        if level_key == "table":
            pinned = self.pinned_scope()
            # Resolve database and schema from pinned values + path
            remaining_path = list(path)
            db = pinned.get("database")
            if not db:
                if not remaining_path:
                    return []
                db = remaining_path.pop(0)
            schema = pinned.get("schema")
            if not schema:
                if not remaining_path:
                    return []
                schema = remaining_path.pop(0)
            query = f"""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = '{schema}'
                  AND table_type = 'BASE TABLE'
                  AND table_name NOT LIKE '%%/%%'
                ORDER BY table_name
            """
            rows = self._read_sql_on(query, db).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["table_name"]
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=name, node_type="table",
                    path=path + [name],
                ))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        # Resolve the actual database.schema.table from effective path + pinned
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
            cols_query = f"""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = '{schema}' AND table_name = '{table_name}'
                ORDER BY ordinal_position
            """
            cols_df = self._read_sql_on(cols_query, db).to_pandas()
            columns = [
                {"name": r["column_name"], "type": r["data_type"]}
                for _, r in cols_df.iterrows()
            ]
            count_df = self._read_sql_on(
                f'SELECT COUNT(*) AS cnt FROM "{schema}"."{table_name}"', db
            ).to_pandas()
            row_count = int(count_df["cnt"].iloc[0])
            col_list = self._safe_select_list(schema, table_name)
            sample_df = self._read_sql_on(
                f'SELECT {col_list} FROM "{schema}"."{table_name}" LIMIT 5', db
            ).to_pandas()
            sample_rows = json.loads(sample_df.to_json(orient="records"))
            return {
                "row_count": row_count,
                "columns": columns,
                "sample_rows": sample_rows,
            }
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self._read_sql("SELECT 1")
            return True
        except Exception:
            return False
