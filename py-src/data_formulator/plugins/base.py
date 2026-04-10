# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Base classes for the data source plugin system.

A ``DataSourcePlugin`` is a self-contained integration with one external
BI platform (Superset, Metabase, Grafana, …).  Each plugin ships:

* **Backend** — Flask Blueprint with auth / catalog / data routes
* **Frontend** — React panel rendered inside the data upload dialog
* **Manifest** — declarative metadata that the framework uses for
  auto-discovery, enablement gating, and frontend configuration

Plugins are auto-discovered by :func:`data_formulator.plugins.discover_and_register`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional

from flask import Blueprint, Flask


class DataSourcePlugin(ABC):
    """Abstract base for data source plugins.

    Lifecycle (managed by ``discover_and_register``):

    1. ``manifest()`` — framework reads ``required_env`` to decide enablement
    2. ``__init__()`` — instantiate the plugin
    3. ``create_blueprint()`` — obtain the Flask Blueprint
    4. ``on_enable(app)`` — called once after Blueprint registration
    5. Per-request: routes in the Blueprint handle auth / catalog / data
    6. ``on_disable()`` — called on teardown (future)

    Subclass contract:

    * ``manifest()`` must be a **staticmethod** returning a dict.
    * ``create_blueprint()`` must return a Blueprint whose ``url_prefix``
      is ``/api/plugins/<plugin_id>/``.
    * ``get_frontend_config()`` must **never** include secrets.
    """

    @staticmethod
    @abstractmethod
    def manifest() -> dict[str, Any]:
        """Declarative plugin metadata.

        Required keys::

            id           — unique slug (e.g. ``"superset"``)
            name         — human-readable display name
            env_prefix   — e.g. ``"PLG_SUPERSET"``
            required_env — list of env vars that must be set to enable

        Optional keys::

            icon, description, version, optional_env,
            auth_modes   — e.g. ``["sso", "jwt", "password"]``
            capabilities — e.g. ``["datasets", "dashboards", "filters"]``
        """
        ...

    @abstractmethod
    def create_blueprint(self) -> Blueprint:
        """Return a Flask Blueprint for this plugin's HTTP routes.

        The blueprint's ``url_prefix`` **must** be
        ``/api/plugins/<manifest.id>/``.
        """
        ...

    @abstractmethod
    def get_frontend_config(self) -> dict[str, Any]:
        """Non-sensitive configuration sent to the frontend.

        Merged with ``manifest()`` and included in ``/api/app-config``
        under ``PLUGINS.<id>``.  Must **not** contain secrets.
        """
        ...

    # -- lifecycle hooks ---------------------------------------------------

    def on_enable(self, app: Flask) -> None:
        """Called once after the Blueprint is registered."""

    def on_disable(self) -> None:
        """Called on application teardown (reserved for future use)."""

    # -- optional capabilities ---------------------------------------------

    def get_auth_status(self, session: dict) -> Optional[dict[str, Any]]:
        """Return current user's auth status for this plugin, or ``None``."""
        return None

    def supports_sso_passthrough(self) -> bool:
        """Whether this plugin can use the DF user's SSO token directly."""
        return False
