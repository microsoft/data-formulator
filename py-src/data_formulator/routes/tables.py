# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

import io
import logging
import sys
import os
import mimetypes
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')
import json
import gzip
from flask import request, Blueprint, Response, stream_with_context
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
import pandas as pd
from pathlib import Path
from data_formulator.auth.identity import get_identity_id
from data_formulator.datalake.workspace import Workspace
from data_formulator.workspace_factory import get_workspace as _create_workspace
from data_formulator.datalake.parquet_utils import sanitize_table_name as parquet_sanitize_table_name, safe_data_filename, normalize_dtype_to_app_type
from data_formulator.datalake.file_manager import save_uploaded_file, is_supported_file, get_file_type, normalize_text_encoding
from data_formulator.datalake.workspace_metadata import TableMetadata as DatalakeTableMetadata, ColumnInfo
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
    # Wrap the base table with a ROW_NUMBER() so the original row position
    # is preserved even after sorting / sampling.
    base = "(SELECT ROW_NUMBER() OVER () AS \"#rowId\", t.* FROM {parquet} AS t) AS t"
    if method == "random":
        order_by = " ORDER BY RANDOM()"
    elif method == "head" and valid_order:
        order_by = " ORDER BY " + ", ".join(f"t.{_quote_duckdb(c)} ASC" for c in valid_order)
    elif method == "bottom" and valid_order:
        order_by = " ORDER BY " + ", ".join(f"t.{_quote_duckdb(c)} DESC" for c in valid_order)
    else:
        order_by = ""
    if valid_select:
        select_list = "t.\"#rowId\", " + ", ".join(f"t.{_quote_duckdb(c)}" for c in valid_select)
        main_sql = f"SELECT {select_list} FROM {base}{order_by} LIMIT {sample_size}"
    else:
        main_sql = f"SELECT * FROM {base}{order_by} LIMIT {sample_size}"
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

    if current_app.config.get('CLI_ARGS', {}).get('workspace_backend', 'local') != 'local':
        raise AppError(ErrorCode.INVALID_REQUEST, "Workspace folder access is only available for local backend")

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
        return json_ok({"path": home_path})
    except Exception as e:
        logger.error(f"Failed to open workspace: {e}")
        raise AppError(ErrorCode.INTERNAL_ERROR, "Failed to open workspace")


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
                columns = []
                for c in (meta.columns or []):
                    col_entry: dict = {"name": c.name, "type": normalize_dtype_to_app_type(c.dtype)}
                    if c.description is not None:
                        col_entry["description"] = c.description
                    columns.append(col_entry)
                if not columns and meta.file_type == "parquet":
                    try:
                        schema_info = workspace.get_parquet_schema(table_name)
                        columns = [{"name": c["name"], "type": normalize_dtype_to_app_type(c["type"])} for c in schema_info.get("columns", [])]
                    except Exception as e:
                        logger.warning("Could not read parquet schema for %s", table_name, exc_info=e)
                if not columns:
                    try:
                        df = workspace.read_data_as_df(table_name)
                        columns = [{"name": str(c), "type": normalize_dtype_to_app_type(str(df[c].dtype))} for c in df.columns]
                    except Exception as e:
                        logger.warning("Could not read columns for %s", table_name, exc_info=e)
                row_count = meta.row_count
                if row_count is None and meta.file_type == "parquet":
                    try:
                        schema_info = workspace.get_parquet_schema(table_name)
                        row_count = schema_info.get("num_rows", 0) or 0
                    except Exception as e:
                        logger.warning("Could not read row count from parquet for %s", table_name, exc_info=e)
                        row_count = 0
                if row_count is None:
                    try:
                        df = workspace.read_data_as_df(table_name)
                        row_count = len(df)
                    except Exception as e:
                        logger.warning("Could not read row count for %s", table_name, exc_info=e)
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
                    except Exception as e:
                        logger.warning("Could not read sample rows for %s", table_name, exc_info=e)
                source_metadata = _table_metadata_to_source_metadata(meta)
                table_entry: dict = {
                    "name": table_name,
                    "columns": columns,
                    "row_count": row_count,
                    "sample_rows": sample_rows,
                    "view_source": None,
                    "source_metadata": source_metadata,
                    "source_type": meta.source_type,
                    "source_filename": meta.filename,
                    "original_name": meta.original_name,
                }
                if meta.description is not None:
                    table_entry["description"] = meta.description
                result.append(table_entry)
            except Exception as e:
                logger.error(f"Error getting table metadata for {table_name}: {str(e)}")
                continue
        return json_ok({"tables": result})
    except Exception as e:
        classify_and_raise_db_error(e)
        

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

    # Attach original 1-based row position before sorting/sampling
    work.insert(0, '#rowId', range(1, len(work) + 1))
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
        return json_ok({
            "rows": rows_json,
            "total_row_count": total_row_count,
        })
    except Exception as e:
        classify_and_raise_db_error(e)

