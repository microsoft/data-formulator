# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import logging
import sys
import os
import mimetypes
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
import json
import traceback
from flask import request, jsonify, Blueprint, Response
import pandas as pd
from pathlib import Path
from data_formulator.data_loader import DATA_LOADERS, DISABLED_LOADERS
from data_formulator.auth import get_identity_id
from data_formulator.datalake.workspace import Workspace
from data_formulator.workspace_factory import get_workspace as _create_workspace
from data_formulator.datalake.parquet_utils import sanitize_table_name as parquet_sanitize_table_name, safe_data_filename
from data_formulator.datalake.file_manager import save_uploaded_file, is_supported_file, normalize_text_encoding
from data_formulator.datalake.metadata import TableMetadata as DatalakeTableMetadata, ColumnInfo

import re

# Get logger for this module (logging config done in app.py)
logger = logging.getLogger(__name__)

import os

tables_bp = Blueprint('tables', __name__, url_prefix='/api/tables')


def _get_workspace():
    """Get workspace for the current identity."""
    return _create_workspace(get_identity_id())


# Row-count threshold above which we use DuckDB for parquet tables
# (avoids loading the entire file into memory via pandas).
_LARGE_TABLE_THRESHOLD = 100_000


def _should_use_duckdb(workspace, table_name: str) -> bool:
    """Return True if the table is a large parquet file that benefits from DuckDB.

    Small parquet tables are faster to handle with pandas (avoids DuckDB
    connection overhead and repeated YAML reads).
    """
    meta = workspace.get_table_metadata(table_name)
    if meta is None or meta.file_type != "parquet":
        return False
    row_count = meta.row_count or 0
    return row_count > _LARGE_TABLE_THRESHOLD


def _quote_duckdb(col: str) -> str:
    """Quote identifier for DuckDB (double quotes, escape internal quotes)."""
    return '"' + str(col).replace('"', '""') + '"'


