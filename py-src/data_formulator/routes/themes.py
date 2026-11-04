# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The user's chart theme library: list and remove saved themes (the agent saves them with ``save_theme``)."""

from __future__ import annotations

from flask import Blueprint, request

from data_formulator.auth.identity import get_identity_id
from data_formulator.datalake.workspace import get_user_home
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.knowledge.themes import ThemeStore

themes_bp = Blueprint("themes", __name__, url_prefix="/api/themes")


def _store() -> ThemeStore:
    return ThemeStore(get_user_home(get_identity_id()))


@themes_bp.route("/list", methods=["POST"])
def themes_list():
    return json_ok({"themes": _store().list()})


@themes_bp.route("/delete", methods=["POST"])
def themes_delete():
    theme_id = (request.get_json(silent=True) or {}).get("id")
    if not isinstance(theme_id, str) or not theme_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "Missing theme id")
    return json_ok({"deleted": _store().delete(theme_id)})