@tables_bp.route('/get-table', methods=['GET'])
def get_table_data():
    """Get data from a specific table in the workspace. Uses DuckDB for parquet (LIMIT/OFFSET only)."""
    try:
        table_name = request.args.get('table_name')
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 100))
        offset = (page - 1) * page_size

        if not table_name:
            raise AppError(ErrorCode.INVALID_REQUEST, "Table name is required")

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

        return json_ok({
            "table_name": table_name,
            "columns": columns,
            "rows": rows,
            "total_rows": total_rows,
            "page": page,
            "page_size": page_size,
        })
    except AppError:
        raise
    except Exception as e:
        classify_and_raise_db_error(e)

def _read_upload_to_df(
    content: bytes,
    file_type: str,
    *,
    table_name: str = "",
    sheet_hint: str | None = None,
) -> pd.DataFrame:
    """Parse uploaded file bytes into a DataFrame for parquet conversion.

    For Excel files the target sheet is resolved by
    :func:`_resolve_excel_sheet`.
    """
    buf = io.BytesIO(content)
    if file_type == "csv":
        return pd.read_csv(buf)
    if file_type == "txt":
        return pd.read_csv(buf, sep="\t")
    if file_type in ("excel",):
        sheet = _resolve_excel_sheet(content, table_name, sheet_hint)
        return pd.read_excel(io.BytesIO(content), sheet_name=sheet)
    if file_type == "json":
        return pd.read_json(buf)
    raise ValueError(f"Cannot convert file_type '{file_type}' to DataFrame")


def _resolve_excel_sheet(
    content: bytes,
    table_name: str,
    sheet_hint: str | None = None,
) -> int | str:
    """Pick the correct sheet from an Excel workbook.

    Resolution order:

    1. **Validated hint** — if the frontend sent *sheet_hint* **and** that
       name actually exists in the workbook, use it directly.
    2. **Suffix match** — for each real sheet name, check whether
       ``table_name`` ends with ``_<sheet_lower>``.  This handles the
       common pattern ``query_产品利润_xlsx_sheet1``.
    3. **Substring match** — looser: ``sheet_lower in table_name``.
    4. **Fallback** — first sheet (index 0).
    """
    try:
        xls = pd.ExcelFile(io.BytesIO(content))
        sheet_names = xls.sheet_names
    except Exception:
        return 0

    if not sheet_names:
        return 0

    # 1. Validated frontend hint
    if sheet_hint:
        for name in sheet_names:
            if name == sheet_hint:
                return name
        for name in sheet_names:
            if name.lower() == sheet_hint.lower():
                return name

    tn_lower = table_name.lower()
    if not tn_lower:
        return 0

    # 2. Exact suffix match (strongest signal)
    for name in sheet_names:
        if tn_lower.endswith("_" + name.lower()):
            return name

    # 3. Substring match (weaker)
    for name in sheet_names:
        if name.lower() in tn_lower:
            return name

    return 0


