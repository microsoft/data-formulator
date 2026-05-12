# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Single source of truth for table-name sanitisation across the datalake, API,
data loaders, and DuckDB SQL helpers.

Different call sites historically used slightly different rules (empty-name
fallback, digit prefixes, SQL keywords, allowed punctuation). Use the function
that matches the **consumer**:

* :func:`sanitize_workspace_parquet_table_name` — logical parquet/workspace
  table keys, HTTP ``create-table`` / :mod:`tables_routes` (lowercase,
  ``table_`` prefix for invalid leading characters, empty → ``"table"``).
* :func:`sanitize_upload_stem_table_name` — default table name derived from an
  **upload filename** (``Path.stem``, empty → ``"_unnamed"``, ``_`` prefix for
  leading digits).
* :func:`sanitize_external_loader_table_name` — names produced when ingesting
  from external DB/API sources (empty raises, SQL keyword escape, 63-char cap,
  case preserved).
* :func:`sanitize_duckdb_sql_table_name` — DuckDB view / quoted identifier
  fragments (allows ``.`` and ``$`` in the identifier).

Thin wrappers in :mod:`parquet_utils`, :mod:`file_manager`,
:mod:`data_loader.external_data_loader`, and :mod:`agents.agent_utils_sql`
keep existing import paths stable.
"""

from __future__ import annotations

import re
from pathlib import Path

# SQL keywords that must not be used bare as identifiers (external loader path).
_SQL_KEYWORDS: frozenset[str] = frozenset(
    {
        "SELECT",
        "FROM",
        "WHERE",
        "GROUP",
        "BY",
        "ORDER",
        "HAVING",
        "LIMIT",
        "OFFSET",
        "JOIN",
        "INNER",
        "LEFT",
        "RIGHT",
        "FULL",
        "OUTER",
        "ON",
        "AND",
        "OR",
        "NOT",
        "NULL",
        "TRUE",
        "FALSE",
        "UNION",
        "ALL",
        "DISTINCT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "CREATE",
        "DROP",
        "TABLE",
        "VIEW",
        "INDEX",
        "ALTER",
        "ADD",
        "COLUMN",
        "PRIMARY",
        "KEY",
        "FOREIGN",
        "REFERENCES",
        "CONSTRAINT",
        "DEFAULT",
        "CHECK",
        "UNIQUE",
        "CASCADE",
        "RESTRICT",
    }
)


def sanitize_workspace_parquet_table_name(name: str) -> str:
    """
    Sanitize a user-provided string to a workspace / parquet logical table name.

    Preserves Unicode letters and digits while normalizing whitespace,
    separators, and punctuation to underscores. Result is lowercased.
    Leading digit or other non-identifier start → ``table_`` prefix.
    Empty after cleanup → ``"table"``.
    """
    name = (name or "").strip()
    name = re.sub(r"[/\\]+", "_", name)
    result = re.sub(r"[^\w]+", "_", name, flags=re.UNICODE)
    result = re.sub(r"_+", "_", result).strip("_")

    if not result:
        result = "table"

    if not (result[0].isalpha() or result[0] == "_"):
        result = f"table_{result}"

    return result.lower()


def sanitize_upload_stem_table_name(name: str) -> str:
    """
    Derive a table name from an upload **filename** (extension stripped via
    :meth:`pathlib.PurePath.stem`).

    Empty after cleanup → ``"_unnamed"``. Leading digit → leading ``_``.
    Result is lowercased. Does not treat ``/`` or ``\\`` specially beyond
    :class:`~pathlib.Path` stem behaviour.
    """
    stem = Path(name).stem
    result = re.sub(r"[^\w]+", "_", stem, flags=re.UNICODE)
    result = re.sub(r"_+", "_", result).strip("_")

    if not result:
        result = "_unnamed"

    if not (result[0].isalpha() or result[0] == "_"):
        result = "_" + result

    return result.lower()


def sanitize_external_loader_table_name(name_as: str) -> str:
    """
    Sanitize a table name for external data-loader ingest (parquet in workspace).

    Raises:
        ValueError: if ``name_as`` is empty.

    Strips common SQL comment/injection fragments, normalizes to Unicode
    word tokens, prefixes with ``_`` if the name is a SQL keyword or starts
    with a non-letter (except leading ``_``). Max length 63. Case is preserved.
    """
    if not name_as:
        raise ValueError("Table name cannot be empty")

    name_as = name_as.replace(";", "").replace("--", "").replace("/*", "").replace("*/", "")

    sanitized = re.sub(r"[^\w]+", "_", name_as, flags=re.UNICODE)
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        sanitized = "table"

    if not sanitized[0].isalpha() and sanitized[0] != "_":
        sanitized = "_" + sanitized

    if sanitized.upper() in _SQL_KEYWORDS:
        sanitized = "_" + sanitized

    if len(sanitized) > 63:
        sanitized = sanitized[:63]

    return sanitized


def sanitize_duckdb_sql_table_name(table_name: str) -> str:
    """
    Sanitize a table name for use as a DuckDB view name (quoted identifier).

    Allows ``.`` and ``$`` in the character set. Empty → ``"table"``.
    Invalid leading character → ``table_`` prefix. Case preserved.
    """
    sanitized_name = (table_name or "").strip().replace(" ", "_").replace("-", "_")
    sanitized_name = re.sub(r"[^\w\.$]+", "_", sanitized_name, flags=re.UNICODE)
    sanitized_name = re.sub(r"_+", "_", sanitized_name).strip("_")
    if not sanitized_name:
        sanitized_name = "table"
    if not (sanitized_name[0].isalpha() or sanitized_name[0] == "_"):
        sanitized_name = f"table_{sanitized_name}"
    return sanitized_name


__all__ = [
    "sanitize_workspace_parquet_table_name",
    "sanitize_upload_stem_table_name",
    "sanitize_external_loader_table_name",
    "sanitize_duckdb_sql_table_name",
]
