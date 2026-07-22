import logging
import os
from typing import Any

import pyarrow as pa

from data_formulator.data_loader.external_data_loader import (
    ExternalDataLoader,
    MAX_IMPORT_ROWS,
    build_where_clause_inline,
    _esc_id,
    _esc_str,
)

from databricks import sql as databricks_sql

logger = logging.getLogger(__name__)

# Unity Catalog exposes an ``information_schema`` schema inside every catalog;
# it is metadata, not user data, so it is hidden from browsing.
_HIDDEN_SCHEMAS = {"information_schema"}
# ``system`` holds platform telemetry and ``__databricks_internal`` is internal.
_HIDDEN_CATALOGS = {"system", "__databricks_internal"}

# Bound broad (unpinned) catalog scans so browsing a large metastore stays fast.
_MAX_CATALOGS = 10
_MAX_TABLES = 500


def _bt(name: str) -> str:
    """Backtick-quote a Databricks/Spark SQL identifier."""
    return _esc_id(name, "`")


class DatabricksDataLoader(ExternalDataLoader):
    """Databricks SQL loader for browsing and importing Unity Catalog data.

    Connects to a Databricks SQL warehouse via ``databricks-sql-connector`` and
    browses the Unity Catalog three-level namespace (``catalog.schema.table``).
    Data is fetched Arrow-native via the connector's ``fetchall_arrow()``.
    """

    DISPLAY_NAME = "Databricks"
    DESCRIPTION = "Query Databricks Unity Catalog tables through a SQL warehouse."

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "server_hostname", "type": "string", "required": True, "tier": "connection",
             "description": "e.g., adb-1234567890.11.azuredatabricks.net"},
            {"name": "http_path", "type": "string", "required": True, "tier": "connection",
             "description": "SQL warehouse HTTP path, e.g., /sql/1.0/warehouses/abc123"},
            {"name": "catalog", "type": "string", "required": False, "tier": "connection",
             "description": "Unity Catalog name (leave empty to browse all catalogs)"},
            {"name": "schema", "type": "string", "required": False, "tier": "filter",
             "description": "Schema name (leave empty to browse all schemas in the catalog)"},
            {"name": "access_token", "type": "string", "required": False, "sensitive": True, "tier": "auth",
             "description": "Databricks personal access token (dapi...)"},
        ]

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        # Personal Access Token is the always-available default. A delegated
        # "Sign in with Databricks" (OAuth U2M) path is surfaced only when the
        # server is configured for it; the gateway is a TODO (see
        # delegated_login_config), so this stays dormant until wired up.
        oauth_ready = bool(os.environ.get("DATABRICKS_OAUTH_CLIENT_ID"))
        paths = [
            {
                "id": "token",
                "label": "Personal access token",
                "description": "Use a Databricks personal access token (dapi…).",
                "fields": ["access_token"],
                "required_fields": ["access_token"],
                "kind": "credentials",
                "default": not oauth_ready,
            },
        ]
        if oauth_ready:
            paths.insert(0, {
                "id": "databricks_sign_in",
                "label": "Sign in with Databricks",
                "description": "Use your Databricks identity and existing Unity Catalog permissions.",
                "fields": [],
                "required_fields": [],
                "kind": "delegated_login",
                "default": True,
            })
        return paths

    @classmethod
    def infer_auth_path(cls, params: dict[str, Any]) -> str:
        if params.get("access_token"):
            return "token"
        if os.environ.get("DATABRICKS_OAUTH_CLIENT_ID"):
            return "databricks_sign_in"
        return "token"

    @staticmethod
    def delegated_login_config() -> dict[str, Any] | None:
        # TODO: implement databricks_oauth_gateway.py (Authorization Code + PKCE
        # against the workspace OAuth endpoint), then return its login URL here.
        return None

    @staticmethod
    def auth_instructions() -> str:
        return """**Example:** server_hostname: `adb-1234567890.11.azuredatabricks.net` · http_path: `/sql/1.0/warehouses/abc123`

**Connection:** Find both values on your SQL warehouse's **Connection details** tab in the Databricks workspace (SQL → SQL Warehouses → your warehouse).

**Personal access token:** In Databricks, open **Settings → Developer → Access tokens** and generate a token (starts with `dapi`). The token's user needs `USE CATALOG` / `USE SCHEMA` and `SELECT` on the Unity Catalog objects you want to read.

**Scope:** Leave *catalog* and *schema* empty to browse everything you can access, or set them to jump straight to a specific catalog/schema."""

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.auth_path = params.get("_auth_path") or self.infer_auth_path(params)

        raw_host = (params.get("server_hostname") or "").strip()
        # Accept a full URL or a bare hostname.
        raw_host = raw_host.replace("https://", "").replace("http://", "").rstrip("/")
        self.server_hostname = raw_host
        self.http_path = (params.get("http_path") or "").strip()
        self.catalog = (params.get("catalog") or "").strip()
        self.schema = (params.get("schema") or "").strip()
        self.access_token = params.get("access_token") or ""

        if not self.server_hostname:
            raise ValueError("Databricks server_hostname is required")
        if not self.http_path:
            raise ValueError("Databricks http_path (SQL warehouse) is required")
        if not self.access_token:
            raise ValueError("Databricks access token is required")

        try:
            self._conn = databricks_sql.connect(
                server_hostname=self.server_hostname,
                http_path=self.http_path,
                access_token=self.access_token,
            )
        except Exception as e:
            logger.error("Failed to connect to Databricks (%s): %s", self.server_hostname, e)
            raise ValueError(
                f"Failed to connect to Databricks warehouse at '{self.server_hostname}': {e}"
            ) from e

        logger.info("Successfully connected to Databricks: %s", self.server_hostname)

    # ------------------------------------------------------------------ #
    # Query helpers                                                        #
    # ------------------------------------------------------------------ #

    def _query_arrow(self, query: str) -> pa.Table:
        """Run *query* and return results as a PyArrow Table (Arrow-native)."""
        cur = self._conn.cursor()
        try:
            cur.execute(query)
            if cur.description is None:
                return pa.table({})
            return cur.fetchall_arrow()
        finally:
            cur.close()

    def _query_rows(self, query: str) -> list[dict[str, Any]]:
        """Run *query* and return a list of row dicts."""
        cur = self._conn.cursor()
        try:
            cur.execute(query)
            if cur.description is None:
                return []
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        finally:
            cur.close()

    def _resolve_source_table(self, source_table: str) -> tuple[str, str, str]:
        """Parse ``catalog.schema.table`` (filling pinned params when partial)."""
        parts = source_table.split(".")
        if len(parts) >= 3:
            return parts[0], parts[1], ".".join(parts[2:])
        if len(parts) == 2:
            return self.catalog, parts[0], parts[1]
        return self.catalog, self.schema, parts[0]

    # ------------------------------------------------------------------ #
    # Catalog hierarchy                                                    #
    # ------------------------------------------------------------------ #

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "catalog", "label": "Catalog"},
            {"key": "schema", "label": "Schema"},
            {"key": "table", "label": "Table"},
        ]

    def _catalogs(self) -> list[str]:
        if self.catalog:
            return [self.catalog]
        try:
            rows = self._query_rows("SHOW CATALOGS")
        except Exception as e:
            logger.warning("SHOW CATALOGS failed: %s", e)
            return []
        names = [str(r.get("catalog") or r.get("catalog_name") or "") for r in rows]
        names = [n for n in names if n and n not in _HIDDEN_CATALOGS]
        return names[:_MAX_CATALOGS]

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List Unity Catalog tables within the pinned/browsable scope.

        Uses each catalog's ``information_schema`` to batch-fetch tables,
        columns and comments (two queries per catalog) so browsing stays fast.
        """
        results: list[dict[str, Any]] = []
        for catalog in self._catalogs():
            self._report_progress(f"Listing tables in catalog {catalog}…")
            try:
                results.extend(self._list_tables_in_catalog(catalog, table_filter))
            except Exception as e:
                logger.warning("Skipped catalog '%s': %s", catalog, e)
            if len(results) >= _MAX_TABLES:
                logger.info("Reached %d table limit, stopping enumeration", _MAX_TABLES)
                break
        return results[:_MAX_TABLES]

    def _list_tables_in_catalog(
        self, catalog: str, table_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        cat = _bt(catalog)
        schema_pred = ""
        if self.schema:
            schema_pred = f"AND table_schema = '{_esc_str(self.schema)}'"

        tables_rows = self._query_rows(f"""
            SELECT table_schema, table_name, comment
            FROM {cat}.information_schema.tables
            WHERE table_schema NOT IN ('information_schema')
              {schema_pred}
            ORDER BY table_schema, table_name
        """)

        cols_rows = self._query_rows(f"""
            SELECT table_schema, table_name, column_name, data_type, comment
            FROM {cat}.information_schema.columns
            WHERE table_schema NOT IN ('information_schema')
              {schema_pred}
            ORDER BY table_schema, table_name, ordinal_position
        """)

        col_map: dict[str, list[dict[str, Any]]] = {}
        for r in cols_rows:
            key = f"{r['table_schema']}.{r['table_name']}"
            entry: dict[str, Any] = {"name": r["column_name"], "type": r["data_type"]}
            comment = r.get("comment")
            if comment and str(comment).strip():
                entry["description"] = str(comment).strip()
            col_map.setdefault(key, []).append(entry)

        results: list[dict[str, Any]] = []
        for r in tables_rows:
            schema = r["table_schema"]
            table = r["table_name"]
            full_name = f"{catalog}.{schema}.{table}"
            if table_filter and table_filter.lower() not in full_name.lower():
                continue
            columns = col_map.get(f"{schema}.{table}", [])
            metadata: dict[str, Any] = {
                "columns": columns,
                "source_metadata_status": "synced" if columns else "partial",
            }
            table_comment = r.get("comment")
            if table_comment and str(table_comment).strip():
                metadata["description"] = str(table_comment).strip()
            results.append({
                "name": full_name,
                "path": [catalog, schema, table],
                "metadata": metadata,
            })
        return results

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        """Return source-level column types/comments for a single table.

        Uses ``DESCRIBE TABLE`` rather than ``information_schema.columns``: the
        latter is unreliable for special catalogs (e.g. the built-in
        ``samples`` catalog exposes tables but no per-schema column rows),
        whereas ``DESCRIBE`` works uniformly across Unity Catalog.
        """
        try:
            catalog, schema, table = self._resolve_source_table(source_table)
            qualified = f"{_bt(catalog)}.{_bt(schema)}.{_bt(table)}"
            rows = self._query_rows(f"DESCRIBE TABLE {qualified}")
            columns: list[dict[str, Any]] = []
            for r in rows:
                name = r.get("col_name")
                # DESCRIBE appends partition/detail sections after a blank or
                # ``# ...`` separator row — stop at the first such marker.
                if not name or str(name).startswith("#"):
                    break
                entry: dict[str, Any] = {"name": name, "type": r.get("data_type")}
                comment = r.get("comment")
                if comment and str(comment).strip():
                    entry["description"] = str(comment).strip()
                columns.append(entry)
            if columns:
                return {"columns": columns}
        except Exception as e:
            logger.debug("get_column_types failed for %s: %s", source_table, e)
        return {}

    # ------------------------------------------------------------------ #
    # Data fetch                                                           #
    # ------------------------------------------------------------------ #

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        opts = import_options or {}
        size = min(opts.get("size", MAX_IMPORT_ROWS), MAX_IMPORT_ROWS)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")
        conditions = opts.get("conditions", [])

        if not source_table:
            raise ValueError("source_table must be provided")

        catalog, schema, table = self._resolve_source_table(source_table)
        qualified = f"{_bt(catalog)}.{_bt(schema)}.{_bt(table)}"

        columns = opts.get("columns")
        if columns:
            col_list = ", ".join(_bt(c) for c in columns)
        else:
            col_list = "*"
        query = f"SELECT {col_list} FROM {qualified}"

        where_clause = build_where_clause_inline(conditions, quote_char="`")
        if where_clause:
            query = f"{query} {where_clause}"

        if sort_columns:
            direction = "DESC" if sort_order == "desc" else "ASC"
            order_cols = ", ".join(f"{_bt(c)} {direction}" for c in sort_columns)
            query = f"{query} ORDER BY {order_cols}"

        query = f"{query} LIMIT {int(size)}"

        logger.info("Executing Databricks query: %s...", query[:200])
        arrow_table = self._query_arrow(query)
        logger.info("Fetched %d rows from Databricks", arrow_table.num_rows)
        return arrow_table