@tables_bp.route('/create-table', methods=['POST'])
def create_table():
    """Create a new table from uploaded file or raw data in the workspace."""
    try:
        has_file = 'file' in request.files
        has_raw_data = 'raw_data' in request.files or 'raw_data' in request.form
        if not has_file and not has_raw_data:
            raise AppError(ErrorCode.INVALID_REQUEST, "No file or raw data provided")

        table_name = request.form.get('table_name')
        if not table_name:
            raise AppError(ErrorCode.INVALID_REQUEST, "No table name provided")

        workspace = _get_workspace()
        sanitized_table_name = parquet_sanitize_table_name(table_name)
        replace_source = request.form.get('replace_source', '').lower() == 'true'

        if has_file:
            file = request.files['file']
            if not file.filename or not is_supported_file(file.filename):
                raise AppError(ErrorCode.INVALID_REQUEST, "Unsupported file format")
            try:
                safe_name = safe_data_filename(file.filename)
            except ValueError:
                raise AppError(ErrorCode.INVALID_REQUEST, "Invalid filename")

            if replace_source:
                workspace.delete_tables_by_source_file(safe_name)

            file_type = get_file_type(safe_name)
            content = file.stream.read()
            content = normalize_text_encoding(content, file_type)

            sheet_hint = request.form.get('sheet_name') or None
            df = _read_upload_to_df(
                content, file_type,
                table_name=sanitized_table_name,
                sheet_hint=sheet_hint,
            )

            meta = workspace.write_parquet(df, sanitized_table_name)
            meta.source_type = "upload"
            meta.source_file = safe_name
            meta.original_name = table_name
            workspace.add_table_metadata(meta)

            sanitized_table_name = meta.name
            row_count = meta.row_count
            columns = [c.name for c in (meta.columns or [])]
        else:
            # raw_data can come as a file upload (Blob) or as a form field
            if 'raw_data' in request.files:
                raw_bytes = request.files['raw_data'].read()
                # Auto-detect gzip (magic bytes 0x1f 0x8b)
                if raw_bytes[:2] == b'\x1f\x8b':
                    raw_data = gzip.decompress(raw_bytes).decode('utf-8')
                else:
                    raw_data = raw_bytes.decode('utf-8')
            else:
                raw_data = request.form.get('raw_data')
            try:
                df = pd.DataFrame(json.loads(raw_data))
            except Exception as e:
                logger.warning("Invalid JSON in raw_data", exc_info=True)
                raise AppError(ErrorCode.VALIDATION_ERROR, "Invalid JSON data — it must be a JSON array of objects")
            workspace.write_parquet(df, sanitized_table_name)
            row_count = len(df)
            columns = list(df.columns)

        meta = workspace.get_table_metadata(sanitized_table_name)
        if meta is not None and meta.original_name is None:
            meta.original_name = table_name
            workspace.add_table_metadata(meta)

        return json_ok({
            "table_name": sanitized_table_name,
            "row_count": row_count,
            "columns": columns,
        })
    except AppError:
        raise
    except Exception as e:
        classify_and_raise_db_error(e)


@tables_bp.route('/parse-file', methods=['POST'])
def parse_file():
    """Parse an uploaded file and return data as JSON without saving to workspace.

    Used for client-side preview of formats that the browser cannot parse
    natively (e.g. legacy .xls).
    """
    try:
        if 'file' not in request.files:
            raise AppError(ErrorCode.INVALID_REQUEST, "No file provided")

        file = request.files['file']
        filename = file.filename or ''
        if not filename or not is_supported_file(filename):
            raise AppError(ErrorCode.INVALID_REQUEST, "Unsupported file format")

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
            return json_ok({"sheets": sheets})
        elif ext == '.csv':
            raw = normalize_text_encoding(file.stream.read(), 'csv')
            df = pd.read_csv(io.BytesIO(raw))
            df = df.where(df.notna(), None)
            records = df.to_dict(orient='records')
            return json_ok({
                "sheets": [{
                    "sheet_name": "Sheet1",
                    "columns": list(df.columns),
                    "row_count": len(records),
                    "data": records,
                }],
            })
        else:
            raise AppError(ErrorCode.INVALID_REQUEST, f"Server-side parsing not supported for {ext}")

    except AppError:
        raise
    except Exception as e:
        logger.error("Error parsing file", exc_info=True)
        raise AppError(ErrorCode.FILE_PARSE_ERROR, "Failed to parse the uploaded file")


