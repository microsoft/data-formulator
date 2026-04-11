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

from flask import Blueprint, jsonify, request

from data_formulator.credential_vault import get_credential_vault
from data_formulator.security.auth import get_identity_id

logger = logging.getLogger(__name__)

credential_bp = Blueprint("credentials", __name__, url_prefix="/api/credentials")


@credential_bp.route("/list", methods=["GET"])
def list_credentials():
    """List source_keys with stored credentials (no secrets exposed)."""
    vault = get_credential_vault()
    if not vault:
        return jsonify({"sources": []})

    identity = get_identity_id()
    sources = vault.list_sources(identity)
    return jsonify({"sources": sources})


@credential_bp.route("/store", methods=["POST"])
def store_credential():
    """Store or update encrypted credentials for a source."""
    vault = get_credential_vault()
    if not vault:
        return jsonify({"error": "Credential vault not configured"}), 503

    data = request.get_json()
    source_key = data.get("source_key")
    credentials = data.get("credentials")
    if not source_key or not credentials:
        return jsonify({"error": "source_key and credentials required"}), 400

    identity = get_identity_id()
    vault.store(identity, source_key, credentials)
    logger.info("Credentials stored for %s / %s", identity[:16], source_key)
    return jsonify({"status": "stored", "source_key": source_key})


@credential_bp.route("/delete", methods=["POST"])
def delete_credential():
    """Delete stored credentials for a source."""
    vault = get_credential_vault()
    if not vault:
        return jsonify({"error": "Credential vault not configured"}), 503

    data = request.get_json()
    source_key = data.get("source_key")
    if not source_key:
        return jsonify({"error": "source_key required"}), 400

    identity = get_identity_id()
    vault.delete(identity, source_key)
    logger.info("Credentials deleted for %s / %s", identity[:16], source_key)
    return jsonify({"status": "deleted", "source_key": source_key})
