"""CRUD API for persisted, non-tabular workspace files."""

import io

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
        "created_at": workspace_file.created_at.isoformat(),
        "content_hash": workspace_file.content_hash,
        "file_size": workspace_file.file_size,
        "media_type": workspace_file.media_type,
    }


@workspace_files_bp.route("", methods=["GET"])
def list_workspace_files():
    files = sorted(_workspace().list_workspace_files(), key=lambda item: item.name.lower())
    return json_ok({"files": [_serialize(item) for item in files]})


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


@workspace_files_bp.route("/<path:name>", methods=["GET"])
def download_workspace_file(name: str):
    try:
        workspace_file, content = _workspace().read_workspace_file(name)
    except FileNotFoundError as exc:
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found") from exc
    return send_file(
        io.BytesIO(content),
        mimetype=workspace_file.media_type,
        as_attachment=True,
        download_name=workspace_file.name,
    )


@workspace_files_bp.route("/<path:name>/preview", methods=["GET"])
def preview_workspace_file(name: str):
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
    if not _workspace().delete_workspace_file(name):
        raise AppError(ErrorCode.TABLE_NOT_FOUND, "File not found")
    return json_ok({"name": name})