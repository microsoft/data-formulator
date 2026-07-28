"""ClickHouse connector for Data Formulator."""

from __future__ import annotations

import logging
import re
import threading
from typing import Any

import clickhouse_connect
import pyarrow as pa

from data_formulator.data_loader import probe_utils
from data_formulator.data_loader.external_data_loader import (
    MAX_IMPORT_ROWS,
    CatalogNode,
    ExternalDataLoader,
)
from data_formulator.datalake.parquet_utils import df_to_safe_records

logger = logging.getLogger(__name__)

_QUOTED_RELATION_RE = re.compile(r"^`((?:``|[^`])+)`\.`((?:``|[^`])+)`$")
_RAW_SQL_RE = re.compile(r"\b(?:select|from|where|join|union|with)\b", re.IGNORECASE)
_SOURCE_FILTER_OPERATORS = {
    "EQ": "=",
    "NEQ": "!=",
    "GT": ">",
    "GTE": ">=",
    "LT": "<",
    "LTE": "<=",
    "LIKE": "LIKE",
    "ILIKE": "ILIKE",
    "IN": "IN",
    "NOT_IN": "NOT IN",
    "IS_NULL": "IS NULL",
    "IS_NOT_NULL": "IS NOT NULL",
    "BETWEEN": "BETWEEN",
}
_LEGACY_OPERATORS = frozenset(
    {
        "=",
        "!=",
        "<>",
        ">",
        "<",
        ">=",
        "<=",
        "LIKE",
        "NOT LIKE",
        "ILIKE",
        "IN",
        "NOT IN",
        "BETWEEN",
        "IS NULL",
        "IS NOT NULL",
    }
)


