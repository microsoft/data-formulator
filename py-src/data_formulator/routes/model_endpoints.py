# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Per-user history of non-secret model endpoint configurations."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

from flask import Blueprint, request

from data_formulator.auth.identity import get_identity_id
from data_formulator.datalake.workspace import get_user_home
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode


model_endpoints_bp = Blueprint("model_endpoints", __name__, url_prefix="/api/model-endpoints")

_FILENAME = "model_endpoints.json"
_MAX_ENTRIES = 20
_MAX_FIELD_LENGTH = 2048
_FIELDS = ("endpoint", "model", "api_base", "api_version", "auth_mode")
_lock = threading.Lock()


def _history_path(identity_id: str) -> Path:
    return get_user_home(identity_id) / _FILENAME


def _sanitize_entry(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid model endpoint configuration")
    entry = {field: str(value.get(field) or "").strip() for field in _FIELDS}
    if not entry["endpoint"] or not entry["model"]:
        raise AppError(ErrorCode.INVALID_REQUEST, "Provider and model are required")
    if any(len(field_value) > _MAX_FIELD_LENGTH for field_value in entry.values()):
        raise AppError(ErrorCode.INVALID_REQUEST, "Model endpoint configuration is too long")
    return entry


def _read_history(path: Path) -> list[dict[str, str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    if not isinstance(data, list):
        return []
    result: list[dict[str, str]] = []
    for item in data:
        try:
            result.append(_sanitize_entry(item))
        except AppError:
            continue
    return result[:_MAX_ENTRIES]


def _write_history(path: Path, entries: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=f".{_FILENAME}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(entries, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


@model_endpoints_bp.route("", methods=["GET"])
def list_model_endpoints():
    with _lock:
        entries = _read_history(_history_path(get_identity_id()))
    return json_ok(entries)


@model_endpoints_bp.route("", methods=["POST"])
def remember_model_endpoint():
    if not request.is_json:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")
    entry = _sanitize_entry(request.get_json())
    path = _history_path(get_identity_id())
    with _lock:
        entries = _read_history(path)
        entries = [existing for existing in entries if existing != entry]
        entries.insert(0, entry)
        entries = entries[:_MAX_ENTRIES]
        _write_history(path, entries)
    return json_ok(entry)