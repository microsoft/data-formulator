# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Data routes for the Superset plugin.

Migrated from 0.6 ``superset/data_routes.py`` with:
- **PluginDataWriter** replaces DuckDB ``db_manager``
- Plugin-namespaced session helpers
- Routes under ``/api/plugins/superset/data/``
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import pandas as pd
from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context
from requests.exceptions import HTTPError

from data_formulator.plugins.data_writer import PluginDataWriter
from data_formulator.plugins.superset.session_helpers import (
    require_auth,
    try_refresh,
)
from data_formulator.security.sanitize import safe_error_response, sanitize_error_message

logger = logging.getLogger(__name__)

data_bp = Blueprint(
    "plugin_superset_data",
    __name__,
    url_prefix="/api/plugins/superset/data",
)


# ------------------------------------------------------------------
# SQL building helpers (lifted from 0.6)
# ------------------------------------------------------------------

def _sanitize_table_name(raw: str) -> str:
    """Normalize a raw table name to a safe identifier."""
    name = (raw or "").lower().replace("-", "_").replace(" ", "_")
    name = re.sub(r"[^\w]", "_", name, flags=re.UNICODE)
    name = re.sub(r"_+", "_", name).strip("_")
    if not name or not name[0].isalpha():
        name = f"table_{name}"
    return name


def _quote_identifier(name: str) -> str:
    escaped = (name or "").replace('"', '""')
    return f'"{escaped}"'


def _column_ref(name: str) -> str:
    stripped = (name or "").strip()
    if re.fullmatch(r"\w+", stripped, flags=re.UNICODE):
        return stripped
    return _quote_identifier(stripped)


def _sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def _build_dataset_sql(detail: dict) -> tuple[int, str, str]:
    db_id = detail["database"]["id"]
    table_name = detail["table_name"]
    schema = detail.get("schema", "") or ""
    dataset_sql = (detail.get("sql") or "").strip()
    dataset_kind = (detail.get("kind") or "").lower()

    if dataset_kind == "virtual" and dataset_sql:
        return db_id, schema, f"SELECT * FROM ({dataset_sql.rstrip(';')}) AS _vds"

    prefix = f'"{schema}".' if schema else ""
    return db_id, schema, f'SELECT * FROM {prefix}"{table_name}"'


def _build_column_map(detail: dict) -> dict[str, str]:
    """Build a mapping: any known column identifier → actual SQL column reference.

    Superset columns can be referenced by column_name, name, verbose_name,
    or expression.  The SQL-safe reference is always the ``column_name``
    (the physical name in the database).

    Lookups are case-insensitive: lowercase variants of every key are also
    stored so that ``column_map.get(name)`` works regardless of casing
    differences between Superset metadata fields (e.g. ``main_dttm_col``
    may be upper-case while the physical column is lower-case).
    """
    col_map: dict[str, str] = {}

    for col in (detail.get("columns") or []):
        physical = (col.get("column_name") or col.get("name") or "").strip()
        if not physical:
            continue
        col_map[physical] = physical
        for alias_key in ("name", "verbose_name"):
            alias = (col.get(alias_key) or "").strip()
            if alias and alias not in col_map:
                col_map[alias] = physical
        expr = (col.get("expression") or "").strip()
        if expr and expr not in col_map:
            col_map[expr] = physical

    main_dttm = (detail.get("main_dttm_col") or "").strip()
    if main_dttm and main_dttm not in col_map:
        # First try: case-insensitive match against column_name
        matched = False
        for col in (detail.get("columns") or []):
            cn = (col.get("column_name") or col.get("name") or "").strip()
            if cn.lower() == main_dttm.lower():
                col_map[main_dttm] = cn
                matched = True
                break
        if not matched:
            # main_dttm_col refers to a source-table column that doesn't
            # appear in the virtual dataset output (e.g. "TS" is used inside
            # the SQL as bl.TS but the output is aliased to "出库日期").
            # Fall back to the first column marked is_dttm=True.
            for col in (detail.get("columns") or []):
                if col.get("is_dttm"):
                    cn = (col.get("column_name") or col.get("name") or "").strip()
                    if cn:
                        col_map[main_dttm] = cn
                        matched = True
                        break
        if not matched:
            # Last resort: look for a column whose type looks like a date
            for col in (detail.get("columns") or []):
                col_type = (col.get("type") or "").upper()
                if any(kw in col_type for kw in ("DATE", "TIME", "TIMESTAMP", "DATETIME")):
                    cn = (col.get("column_name") or col.get("name") or "").strip()
                    if cn:
                        col_map[main_dttm] = cn
                        matched = True
                        break
        if not matched:
            logger.warning(
                "main_dttm_col=%r does not match any dataset column; "
                "filters using this name will be rejected.",
                main_dttm,
            )

    for metric in (detail.get("metrics") or []):
        for key in ("metric_name", "verbose_name"):
            val = (metric.get(key) or "").strip()
            expr = (metric.get("expression") or "").strip()
            if val and val not in col_map:
                col_map[val] = expr if expr else val

    lower_extras: dict[str, str] = {}
    for k, v in col_map.items():
        lk = k.lower()
        if lk not in col_map and lk not in lower_extras:
            lower_extras[lk] = v
    col_map.update(lower_extras)

    return col_map


