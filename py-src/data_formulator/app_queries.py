"""Data queries from dashboard apps (design-docs/59).

Apps run untrusted, agent-written code in a sandboxed frame. The host forwards
two kinds of query here, after checking them against the app's manifest:

- ``run_app_sql``: read-only DuckDB SQL over the app's declared workspace tables.
  The statement is validated (one SELECT; only declared tables and the query's
  own CTEs; no table functions) and run on a locked connection that can read
  only those tables' parquet files.
- ``run_app_source_query``: a live, bounded query against a connected source,
  in the data-loading query shape (structured fields or native text the
  connector accepts).
"""

from __future__ import annotations

import json
import threading
from typing import Any

import duckdb

from data_formulator.datalake.parquet_utils import df_to_safe_records

DEFAULT_ROWS = 5_000
MAX_ROWS = 50_000
MAX_PARAMS = 100
MAX_SQL_CHARS = 20_000
QUERY_TIMEOUT_SECONDS = 60


def _row_limit(limit: Any) -> int:
    if limit is None:
        return DEFAULT_ROWS
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_ROWS:
        raise ValueError(f"limit must be an integer from 1 to {MAX_ROWS}")
    return limit


def _walk(node: Any, visit) -> None:
    if isinstance(node, dict):
        visit(node)
        for value in node.values():
            _walk(value, visit)
    elif isinstance(node, list):
        for value in node:
            _walk(value, visit)


def validate_app_sql(sql: Any, tables: list[str]) -> str:
    """Check app SQL reads only the declared tables; return it without a trailing semicolon."""
    if not isinstance(sql, str) or not sql.strip():
        raise ValueError("sql must be a non-empty SELECT statement")
    if len(sql) > MAX_SQL_CHARS:
        raise ValueError(f"sql must be at most {MAX_SQL_CHARS:,} characters")
    try:
        statements = duckdb.extract_statements(sql)
    except duckdb.Error as error:
        raise ValueError(f"SQL syntax error: {error}") from error
    if len(statements) != 1 or statements[0].type != duckdb.StatementType.SELECT:
        raise ValueError("Apps can run exactly one SELECT statement")
    serialized = duckdb.connect(":memory:").execute("SELECT json_serialize_sql(?)", [sql]).fetchone()[0]
    tree = json.loads(serialized)
    if tree.get("error"):
        raise ValueError(f"SQL could not be checked: {tree.get('error_message', 'unknown error')}")

    ctes: set[str] = set()
    references: list[dict[str, Any]] = []
    functions: list[str] = []

    def visit(node: dict[str, Any]) -> None:
        if isinstance(node.get("cte_map"), dict):
            ctes.update(str(entry.get("key", "")).lower() for entry in node["cte_map"].get("map", []))
        if node.get("type") == "BASE_TABLE":
            references.append(node)
        elif node.get("type") == "TABLE_FUNCTION":
            function = node.get("function") or {}
            functions.append(str(function.get("function_name") or "table function"))

    _walk(tree, visit)
    if functions:
        raise ValueError(f"Apps cannot call table functions ({', '.join(sorted(set(functions)))}); "
                         "query the declared tables by name")
    declared = {name.lower() for name in tables}
    for reference in references:
        name = str(reference.get("table_name", ""))
        if reference.get("catalog_name") or reference.get("schema_name"):
            raise ValueError(f"Refer to tables by name only, not {reference.get('schema_name')}.{name}")
        if name.lower() not in declared and name.lower() not in ctes:
            raise ValueError(f"Table {name!r} is not declared in the app manifest. Declared: {', '.join(tables) or 'none'}")
    return sql.strip().rstrip(";").strip()


def _scalar_params(params: Any) -> list[Any]:
    if params is None:
        return []
    if not isinstance(params, list) or len(params) > MAX_PARAMS:
        raise ValueError(f"params must be a list of at most {MAX_PARAMS} values")
    for value in params:
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise ValueError("params must be strings, numbers, booleans, or null")
    return params


