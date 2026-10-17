"""Data queries from dashboard apps: workspace SQL and live connected-source reads (design-docs/59)."""

from __future__ import annotations

import logging

from flask import Blueprint, request

from data_formulator.app_queries import run_app_source_query, run_app_sql
from data_formulator.auth.identity import get_identity_id
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.workspace_factory import get_workspace

logger = logging.getLogger(__name__)

apps_bp = Blueprint("apps", __name__, url_prefix="/api/apps")


def _request_json() -> dict:
    content = request.get_json(silent=True)
    if not isinstance(content, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "Expected a JSON object")
    return content


@apps_bp.route("/sql", methods=["POST"])
def app_sql():
    """Read-only SQL over the app's declared workspace tables."""
    content = _request_json()
    try:
        result = run_app_sql(get_workspace(get_identity_id()), content.get("tables"), content.get("sql"),
                             content.get("params"), content.get("limit"))
    except (ValueError, FileNotFoundError) as error:
        raise AppError(ErrorCode.INVALID_REQUEST, str(error)) from error
    return json_ok(result)


@apps_bp.route("/source-query", methods=["POST"])
def app_source_query():
    """A bounded live query against a connected source the app declared."""
    content = _request_json()
    try:
        result = run_app_source_query(get_workspace(get_identity_id()), content.get("connector_id"),
                                      content.get("table_key"), content.get("query"), content.get("limit"))
    except (ValueError, NotImplementedError) as error:
        raise AppError(ErrorCode.INVALID_REQUEST, str(error)) from error
    return json_ok(result)
