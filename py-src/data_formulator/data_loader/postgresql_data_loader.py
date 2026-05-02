import json
import logging
import os
from typing import Any

_PG_CLIENT_ENCODING = "UTF8"
# libpq/psycopg2 can consult this during connection startup, so set it before importing psycopg2.
os.environ["PGCLIENTENCODING"] = _PG_CLIENT_ENCODING

import pyarrow as pa
import psycopg2

from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
    build_source_filter_where_clause_inline,
    build_where_clause_inline,
    _esc_id,
    _esc_str,
)

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

        try:
            self._conn = psycopg2.connect(**self._connection_kwargs(connect_db))
            self._conn.autocommit = True
        except UnicodeDecodeError as e:
            logger.error(
                "Failed to connect to PostgreSQL (postgresql://%s:***@%s:%s/%s): psycopg2 could not decode the server error message: %s",
                self.user,
                self.host,
                self.port,
                connect_db,
                e,
            )
            raise ValueError(
                f"Failed to connect to PostgreSQL database '{connect_db}' on host '{self.host}': "
                "PostgreSQL returned a connection error that psycopg2 could not decode. "
                "Verify host, port, database, username, and password; this is common on localized "
                f"Windows PostgreSQL installations. Decoder error: {e}"
            ) from e
        except Exception as e:
            logger.error(
                "Failed to connect to PostgreSQL (postgresql://%s:***@%s:%s/%s): %s",
                self.user,
                self.host,
                self.port,
                connect_db,
                e,
            )
            raise ValueError(f"Failed to connect to PostgreSQL database '{connect_db}' on host '{self.host}': {e}") from e
        logger.info(
            "Successfully connected to PostgreSQL: postgresql://%s:***@%s:%s/%s",
            self.user,
            self.host,
            self.port,
            connect_db,
        )

    # PostgreSQL types that may need special handling
    _SPATIAL_TYPES = {'geometry', 'geography'}  # PostGIS types → ST_AsText()
    _OTHER_UNSUPPORTED = {'box', 'circle', 'line', 'lseg', 'path', 'point',
                              'polygon', 'bit', 'bit varying', 'xml', 'tsvector', 'tsquery'}
    _UNSUPPORTED_TYPES = _SPATIAL_TYPES | _OTHER_UNSUPPORTED

    _CONNECT_TIMEOUT = 10  # seconds — prevents hangs on unreachable databases

    def _connection_kwargs(self, dbname: str) -> dict[str, Any]:
        # Use 127.0.0.1 when host is localhost to force IPv4 TCP and avoid IPv6 ::1 connection issues.
        host_for_conn = "127.0.0.1" if (self.host or "").strip().lower() == "localhost" else self.host
        return {
            "host": host_for_conn,
            "port": int(self.port),
            "user": self.user,
            "password": self.password or "",
            "dbname": dbname,
            "client_encoding": _PG_CLIENT_ENCODING,
            "options": f"-c client_encoding={_PG_CLIENT_ENCODING}",
            "connect_timeout": self._CONNECT_TIMEOUT,
        }

    def _resolve_source_table(self, source_table: str) -> tuple[str | None, str, str]:
        """Parse a source_table string into (database, schema, table).

        Accepts:
          - ``"database.schema.table"`` — cross-database reference from lazy catalog
          - ``"schema.table"``          — same-database reference
          - ``"table"``                 — defaults to public schema

        Returns ``(database_or_None, schema, table)``.  When *database* is
        ``None``, callers should use the primary connection.
        """
        parts = source_table.split(".")
        if len(parts) >= 3:
            db, schema, table = parts[0], parts[1], ".".join(parts[2:])
            current_db = self.database or "postgres"
            return (db if db != current_db else None), schema, table
        if len(parts) == 2:
            return None, parts[0], parts[1]
        return None, "public", parts[0]

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

    def _safe_select_list(self, schema: str, table_name: str, dbname: str | None = None) -> str:
        """Build a SELECT column list that converts unsupported types to text.
        Uses ST_AsText() for PostGIS types, ::text for others.
        Returns '*' if no unsupported columns are found."""
        try:
            columns_query = f"""
                SELECT column_name, udt_name
                FROM information_schema.columns
                WHERE table_schema = '{_esc_str(schema)}' AND table_name = '{_esc_str(table_name)}'
                ORDER BY ordinal_position
            """
            cols_arrow = self._read_sql_on(columns_query, dbname) if dbname else self._read_sql(columns_query)
            cols_df = cols_arrow.to_pandas()
            has_unsupported = any(r['udt_name'].lower() in self._UNSUPPORTED_TYPES for _, r in cols_df.iterrows())
            if not has_unsupported:
                return "*"
            parts = []
            for _, r in cols_df.iterrows():
                col, dtype = r['column_name'], r['udt_name'].lower()
                if dtype in self._SPATIAL_TYPES:
                    parts.append(f'ST_AsText({_esc_id(col, chr(34))}) AS {_esc_id(col, chr(34))}')
                elif dtype in self._OTHER_UNSUPPORTED:
                    parts.append(f'{_esc_id(col, chr(34))}::text AS {_esc_id(col, chr(34))}')
                else:
                    parts.append(_esc_id(col, chr(34)))
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
        conditions = opts.get("conditions", [])
        source_filters = opts.get("source_filters", [])

        if not source_table:
            raise ValueError("source_table must be provided")
        
        db, schema, table = self._resolve_source_table(source_table)

        col_list = self._safe_select_list(schema, table, dbname=db)
        qualified = f'{_esc_id(schema, chr(34))}.{_esc_id(table, chr(34))}'
        base_query = f"SELECT {col_list} FROM {qualified}"

        # Add WHERE clause from source filters, falling back to legacy conditions.
        where_clause = build_source_filter_where_clause_inline(
            source_filters, quote_char='"', dialect="postgres"
        ) or build_where_clause_inline(conditions, quote_char='"')
        if where_clause:
            base_query = f"{base_query} {where_clause}"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'{_esc_id(col, chr(34))} {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        # Build full query with limit
        query = f"{base_query}{order_by_clause} LIMIT {int(size)}"
        
        logger.info(f"Executing PostgreSQL query: {query[:200]}...")
        
        arrow_table = self._read_sql_on(query, db) if db else self._read_sql(query)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from PostgreSQL")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List available tables from PostgreSQL.

        When ``database`` is specified, queries only that database.
        When ``database`` is empty, iterates every accessible database
        so the result includes tables from all databases — consistent
        with :meth:`sync_catalog_metadata`.
        """
        if self.database:
            return self._list_tables(table_filter)

        return self._cross_db_list_tables(table_filter)

    def _list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables from PostgreSQL.

        Only queries information_schema and pg_description in batch; does NOT
        run per-table SELECT * LIMIT or COUNT(*) to keep catalog browsing fast.
        """
        try:
            query = """
                SELECT table_schema as schemaname, table_name as tablename 
                FROM information_schema.tables 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast') 
                AND table_schema !~ '^pg_temp_[0-9]+$'
                AND table_schema !~ '^pg_toast_temp_[0-9]+$'
                AND table_schema NOT LIKE '%_intern%' 
                AND table_schema NOT LIKE '%timescaledb%'
                AND table_name NOT LIKE '%/%'
                AND table_type = 'BASE TABLE'
                ORDER BY table_schema, table_name
            """
            tables_arrow = self._read_sql(query)
            tables_df = tables_arrow.to_pandas()

            logger.info(f"Found {len(tables_df)} tables")

            schema_filter = """
                table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
                AND table_schema !~ '^pg_temp_[0-9]+$'
                AND table_schema !~ '^pg_toast_temp_[0-9]+$'
                AND table_schema NOT LIKE '%_intern%'
                AND table_schema NOT LIKE '%timescaledb%'
            """

            columns_query = f"""
                SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
                       pgd.description AS column_comment
                FROM information_schema.columns c
                LEFT JOIN pg_catalog.pg_statio_all_tables st
                  ON st.schemaname = c.table_schema AND st.relname = c.table_name
                LEFT JOIN pg_catalog.pg_description pgd
                  ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
                WHERE {schema_filter}
                ORDER BY c.table_schema, c.table_name, c.ordinal_position
            """
            cols_arrow = self._read_sql(columns_query)
            cols_df = cols_arrow.to_pandas()

            col_map: dict[str, list[dict]] = {}
            for _, cr in cols_df.iterrows():
                key = f"{cr['table_schema']}.{cr['table_name']}"
                entry: dict[str, Any] = {
                    "name": cr["column_name"],
                    "type": cr["data_type"],
                }
                comment = cr.get("column_comment")
                if comment and str(comment).strip():
                    entry["description"] = str(comment).strip()
                col_map.setdefault(key, []).append(entry)

            # Batch-fetch table comments
            table_comments_query = """
                SELECT n.nspname AS schemaname,
                       c.relname AS tablename,
                       obj_description(c.oid) AS table_comment
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind = 'r'
                  AND obj_description(c.oid) IS NOT NULL
            """
            try:
                tc_df = self._read_sql(table_comments_query).to_pandas()
                table_comment_map: dict[str, str] = {}
                for _, r in tc_df.iterrows():
                    key = f"{r['schemaname']}.{r['tablename']}"
                    comment = str(r['table_comment']).strip()
                    if comment:
                        table_comment_map[key] = comment
            except Exception:
                table_comment_map = {}

            results = []
            for _, row in tables_df.iterrows():
                schema = row['schemaname']
                table_name = row['tablename']
                full_table_name = f"{schema}.{table_name}"

                if table_filter and table_filter.lower() not in full_table_name.lower():
                    continue

                columns = col_map.get(full_table_name, [])
                metadata: dict[str, Any] = {
                    "columns": columns,
                    "source_metadata_status": "synced" if columns else "partial",
                }
                table_desc = table_comment_map.get(full_table_name)
                if table_desc:
                    metadata["description"] = table_desc
                results.append({
                    "name": full_table_name,
                    "path": [schema, table_name],
                    "metadata": metadata,
                })

            return results

        except Exception as e:
            logger.error(f"Error listing tables: {e}")
            return []

    # -- Cross-database sync -----------------------------------------------

    _SCHEMA_FILTER_SQL = """
        table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
        AND table_schema !~ '^pg_temp_[0-9]+$'
        AND table_schema !~ '^pg_toast_temp_[0-9]+$'
        AND table_schema NOT LIKE '%_intern%'
        AND table_schema NOT LIKE '%timescaledb%'
    """

    def _cross_db_list_tables(
        self, table_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """Iterate all accessible databases and collect tables.

        Shared by :meth:`list_tables` and :meth:`sync_catalog_metadata`
        when no database is pinned.  Logs per-database counts so the user
        can see which databases were scanned and whether any were empty.

        Side effect: stores the list of scanned database names in
        ``self._scanned_databases`` so that :meth:`_tables_to_catalog_tree`
        can include empty databases as namespace nodes.
        """
        db_rows = self._read_sql("""
            SELECT datname FROM pg_database
            WHERE datistemplate = false AND datallowconn = true
            ORDER BY datname
        """).to_pandas()

        db_names = [r["datname"] for _, r in db_rows.iterrows()]
        self._scanned_databases = list(db_names)
        logger.info("PostgreSQL server has %d databases: %s", len(db_names), db_names)

        all_tables: list[dict[str, Any]] = []
        for db in db_names:
            try:
                tables = self._list_tables_for_db(db, table_filter)
                logger.info(
                    "Database '%s': found %d user tables", db, len(tables),
                )
                all_tables.extend(tables)
            except Exception:
                logger.warning(
                    "Skipped database '%s' (connection or query failed)",
                    db, exc_info=True,
                )

        logger.info(
            "Cross-database scan complete: %d tables across %d databases",
            len(all_tables), len(db_names),
        )
        return all_tables

    def _list_tables_for_db(
        self, db: str, table_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """List tables in a specific database with full column and comment info.

        Like ``_list_tables`` but queries *db* via a fresh connection and
        returns three-part ``database.schema.table`` identifiers.
        """
        sf = self._SCHEMA_FILTER_SQL
        tables_query = f"""
            SELECT table_schema AS schemaname, table_name AS tablename
            FROM information_schema.tables
            WHERE {sf}
              AND table_name NOT LIKE '%%/%%'
              AND table_type = 'BASE TABLE'
            ORDER BY table_schema, table_name
        """
        tables_df = self._read_sql_on(tables_query, db).to_pandas()
        if tables_df.empty:
            return []

        columns_query = f"""
            SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
                   pgd.description AS column_comment
            FROM information_schema.columns c
            LEFT JOIN pg_catalog.pg_statio_all_tables st
              ON st.schemaname = c.table_schema AND st.relname = c.table_name
            LEFT JOIN pg_catalog.pg_description pgd
              ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
            WHERE {sf}
            ORDER BY c.table_schema, c.table_name, c.ordinal_position
        """
        cols_df = self._read_sql_on(columns_query, db).to_pandas()

        col_map: dict[str, list[dict]] = {}
        for _, cr in cols_df.iterrows():
            key = f"{cr['table_schema']}.{cr['table_name']}"
            entry: dict[str, Any] = {
                "name": cr["column_name"],
                "type": cr["data_type"],
            }
            comment = cr.get("column_comment")
            if comment and str(comment).strip():
                entry["description"] = str(comment).strip()
            col_map.setdefault(key, []).append(entry)

        table_comments_query = """
            SELECT n.nspname AS schemaname,
                   c.relname AS tablename,
                   obj_description(c.oid) AS table_comment
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'
              AND obj_description(c.oid) IS NOT NULL
        """
        try:
            tc_df = self._read_sql_on(table_comments_query, db).to_pandas()
            table_comment_map: dict[str, str] = {
                f"{r['schemaname']}.{r['tablename']}": str(r['table_comment']).strip()
                for _, r in tc_df.iterrows()
                if r['table_comment'] and str(r['table_comment']).strip()
            }
        except Exception:
            table_comment_map = {}

        results: list[dict[str, Any]] = []
        for _, row in tables_df.iterrows():
            schema = row["schemaname"]
            table_name = row["tablename"]
            schema_table = f"{schema}.{table_name}"
            full_source = f"{db}.{schema}.{table_name}"

            if table_filter and table_filter.lower() not in full_source.lower():
                continue

            columns = col_map.get(schema_table, [])
            metadata: dict[str, Any] = {
                "_source_name": full_source,
                "columns": columns,
                "source_metadata_status": "synced" if columns else "partial",
            }
            table_desc = table_comment_map.get(schema_table)
            if table_desc:
                metadata["description"] = table_desc
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
        is empty, iterates every accessible database on the server and
        collects tables with full column info and comments.
        """
        if self.database:
            tables = self.list_tables(table_filter)
            self.ensure_table_keys(tables)
            return tables

        all_tables = self._cross_db_list_tables(table_filter)
        self.ensure_table_keys(all_tables)
        return all_tables

    def search_catalog(self, query: str, limit: int = 100) -> dict:
        """Search database/schema/table names without fetching table metadata."""
        text = (query or "").strip()
        if not text:
            return {"tree": [], "truncated": False}

        max_results = max(1, int(limit or 100))
        pattern = f"%{_esc_str(text.lower())}%"
        entries: list[dict[str, Any]] = []

        try:
            if self.database:
                databases = [self.database]
            else:
                db_rows = self._read_sql("""
                    SELECT datname FROM pg_database
                    WHERE datistemplate = false AND datallowconn = true
                    ORDER BY datname
                """).to_pandas()
                databases = [r["datname"] for _, r in db_rows.iterrows()]

            for db in databases:
                db_matches = text.lower() in str(db).lower()
                name_predicate = "TRUE" if db_matches else (
                    f"(LOWER(table_schema) LIKE '{pattern}' OR LOWER(table_name) LIKE '{pattern}')"
                )
                remaining = max_results + 1 - len(entries)
                if remaining <= 0:
                    break
                tables_query = f"""
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
                      AND table_schema !~ '^pg_temp_[0-9]+$'
                      AND table_schema !~ '^pg_toast_temp_[0-9]+$'
                      AND table_schema NOT LIKE '%%_intern%%'
                      AND table_schema NOT LIKE '%%timescaledb%%'
                      AND table_name NOT LIKE '%%/%%'
                      AND table_type = 'BASE TABLE'
                      AND {name_predicate}
                    ORDER BY table_schema, table_name
                    LIMIT {remaining}
                """
                try:
                    rows = self._read_sql_on(tables_query, db).to_pandas()
                except Exception as exc:
                    logger.debug("PostgreSQL catalog search skipped database %s: %s", db, type(exc).__name__)
                    continue
                for _, row in rows.iterrows():
                    schema = row["table_schema"]
                    table_name = row["table_name"]
                    full_source = f"{db}.{schema}.{table_name}"
                    entries.append({
                        "name": full_source,
                        "path": [db, schema, table_name],
                        "metadata": {"_source_name": full_source},
                    })
        except Exception as exc:
            logger.warning("PostgreSQL catalog search failed: %s", type(exc).__name__)
            entries = []

        truncated = len(entries) > max_results
        return {
            "tree": self._tables_to_catalog_tree(entries[:max_results]),
            "truncated": truncated,
        }

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
            {"key": "schema", "label": "Schema"},
            {"key": "table", "label": "Table"},
        ]

    def _tables_to_catalog_tree(self, tables: list[dict[str, Any]]) -> list[dict]:
        """Build tree, then append empty databases as namespace nodes.

        In cross-database mode (no pinned database), ensures all scanned
        databases appear in the tree — even those with zero user tables.
        """
        tree = super()._tables_to_catalog_tree(tables)

        if self.database or not getattr(self, "_scanned_databases", None):
            return tree

        existing_dbs = {node["name"] for node in tree if node.get("node_type") == "namespace"}
        for db in self._scanned_databases:
            if db not in existing_dbs:
                tree.append({
                    "name": db,
                    "node_type": "namespace",
                    "path": [db],
                    "metadata": None,
                    "children": [],
                })
        return tree

    def _connect_to_db(self, dbname: str):
        """Open a new connection to a specific database on the same server."""
        conn = psycopg2.connect(**self._connection_kwargs(dbname))
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

    def ls(
        self,
        path: list[str] | None = None,
        filter: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()

        if len(path) >= len(eff):
            return []

        level_key = eff[len(path)]["key"]

        # --- database level ---
        if level_key == "database":
            pagination_clause = ""
            if limit is not None:
                pagination_clause = f" LIMIT {max(0, int(limit))} OFFSET {max(0, int(offset))}"
            query = f"""
                SELECT datname FROM pg_database
                WHERE datistemplate = false AND datallowconn = true
                ORDER BY datname
                {pagination_clause}
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
            pagination_clause = ""
            if limit is not None:
                pagination_clause = f" LIMIT {max(0, int(limit))} OFFSET {max(0, int(offset))}"
            query = f"""
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
                  AND schema_name !~ '^pg_temp_[0-9]+$'
                  AND schema_name !~ '^pg_toast_temp_[0-9]+$'
                  AND schema_name NOT LIKE '%%_intern%%'
                  AND schema_name NOT LIKE '%%timescaledb%%'
                ORDER BY schema_name
                {pagination_clause}
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
            pagination_clause = ""
            if limit is not None:
                pagination_clause = f" LIMIT {max(0, int(limit))} OFFSET {max(0, int(offset))}"
            query = f"""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = '{_esc_str(schema)}'
                  AND table_type = 'BASE TABLE'
                  AND table_name NOT LIKE '%%/%%'
                ORDER BY table_name
                {pagination_clause}
            """
            rows = self._read_sql_on(query, db).to_pandas()
            nodes = []
            for _, r in rows.iterrows():
                name = r["table_name"]
                if filter and filter.lower() not in name.lower():
                    continue
                full_source = f"{db}.{schema}.{name}"
                nodes.append(CatalogNode(
                    name=name, node_type="table",
                    path=path + [name],
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
        full_source = f"{db}.{schema}.{table_name}"
        try:
            cols_query = f"""
                SELECT c.column_name, c.data_type,
                       pgd.description AS column_comment
                FROM information_schema.columns c
                LEFT JOIN pg_catalog.pg_statio_all_tables st
                  ON st.schemaname = c.table_schema AND st.relname = c.table_name
                LEFT JOIN pg_catalog.pg_description pgd
                  ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
                WHERE c.table_schema = '{_esc_str(schema)}'
                  AND c.table_name = '{_esc_str(table_name)}'
                ORDER BY c.ordinal_position
            """
            cols_df = self._read_sql_on(cols_query, db).to_pandas()
            columns = []
            for _, r in cols_df.iterrows():
                entry: dict[str, Any] = {"name": r["column_name"], "type": r["data_type"]}
                comment = r.get("column_comment")
                if comment and str(comment).strip():
                    entry["description"] = str(comment).strip()
                columns.append(entry)

            # Table comment
            table_desc_query = f"""
                SELECT obj_description(c.oid) AS table_comment
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = '{_esc_str(schema)}'
                  AND c.relname = '{_esc_str(table_name)}'
                  AND c.relkind = 'r'
            """
            table_description = None
            try:
                td_df = self._read_sql_on(table_desc_query, db).to_pandas()
                if not td_df.empty and td_df["table_comment"].iloc[0]:
                    table_description = str(td_df["table_comment"].iloc[0]).strip() or None
            except Exception:
                pass

            count_df = self._read_sql_on(
                f'SELECT COUNT(*) AS cnt FROM {_esc_id(schema, chr(34))}.{_esc_id(table_name, chr(34))}', db
            ).to_pandas()
            row_count = int(count_df["cnt"].iloc[0])
            col_list = self._safe_select_list(schema, table_name)
            sample_df = self._read_sql_on(
                f'SELECT {col_list} FROM {_esc_id(schema, chr(34))}.{_esc_id(table_name, chr(34))} LIMIT 5', db
            ).to_pandas()
            sample_rows = json.loads(sample_df.to_json(orient="records"))
            result: dict[str, Any] = {
                "_source_name": full_source,
                "row_count": row_count,
                "columns": columns,
                "sample_rows": sample_rows,
            }
            if table_description:
                result["description"] = table_description
            return result
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self._read_sql("SELECT 1")
            return True
        except Exception:
            return False
