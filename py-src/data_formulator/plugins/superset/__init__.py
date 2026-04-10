# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Superset data source plugin for Data Formulator.

Provides:
- Password / SSO authentication against a Superset instance
- Dataset & dashboard catalog browsing with native filter support
- Dataset loading via Superset SQL Lab → Workspace Parquet

Activation requires ``PLG_SUPERSET_URL`` to be set.
"""

from __future__ import annotations

import os
from typing import Any

from flask import Blueprint, Flask

from data_formulator.plugins.base import DataSourcePlugin
from data_formulator.plugins.superset.auth_bridge import SupersetAuthBridge
from data_formulator.plugins.superset.catalog import SupersetCatalog
from data_formulator.plugins.superset.superset_client import SupersetClient


class SupersetPlugin(DataSourcePlugin):
    """Concrete ``DataSourcePlugin`` for Apache Superset."""

    @staticmethod
    def manifest() -> dict[str, Any]:
        return {
            "id": "superset",
            "name": "Apache Superset",
            "env_prefix": "PLG_SUPERSET",
            "required_env": ["PLG_SUPERSET_URL"],
            "icon": "superset",
            "description": "Connect to an Apache Superset instance to browse and load datasets.",
            "auth_modes": ["password", "sso"],
            "capabilities": ["datasets", "dashboards", "filters"],
        }

    def create_blueprint(self) -> Blueprint:
        """Assemble a parent Blueprint that nests auth / catalog / data sub-blueprints."""
        parent = Blueprint("plugin_superset", __name__)

        from data_formulator.plugins.superset.routes.auth import auth_bp
        from data_formulator.plugins.superset.routes.catalog import catalog_bp
        from data_formulator.plugins.superset.routes.data import data_bp

        parent.register_blueprint(auth_bp)
        parent.register_blueprint(catalog_bp)
        parent.register_blueprint(data_bp)

        return parent

    def get_frontend_config(self) -> dict[str, Any]:
        superset_url = os.environ.get("PLG_SUPERSET_URL", "")
        sso_login_url = os.environ.get("PLG_SUPERSET_SSO_LOGIN_URL", "")
        if not sso_login_url and superset_url:
            sso_login_url = f"{superset_url.rstrip('/')}/df-sso-bridge/"
        return {
            "base_url": superset_url,
            "sso_login_url": sso_login_url,
            "guest_enabled": True,
            "auth_url": "/api/plugins/superset/auth/login",
            "status_url": "/api/plugins/superset/auth/status",
            "catalog_url": "/api/plugins/superset/catalog/datasets",
            "load_url": "/api/plugins/superset/data/load-dataset",
        }

    def on_enable(self, app: Flask) -> None:
        """Create shared service objects and store them as Flask extensions."""
        superset_url = os.environ["PLG_SUPERSET_URL"].rstrip("/")
        cache_ttl = int(os.environ.get("PLG_SUPERSET_CACHE_TTL", "300"))

        bridge = SupersetAuthBridge(superset_url)
        client = SupersetClient(superset_url)
        catalog = SupersetCatalog(client, cache_ttl=cache_ttl)

        app.extensions["plugin_superset_bridge"] = bridge
        app.extensions["plugin_superset_client"] = client
        app.extensions["plugin_superset_catalog"] = catalog

    def get_auth_status(self, session: dict) -> dict[str, Any] | None:
        from data_formulator.plugins.superset.session_helpers import KEY_USER
        user = session.get(KEY_USER)
        if user:
            return {
                "authenticated": True,
                "user": {
                    "id": user.get("id"),
                    "username": user.get("username", ""),
                },
            }
        return {"authenticated": False}


# Plugin class attribute required by the discovery system
plugin_class = SupersetPlugin
