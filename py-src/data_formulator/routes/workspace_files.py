"""CRUD API for persisted, non-tabular workspace files."""

import hashlib
import io
import mimetypes
from datetime import datetime, timezone

from flask import Blueprint, request, send_file

from data_formulator.auth.identity import get_identity_id
from data_formulator.datalake.workspace_file_content import (
    extract_workspace_file_text,
    read_workspace_file_text,
)
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.workspace_factory import get_workspace


workspace_files_bp = Blueprint(
    "workspace_files", __name__, url_prefix="/api/workspace/files"
)

def _workspace():
    return get_workspace(get_identity_id())


def _serialize(workspace_file) -> dict:
    return {
        "name": workspace_file.name,
        "filename": workspace_file.filename,
        **({"display_name": workspace_file.display_name} if workspace_file.display_name else {}),
        "created_at": workspace_file.created_at.isoformat(),
        "content_hash": workspace_file.content_hash,
        "file_size": workspace_file.file_size,
        "media_type": workspace_file.media_type,
        "origin": workspace_file.origin,
        "edit_policy": workspace_file.edit_policy or "protected",
    }


def _scratch_path(workspace, name):
    return workspace.resolve_scratch_file(name.removeprefix("scratch/"))


def _table_file_path(workspace, name):
    for table_name in workspace.list_tables():
        metadata = workspace.get_table_metadata(table_name)
        if metadata and metadata.file_type == "parquet" and name == f"data/{metadata.filename}":
            return workspace.get_parquet_path(table_name)
    raise FileNotFoundError("Table file not found")


def _scratch_metadata(workspace, name, path):
    stat = path.stat()
    display_name = workspace.get_scratch_display_name(name.removeprefix("scratch/"))
    return {
        "name": name, "filename": path.name, "temporary": True,
        **({"display_name": display_name} if display_name else {}),
        "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "content_hash": "", "file_size": stat.st_size,
        "media_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
    }


@workspace_files_bp.route("", methods=["GET"])
def list_workspace_files():
    workspace = _workspace()
    files = [_serialize(item) for item in workspace.list_workspace_files()]
    if request.args.get("include_tables") == "true":
        for table_name in workspace.list_tables():
            metadata = workspace.get_table_metadata(table_name)
            if metadata and metadata.file_type == "parquet":
                files.append({
                    "name": f"data/{metadata.filename}", "filename": metadata.filename,
                    "created_at": metadata.created_at.isoformat(), "content_hash": metadata.content_hash or "",
                    "file_size": metadata.file_size, "media_type": "application/vnd.apache.parquet",
                })
    if request.args.get("include_temp") == "true":
        for name in workspace.list_scratch_files():
            try:
                files.append(_scratch_metadata(workspace, name, _scratch_path(workspace, name)))
            except (ValueError, OSError):
                continue
    return json_ok({"files": sorted(files, key=lambda item: item["name"].lower())})


@workspace_files_bp.route("", methods=["POST"])
def upload_workspace_file():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise AppError(ErrorCode.INVALID_REQUEST, "No file in request")
    try:
        workspace_file = _workspace().save_workspace_file(
            upload.read(), upload.filename, upload.mimetype
        )
    except ValueError as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Invalid filename") from exc
    return json_ok(_serialize(workspace_file))


@workspace_files_bp.route("/text", methods=["POST"])
def create_workspace_text_file():
    payload = request.get_json(silent=True) or {}
    name = payload.get("name")
    if not isinstance(name, str):
        raise AppError(ErrorCode.INVALID_REQUEST, "A filename is required")
    try:
        workspace_file = _workspace().save_workspace_text_file(name, "")
    except ValueError as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
    return json_ok(_serialize(workspace_file))


@workspace_files_bp.route("/<path:name>/text", methods=["GET", "PUT"])
def workspace_text_file(name: str):
    workspace = _workspace()
    try:
        if name.startswith("scratch/"):
            if request.method != "GET":
                raise ValueError("Temporary files are read-only")
            path = _scratch_path(workspace, name)
            if path.stat().st_size > 2_000_000:
                raise ValueError("Text preview is limited to 2 MB")
            raw = path.read_bytes()
            if b"\x00" in raw or raw.startswith((b"%PDF-", b"PK\x03\x04")):
                raise ValueError("Not a text file")
            return json_ok({**_scratch_metadata(workspace, name, path), "content": raw.decode("utf-8")})
        workspace_file, raw = workspace.read_workspace_file(name)
        media_type = (workspace_file.media_type or "").split(";")[0]
        if media_type == "application/pdf" or media_type.startswith(("image/", "audio/", "video/")) or raw.startswith((b"%PDF-", b"PK\x03\x04")):
            raise ValueError("This file is not a text document")
        if len(raw) > 2_000_000 or b"\x00" in raw:
            raise ValueError("Only UTF-8 text files under 2 MB can be edited")
        content = raw.decode("utf-8")
        if request.method == "PUT":
            payload = request.get_json(silent=True) or {}
            if not isinstance(payload.get("content"), str) or not isinstance(payload.get("content_hash"), str):
                raise ValueError("Content and content_hash are required")
            workspace_file = workspace.save_workspace_text_file(name, payload["content"], payload["content_hash"])
            content = payload["content"]
        return json_ok({**_serialize(workspace_file), "content": content,
                "content_hash": hashlib.sha256(content.encode("utf-8")).hexdigest()})
    except FileNotFoundError as exc:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found") from exc
    except (ValueError, UnicodeError) as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc


