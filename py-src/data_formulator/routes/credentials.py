# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""REST API for credential management (list / store / delete).

All endpoints are identity-scoped: the current user (from
:func:`get_identity_id`) can only access their own stored credentials.
Credential *values* are never returned to the frontend — ``/list``
only reveals which source_keys have stored credentials.
"""
from __future__ import annotations

import logging

from flask import Blueprint, request

from data_formulator.auth.vault import get_credential_vault
from data_formulator.auth.identity import get_identity_id
from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode

logger = logging.getLogger(__name__)

credential_bp = Blueprint("credentials", __name__, url_prefix="/api/credentials")


@credential_bp.route("/list", methods=["GET"])
def list_credentials():
    """List source_keys with stored credentials (no secrets exposed)."""
    vault = get_credential_vault()
    if not vault:
        return json_ok({"sources": []})

    identity = get_identity_id()
    sources = vault.list_sources(identity)
    return json_ok({"sources": sources})


@credential_bp.route("/store", methods=["POST"])
def store_credential():
    """Store or update encrypted credentials for a source."""
    vault = get_credential_vault()
    if not vault:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Credential vault not configured")

    data = request.get_json()
    source_key = data.get("source_key")
    credentials = data.get("credentials")
    if not source_key or not credentials:
        raise AppError(ErrorCode.INVALID_REQUEST, "source_key and credentials required")

    identity = get_identity_id()
    vault.store(identity, source_key, credentials)
    logger.info("Credentials stored for %s / %s", identity[:16], source_key)
    return json_ok({"source_key": source_key})


@credential_bp.route("/delete", methods=["POST"])
def delete_credential():
    """Delete stored credentials for a source."""
    vault = get_credential_vault()
    if not vault:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Credential vault not configured")

    data = request.get_json()
    source_key = data.get("source_key")
    if not source_key:
        raise AppError(ErrorCode.INVALID_REQUEST, "source_key required")

    identity = get_identity_id()
    vault.delete(identity, source_key)
    logger.info("Credentials deleted for %s / %s", identity[:16], source_key)
    return json_ok({"source_key": source_key})