def _as_bool(value: Any, *, name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off", ""}:
            return False
    if value in (0, 1):
        return bool(value)
    raise ValueError(f"{name} must be a boolean")


class ClickHouseDataLoader(ExternalDataLoader):
    """Read-only ClickHouse loader using the official HTTP client."""

    DISPLAY_NAME = "ClickHouse"
    DESCRIPTION = "Connect to ClickHouse or ClickHouse Cloud for fast analytical queries."

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {
                "name": "username",
                "type": "string",
                "required": True,
                "default": "default",
                "tier": "auth",
                "description": "ClickHouse username",
            },
            {
                "name": "password",
                "type": "string",
                "required": False,
                "default": "",
                "sensitive": True,
                "tier": "auth",
                "description": "ClickHouse password",
            },
            {
                "name": "host",
                "type": "string",
                "required": True,
                "default": "localhost",
                "tier": "connection",
                "description": "ClickHouse server or Cloud hostname",
            },
            {
                "name": "port",
                "type": "int",
                "required": False,
                "tier": "connection",
                "advanced": True,
                "description": "HTTP(S) port (typically 8123 or 8443)",
            },
            {
                "name": "secure",
                "type": "boolean",
                "required": False,
                "default": False,
                "tier": "connection",
                "advanced": True,
                "description": "Use HTTPS/TLS",
            },
            {
                "name": "verify",
                "type": "boolean",
                "required": False,
                "default": True,
                "tier": "connection",
                "advanced": True,
                "description": "Verify the server TLS certificate",
            },
            {
                "name": "timeout",
                "type": "int",
                "required": False,
                "default": 30,
                "tier": "connection",
                "advanced": True,
                "description": "Connection and query timeout in seconds",
            },
            {
                "name": "database",
                "type": "string",
                "required": False,
                "default": "",
                "tier": "filter",
                "description": "Database name (leave empty to browse databases)",
            },
        ]

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        return [
            {
                "id": "password",
                "label": "Username and password",
                "description": "Connect with a ClickHouse user and optional password.",
                "fields": ["username", "password"],
                "required_fields": ["username"],
                "kind": "credentials",
                "default": True,
            }
        ]

    @staticmethod
    def auth_instructions() -> str:
        return """**ClickHouse Cloud:** use the service hostname, port `8443`, and enable TLS.

**Self-hosted ClickHouse:** the HTTP interface usually uses port `8123`; enable TLS if your server exposes HTTPS.

Use a read-only ClickHouse account. Leave *database* empty to browse accessible databases, or set it to open tables directly."""

    def __init__(self, params: dict[str, Any]):
        self.params = dict(params)
        self.validate_params(self.params)
        self.host = str(self.params.get("host", "")).strip()
        self.username = str(self.params.get("username", "default")).strip()
        raw_password = self.params.get("password")
        self.password = "" if raw_password is None else str(raw_password)
        raw_database = self.params.get("database")
        self.database = "" if raw_database is None else str(raw_database).strip()
        self.secure = _as_bool(self.params.get("secure", False), name="secure")
        self.verify = _as_bool(self.params.get("verify", True), name="verify")

        raw_port = self.params.get("port")
        self.port = int(raw_port) if raw_port not in (None, "") else (8443 if self.secure else 8123)
        raw_timeout = self.params.get("timeout", 30)
        if isinstance(raw_timeout, bool):
            raise ValueError("timeout must be a positive integer")
        self.timeout = int(raw_timeout)
        if not 1 <= self.port <= 65535:
            raise ValueError("port must be between 1 and 65535")
        if self.timeout <= 0:
            raise ValueError("timeout must be a positive integer")

        self._lock = threading.RLock()
        self._client = None
        try:
            self._client = clickhouse_connect.get_client(
                host=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                database=self.database or None,
                secure=self.secure,
                verify=self.verify,
                connect_timeout=self.timeout,
                send_receive_timeout=self.timeout,
                client_name="data-formulator",
                settings={
                    "readonly": 1,
                    "max_execution_time": self.timeout,
                },
            )
        except Exception as exc:
            logger.error(
                "Failed to connect to ClickHouse at %s:%s (%s)",
                self.host,
                self.port,
                type(exc).__name__,
            )
            raise ValueError(
                f"Failed to connect to ClickHouse at '{self.host}:{self.port}'"
            ) from None

    def close(self) -> None:
        with self._lock:
            if self._client is not None:
                try:
                    self._client.close()
                except Exception:
                    logger.debug("ClickHouse client close failed", exc_info=True)
                finally:
                    self._client = None

    def __enter__(self) -> ClickHouseDataLoader:
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> bool:
        self.close()
        return False

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    def _read_sql(
        self,
        query: str,
        parameters: dict[str, Any] | None = None,
    ) -> pa.Table:
        with self._lock:
            if self._client is None:
                raise RuntimeError("ClickHouse connection is closed")
            return self._client.query_arrow(query, parameters=parameters)

    @staticmethod
    def _quote_identifier(name: str) -> str:
        return probe_utils.quote_ident(name, probe_utils.CLICKHOUSE)

    @classmethod
    def _quote_relation(cls, database: str, table: str) -> str:
        return f"{cls._quote_identifier(database)}.{cls._quote_identifier(table)}"

    def _resolve_source_table(self, source_table: str) -> tuple[str, str, str]:
        if not isinstance(source_table, str) or not source_table.strip():
            raise ValueError("source_table must be provided")
        source = source_table.strip()
        match = _QUOTED_RELATION_RE.fullmatch(source)
        if match:
            database, table = (part.replace("``", "`") for part in match.groups())
        else:
            if _RAW_SQL_RE.search(source):
                raise ValueError("source_table must be a table identifier, not SQL")
            parts = source.split(".")
            if len(parts) == 2:
                database, table = parts
            elif len(parts) == 1 and self.database:
                database, table = self.database, parts[0]
            else:
                raise ValueError(
                    "source_table must identify exactly one database and table"
                )

        if self.database and database != self.database:
            raise ValueError("source_table is outside the configured database")
        relation = self._quote_relation(database, table)
        return database, table, relation

    @staticmethod
    def _validated_size(value: Any) -> int:
        if isinstance(value, bool):
            raise ValueError("size must be an integer")
        try:
            size = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("size must be an integer") from exc
        if size < 0:
            raise ValueError("size must not be negative")
        return min(size, MAX_IMPORT_ROWS)

    @classmethod
    def _compile_filters(
        cls,
        filters: list[dict[str, Any]] | None,
        *,
        source_vocabulary: bool,
    ) -> tuple[str, dict[str, Any]]:
        parts: list[str] = []
        parameters: dict[str, Any] = {}

        def bind(value: Any) -> str:
            name = f"filter_{len(parameters)}"
            parameters[name] = value
            return f"%({name})s"

        for condition in filters or []:
            if not isinstance(condition, dict):
                continue
            column = condition.get("column")
            raw_operator = str(condition.get("operator") or "").upper().strip()
            operator = (
                _SOURCE_FILTER_OPERATORS.get(raw_operator)
                if source_vocabulary
                else raw_operator
            )
            if not column or not operator or operator not in _LEGACY_OPERATORS:
                continue
            try:
                quoted_column = cls._quote_identifier(str(column))
            except ValueError:
                continue
            value = condition.get("value")

            if operator in {"IS NULL", "IS NOT NULL"}:
                parts.append(f"{quoted_column} {operator}")
            elif operator in {"IN", "NOT IN"}:
                values = value if isinstance(value, (list, tuple)) else [value]
                if values:
                    parts.append(
                        f"{quoted_column} {operator} "
                        f"({', '.join(bind(item) for item in values)})"
                    )
            elif operator == "BETWEEN":
                if isinstance(value, (list, tuple)) and len(value) == 2:
                    parts.append(
                        f"{quoted_column} BETWEEN {bind(value[0])} AND {bind(value[1])}"
                    )
            elif operator == "ILIKE":
                parts.append(f"{quoted_column} ILIKE {bind(f'%{value}%')}")
            else:
                parts.append(f"{quoted_column} {operator} {bind(value)}")

        return (" AND ".join(parts), parameters)

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        options = import_options or {}
        size = self._validated_size(options.get("size", MAX_IMPORT_ROWS))
        _, _, relation = self._resolve_source_table(source_table)

        columns = options.get("columns") or []
        select_list = (
            ", ".join(self._quote_identifier(str(column)) for column in columns)
            if columns
            else "*"
        )
        sql = f"SELECT {select_list} FROM {relation}"

        filters = options.get("source_filters") or []
        where, parameters = self._compile_filters(filters, source_vocabulary=True)
        if not where:
            where, parameters = self._compile_filters(
                options.get("conditions") or [], source_vocabulary=False
            )
        if where:
            sql += f" WHERE {where}"

        sort_columns = options.get("sort_columns") or []
        if sort_columns:
            direction = (
                "DESC"
                if str(options.get("sort_order", "asc")).lower() == "desc"
                else "ASC"
            )
            sql += " ORDER BY " + ", ".join(
                f"{self._quote_identifier(str(column))} {direction}"
                for column in sort_columns
            )
        sql += f" LIMIT {size}"

        logger.info("Executing bounded ClickHouse table query against %s", relation)
        return self._read_sql(sql, parameters)

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        if not path:
            return {"error": "probe requires a non-empty table path"}
        try:
            if self.database:
                if len(path) != 1:
                    return {
                        "error": "probe path must contain only a table within "
                        "the configured database"
                    }
                source = self._quote_relation(self.database, str(path[0]))
            else:
                if len(path) != 2:
                    return {"error": "probe path must contain a database and table"}
                source = self._quote_relation(str(path[0]), str(path[1]))
        except (IndexError, ValueError) as exc:
            return {"error": f"invalid table identifier: {exc}"}
        return probe_utils.probe_via_native_sql(
            query,
            relation=source,
            dialect=probe_utils.CLICKHOUSE,
            execute=self._read_sql,
        )

    def _catalog_tables(self) -> pa.Table:
        sql = """
            SELECT database, name, engine, comment, total_rows
            FROM system.tables
            WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        """
        parameters: dict[str, Any] = {}
        if self.database:
            sql += " AND database = %(database)s"
            parameters["database"] = self.database
        sql += " ORDER BY database, name"
        return self._read_sql(sql, parameters)

    def _catalog_columns(self) -> pa.Table:
        sql = """
            SELECT database, table, name, type, comment
            FROM system.columns
            WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        """
        parameters: dict[str, Any] = {}
        if self.database:
            sql += " AND database = %(database)s"
            parameters["database"] = self.database
        sql += " ORDER BY database, table, position"
        return self._read_sql(sql, parameters)

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        tables = self._catalog_tables().to_pylist()
        columns = self._catalog_columns().to_pylist()
        column_map: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for column in columns:
            metadata: dict[str, Any] = {
                "name": column["name"],
                "type": column["type"],
            }
            if column.get("comment"):
                metadata["description"] = column["comment"]
            column_map.setdefault((column["database"], column["table"]), []).append(metadata)

        needle = (table_filter or "").lower()
        results: list[dict[str, Any]] = []
        for table in tables:
            database = table["database"]
            table_name = table["name"]
            if needle and needle not in database.lower() and needle not in table_name.lower():
                continue
            metadata = {
                "columns": column_map.get((database, table_name), []),
                "engine": table.get("engine"),
            }
            if table.get("comment"):
                metadata["description"] = table["comment"]
            if table.get("total_rows") is not None:
                metadata["row_count"] = int(table["total_rows"])
            results.append(
                {
                    "name": self._quote_relation(database, table_name),
                    "path": [database, table_name],
                    "metadata": metadata,
                }
            )
        return results

    def search_catalog(self, query: str, limit: int = 100) -> dict:
        text = (query or "").strip()
        if not text:
            return {"tree": [], "truncated": False}
        max_results = max(1, int(limit or 100))
        tables = self.list_tables(table_filter=text)
        return {
            "tree": self._tables_to_catalog_tree(tables[:max_results]),
            "truncated": len(tables) > max_results,
        }

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
            {"key": "table", "label": "Table"},
        ]

    def ls(
        self,
        path: list[str] | None = None,
        filter: str | None = None,
    ) -> list[CatalogNode]:
        path = path or []
        hierarchy = self.effective_hierarchy()
        if len(path) >= len(hierarchy):
            return []
        level = hierarchy[len(path)]["key"]
        needle = (filter or "").lower()

        if level == "database":
            rows = self._read_sql(
                """
                SELECT name
                FROM system.databases
                WHERE name NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
                ORDER BY name
                """
            ).to_pylist()
            return [
                CatalogNode(name=row["name"], node_type="namespace", path=[row["name"]])
                for row in rows
                if not needle or needle in row["name"].lower()
            ]

        database = self.database or (path[0] if path else "")
        if not database:
            return []
        rows = self._read_sql(
            """
            SELECT name
            FROM system.tables
            WHERE database = %(database)s
            ORDER BY name
            """,
            {"database": database},
        ).to_pylist()
        return [
            CatalogNode(
                name=row["name"],
                node_type="table",
                path=path + [row["name"]],
                metadata={
                    "_source_name": self._quote_relation(database, row["name"]),
                },
            )
            for row in rows
            if not needle or needle in row["name"].lower()
        ]

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        remaining = list(path)
        database = self.database
        if not database:
            if len(remaining) < 2:
                return {}
            database = remaining.pop(0)
        if not remaining:
            return {}
        table = remaining[0]
        try:
            relation = self._quote_relation(database, table)
            parameters = {"database": database, "table": table}

            columns = self._read_sql(
                """
                SELECT name, type, comment
                FROM system.columns
                WHERE database = %(database)s AND table = %(table)s
                ORDER BY position
                """,
                parameters,
            ).to_pylist()
            column_metadata = []
            for column in columns:
                item = {"name": column["name"], "type": column["type"]}
                if column.get("comment"):
                    item["description"] = column["comment"]
                column_metadata.append(item)

            table_rows = self._read_sql(
                """
                SELECT comment, total_rows
                FROM system.tables
                WHERE database = %(database)s AND name = %(table)s
                """,
                parameters,
            ).to_pylist()
            sample = self._read_sql(f"SELECT * FROM {relation} LIMIT 5")
            result: dict[str, Any] = {
                "columns": column_metadata,
                "sample_rows": df_to_safe_records(sample.to_pandas()),
            }
            if table_rows:
                if table_rows[0].get("comment"):
                    result["description"] = table_rows[0]["comment"]
                if table_rows[0].get("total_rows") is not None:
                    result["row_count"] = int(table_rows[0]["total_rows"])
            return result
        except Exception as exc:
            logger.warning(
                "ClickHouse metadata lookup failed for %s (%s)",
                path,
                type(exc).__name__,
            )
            return {}

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        database, table, _ = self._resolve_source_table(source_table)
        return self.get_metadata(
            [table] if self.database else [database, table]
        )

    def test_connection(self) -> bool:
        try:
            self._read_sql("SELECT 1")
            return True
        except Exception:
            return False