def _resolve_column(column: str, column_map: dict[str, str]) -> str | None:
    """Look up a filter column in the map, with case-insensitive fallback."""
    return column_map.get(column) or column_map.get(column.lower())


def _build_where_clauses(filters: list[dict], column_map: dict[str, str]) -> list[str]:
    clauses: list[str] = []
    allowed_ops = {
        "IN", "NOT_IN", "EQ", "NEQ", "GT", "GTE", "LT", "LTE",
        "BETWEEN", "LIKE", "ILIKE", "IS_NULL", "IS_NOT_NULL",
    }
    compare_op_map = {
        "EQ": "=", "NEQ": "!=", "GT": ">", "GTE": ">=",
        "LT": "<", "LTE": "<=", "LIKE": "LIKE", "ILIKE": "ILIKE",
    }

    for raw_filter in filters:
        if not isinstance(raw_filter, dict):
            raise ValueError("Invalid filter payload")
        column = (raw_filter.get("column") or raw_filter.get("column_name") or "").strip()
        operator = str(raw_filter.get("operator") or "").upper()
        value = raw_filter.get("value")
        if not column or operator not in allowed_ops:
            raise ValueError(f"Invalid filter definition: {raw_filter}")
        physical = _resolve_column(column, column_map)
        if not physical:
            raise ValueError(f"Unknown filter column: {column}")

        quoted_column = _column_ref(physical)
        if operator == "IS_NULL":
            clauses.append(f"{quoted_column} IS NULL")
            continue
        if operator == "IS_NOT_NULL":
            clauses.append(f"{quoted_column} IS NOT NULL")
            continue
        if operator in {"IN", "NOT_IN"}:
            values = value if isinstance(value, list) else [value]
            values = [v for v in values if v not in (None, "")]
            if not values:
                continue
            joined = ", ".join(_sql_literal(v) for v in values)
            keyword = "NOT IN" if operator == "NOT_IN" else "IN"
            clauses.append(f"{quoted_column} {keyword} ({joined})")
            continue
        if operator == "BETWEEN":
            if not isinstance(value, list) or len(value) != 2:
                raise ValueError(f"BETWEEN requires two values for column {column}")
            if value[0] in (None, "") or value[1] in (None, ""):
                continue
            clauses.append(
                f"{quoted_column} BETWEEN {_sql_literal(value[0])} AND {_sql_literal(value[1])}"
            )
            continue

        if value in (None, ""):
            continue
        if operator in {"LIKE", "ILIKE"}:
            text_value = str(value)
            if "%" not in text_value and "_" not in text_value:
                text_value = f"%{text_value}%"
            clauses.append(f"{quoted_column} {compare_op_map[operator]} {_sql_literal(text_value)}")
            continue
        clauses.append(f"{quoted_column} {compare_op_map[operator]} {_sql_literal(value)}")

    return clauses


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@data_bp.route("/load-dataset", methods=["POST"])
def load_dataset():
    """Fetch data from Superset (RBAC + RLS) and write into the user's Workspace.

    Supports streaming progress via ``"stream": true`` in the request body.
    """
    token, user = require_auth()
    if not user:
        return jsonify({"status": "error", "message": "Not authenticated"}), 401
    if not token:
        return jsonify({"status": "error", "message": "Loading data requires login. Please sign in first."}), 401

    data = request.get_json(force=True)
    dataset_id = data.get("dataset_id")
    row_limit = int(data.get("row_limit", 20_000))
    stream_mode = bool(data.get("stream", False))
    table_name_override = (data.get("table_name") or "").strip()
    filters = data.get("filters") or []

    if not dataset_id:
        return jsonify({"status": "error", "message": "dataset_id required"}), 400

    superset_client = current_app.extensions["plugin_superset_client"]

    try:
        detail = superset_client.get_dataset_detail(token, dataset_id)
    except HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 401:
            token = try_refresh()
            if token:
                try:
                    detail = superset_client.get_dataset_detail(token, dataset_id)
                except Exception as retry_err:
                    logger.warning("Auth retry failed for dataset %s: %s", dataset_id, retry_err)
                    return jsonify({"status": "error", "message": "Authentication failed"}), 401
            else:
                return jsonify({"status": "error", "message": "Authentication expired, please log in again"}), 401
        else:
            return safe_error_response(exc, 502, log_message="Failed to fetch dataset detail")
    except Exception as exc:
        return safe_error_response(exc, 500, log_message="Failed to fetch dataset detail")

    db_id, schema, base_sql = _build_dataset_sql(detail)
    table_name = detail["table_name"]
    column_map = _build_column_map(detail)
    logger.info(
        "Dataset %s columns raw: %s",
        dataset_id,
        [(c.get("column_name"), c.get("name"), c.get("verbose_name"),
          c.get("expression"), c.get("is_dttm"), c.get("type"))
         for c in (detail.get("columns") or [])],
    )
    logger.info("Dataset %s main_dttm_col=%s", dataset_id, detail.get("main_dttm_col"))
    logger.info("Dataset %s column_map=%s", dataset_id, column_map)
    try:
        where_clauses = _build_where_clauses(filters, column_map)
    except ValueError as exc:
        return safe_error_response(exc, 400, log_message="Invalid filter definition")

    final_table_name = _sanitize_table_name(table_name_override or table_name)
    writer = PluginDataWriter("superset")

    def _generate():
        try:
            sql_session = superset_client.create_sql_session(token)
            where_sql = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
            full_sql = f"SELECT * FROM ({base_sql}) AS _src{where_sql} LIMIT {row_limit}"
            logger.info(
                "Superset load dataset_id=%s filters=%s sql=%s",
                dataset_id, filters, full_sql,
            )
            result = superset_client.execute_sql_with_session(
                sql_session, db_id, full_sql, schema, row_limit,
            )
            all_rows = result.get("data", []) or []
            columns = [c.get("column_name", c.get("name", "")) for c in result.get("columns", [])]

            if stream_mode:
                yield json.dumps({
                    "type": "progress",
                    "loaded_batches": 1,
                    "total_loaded_rows": len(all_rows),
                }, ensure_ascii=False) + "\n"

            write_result: dict[str, Any] = {}
            if all_rows:
                df = pd.DataFrame(all_rows)
                write_result = writer.write_dataframe(
                    df,
                    final_table_name,
                    source_metadata={
                        "plugin": "superset",
                        "dataset_id": dataset_id,
                        "filters": filters,
                        "row_limit": row_limit,
                    },
                )
            else:
                write_result = {
                    "table_name": final_table_name,
                    "row_count": 0,
                    "columns": [],
                    "is_renamed": False,
                }

            done_payload = {
                "status": "ok",
                "table_name": write_result.get("table_name", final_table_name),
                "row_count": write_result.get("row_count", 0),
                "columns": columns,
            }

            if stream_mode:
                yield json.dumps({"type": "done", **done_payload}, ensure_ascii=False) + "\n"
            else:
                yield json.dumps(done_payload, ensure_ascii=False)

        except Exception as exc:
            logger.error("Failed to load dataset %s: %s", dataset_id, exc, exc_info=True)
            err = {"status": "error", "message": sanitize_error_message(str(exc))}
            if stream_mode:
                yield json.dumps({"type": "error", **err}, ensure_ascii=False) + "\n"
            else:
                yield json.dumps(err, ensure_ascii=False)

    if stream_mode:
        return Response(
            stream_with_context(_generate()),
            content_type="text/x-ndjson; charset=utf-8",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    payload_text = "".join(_generate())
    parsed = json.loads(payload_text)
    status_code = 500 if parsed.get("status") == "error" else 200
    return Response(payload_text, status=status_code, content_type="application/json")
