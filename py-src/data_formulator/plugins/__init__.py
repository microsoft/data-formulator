# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Data source plugin auto-discovery and registration.

On import, this module does **not** scan.  Call :func:`discover_and_register`
once from ``app.py`` after the Flask app is created.

Discovery walks every **sub-package** under ``plugins/``, looking for a
module-level ``plugin_class`` attribute that is a concrete
:class:`DataSourcePlugin` subclass.  Enablement is gated by the
``required_env`` list in the plugin's ``manifest()``: all listed
environment variables must be set for the plugin to activate.

Adding a new plugin:

1. Create a sub-directory under ``plugins/``
2. In its ``__init__.py``, set ``plugin_class = YourPlugin``
3. Set the required env vars in ``.env``
4. Restart — no core code changes needed
"""

from __future__ import annotations

import importlib
import logging
import os
import pkgutil
from typing import Any

from data_formulator.plugins.base import DataSourcePlugin

_log = logging.getLogger(__name__)

ENABLED_PLUGINS: dict[str, DataSourcePlugin] = {}
DISABLED_PLUGINS: dict[str, str] = {}


def discover_and_register(app: Any) -> None:
    """Scan ``plugins/`` sub-packages and register enabled plugins.

    Called once in :func:`data_formulator.app._register_blueprints`.
    """
    for _finder, pkg_name, ispkg in pkgutil.iter_modules(__path__):
        if not ispkg:
            continue

        try:
            mod = importlib.import_module(f"data_formulator.plugins.{pkg_name}")
        except ImportError as exc:
            DISABLED_PLUGINS[pkg_name] = f"Missing dependency: {exc.name}"
            _log.info(
                "Plugin '%s' disabled (import error): %s", pkg_name, exc,
            )
            continue

        plugin_cls = getattr(mod, "plugin_class", None)
        if plugin_cls is None:
            continue
        if not (isinstance(plugin_cls, type) and issubclass(plugin_cls, DataSourcePlugin)):
            _log.warning(
                "Plugin '%s': plugin_class is not a DataSourcePlugin subclass, skipped",
                pkg_name,
            )
            continue

        try:
            manifest = plugin_cls.manifest()
        except Exception as exc:
            DISABLED_PLUGINS[pkg_name] = f"manifest() failed: {exc}"
            _log.error("Plugin '%s' manifest() failed: %s", pkg_name, exc)
            continue

        plugin_id = manifest.get("id", pkg_name)
        required_env = manifest.get("required_env", [])

        missing_env = [e for e in required_env if not os.environ.get(e)]
        if missing_env:
            DISABLED_PLUGINS[plugin_id] = (
                f"Not configured: {', '.join(missing_env)}"
            )
            _log.info(
                "Plugin '%s' disabled: missing env %s",
                plugin_id,
                ", ".join(missing_env),
            )
            continue

        try:
            plugin: DataSourcePlugin = plugin_cls()
            bp = plugin.create_blueprint()
            app.register_blueprint(bp)
            plugin.on_enable(app)

            ENABLED_PLUGINS[plugin_id] = plugin
            _log.info(
                "Plugin '%s' enabled (from plugins/%s/)",
                plugin_id,
                pkg_name,
            )
        except Exception as exc:
            DISABLED_PLUGINS[plugin_id] = str(exc)
            _log.error(
                "Plugin '%s' failed to initialise: %s",
                plugin_id,
                exc,
                exc_info=True,
            )
