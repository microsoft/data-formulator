import logging
from typing import Any

import pyarrow as pa
import snowflake.connector

from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
    MAX_IMPORT_ROWS,
    _esc_id,
    _esc_str,
    build_where_clause_inline,
)

logger = logging.getLogger(__name__)

_HIDDEN_SCHEMAS = {"INFORMATION_SCHEMA"}
_MAX_DATABASES = 10
_MAX_TABLES = 500


def _dq(name: str) -> str:
    """Double-quote a Snowflake identifier."""
    return _esc_id(name, '"')


def _row_value(row: dict[str, Any], key: str) -> Any:
    """Return a row value regardless of Snowflake result-key casing."""
    for candidate in (key, key.lower(), key.upper()):
        if candidate in row:
            return row[candidate]
    return None


class SnowflakeDataLoader(ExternalDataLoader):
    """Snowflake loader for browsing and importing database tables and views."""

    DISPLAY_NAME = "Snowflake"
    DESCRIPTION = "Query Snowflake databases, schemas, tables, and views with SQL."
    AUTH_GUIDE = "snowflake.md"

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {
                "name": "account",
                "type": "string",
                "required": True,
                "tier": "connection",
                "description": "Snowflake account identifier, e.g. myorg-myaccount",
            },
            {
                "name": "user",
                "type": "string",
                "required": True,
                "tier": "auth",
                "description": "Snowflake login name",
            },
            {
                "name": "password",
                "type": "password",
                "required": True,
                "sensitive": True,
                "tier": "auth",
                "description": "Snowflake password",
            },
            {
                "name": "warehouse",
                "type": "string",
                "required": True,
                "tier": "connection",
                "description": "Warehouse used to run preview and import queries",
            },
            {
                "name": "database",
                "type": "string",
                "required": False,
                "tier": "filter",
                "description": "Database name (leave empty to browse accessible databases)",
            },
            {
                "name": "schema",
                "type": "string",
                "required": False,
                "tier": "filter",
                "description": "Schema name (leave empty to browse schemas)",
            },
            {
                "name": "role",
                "type": "string",
                "required": False,
                "tier": "connection",
                "advanced": True,
                "description": "Optional Snowflake role",
            },
        ]

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.account = (params.get("account") or "").strip()
        self.user = (params.get("user") or "").strip()
        self.password = params.get("password") or ""
        self.warehouse = (params.get("warehouse") or "").strip()
        self.database = (params.get("database") or "").strip()
        self.schema = (params.get("schema") or "").strip()
        self.role = (params.get("role") or "").strip()

        if not self.account:
            raise ValueError("Snowflake account is required")
        if not self.user:
            raise ValueError("Snowflake user is required")
        if not self.password:
            raise ValueError("Snowflake password is required")
        if not self.warehouse:
            raise ValueError("Snowflake warehouse is required")
        if self.schema and not self.database:
            raise ValueError("Snowflake database is required when schema is provided")

        connect_args: dict[str, Any] = {
            "account": self.account,
            "user": self.user,
            "password": self.password,
            "warehouse": self.warehouse,
            "application": "DataFormulator",
        }
        if self.database:
            connect_args["database"] = self.database
        if self.schema:
            connect_args["schema"] = self.schema
        if self.role:
            connect_args["role"] = self.role

        try:
            self._conn = snowflake.connector.connect(**connect_args)
        except Exception as exc:
            logger.error("Failed to connect to Snowflake account %s: %s", self.account, exc)
            raise ValueError(f"Failed to connect to Snowflake account '{self.account}': {exc}") from exc

        logger.info("Successfully connected to Snowflake account: %s", self.account)

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
            {"key": "schema", "label": "Schema"},
            {"key": "table", "label": "Table"},
        ]

    def _query_rows(self, query: str) -> list[dict[str, Any]]:
        cur = self._conn.cursor()
        try:
            cur.execute(query)
            if cur.description is None:
                return []
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        finally:
            cur.close()

    def _query_arrow(self, query: str) -> pa.Table:
        cur = self._conn.cursor()
        try:
            cur.execute(query)
            if cur.description is None:
                return pa.table({})
            table = cur.fetch_arrow_all()
            return table if table is not None else pa.table({})
        finally:
            cur.close()

    def _databases(self) -> list[str]:
        if self.database:
            return [self.database]
        try:
            rows = self._query_rows("SHOW DATABASES")
        except Exception as exc:
            logger.warning("SHOW DATABASES failed: %s", exc)
            return []
        names = [str(_row_value(row, "name") or "") for row in rows]
        return [name for name in names if name][:_MAX_DATABASES]

    def _schemas(self, database: str) -> list[str]:
        rows = self._query_rows(
            f'SELECT schema_name AS "schema_name" '
            f'FROM {_dq(database)}.INFORMATION_SCHEMA.SCHEMATA '
            f"WHERE UPPER(schema_name) <> 'INFORMATION_SCHEMA' "
            f'ORDER BY schema_name'
        )
        return [
            str(_row_value(row, "schema_name"))
            for row in rows
            if _row_value(row, "schema_name")
        ]

    def _tables(self, database: str, schema: str) -> list[str]:
        rows = self._query_rows(
            f'SELECT table_name AS "table_name" '
            f'FROM {_dq(database)}.INFORMATION_SCHEMA.TABLES '
            f"WHERE table_schema = '{_esc_str(schema)}' "
            f'ORDER BY table_name'
        )
        return [
            str(_row_value(row, "table_name"))
            for row in rows
            if _row_value(row, "table_name")
        ]

    def _list_tables_in_database(
        self,
        database: str,
        table_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        schema_predicate = ""
        if self.schema:
            schema_predicate = f"AND table_schema = '{_esc_str(self.schema)}'"

        tables = self._query_rows(
            f"""
            SELECT
                table_schema AS "table_schema",
                table_name AS "table_name",
                table_type AS "table_type",
                comment AS "comment"
            FROM {_dq(database)}.INFORMATION_SCHEMA.TABLES
            WHERE UPPER(table_schema) <> 'INFORMATION_SCHEMA'
              {schema_predicate}
            ORDER BY table_schema, table_name
            """
        )

        columns = self._query_rows(
            f"""
            SELECT
                table_schema AS "table_schema",
                table_name AS "table_name",
                column_name AS "column_name",
                data_type AS "data_type",
                comment AS "comment"
            FROM {_dq(database)}.INFORMATION_SCHEMA.COLUMNS
            WHERE UPPER(table_schema) <> 'INFORMATION_SCHEMA'
              {schema_predicate}
            ORDER BY table_schema, table_name, ordinal_position
            """
        )

        column_map: dict[str, list[dict[str, Any]]] = {}
        for row in columns:
            schema = str(_row_value(row, "table_schema") or "")
            table = str(_row_value(row, "table_name") or "")
            column = str(_row_value(row, "column_name") or "")
            if not schema or not table or not column:
                continue
            entry: dict[str, Any] = {
                "name": column,
                "type": _row_value(row, "data_type"),
            }
            comment = _row_value(row, "comment")
            if comment and str(comment).strip():
                entry["description"] = str(comment).strip()
            column_map.setdefault(f"{schema}.{table}", []).append(entry)

        results: list[dict[str, Any]] = []
        for row in tables:
            schema = str(_row_value(row, "table_schema") or "")
            table = str(_row_value(row, "table_name") or "")
            if not schema or not table or schema.upper() in _HIDDEN_SCHEMAS:
                continue
            source_name = f"{database}.{schema}.{table}"
            if table_filter and table_filter.lower() not in source_name.lower():
                continue

            table_columns = column_map.get(f"{schema}.{table}", [])
            metadata: dict[str, Any] = {
                "_source_name": source_name,
                "columns": table_columns,
                "source_metadata_status": "synced" if table_columns else "partial",
            }
            table_type = _row_value(row, "table_type")
            if table_type:
                metadata["table_type"] = table_type
            comment = _row_value(row, "comment")
            if comment and str(comment).strip():
                metadata["description"] = str(comment).strip()

            results.append(
                {
                    "name": source_name,
                    "path": [database, schema, table],
                    "metadata": metadata,
                }
            )
        return results

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for database in self._databases():
            self._report_progress(f"Listing Snowflake tables in {database}…")
            try:
                results.extend(self._list_tables_in_database(database, table_filter))
            except Exception as exc:
                logger.warning("Skipped Snowflake database '%s': %s", database, exc)
            if len(results) >= _MAX_TABLES:
                break
        return results[:_MAX_TABLES]

    def _resolve_source_table(self, source_table: str) -> tuple[str, str, str]:
        parts = source_table.split(".")
        if len(parts) >= 3:
            return parts[0], parts[1], ".".join(parts[2:])
        if len(parts) == 2 and self.database:
            return self.database, parts[0], parts[1]
        if len(parts) == 1 and self.database and self.schema:
            return self.database, self.schema, parts[0]
        raise ValueError(
            "Snowflake source_table must be database.schema.table unless database/schema are pinned"
        )

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        if not source_table:
            raise ValueError("source_table must be provided")

        opts = import_options or {}
        size = min(max(0, int(opts.get("size", MAX_IMPORT_ROWS))), MAX_IMPORT_ROWS)
        database, schema, table = self._resolve_source_table(source_table)
        qualified = f"{_dq(database)}.{_dq(schema)}.{_dq(table)}"

        columns = opts.get("columns")
        if columns:
            select_list = ", ".join(_dq(column) for column in columns)
        else:
            select_list = "*"

        query = f"SELECT {select_list} FROM {qualified}"

        conditions = opts.get("conditions") or opts.get("filters") or []
        where_clause = build_where_clause_inline(conditions, quote_char='"')
        if where_clause:
            query = f"{query} {where_clause}"

        sort_columns = opts.get("sort_columns")
        if sort_columns:
            direction = "DESC" if opts.get("sort_order", "asc") == "desc" else "ASC"
            order_by = ", ".join(f"{_dq(column)} {direction}" for column in sort_columns)
            query = f"{query} ORDER BY {order_by}"

        query = f"{query} LIMIT {size}"
        logger.info("Executing Snowflake query: %s...", query[:200])
        return self._query_arrow(query)

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        try:
            database, schema, table = self._resolve_source_table(source_table)
            rows = self._query_rows(
                f"""
                SELECT
                    column_name AS "column_name",
                    data_type AS "data_type",
                    comment AS "comment"
                FROM {_dq(database)}.INFORMATION_SCHEMA.COLUMNS
                WHERE table_schema = '{_esc_str(schema)}'
                  AND table_name = '{_esc_str(table)}'
                ORDER BY ordinal_position
                """
            )
            columns: list[dict[str, Any]] = []
            for row in rows:
                name = _row_value(row, "column_name")
                if not name:
                    continue
                entry: dict[str, Any] = {
                    "name": name,
                    "type": _row_value(row, "data_type"),
                }
                comment = _row_value(row, "comment")
                if comment and str(comment).strip():
                    entry["description"] = str(comment).strip()
                columns.append(entry)
            return {"columns": columns} if columns else {}
        except Exception as exc:
            logger.debug("get_column_types failed for %s: %s", source_table, exc)
            return {}

    def ls(
        self,
        path: list[str] | None = None,
        filter: str | None = None,
    ) -> list[CatalogNode]:
        path = path or []
        effective = self.effective_hierarchy()
        if len(path) >= len(effective):
            return []

        level_key = effective[len(path)]["key"]

        if level_key == "database":
            return [
                CatalogNode(name=name, node_type="namespace", path=path + [name])
                for name in self._databases()
                if not filter or filter.lower() in name.lower()
            ]

        if level_key == "schema":
            pinned = self.pinned_scope()
            database = pinned.get("database") or (path[0] if path else None)
            if not database:
                return []
            return [
                CatalogNode(name=name, node_type="namespace", path=path + [name])
                for name in self._schemas(database)
                if not filter or filter.lower() in name.lower()
            ]

        if level_key == "table":
            pinned = self.pinned_scope()
            remaining = list(path)

            database = pinned.get("database")
            if not database:
                if not remaining:
                    return []
                database = remaining.pop(0)

            schema = pinned.get("schema")
            if not schema:
                if not remaining:
                    return []
                schema = remaining.pop(0)

            nodes: list[CatalogNode] = []
            for name in self._tables(database, schema):
                if filter and filter.lower() not in name.lower():
                    continue
                source_name = f"{database}.{schema}.{name}"
                nodes.append(
                    CatalogNode(
                        name=name,
                        node_type="table",
                        path=path + [name],
                        metadata={"_source_name": source_name},
                    )
                )
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        pinned = self.pinned_scope()
        remaining = list(path)

        database = pinned.get("database")
        if not database:
            if not remaining:
                return {}
            database = remaining.pop(0)

        schema = pinned.get("schema")
        if not schema:
            if not remaining:
                return {}
            schema = remaining.pop(0)

        if not remaining:
            return {}

        table = remaining[0]
        source_name = f"{database}.{schema}.{table}"
        metadata = self.get_column_types(source_name)
        if metadata:
            metadata["_source_name"] = source_name
        return metadata

    def test_connection(self) -> bool:
        try:
            self._query_rows("SELECT 1 AS ok")
            return True
        except Exception:
            return False