def run_app_sql(workspace: Any, tables: Any, sql: Any, params: Any = None, limit: Any = None) -> dict[str, Any]:
    """Run validated app SQL over the declared workspace tables; return rows and truncation."""
    from data_formulator.data_loader.probe_utils import query_memory_limit_mb

    if not isinstance(tables, list) or not tables or not all(isinstance(name, str) and name for name in tables):
        raise ValueError("tables must list the app's declared workspace tables")
    statement = validate_app_sql(sql, tables)
    values = _scalar_params(params)
    rows = _row_limit(limit)
    files = {name: workspace.local_parquet_file(name) for name in dict.fromkeys(tables)}

    connection = duckdb.connect(":memory:")
    timer = threading.Timer(QUERY_TIMEOUT_SECONDS, connection.interrupt)
    try:
        connection.execute(f"SET memory_limit = '{query_memory_limit_mb()}MB'")
        connection.execute("SET threads = 2")
        connection.execute("SET allowed_paths = ?", [[str(path) for path in files.values()]])
        connection.execute("SET enable_external_access = false")
        connection.execute("SET lock_configuration = true")
        for name, path in files.items():
            quoted_name = '"' + name.replace('"', '""') + '"'
            quoted_path = str(path).replace("'", "''")
            connection.execute(f"CREATE VIEW {quoted_name} AS SELECT * FROM read_parquet('{quoted_path}')")
        timer.start()
        try:
            frame = connection.execute(f"SELECT * FROM ({statement}) AS app_query LIMIT {rows + 1}", values).fetchdf()
        except duckdb.InterruptException as error:
            raise ValueError(f"The query took longer than {QUERY_TIMEOUT_SECONDS} seconds; narrow or aggregate it") from error
        except duckdb.Error as error:
            raise ValueError(str(error).split("\n")[0]) from error
    finally:
        timer.cancel()
        connection.close()
    truncated = len(frame) > rows
    frame = frame.head(rows)
    return {"rows": df_to_safe_records(frame), "columns": list(frame.columns), "truncated": truncated}


def run_app_source_query(workspace: Any, connector_id: Any, table_key: Any, query: Any, limit: Any = None) -> dict[str, Any]:
    """Run a bounded live query against a connected source; return rows and truncation."""
    import pyarrow as pa

    from data_formulator.data_connector import resolve_live_loader
    from data_formulator.data_loader.external_data_loader import apply_import_projection
    from data_formulator.data_loader.query_runtime import execute_source_query
    from data_formulator.data_operations.discovery import DataDiscoveryService
    from data_formulator.data_operations.models import LoadQuery

    if not isinstance(connector_id, str) or not connector_id or not isinstance(table_key, str) or not table_key:
        raise ValueError("A source query needs the connected source and table")
    if query is not None and not isinstance(query, dict):
        raise ValueError("query must be an object")
    parsed = LoadQuery.from_dict(query or {})
    rows = _row_limit(parsed.limit if parsed.limit is not None else limit)
    resolved = DataDiscoveryService(workspace).resolve_load_table(connector_id, table_key)
    if resolved is None:
        raise ValueError(f"Table {table_key!r} is not in the catalog of source {connector_id!r}")
    loader = resolve_live_loader(connector_id)
    source_table = resolved["source_table"]
    semantic = loader.query_model(source_table) == "semantic"
    if parsed.native is not None:
        loader.check_native_query(parsed.native)
    if parsed.group_by or parsed.aggregates or parsed.native is not None or semantic:
        table = execute_source_query(loader, "query_data_as_arrow", source_table=source_table,
                                     query=parsed.to_dict(), limit=rows + 1)
    else:
        options: dict[str, Any] = {"size": rows + 1}
        if parsed.filters:
            options["source_filters"] = [item.to_dict() for item in parsed.filters]
        if parsed.columns:
            options["columns"] = list(parsed.columns)
        if parsed.order_by:
            options["sort_columns"] = [item.column for item in parsed.order_by]
            options["sort_order"] = parsed.order_by[0].direction
        table = apply_import_projection(execute_source_query(
            loader, "fetch_data_as_arrow", source_table=source_table, import_options=options), options)
    if not isinstance(table, pa.Table):
        raise TypeError("Connector query must return a table")
    truncated = table.num_rows > rows
    frame = table.slice(0, rows).to_pandas()
    return {"rows": df_to_safe_records(frame), "columns": list(frame.columns), "truncated": truncated}