@workspace_files_bp.route("/<path:name>", methods=["GET"])
def download_workspace_file(name: str):
    try:
        if name.startswith("data/"):
            path = _table_file_path(_workspace(), name)
            return send_file(path, as_attachment=True, download_name=path.name)
        if name.startswith("scratch/"):
            path = _scratch_path(_workspace(), name)
            return send_file(path, as_attachment=True, download_name=path.name)
        workspace_file, content = _workspace().read_workspace_file(name)
    except FileNotFoundError as exc:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found") from exc
    except ValueError as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
    return send_file(
        io.BytesIO(content),
        mimetype=workspace_file.media_type,
        as_attachment=True,
        download_name=workspace_file.name,
    )


@workspace_files_bp.route("/<path:name>/preview", methods=["GET"])
def preview_workspace_file(name: str):
    if name.lower().endswith(".parquet"):
        try:
            import pyarrow.parquet as pq
            from data_formulator.datalake.parquet_utils import df_to_safe_records
            workspace = _workspace()
            if name.startswith("data/"):
                source = _table_file_path(workspace, name)
            elif name.startswith("scratch/"):
                source = _scratch_path(workspace, name)
            else:
                source = io.BytesIO(workspace.read_workspace_file(name)[1])
            parquet = pq.ParquetFile(source)
            columns = parquet.schema_arrow.names[:50]
            batch = next(parquet.iter_batches(batch_size=50, columns=columns), None)
            rows = df_to_safe_records(batch.to_pandas()) if batch is not None else []
            truncated = parquet.metadata.num_rows > len(rows) or len(parquet.schema_arrow.names) > len(columns)
            for row in rows:
                for column, value in row.items():
                    if isinstance(value, (list, dict)):
                        import json
                        value = json.dumps(value, ensure_ascii=False, default=str)
                    if isinstance(value, str) and len(value) > 1000:
                        value = value[:1000] + "..."
                        truncated = True
                    row[column] = value
            return json_ok({"name": name, "kind": "table", "content": "",
                            "columns": columns, "rows": rows, "row_count": parquet.metadata.num_rows,
                            "truncated": truncated})
        except (ValueError, OSError) as exc:
            raise AppError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
    if name.startswith("scratch/"):
        try:
            path = _scratch_path(_workspace(), name)
            if path.stat().st_size > 2_000_000:
                raise ValueError("Preview is limited to 2 MB; download the file to view it")
            preview = extract_workspace_file_text(path.name, path.read_bytes(), mimetypes.guess_type(path.name)[0])
        except (ValueError, OSError) as exc:
            raise AppError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
        return json_ok({"name": name, "kind": "text", "content": preview.content, "truncated": preview.truncated})
    preview = read_workspace_file_text(_workspace(), name)
    return json_ok({
        "name": preview.name,
        "kind": "text",
        "content": preview.content,
        "truncated": preview.truncated,
    })


@workspace_files_bp.route("/preview", methods=["POST"])
def preview_uploaded_workspace_file():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise AppError(ErrorCode.INVALID_REQUEST, "No file in request")
    preview = extract_workspace_file_text(
        upload.filename,
        upload.read(),
        upload.mimetype,
    )
    return json_ok({
        "name": preview.name,
        "kind": "text",
        "content": preview.content,
        "truncated": preview.truncated,
    })


@workspace_files_bp.route("/<path:name>", methods=["DELETE"])
def delete_workspace_file(name: str):
    if name.startswith("scratch/"):
        try:
            _scratch_path(_workspace(), name).unlink()
        except FileNotFoundError as exc:
            raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found") from exc
        except (ValueError, OSError) as exc:
            raise AppError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
        return json_ok({"name": name})
    if not _workspace().delete_workspace_file(name):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found")
    return json_ok({"name": name})


@workspace_files_bp.route("/<path:name>", methods=["PATCH"])
def rename_workspace_file(name: str):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("name"), str):
        raise AppError(ErrorCode.INVALID_REQUEST, "A filename is required")
    try:
        workspace_file = _workspace().rename_workspace_file(name, payload["name"])
    except FileNotFoundError as exc:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found") from exc
    except ValueError as exc:
        raise AppError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc
    return json_ok(_serialize(workspace_file))