@tables_bp.route('/sync-table-data', methods=['POST'])
def sync_table_data():
    """Update an existing workspace table's parquet with new row data.
    
    Used when the frontend has fresher data than the workspace (e.g., from stream refresh)
    and needs to sync it so sandbox code reads the latest data.
    """
    try:
        # Auto-detect gzip-compressed request body
        raw_bytes = request.get_data()
        if raw_bytes[:2] == b'\x1f\x8b':
            data = json.loads(gzip.decompress(raw_bytes).decode('utf-8'))
        else:
            data = request.get_json()
        table_name = data.get('table_name')
        rows = data.get('rows')

        if not table_name:
            raise AppError(ErrorCode.INVALID_REQUEST, "table_name is required")
        if rows is None:
            raise AppError(ErrorCode.INVALID_REQUEST, "rows is required")

        workspace = _get_workspace()

        if table_name not in workspace.list_tables():
            raise AppError(ErrorCode.TABLE_NOT_FOUND, f"Table '{table_name}' not found in workspace")

        df = pd.DataFrame(rows) if rows else pd.DataFrame()
        workspace.write_parquet(df, table_name)

        return json_ok({
            "table_name": table_name,
            "row_count": len(df),
        })
    except AppError:
        raise
    except Exception as e:
        classify_and_raise_db_error(e)


@tables_bp.route('/delete-table', methods=['POST'])
def drop_table():
    """Drop a table from the workspace."""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        if not table_name:
            raise AppError(ErrorCode.INVALID_REQUEST, "No table name provided")

        workspace = _get_workspace()
        if not workspace.delete_table(table_name):
            raise AppError(ErrorCode.TABLE_NOT_FOUND, f"Table '{table_name}' does not exist")
        return json_ok({"message": f"Table {table_name} dropped"})
    except AppError:
        raise
    except Exception as e:
        classify_and_raise_db_error(e)


@tables_bp.route('/upload-db-file', methods=['POST'])
def upload_db_file():
    """No longer used: storage is workspace/datalake, not DuckDB. Kept for API compatibility."""
    raise AppError(ErrorCode.INVALID_REQUEST, "Database file upload is no longer supported. Data is stored in the workspace; use create-table with a file or data loaders to add data.")


@tables_bp.route('/download-db-file', methods=['GET'])
def download_db_file():
    """No longer used: storage is workspace/datalake. Kept for API compatibility."""
    raise AppError(
        ErrorCode.INVALID_REQUEST,
        "Database file download is no longer supported. Data lives in the workspace.",
    )


_CSV_STREAM_CHUNK_ROWS = 10_000


def _stream_csv_from_duckdb(workspace, table_name: str, delimiter: str):
    """Use DuckDB native COPY to export CSV — bypasses pandas entirely."""
    import duckdb
    import tempfile

    parquet_path = workspace.get_parquet_path(table_name)
    path_escaped = str(parquet_path).replace("\\", "\\\\").replace("'", "''")

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".csv")
    os.close(tmp_fd)
    try:
        conn = duckdb.connect(":memory:")
        try:
            cols = conn.execute(
                f"SELECT column_name FROM parquet_schema('{path_escaped}')"
            ).fetchall()
            has_row_id = any(c[0] == "#rowId" for c in cols)
            exclude = ' EXCLUDE ("#rowId")' if has_row_id else ""
            select_sql = f"SELECT *{exclude} FROM read_parquet('{path_escaped}')"

            copy_opts = f"HEADER, DELIMITER '{delimiter}'"
            tmp_escaped = tmp_path.replace("\\", "\\\\").replace("'", "''")
            conn.execute(f"COPY ({select_sql}) TO '{tmp_escaped}' ({copy_opts})")
        finally:
            conn.close()

        yield b'\xef\xbb\xbf'
        with open(tmp_path, "rb") as f:
            while True:
                chunk = f.read(65_536)
                if not chunk:
                    break
                yield chunk
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _stream_csv_from_dataframe(df: pd.DataFrame, delimiter: str):
    """Stream CSV from a pandas DataFrame in chunks to limit memory."""
    yield b'\xef\xbb\xbf'

    header_buf = io.StringIO()
    df.iloc[:0].to_csv(header_buf, index=False, sep=delimiter)
    yield header_buf.getvalue().encode("utf-8")

    for start in range(0, len(df), _CSV_STREAM_CHUNK_ROWS):
        chunk_buf = io.StringIO()
        df.iloc[start : start + _CSV_STREAM_CHUNK_ROWS].to_csv(
            chunk_buf, index=False, header=False, sep=delimiter
        )
        yield chunk_buf.getvalue().encode("utf-8")