def _dedup_dataframe_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Remove duplicate columns from a DataFrame, keeping the first occurrence."""
    if df.columns.duplicated().any():
        return df.loc[:, ~df.columns.duplicated()]
    return df


def _dedup_list(items: list) -> list:
    """Remove duplicates from a list while preserving order."""
    return list(dict.fromkeys(items))


def _build_parquet_sample_sql(
    columns: list[str],
    aggregate_fields_and_functions: list,
    select_fields: list,
    method: str,
    order_by_fields: list,
    sample_size: int,
) -> tuple[str, str]:
    """
    Build DuckDB SQL for sampling (and optional aggregation) over parquet.
    Returns (main_sql, count_sql) where each contains {parquet} placeholder.
    """
    valid_agg = [(f, fn) for (f, fn) in aggregate_fields_and_functions if f is None or f in columns]
    valid_select = _dedup_list([f for f in select_fields if f in columns])
    valid_order = [f for f in order_by_fields if f in columns]

    if valid_agg:
        select_parts = []
        for field, function in valid_agg:
            fn = function.lower()
            if field is None and fn == "count":
                select_parts.append("COUNT(*) AS _count")
            elif field in columns:
                q = _quote_duckdb(field)
                if fn == "count":
                    select_parts.append(f"COUNT({q}) AS _count")
                elif fn in ("avg", "average", "mean"):
                    select_parts.append(f"AVG({q}) AS {_quote_duckdb(field + '_' + function)}")
                elif fn == "sum":
                    select_parts.append(f"SUM({q}) AS {_quote_duckdb(field + '_sum')}")
                elif fn == "min":
                    select_parts.append(f"MIN({q}) AS {_quote_duckdb(field + '_min')}")
                elif fn == "max":
                    select_parts.append(f"MAX({q}) AS {_quote_duckdb(field + '_max')}")
        for f in valid_select:
            select_parts.append(f"t.{_quote_duckdb(f)}")
        group_cols = valid_select
        group_by = f" GROUP BY {', '.join('t.' + _quote_duckdb(c) for c in group_cols)}" if group_cols else ""
        inner = f"SELECT {', '.join(select_parts)} FROM {{parquet}} AS t{group_by}"
        count_sql = f"SELECT COUNT(*) FROM ({inner}) AS sub"
        if method == "random":
            order_by = " ORDER BY RANDOM()"
        elif method == "head" and valid_order:
            order_by = " ORDER BY " + ", ".join(f"sub.{_quote_duckdb(c)} ASC" for c in valid_order)
        elif method == "bottom" and valid_order:
            order_by = " ORDER BY " + ", ".join(f"sub.{_quote_duckdb(c)} DESC" for c in valid_order)
        else:
            order_by = ""
        main_sql = f"SELECT * FROM ({inner}) AS sub{order_by} LIMIT {sample_size}"
        return main_sql, count_sql

    count_sql = "SELECT COUNT(*) FROM {parquet} AS t"
    if method == "random":
        order_by = " ORDER BY RANDOM()"
    elif method == "head" and valid_order:
        order_by = " ORDER BY " + ", ".join(f"t.{_quote_duckdb(c)} ASC" for c in valid_order)
    elif method == "bottom" and valid_order:
        order_by = " ORDER BY " + ", ".join(f"t.{_quote_duckdb(c)} DESC" for c in valid_order)
    else:
        order_by = ""
    if valid_select:
        select_list = ", ".join(f"t.{_quote_duckdb(c)}" for c in valid_select)
        main_sql = f"SELECT {select_list} FROM {{parquet}} AS t{order_by} LIMIT {sample_size}"
    else:
        main_sql = f"SELECT * FROM {{parquet}} AS t{order_by} LIMIT {sample_size}"
    return main_sql, count_sql


def _table_metadata_to_source_metadata(meta: DatalakeTableMetadata) -> dict | None:
    """Convert workspace TableMetadata to API source_metadata dict (for refresh)."""
    if meta.loader_type is None and meta.loader_params is None:
        return None
    return {
        "table_name": meta.name,
        "data_loader_type": meta.loader_type or "",
        "data_loader_params": meta.loader_params or {},
        "source_table_name": meta.source_table,
        "source_query": meta.source_query,
        "last_refreshed": meta.last_synced.isoformat() if meta.last_synced else None,
        "content_hash": meta.content_hash,
    }


@tables_bp.route('/open-workspace', methods=['POST'])
def open_workspace():
    """Open the Data Formulator home directory in the system file manager."""
    from flask import current_app
    from data_formulator.datalake.workspace import get_data_formulator_home
    import subprocess, platform

    if current_app.config.get('CLI_ARGS', {}).get('disable_database', False):
        return jsonify(status="error", message="Workspace access is disabled"), 403

    try:
        home_path = str(get_data_formulator_home())
        # Ensure directory exists
        Path(home_path).mkdir(parents=True, exist_ok=True)
        system = platform.system()
        if system == "Darwin":
            subprocess.Popen(["open", home_path])
        elif system == "Windows":
            subprocess.Popen(["explorer", home_path])
        else:
            subprocess.Popen(["xdg-open", home_path])
        return jsonify(status="ok", path=home_path)
    except Exception as e:
        logger.error(f"Failed to open workspace: {e}")
        return jsonify(status="error", message=str(e)), 500


@tables_bp.route('/list-tables', methods=['GET'])
def list_tables():
    """List all tables in the current workspace (datalake)."""
    try:
        workspace = _get_workspace()
        result = []
        for table_name in workspace.list_tables():
            try:
                meta = workspace.get_table_metadata(table_name)
                if meta is None:
                    continue
                columns = [{"name": c.name, "type": c.dtype} for c in (meta.columns or [])]
                if not columns and meta.file_type == "parquet":
                    try:
                        schema_info = workspace.get_parquet_schema(table_name)
                        columns = [{"name": c["name"], "type": c["type"]} for c in schema_info.get("columns", [])]
                    except Exception:
                        pass
                if not columns:
                    try:
                        df = workspace.read_data_as_df(table_name)
                        columns = [{"name": str(c), "type": str(df[c].dtype)} for c in df.columns]
                    except Exception:
                        pass
                row_count = meta.row_count
                if row_count is None and meta.file_type == "parquet":
                    try:
                        schema_info = workspace.get_parquet_schema(table_name)
                        row_count = schema_info.get("num_rows", 0) or 0
                    except Exception:
                        row_count = 0
                if row_count is None:
                    try:
                        df = workspace.read_data_as_df(table_name)
                        row_count = len(df)
                    except Exception:
                        row_count = 0
                sample_rows = []
                if row_count > 0:
                    try:
                        if _should_use_duckdb(workspace, table_name):
                            df = workspace.run_parquet_sql(table_name, "SELECT * FROM {parquet} AS t LIMIT 1000")
                        else:
                            df = workspace.read_data_as_df(table_name)
                            df = df.head(1000)
                        df = _dedup_dataframe_columns(df)
                        sample_rows = json.loads(df.to_json(orient='records', date_format='iso'))
                    except Exception:
                        pass
                source_metadata = _table_metadata_to_source_metadata(meta)
                result.append({
                    "name": table_name,
                    "columns": columns,
                    "row_count": row_count,
                    "sample_rows": sample_rows,
                    "view_source": None,
                    "source_metadata": source_metadata,
                })
            except Exception as e:
                logger.error(f"Error getting table metadata for {table_name}: {str(e)}")
                continue
        return jsonify({"status": "success", "tables": result})
    except Exception as e:
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code
        

def _apply_aggregation_and_sample(
    df: pd.DataFrame,
    aggregate_fields_and_functions: list,
    select_fields: list,
    method: str,
    order_by_fields: list,
    sample_size: int,
) -> tuple[pd.DataFrame, int]:
    """
    Apply aggregation (optional), then sample with ordering.
    Returns (sampled_df, total_row_count_after_aggregation).
    """
    columns = list(df.columns)
    valid_agg = [
        (f, fn) for (f, fn) in aggregate_fields_and_functions
        if f is None or f in columns
    ]
    valid_select = _dedup_list([f for f in select_fields if f in columns])
    valid_order = [f for f in order_by_fields if f in columns]

    if valid_agg:
        group_cols = valid_select
        agg_spec = {}
        for field, function in valid_agg:
            fn = function.lower()
            if field is None and fn == "count":
                agg_spec["_count"] = ("__size__", "size")
            elif field in columns:
                if fn == "count":
                    agg_spec["_count"] = (field, "count")
                elif fn in ("avg", "average", "mean"):
                    agg_spec[f"{field}_{function}"] = (field, "mean")
                elif fn == "sum":
                    agg_spec[f"{field}_sum"] = (field, "sum")
                elif fn == "min":
                    agg_spec[f"{field}_min"] = (field, "min")
                elif fn == "max":
                    agg_spec[f"{field}_max"] = (field, "max")
        if "_count" in agg_spec and agg_spec["_count"] == ("__size__", "size"):
            df = df.assign(__size__=1)
            agg_spec["_count"] = ("__size__", "count")
        if group_cols:
            df_agg = df.groupby(group_cols, dropna=False).agg(**{k: (c, f) for k, (c, f) in agg_spec.items()}).reset_index()
        else:
            df_agg = pd.DataFrame([{k: df[c].agg(f) for k, (c, f) in agg_spec.items()}])
        total_row_count = len(df_agg)
        work = df_agg
    else:
        total_row_count = len(df)
        work = df[valid_select].copy() if valid_select else df.copy()

    if method == "random":
        work = work.sample(n=min(sample_size, len(work)), random_state=None)
    elif method == "head":
        work = work.sort_values(by=valid_order, ascending=True).head(sample_size) if valid_order else work.head(sample_size)
    elif method == "bottom":
        work = work.sort_values(by=valid_order, ascending=False).head(sample_size) if valid_order else work.tail(sample_size).iloc[::-1].reset_index(drop=True)
    else:
        work = work.head(sample_size)
    return work, total_row_count


@tables_bp.route('/sample-table', methods=['POST'])
def sample_table():
    """Sample a table from the workspace. Uses DuckDB for parquet (no full load)."""
    try:
        data = request.get_json()
        table_id = data.get('table')
        sample_size = data.get('size', 1000)
        aggregate_fields_and_functions = data.get('aggregate_fields_and_functions', [])
        select_fields = data.get('select_fields', [])
        method = data.get('method', 'random')
        order_by_fields = data.get('order_by_fields', [])

        workspace = _get_workspace()
        if _should_use_duckdb(workspace, table_id):
            schema_info = workspace.get_parquet_schema(table_id)
            columns = [c["name"] for c in schema_info.get("columns", [])]
            main_sql, count_sql = _build_parquet_sample_sql(
                columns,
                aggregate_fields_and_functions,
                select_fields,
                method,
                order_by_fields,
                sample_size,
            )
            total_row_count = int(workspace.run_parquet_sql(table_id, count_sql).iloc[0, 0])
            result_df = workspace.run_parquet_sql(table_id, main_sql)
        else:
            df = workspace.read_data_as_df(table_id)
            result_df, total_row_count = _apply_aggregation_and_sample(
                df,
                aggregate_fields_and_functions,
                select_fields,
                method,
                order_by_fields,
                sample_size,
            )
        result_df = _dedup_dataframe_columns(result_df)
        rows_json = json.loads(result_df.to_json(orient='records', date_format='iso'))
        return jsonify({
            "status": "success",
            "rows": rows_json,
            "total_row_count": total_row_count,
        })
    except Exception as e:
        logger.error(f"Error sampling table: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code

@tables_bp.route('/get-table', methods=['GET'])
def get_table_data():
    """Get data from a specific table in the workspace. Uses DuckDB for parquet (LIMIT/OFFSET only)."""
    try:
        table_name = request.args.get('table_name')
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 100))
        offset = (page - 1) * page_size

        if not table_name:
            return jsonify({"status": "error", "message": "Table name is required"}), 400

        workspace = _get_workspace()
        if _should_use_duckdb(workspace, table_name):
            count_df = workspace.run_parquet_sql(table_name, "SELECT COUNT(*) FROM {parquet} AS t")
            total_rows = int(count_df.iloc[0, 0])
            page_df = workspace.run_parquet_sql(
                table_name,
                f"SELECT * FROM {{parquet}} AS t LIMIT {page_size} OFFSET {offset}",
            )
            page_df = _dedup_dataframe_columns(page_df)
            columns = list(page_df.columns)
            rows = json.loads(page_df.to_json(orient='records', date_format='iso'))
        else:
            df = workspace.read_data_as_df(table_name)
            df = _dedup_dataframe_columns(df)
            total_rows = len(df)
            columns = list(df.columns)
            page_df = df.iloc[offset : offset + page_size]
            rows = json.loads(page_df.to_json(orient='records', date_format='iso'))

        return jsonify({
            "status": "success",
            "table_name": table_name,
            "columns": columns,
            "rows": rows,
            "total_rows": total_rows,
            "page": page,
            "page_size": page_size,
        })
    except Exception as e:
        logger.error(f"Error getting table data: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code

@tables_bp.route('/create-table', methods=['POST'])
def create_table():
    """Create a new table from uploaded file or raw data in the workspace."""
    try:
        has_file = 'file' in request.files
        has_raw_data = 'raw_data' in request.files or 'raw_data' in request.form
        if not has_file and not has_raw_data:
            return jsonify({"status": "error", "message": "No file or raw data provided"}), 400

        table_name = request.form.get('table_name')
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400

        workspace = _get_workspace()
        sanitized_table_name = parquet_sanitize_table_name(table_name)
        replace_source = request.form.get('replace_source', '').lower() == 'true'

        if has_file:
            file = request.files['file']
            if not file.filename or not is_supported_file(file.filename):
                return jsonify({"status": "error", "message": "Unsupported file format"}), 400
            try:
                safe_name = safe_data_filename(file.filename)
            except ValueError:
                return jsonify({"status": "error", "message": "Invalid filename"}), 400

            if replace_source:
                workspace.delete_tables_by_source_file(safe_name)

            meta = save_uploaded_file(
                workspace,
                file.stream,
                safe_name,
                table_name=sanitized_table_name,
                overwrite=True,
            )
            sanitized_table_name = meta.name
            row_count = meta.row_count
            columns = [c.name for c in (meta.columns or [])]
            if row_count is None or not columns:
                df = workspace.read_data_as_df(sanitized_table_name)
                row_count = len(df)
                columns = list(df.columns)
                meta.row_count = row_count
                meta.columns = [
                    ColumnInfo(name=str(c), dtype=str(df[c].dtype))
                    for c in df.columns
                ]
                workspace.add_table_metadata(meta)
        else:
            # raw_data can come as a file upload (Blob) or as a form field
            if 'raw_data' in request.files:
                raw_data = request.files['raw_data'].read().decode('utf-8')
            else:
                raw_data = request.form.get('raw_data')
            try:
                df = pd.DataFrame(json.loads(raw_data))
            except Exception as e:
                return jsonify({"status": "error", "message": f"Invalid JSON data: {str(e)}, it must be a list of dictionaries"}), 400
            workspace.write_parquet(df, sanitized_table_name)
            row_count = len(df)
            columns = list(df.columns)

        return jsonify({
            "status": "success",
            "table_name": sanitized_table_name,
            "row_count": row_count,
            "columns": columns,
        })
    except Exception as e:
        logger.error(f"Error creating table: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


@tables_bp.route('/parse-file', methods=['POST'])
def parse_file():
    """Parse an uploaded file and return data as JSON without saving to workspace.

    Used for client-side preview of formats that the browser cannot parse
    natively (e.g. legacy .xls).
    """
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "No file provided"}), 400

        file = request.files['file']
        filename = file.filename or ''
        if not filename or not is_supported_file(filename):
            return jsonify({"status": "error", "message": "Unsupported file format"}), 400

        ext = os.path.splitext(filename)[1].lower()

        if ext in ('.xls', '.xlsx'):
            engine = 'xlrd' if ext == '.xls' else 'openpyxl'
            xls = pd.ExcelFile(file.stream, engine=engine)
            sheets = []
            for sheet_name in xls.sheet_names:
                df = xls.parse(sheet_name)
                df = df.where(df.notna(), None)
                records = df.to_dict(orient='records')
                sheets.append({
                    "sheet_name": sheet_name,
                    "columns": list(df.columns),
                    "row_count": len(records),
                    "data": records,
                })
            return jsonify({"status": "success", "sheets": sheets})
        elif ext == '.csv':
            import io
            raw = normalize_text_encoding(file.stream.read(), 'csv')
            df = pd.read_csv(io.BytesIO(raw))
            df = df.where(df.notna(), None)
            records = df.to_dict(orient='records')
            return jsonify({
                "status": "success",
                "sheets": [{
                    "sheet_name": "Sheet1",
                    "columns": list(df.columns),
                    "row_count": len(records),
                    "data": records,
                }],
            })
        else:
            return jsonify({"status": "error", "message": f"Server-side parsing not supported for {ext}"}), 400

    except Exception as e:
        logger.error("Error parsing file", exc_info=True)
        return jsonify({"status": "error", "message": str(e)}), 400


@tables_bp.route('/sync-table-data', methods=['POST'])
def sync_table_data():
    """Update an existing workspace table's parquet with new row data.
    
    Used when the frontend has fresher data than the workspace (e.g., from stream refresh)
    and needs to sync it so sandbox code reads the latest data.
    """
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        rows = data.get('rows')

        if not table_name:
            return jsonify({"status": "error", "message": "table_name is required"}), 400
        if rows is None:
            return jsonify({"status": "error", "message": "rows is required"}), 400

        workspace = _get_workspace()

        if table_name not in workspace.list_tables():
            return jsonify({"status": "error", "message": f"Table '{table_name}' not found in workspace"}), 404

        df = pd.DataFrame(rows) if rows else pd.DataFrame()
        workspace.write_parquet(df, table_name)

        return jsonify({
            "status": "success",
            "table_name": table_name,
            "row_count": len(df),
        })
    except Exception as e:
        logger.error(f"Error syncing table data: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


@tables_bp.route('/delete-table', methods=['POST'])
def drop_table():
    """Drop a table from the workspace."""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400

        workspace = _get_workspace()
        if not workspace.delete_table(table_name):
            return jsonify({"status": "error", "message": f"Table '{table_name}' does not exist"}), 404
        return jsonify({"status": "success", "message": f"Table {table_name} dropped"})
    except Exception as e:
        logger.error(f"Error dropping table: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


@tables_bp.route('/upload-db-file', methods=['POST'])
def upload_db_file():
    """No longer used: storage is workspace/datalake, not DuckDB. Kept for API compatibility."""
    return jsonify({
        "status": "error",
        "message": "Database file upload is no longer supported. Data is stored in the workspace; use create-table with a file or data loaders to add data.",
    }), 410


@tables_bp.route('/download-db-file', methods=['GET'])
def download_db_file():
    """No longer used: storage is workspace/datalake. Kept for API compatibility."""
    return jsonify({
        "status": "error",
        "message": "Database file download is no longer supported. Data lives in the workspace.",
    }), 410


@tables_bp.route('/reset-db-file', methods=['POST'])
def reset_db_file():
    """Reset the workspace for the current session (removes all tables and files)."""
    try:
        workspace = _get_workspace()
        workspace.cleanup()
        return jsonify({"status": "success", "message": "Workspace reset successfully"})
    except Exception as e:
        logger.error(f"Error resetting workspace: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code

def _is_numeric_duckdb_type(col_type: str) -> bool:
    """Return True if DuckDB/parquet type is numeric for min/max/avg."""
    t = (col_type or "").upper()
    return any(
        t.startswith(k) for k in ("INT", "BIGINT", "SMALLINT", "TINYINT", "DOUBLE", "FLOAT", "REAL", "DECIMAL", "NUMERIC")
    )


@tables_bp.route('/analyze', methods=['POST'])
def analyze_table():
    """Get basic statistics about a table in the workspace. Uses DuckDB for parquet (no full load)."""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        if not table_name:
            return jsonify({"status": "error", "message": "No table name provided"}), 400

        workspace = _get_workspace()
        if _should_use_duckdb(workspace, table_name):
            schema_info = workspace.get_parquet_schema(table_name)
            col_infos = schema_info.get("columns", [])
            stats = []
            for col_info in col_infos:
                col_name = col_info["name"]
                col_type = col_info.get("type", "")
                q = _quote_duckdb(col_name)
                if _is_numeric_duckdb_type(col_type):
                    sql = (
                        f"SELECT COUNT(*) AS count, COUNT(DISTINCT t.{q}) AS unique_count, "
                        f"COUNT(*) - COUNT(t.{q}) AS null_count, "
                        f"MIN(t.{q}) AS min_val, MAX(t.{q}) AS max_val, AVG(t.{q}) AS avg_val "
                        f"FROM {{parquet}} AS t"
                    )
                    df = workspace.run_parquet_sql(table_name, sql)
                    row = df.iloc[0]
                    stats_dict = {
                        "count": int(row["count"]),
                        "unique_count": int(row["unique_count"]),
                        "null_count": int(row["null_count"]),
                        "min": float(row["min_val"]) if row["min_val"] is not None else None,
                        "max": float(row["max_val"]) if row["max_val"] is not None else None,
                        "avg": float(row["avg_val"]) if row["avg_val"] is not None else None,
                    }
                else:
                    sql = (
                        f"SELECT COUNT(*) AS count, COUNT(DISTINCT t.{q}) AS unique_count, "
                        f"COUNT(*) - COUNT(t.{q}) AS null_count FROM {{parquet}} AS t"
                    )
                    df = workspace.run_parquet_sql(table_name, sql)
                    row = df.iloc[0]
                    stats_dict = {
                        "count": int(row["count"]),
                        "unique_count": int(row["unique_count"]),
                        "null_count": int(row["null_count"]),
                    }
                stats.append({"column": col_name, "type": col_type, "statistics": stats_dict})
        else:
            df = workspace.read_data_as_df(table_name)
            stats = []
            for col_name in df.columns:
                s = df[col_name]
                col_type = str(s.dtype)
                stats_dict = {
                    "count": int(s.count()),
                    "unique_count": int(s.nunique()),
                    "null_count": int(s.isna().sum()),
                }
                if pd.api.types.is_numeric_dtype(s):
                    stats_dict["min"] = float(s.min()) if s.notna().any() else None
                    stats_dict["max"] = float(s.max()) if s.notna().any() else None
                    stats_dict["avg"] = float(s.mean()) if s.notna().any() else None
                stats.append({"column": col_name, "type": col_type, "statistics": stats_dict})

        return jsonify({"status": "success", "table_name": table_name, "statistics": stats})
    except Exception as e:
        logger.error(f"Error analyzing table: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


def sanitize_table_name(table_name: str) -> str:
    """Sanitize a table name for use in the workspace."""
    return parquet_sanitize_table_name(table_name)

def sanitize_db_error_message(error: Exception) -> tuple[str, int]:
    """
    Sanitize error messages before sending to client.
    Returns a tuple of (sanitized_message, status_code)
    """
    # Convert error to string
    error_msg = str(error)
    
    # Define patterns for known safe errors
    safe_error_patterns = {
        # Database table errors
        r"Table.*does not exist": (error_msg, 404),
        r"Table.*already exists": (error_msg, 409),
        # Query errors
        r"syntax error": (error_msg, 400),
        r"Catalog Error": (error_msg, 404), 
        r"Binder Error": (error_msg, 400),
        r"Invalid input syntax": (error_msg, 400),
        
        # File errors
        r"No such file": (error_msg, 404),
        r"Permission denied": ("Access denied", 403),

        # Data loader errors
        r"Entity ID": (error_msg, 500),
        r"identity": ("Identity not found, please refresh the page", 500),
    }
    
    # Check if error matches any safe pattern
    for pattern, (safe_msg, status_code) in safe_error_patterns.items():
        if re.search(pattern, error_msg, re.IGNORECASE):
            return safe_msg, status_code
            
    # Log the full error for debugging
    logger.error(f"Unexpected error occurred: {error_msg}")
    
    # Return a generic error message for unknown errors
    return f"An unexpected error occurred: {error_msg}", 500


@tables_bp.route('/data-loader/list-data-loaders', methods=['GET'])
def data_loader_list_data_loaders():
    """List all available data loaders and disabled ones with install hints."""

    try:
        return jsonify({
            "status": "success",
            "data_loaders": {
                name: {
                    "params": data_loader.list_params(),
                    "auth_instructions": data_loader.auth_instructions()
                }
                for name, data_loader in DATA_LOADERS.items()
            },
            "disabled_loaders": {
                name: {"install_hint": hint}
                for name, hint in DISABLED_LOADERS.items()
            }
        })
    except Exception as e:
        logger.error(f"Error listing data loaders: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({
            "status": "error", 
            "message": safe_msg
        }), status_code

@tables_bp.route('/data-loader/list-tables', methods=['POST'])
def data_loader_list_tables():
    """List tables from a data loader (no workspace needed)."""
    try:
        data = request.get_json()
        data_loader_type = data.get('data_loader_type')
        data_loader_params = data.get('data_loader_params')
        table_filter = data.get('table_filter', None)

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Invalid data loader type. Must be one of: {', '.join(DATA_LOADERS.keys())}"}), 400

        data_loader = DATA_LOADERS[data_loader_type](data_loader_params)
        if hasattr(data_loader, 'list_tables') and 'table_filter' in data_loader.list_tables.__code__.co_varnames:
            tables = data_loader.list_tables(table_filter=table_filter)
        else:
            tables = data_loader.list_tables()

        return jsonify({"status": "success", "tables": tables})
    except Exception as e:
        logger.error(f"Error listing tables from data loader: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


@tables_bp.route('/data-loader/ingest-data', methods=['POST'])
def data_loader_ingest_data():
    """Ingest data from a data loader into the workspace as parquet."""
    try:
        data = request.get_json()
        data_loader_type = data.get('data_loader_type')
        data_loader_params = data.get('data_loader_params')
        table_name = data.get('table_name')
        import_options = data.get('import_options', {}) or {}
        row_limit = import_options.get('row_limit', 1000000)
        sort_columns = import_options.get('sort_columns')
        sort_order = import_options.get('sort_order', 'asc')

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Invalid data loader type. Must be one of: {', '.join(DATA_LOADERS.keys())}"}), 400

        workspace = _get_workspace()
        data_loader = DATA_LOADERS[data_loader_type](data_loader_params)
        safe_name = parquet_sanitize_table_name(table_name.split('.')[-1] if '.' in table_name else table_name)
        meta = data_loader.ingest_to_workspace(
            workspace,
            safe_name,
            source_table=table_name,
            size=row_limit,
            sort_columns=sort_columns,
            sort_order=sort_order,
        )
        return jsonify({
            "status": "success",
            "message": "Successfully ingested data from data loader",
            "table_name": meta.name,
        })
    except Exception as e:
        logger.error(f"Error ingesting data from data loader: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


@tables_bp.route('/data-loader/view-query-sample', methods=['POST'])
def data_loader_view_query_sample():
    """View a sample of data from a query (fetches from external source, no workspace)."""
    try:
        data = request.get_json()
        data_loader_type = data.get('data_loader_type')
        data_loader_params = data.get('data_loader_params')
        query = data.get('query')

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Invalid data loader type. Must be one of: {', '.join(DATA_LOADERS.keys())}"}), 400

        data_loader = DATA_LOADERS[data_loader_type](data_loader_params)
        if hasattr(data_loader, 'view_query_sample') and callable(getattr(data_loader, 'view_query_sample')):
            sample = data_loader.view_query_sample(query)
        else:
            return jsonify({
                "status": "error",
                "message": "Query sample is only supported for loaders that implement view_query_sample. Use a source table to fetch data.",
            }), 400
        return jsonify({"status": "success", "sample": sample, "message": "Successfully retrieved query sample"})
    except Exception as e:
        logger.error(f"Error viewing query sample: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "sample": [], "message": safe_msg}), status_code


@tables_bp.route('/data-loader/fetch-data', methods=['POST'])
def data_loader_fetch_data():
    """Fetch data from an external data loader and return as JSON rows WITHOUT saving to workspace.
    
    This is used when storeOnServer=false (local-only / incognito mode).
    The data is returned directly to the frontend without being persisted as parquet.
    """
    try:
        data = request.get_json()
        data_loader_type = data.get('data_loader_type')
        data_loader_params = data.get('data_loader_params')
        table_name = data.get('table_name')
        row_limit = data.get('row_limit', 10000)
        sort_columns = data.get('sort_columns')
        sort_order = data.get('sort_order', 'asc')

        if not data_loader_type or not table_name:
            return jsonify({"status": "error", "message": "data_loader_type and table_name are required"}), 400

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Invalid data loader type. Must be one of: {', '.join(DATA_LOADERS.keys())}"}), 400

        data_loader = DATA_LOADERS[data_loader_type](data_loader_params)
        
        # Fetch data as DataFrame (not Arrow, since we need JSON output not parquet)
        df = data_loader.fetch_data_as_dataframe(
            source_table=table_name,
            size=row_limit,
            sort_columns=sort_columns,
            sort_order=sort_order,
        )
        
        total_row_count = len(df)
        # Apply row limit
        if len(df) > row_limit:
            df = df.head(row_limit)
        
        df = _dedup_dataframe_columns(df)
        rows = json.loads(df.to_json(orient='records', date_format='iso'))
        columns = [{"name": col, "type": str(df[col].dtype)} for col in df.columns]
        
        return jsonify({
            "status": "success",
            "rows": rows,
            "columns": columns,
            "total_row_count": total_row_count,
            "row_limit_applied": row_limit,
        })
    except Exception as e:
        logger.error(f"Error fetching data from data loader: {str(e)}")
        logger.error(traceback.format_exc())
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


@tables_bp.route('/data-loader/ingest-data-from-query', methods=['POST'])
def data_loader_ingest_data_from_query():
    """Ingest data from a query into the workspace as parquet."""
    return jsonify({
        "status": "error",
        "message": "Ingestion from custom query is not supported. Please select a source table to ingest.",
    }), 400


@tables_bp.route('/data-loader/refresh-table', methods=['POST'])
def data_loader_refresh_table():
    """Refresh a table by re-fetching from its source and updating parquet in the workspace."""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        updated_params = data.get('data_loader_params', {})

        if not table_name:
            return jsonify({"status": "error", "message": "table_name is required"}), 400

        workspace = _get_workspace()
        meta = workspace.get_table_metadata(table_name)
        if meta is None:
            return jsonify({"status": "error", "message": f"No table '{table_name}' found. Cannot refresh."}), 400
        if not meta.loader_type:
            return jsonify({"status": "error", "message": f"No source metadata for table '{table_name}'. Cannot refresh."}), 400

        old_content_hash = meta.content_hash
        data_loader_type = meta.loader_type
        data_loader_params = {**(meta.loader_params or {}), **updated_params}

        if data_loader_type not in DATA_LOADERS:
            return jsonify({"status": "error", "message": f"Unknown data loader type: {data_loader_type}"}), 400

        data_loader = DATA_LOADERS[data_loader_type](data_loader_params)
        if meta.source_table:
            arrow_table = data_loader.fetch_data_as_arrow(source_table=meta.source_table)
        else:
            return jsonify({
                "status": "error",
                "message": "Refresh is not supported for tables ingested from a query. Only table-based sources can be refreshed.",
            }), 400

        new_meta, data_changed = workspace.refresh_parquet_from_arrow(table_name, arrow_table)
        return jsonify({
            "status": "success",
            "message": f"Successfully refreshed table '{table_name}'",
            "row_count": new_meta.row_count,
            "content_hash": new_meta.content_hash,
            "data_changed": data_changed,
        })
    except Exception as e:
        logger.error(f"Error refreshing table: {str(e)}")
        logger.error(traceback.format_exc())
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


@tables_bp.route('/data-loader/get-table-metadata', methods=['POST'])
def data_loader_get_table_metadata():
    """Get source metadata for a specific table from workspace."""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        if not table_name:
            return jsonify({"status": "error", "message": "table_name is required"}), 400

        workspace = _get_workspace()
        meta = workspace.get_table_metadata(table_name)
        metadata = _table_metadata_to_source_metadata(meta) if meta else None
        return jsonify({
            "status": "success",
            "metadata": metadata,
            "message": f"No metadata found for table '{table_name}'" if metadata is None else None,
        })
    except Exception as e:
        logger.error(f"Error getting table metadata: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code


@tables_bp.route('/data-loader/list-table-metadata', methods=['GET'])
def data_loader_list_table_metadata():
    """Get source metadata for all tables in the workspace."""
    try:
        workspace = _get_workspace()
        metadata_list = []
        for name in workspace.list_tables():
            meta = workspace.get_table_metadata(name)
            m = _table_metadata_to_source_metadata(meta) if meta else None
            if m:
                metadata_list.append(m)
        return jsonify({"status": "success", "metadata": metadata_list})
    except Exception as e:
        logger.error(f"Error listing table metadata: {str(e)}")
        safe_msg, status_code = sanitize_db_error_message(e)
        return jsonify({"status": "error", "message": safe_msg}), status_code