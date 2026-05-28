"""SQLite data loader — example plugin for Data Formulator.

This file is a complete, working example of a Data Formulator plugin.
SQLite is part of the Python standard library, so this loader has **no
extra dependencies** and is a good template for building your own.

How to install
--------------
1. Make sure Data Formulator runs in single-user mode
   (the default — ``WORKSPACE_BACKEND`` unset or ``local``).
2. Copy this file to ``~/.data_formulator/plugins/`` (or whatever
   directory ``DF_PLUGIN_DIR`` points to).  Filename must end in
   ``_data_loader.py``.
3. Restart Data Formulator.  A new "sqlite" connector should appear
   alongside the built-ins.

How to test it quickly
----------------------
::

    sqlite3 /tmp/demo.db <<'SQL'
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
    INSERT INTO users VALUES (1, 'Alice', 30), (2, 'Bob', 25);
    SQL

Then in DF, add a SQLite connector pointing at ``/tmp/demo.db``.

What this example demonstrates
------------------------------
* Implementing every abstract method on :class:`ExternalDataLoader`.
* Declaring connection params via :meth:`list_params` so the UI
  auto-renders a config form.
* Identifier quoting to avoid SQL-injection in table/column names.
* Returning data directly as a PyArrow Table (no pandas in the hot path).
* Read-only access (``mode=ro`` URI) — the loader never writes to the DB.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from typing import Any
from urllib.parse import quote as _url_quote

import pyarrow as pa

from data_formulator.data_loader.external_data_loader import (
    ExternalDataLoader,
    MAX_IMPORT_ROWS,
)

logger = logging.getLogger(__name__)


def _quote_ident(name: str) -> str:
    """Quote a SQLite identifier safely (table or column name)."""
    return '"' + str(name).replace('"', '""') + '"'


class SQLiteDataLoader(ExternalDataLoader):
    """Read tables from a local SQLite database file."""

    # Override the default title-casing of the registry key ("Sqlite") with
    # a properly-cased product name.  Optional; remove if you don't care.
    DISPLAY_NAME = "SQLite"

    # ------------------------------------------------------------------ #
    # Static metadata: what the UI shows + how to configure              #
    # ------------------------------------------------------------------ #

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {
                "name": "database_path",
                "type": "string",
                "required": True,
                "default": "",
                "tier": "connection",
                "description": "Absolute path to a .db / .sqlite file",
            },
        ]

    @staticmethod
    def auth_instructions() -> str:
        return (
            "**Example:** `/tmp/demo.db`\n\n"
            "Provide the absolute path to a local SQLite database file. "
            "The file must exist and be readable. The loader opens it "
            "read-only — your data is never modified.\n\n"
            "**Create a test DB:**\n"
            "```\nsqlite3 /tmp/demo.db 'CREATE TABLE t(a,b); "
            "INSERT INTO t VALUES (1,2),(3,4);'\n```"
        )

    # ------------------------------------------------------------------ #
    # Connection                                                          #
    # ------------------------------------------------------------------ #

    def __init__(self, params: dict[str, Any]):
        self.params = params or {}
        self.database_path = (self.params.get("database_path") or "").strip()

        if not self.database_path:
            raise ValueError("SQLite database_path is required")
        if not os.path.isfile(self.database_path):
            raise ValueError(f"SQLite database not found: {self.database_path}")

        # Open read-only via URI so we cannot accidentally mutate the DB.
        uri = f"file:{_url_quote(self.database_path)}?mode=ro"
        try:
            self._conn = sqlite3.connect(
                uri, uri=True, check_same_thread=False, isolation_level=None,
            )
        except sqlite3.Error as e:
            raise ValueError(
                f"Failed to open SQLite database '{self.database_path}': {e}"
            ) from e

        self._lock = threading.Lock()
        logger.info("SQLite plugin connected: %s", self.database_path)

    # ------------------------------------------------------------------ #
    # Helpers                                                             #
    # ------------------------------------------------------------------ #

    def _read_sql(self, query: str) -> pa.Table:
        """Run a query and return the result as a PyArrow Table."""
        with self._lock:
            cur = self._conn.execute(query)
            if cur.description is None:
                return pa.table({})
            columns = [d[0] for d in cur.description]
            rows = cur.fetchall()
        # Transpose rows to per-column lists; pyarrow infers types.
        col_data: dict[str, list[Any]] = {c: [] for c in columns}
        for row in rows:
            for col, value in zip(columns, row):
                col_data[col].append(value)
        return pa.table(col_data)

    # ------------------------------------------------------------------ #
    # Required loader API                                                 #
    # ------------------------------------------------------------------ #

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List every table + view in the database."""
        names_tbl = self._read_sql(
            "SELECT name, type FROM sqlite_master "
            "WHERE type IN ('table', 'view') "
            "AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name"
        )
        if names_tbl.num_rows == 0:
            return []

        results: list[dict[str, Any]] = []
        for name in names_tbl.column("name").to_pylist():
            if table_filter and table_filter.lower() not in name.lower():
                continue
            # PRAGMA table_info gives column name + declared type.
            info = self._read_sql(f"PRAGMA table_info({_quote_ident(name)})")
            columns = [
                {"name": n, "type": t or "ANY"}
                for n, t in zip(
                    info.column("name").to_pylist() if info.num_rows else [],
                    info.column("type").to_pylist() if info.num_rows else [],
                )
            ]
            count_tbl = self._read_sql(
                f"SELECT COUNT(*) AS n FROM {_quote_ident(name)}"
            )
            row_count = int(count_tbl.column("n")[0].as_py()) if count_tbl.num_rows else 0
            results.append({
                "name": name,
                "metadata": {"columns": columns, "row_count": row_count},
            })
        return results

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """Fetch rows from ``source_table`` as a PyArrow Table."""
        if not source_table:
            raise ValueError("source_table must be provided")

        opts = import_options or {}
        size = min(int(opts.get("size", MAX_IMPORT_ROWS)), MAX_IMPORT_ROWS)
        sort_columns = opts.get("sort_columns") or []
        sort_order = "DESC" if str(opts.get("sort_order", "asc")).lower() == "desc" else "ASC"

        query = f"SELECT * FROM {_quote_ident(source_table)}"
        if sort_columns:
            order_by = ", ".join(f"{_quote_ident(c)} {sort_order}" for c in sort_columns)
            query += f" ORDER BY {order_by}"
        query += f" LIMIT {int(size)}"

        logger.info("SQLite plugin query: %s", query)
        return self._read_sql(query)
