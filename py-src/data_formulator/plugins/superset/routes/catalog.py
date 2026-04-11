# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Catalog routes for the Superset plugin.

Migrated from 0.6 ``superset/catalog_routes.py`` with:
- Plugin-namespaced session helpers
- Routes under ``/api/plugins/superset/catalog/``
- Extensions keyed as ``plugin_superset_*``
"""

from __future__ import annotations

import logging

from flask import Blueprint, current_app, jsonify, request
from requests.exceptions import HTTPError

from data_formulator.plugins.superset.session_helpers import (
    require_auth,
    try_refresh,
)
from data_formulator.security.sanitize import safe_error_response

logger = logging.getLogger(__name__)

catalog_bp = Blueprint(
    "plugin_superset_catalog",
    __name__,
    url_prefix="/api/plugins/superset/catalog",
)


def _catalog():
    return current_app.extensions["plugin_superset_catalog"]


def _with_retry(fn, *args, **kwargs):
    """Call *fn* and retry once with a refreshed token on 401."""
    try:
        return fn(*args, **kwargs)
    except HTTPError as e:
        if e.response is not None and e.response.status_code == 401:
            new_token = try_refresh()
            if new_token:
                new_args = (new_token,) + args[1:]
                return fn(*new_args, **kwargs)
            return None
        raise


@catalog_bp.route("/datasets", methods=["GET"])
def list_datasets():
    """List datasets visible to the current user."""
    token, user = require_auth()
    if not user:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    user_id = user["id"]

    catalog = _catalog()
    try:
        if token:
            datasets = _with_retry(catalog.get_catalog_summary, token, user_id)
        else:
            datasets = catalog.get_catalog_summary(None, user_id)
        if datasets is None:
            return jsonify({"status": "error", "message": "Authentication expired, please log in again"}), 401
    except HTTPError as e:
        return safe_error_response(e, 502, log_message="Superset API call failed")
    except Exception as e:
        return safe_error_response(e, 500, log_message="Failed to list datasets")

    return jsonify({"status": "ok", "datasets": datasets, "count": len(datasets)})


@catalog_bp.route("/dashboards", methods=["GET"])
def list_dashboards():
    """List dashboards visible to the current user."""
    token, user = require_auth()
    if not user:
        return jsonify({"status": "error", "message": "Authentication required"}), 401
    user_id = user["id"]

    catalog = _catalog()
    try:
        if token:
            dashboards = _with_retry(catalog.get_dashboard_summary, token, user_id)
        else:
            dashboards = catalog.get_dashboard_summary(None, user_id)
        if dashboards is None:
            return jsonify({"status": "error", "message": "Authentication expired, please log in again"}), 401
    except HTTPError as e:
        return safe_error_response(e, 502, log_message="Superset API call failed")
    except Exception as e:
        return safe_error_response(e, 500, log_message="Failed to list dashboards")

    return jsonify({"status": "ok", "dashboards": dashboards, "count": len(dashboards)})


@catalog_bp.route("/dashboards/<int:dashboard_id>/datasets", methods=["GET"])
def get_dashboard_datasets(dashboard_id: int):
    """Get datasets used by a specific dashboard."""
    token, user = require_auth()
    if not user:
        return jsonify({"status": "error", "message": "Authentication required"}), 401

    catalog = _catalog()
    try:
        if token:
            datasets = _with_retry(catalog.get_dashboard_datasets, token, dashboard_id)
        else:
            datasets = catalog.get_dashboard_datasets(None, dashboard_id)
        if datasets is None:
            return jsonify({"status": "error", "message": "Authentication expired, please log in again"}), 401
    except HTTPError as e:
        return safe_error_response(e, 502, log_message="Superset API call failed")
    except Exception as e:
        return safe_error_response(e, 500, log_message="Failed to get dashboard datasets")

    return jsonify({"status": "ok", "datasets": datasets, "count": len(datasets)})


@catalog_bp.route("/dashboards/<int:dashboard_id>/filters", methods=["GET"])
def get_dashboard_filters(dashboard_id: int):
    """Get native filters defined for a dashboard."""
    token, user = require_auth()
    if not user:
        return jsonify({"status": "error", "message": "Authentication required"}), 401

    dataset_id_raw = request.args.get("dataset_id")
    dataset_id = int(dataset_id_raw) if dataset_id_raw else None

    catalog = _catalog()
    try:
        if token:
            filters = _with_retry(catalog.get_dashboard_filters, token, dashboard_id, dataset_id)
        else:
            filters = catalog.get_dashboard_filters(None, dashboard_id, dataset_id)
        if filters is None:
            return jsonify({"status": "error", "message": "Authentication expired, please log in again"}), 401
    except HTTPError as e:
        return safe_error_response(e, 502, log_message="Superset API call failed")
    except Exception as e:
        return safe_error_response(e, 500, log_message="Failed to get dashboard filters")

    return jsonify({
        "status": "ok",
        "dashboard_id": dashboard_id,
        "dataset_id": dataset_id,
        "filters": filters,
        "count": len(filters),
    })


@catalog_bp.route("/filters/options", methods=["GET"])
def get_filter_options():
    """Get option values for a dashboard filter field."""
    token, user = require_auth()
    if not user:
        return jsonify({"status": "error", "message": "Authentication required"}), 401

    dataset_id_raw = request.args.get("dataset_id")
    column_name = (request.args.get("column_name") or "").strip()
    keyword = (request.args.get("keyword") or "").strip()
    limit = int(request.args.get("limit", 50))
    offset = int(request.args.get("offset", 0))

    if not dataset_id_raw or not column_name:
        return jsonify({"status": "error", "message": "dataset_id and column_name are required"}), 400

    dataset_id = int(dataset_id_raw)
    catalog = _catalog()
    try:
        if token:
            payload = _with_retry(
                catalog.get_filter_options, token, dataset_id, column_name, keyword, limit, offset,
            )
        else:
            payload = catalog.get_filter_options(None, dataset_id, column_name, keyword, limit, offset)
        if payload is None:
            return jsonify({"status": "error", "message": "Authentication expired, please log in again"}), 401
    except HTTPError as e:
        return safe_error_response(e, 502, log_message="Superset API call failed")
    except ValueError as e:
        return safe_error_response(e, 400, log_message="Invalid filter options request")
    except Exception as e:
        return safe_error_response(e, 500, log_message="Failed to get filter options")

    return jsonify({"status": "ok", **payload})


@catalog_bp.route("/datasets/<int:dataset_id>", methods=["GET"])
def get_dataset_detail(dataset_id: int):
    """Full detail for a single dataset."""
    token, user = require_auth()
    if not user:
        return jsonify({"status": "error", "message": "Authentication required"}), 401

    catalog = _catalog()
    try:
        if token:
            detail = _with_retry(catalog.get_dataset_detail, token, dataset_id)
        else:
            detail = catalog.get_dataset_detail(None, dataset_id)
        if detail is None:
            return jsonify({"status": "error", "message": "Authentication expired, please log in again"}), 401
    except HTTPError as e:
        return safe_error_response(e, 502, log_message="Superset API call failed")
    except Exception as e:
        return safe_error_response(e, 500, log_message="Failed to get dataset detail")

    return jsonify({"status": "ok", "dataset": detail})