@tables_bp.route('/export-table-csv', methods=['POST'])
def export_table_csv():
    """Export a workspace table as CSV (or TSV) file download."""
    try:
        data = request.get_json()
        table_name = data.get('table_name')
        delimiter = data.get('delimiter', ',')

        if not table_name:
            raise AppError(ErrorCode.INVALID_REQUEST, "table_name is required")

        if delimiter not in (',', '\t'):
            raise AppError(ErrorCode.INVALID_REQUEST, "delimiter must be ',' or '\\t'")

        workspace = _get_workspace()
        ext = 'tsv' if delimiter == '\t' else 'csv'
        mime = 'text/tab-separated-values' if delimiter == '\t' else 'text/csv'

        if _should_use_duckdb(workspace, table_name):
            gen = _stream_csv_from_duckdb(workspace, table_name, delimiter)
        else:
            df = workspace.read_data_as_df(table_name)
            df = _dedup_dataframe_columns(df)
            if '#rowId' in df.columns:
                df = df.drop(columns=['#rowId'])
            gen = _stream_csv_from_dataframe(df, delimiter)

        from urllib.parse import quote
        ascii_name = table_name.encode('ascii', 'replace').decode('ascii')
        utf8_name = quote(table_name)
        disposition = (
            f'attachment; filename="{ascii_name}.{ext}"; '
            f"filename*=UTF-8''{utf8_name}.{ext}"
        )

        return Response(
            stream_with_context(gen),
            mimetype=mime,
            headers={'Content-Disposition': disposition},
        )
    except AppError:
        raise
    except Exception as e:
        classify_and_raise_db_error(e)


@tables_bp.route('/reset-db-file', methods=['POST'])
def reset_db_file():
    """Reset the workspace for the current session (removes all tables and files)."""
    try:
        workspace = _get_workspace()
        workspace.cleanup()
        return json_ok({"message": "Workspace reset successfully"})
    except Exception as e:
        classify_and_raise_db_error(e)

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
            raise AppError(ErrorCode.INVALID_REQUEST, "No table name provided")

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

        return json_ok({"table_name": table_name, "statistics": stats})
    except AppError:
        raise
    except Exception as e:
        classify_and_raise_db_error(e)


def sanitize_table_name(table_name: str) -> str:
    """Sanitize a table name for use in the workspace."""
    return parquet_sanitize_table_name(table_name)

def classify_and_raise_db_error(error: Exception) -> None:
    """Classify a database/workspace error and raise ``AppError``.

    **Security rule**: the raised message is *never* derived from
    ``str(error)``.  Only pre-defined, human-written strings are used.
    The full exception is logged server-side for debugging.
    """
    from data_formulator.errors import AppError, ErrorCode

    logger.error("Database/workspace error", exc_info=error)

    error_msg = str(error)

    _SAFE_PATTERNS: list[tuple[str, str, str]] = [
        # (regex, ErrorCode, safe client message)
        (r"Table.*does not exist",   ErrorCode.TABLE_NOT_FOUND,   "The requested table does not exist"),
        (r"Table.*already exists",   ErrorCode.INVALID_REQUEST,   "A table with that name already exists"),
        (r"syntax error",            ErrorCode.INVALID_REQUEST,   "Query syntax error"),
        (r"Catalog Error",           ErrorCode.TABLE_NOT_FOUND,   "The requested catalog object was not found"),
        (r"Binder Error",            ErrorCode.INVALID_REQUEST,   "Invalid query reference"),
        (r"Invalid input syntax",    ErrorCode.INVALID_REQUEST,   "Invalid input syntax"),
        (r"No such file",            ErrorCode.TABLE_NOT_FOUND,   "The requested resource was not found"),
        (r"Permission denied",       ErrorCode.ACCESS_DENIED,     "Access denied"),
        (r"identity",                ErrorCode.AUTH_REQUIRED,     "Identity not found, please refresh the page"),
    ]

    for pattern, code, safe_msg in _SAFE_PATTERNS:
        if re.search(pattern, error_msg, re.IGNORECASE):
            raise AppError(code, safe_msg, detail=error_msg) from error

    raise AppError(ErrorCode.INTERNAL_ERROR, "An unexpected error occurred", detail=error_msg) from error


def sanitize_db_error_message(error: Exception) -> tuple[str, int]:
    """Legacy wrapper — prefer ``classify_and_raise_db_error`` for new code."""
    from data_formulator.errors import AppError
    try:
        classify_and_raise_db_error(error)
    except AppError as ae:
        return ae.message, ae.get_http_status()
    return "An unexpected error occurred", 500