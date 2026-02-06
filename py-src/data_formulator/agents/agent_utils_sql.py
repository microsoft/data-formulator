# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
SQL-related utility functions for agents.
These functions are used across multiple agents for DuckDB operations and SQL data summaries.
"""

import re


def sanitize_table_name(table_name: str) -> str:
    """Sanitize table name to be used in SQL queries"""
    # Replace spaces with underscores
    sanitized_name = table_name.replace(" ", "_")
    sanitized_name = sanitized_name.replace("-", "_")
    # Allow alphanumeric, underscore, dot, dash, and dollar sign
    sanitized_name = re.sub(r'[^a-zA-Z0-9_\.$]', '', sanitized_name)
    return sanitized_name


def create_duckdb_conn_with_parquet_views(workspace, input_tables: list[dict]):
    """
    Create an in-memory DuckDB connection with a view for each parquet table in the workspace.
    Input tables are expected to be parquet-backed tables in the datalake (parquet-to-parquet).

    Args:
        workspace: Workspace instance
        input_tables: list of dicts with 'name' key for the table name

    Returns:
        DuckDB connection with views created for all input tables
    """
    import duckdb

    conn = duckdb.connect(":memory:")
    for table in input_tables:
        name = table["name"]
        view_name = sanitize_table_name(name)
        path = workspace.get_parquet_path(name)
        path_escaped = str(path).replace("\\", "\\\\").replace("'", "''")
        conn.execute(f'CREATE VIEW "{view_name}" AS SELECT * FROM read_parquet(\'{path_escaped}\')')
    return conn
