"""
Modular data-loader registry.

Two loader sources:

1. **Built-in** — declared in ``_LOADER_SPECS`` (this file).  Each loader
   is independently imported via try/except so that a missing dependency
   only disables that one loader.

2. **External plugins** — Python files matching ``*_data_loader.py``
   found in the plugin directory.  Resolution order:

   1. ``DF_PLUGIN_DIR`` env var — explicit override (useful for
      team-shared dirs, read-only mounts, dev iteration).
   2. ``DATA_FORMULATOR_HOME/plugins`` — the default location,
      consistent with every other DF artifact.
   3. ``~/.data_formulator/plugins/`` — final fallback when
      ``DATA_FORMULATOR_HOME`` is unset.

   Any ``ExternalDataLoader`` subclass found in such a file is
   auto-registered.  If a plugin key collides with a built-in key the
   plugin wins (override).

   For safety, plugin scanning is enabled only when running in local
   single-user mode (``WORKSPACE_BACKEND=local``, the default).  In
   multi-user / hosted deployments, set ``DF_ALLOW_PLUGINS=1`` to opt in
   explicitly — the plugin directory must be trusted, since loading a
   plugin executes arbitrary Python code in the server process.

``DATA_LOADERS``     — loaders that imported successfully.
``DISABLED_LOADERS`` — loaders that failed, with a human-readable hint.
``PLUGIN_LOADERS``   — subset of ``DATA_LOADERS`` registered from plugins,
                       mapped to the source file path.
``PLUGIN_ERRORS``    — plugins that were rejected (e.g. built-in override
                       attempt or duplicate key).  Each entry is a dict:
                       ``{"file", "reason", "kind"}``.
"""

from __future__ import annotations

import importlib
import importlib.util
import inspect
import logging
import os
import sys
from pathlib import Path

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode

_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Declarative built-in loader specs
# (registry_key, module_path, class_name, pip_package)
# To add a new loader, just append a tuple here.
# ---------------------------------------------------------------------------
_LOADER_SPECS: list[tuple[str, str, str, str]] = [
    ("mysql",      "data_formulator.data_loader.mysql_data_loader",      "MySQLDataLoader",      "pymysql"),
    ("mssql",      "data_formulator.data_loader.mssql_data_loader",      "MSSQLDataLoader",      "pyodbc"),
    ("postgresql", "data_formulator.data_loader.postgresql_data_loader",  "PostgreSQLDataLoader", "psycopg2-binary"),
    ("kusto",      "data_formulator.data_loader.kusto_data_loader",      "KustoDataLoader",      "azure-kusto-data"),
    ("databricks", "data_formulator.data_loader.databricks_data_loader", "DatabricksDataLoader", "databricks-sql-connector"),
    ("s3",         "data_formulator.data_loader.s3_data_loader",         "S3DataLoader",         "boto3"),
    ("azure_blob", "data_formulator.data_loader.azure_blob_data_loader", "AzureBlobDataLoader",  "azure-storage-blob"),
    ("mongodb",    "data_formulator.data_loader.mongodb_data_loader",    "MongoDBDataLoader",    "pymongo"),
    ("cosmosdb",   "data_formulator.data_loader.cosmosdb_data_loader",  "CosmosDBDataLoader",   "azure-cosmos"),
    ("bigquery",   "data_formulator.data_loader.bigquery_data_loader",   "BigQueryDataLoader",   "google-cloud-bigquery"),
    ("athena",     "data_formulator.data_loader.athena_data_loader",     "AthenaDataLoader",     "boto3"),
    ("superset",   "data_formulator.data_loader.superset_data_loader",   "SupersetLoader",       "requests"),
    ("local_folder", "data_formulator.data_loader.local_folder_data_loader", "LocalFolderDataLoader", "pyarrow"),
    ("sample_datasets", "data_formulator.data_loader.sample_datasets_loader", "SampleDatasetsLoader", "requests"),
]

# ---------------------------------------------------------------------------
# Phase 1: load built-in loaders
# ---------------------------------------------------------------------------

DATA_LOADERS: dict[str, type[ExternalDataLoader]] = {}
DISABLED_LOADERS: dict[str, str] = {}  # key -> install / failure hint
PLUGIN_LOADERS: dict[str, str] = {}    # key -> absolute source file path
PLUGIN_ERRORS: list[dict] = []         # rejected plugin attempts (override / duplicate)
_BUILTIN_KEYS: frozenset[str] = frozenset(spec[0] for spec in _LOADER_SPECS)

def _scan_package_loaders() -> None:
    """Import built-in loaders from ``_LOADER_SPECS``."""
    for key, module_path, cls_name, pip_pkg in _LOADER_SPECS:
        try:
            mod = importlib.import_module(module_path)
            DATA_LOADERS[key] = getattr(mod, cls_name)
        except ImportError as exc:
            hint = f"pip install {pip_pkg}"
            DISABLED_LOADERS[key] = hint
            _log.info(
                "Data loader '%s' disabled (missing: %s). Install with: %s",
                key, exc.name, hint,
            )

_scan_package_loaders()

# ---------------------------------------------------------------------------
# Phase 2: scan external plugin directory
# ---------------------------------------------------------------------------

def _resolve_plugin_dir() -> str:
    """Resolve the plugin directory.

    Order: ``DF_PLUGIN_DIR`` (explicit override) >
    ``DATA_FORMULATOR_HOME/plugins`` (default) >
    ``~/.data_formulator/plugins`` (fallback).
    """
    explicit = os.environ.get("DF_PLUGIN_DIR")
    if explicit:
        return explicit
    df_home = os.environ.get("DATA_FORMULATOR_HOME")
    base = Path(df_home) if df_home else Path.home() / ".data_formulator"
    return str(base / "plugins")


PLUGIN_DIR: str = _resolve_plugin_dir()


def _plugin_scanning_enabled() -> tuple[bool, str]:
    """Return ``(enabled, reason)``.

    Plugin loading executes arbitrary Python in the server process, so it
    is only enabled by default in single-user local mode.  Hosted
    deployments must opt in via ``DF_ALLOW_PLUGINS=1``.
    """
    if os.environ.get("DF_ALLOW_PLUGINS", "").lower() in ("1", "true", "yes"):
        return True, "DF_ALLOW_PLUGINS opt-in"
    backend = os.environ.get("WORKSPACE_BACKEND", "local")
    if backend == "local":
        return True, "WORKSPACE_BACKEND=local"
    return False, f"WORKSPACE_BACKEND={backend} (set DF_ALLOW_PLUGINS=1 to enable)"


def _register_plugin_class(key: str, cls: type[ExternalDataLoader], py_file: Path) -> None:
    """Register a plugin loader class.

    Plugins are **not** allowed to override built-in loaders or earlier
    plugin loaders. Silent overrides are a credential-exfiltration risk
    (a malicious ``mysql_data_loader.py`` could replace the built-in
    MySQL connector and capture every existing MySQL connection's
    password).  Collisions are recorded in ``PLUGIN_ERRORS`` so the UI
    can surface them at the top of the connector picker.
    """
    if key in PLUGIN_LOADERS:
        reason = (
            f"plugin file '{py_file.name}' would override earlier plugin loader '{key}' "
            f"from {PLUGIN_LOADERS[key]} — rename one of the files so their registry keys differ."
        )
        _log.error("Rejected plugin %s: %s", py_file.name, reason)
        PLUGIN_ERRORS.append({"file": str(py_file), "reason": reason, "kind": "duplicate"})
        return
    # Block override of any built-in spec, even if that built-in failed
    # to import (otherwise a missing dependency would silently hand the
    # registry slot to the plugin — stealth substitution risk).
    if key in _BUILTIN_KEYS:
        reason = (
            f"plugin file '{py_file.name}' would override built-in loader '{key}' — "
            f"this is blocked for security reasons. Rename the plugin file to use a "
            f"different prefix (e.g. '{key}_custom_data_loader.py')."
        )
        _log.error("Rejected plugin %s: %s", py_file.name, reason)
        PLUGIN_ERRORS.append({"file": str(py_file), "reason": reason, "kind": "override_builtin"})
        return
    DATA_LOADERS[key] = cls
    PLUGIN_LOADERS[key] = str(py_file)
    # Clear any stale disabled entry from a previous failed scan.
    DISABLED_LOADERS.pop(key, None)


def _load_plugin_file(py_file: Path) -> None:
    """Load a single ``*_data_loader.py`` plugin file.

    On failure the key is recorded in ``DISABLED_LOADERS`` so the UI can
    surface why the plugin is missing.  ``sys.modules`` is cleaned up on
    failure to avoid leaking a half-initialized module.
    """
    key = py_file.stem.removesuffix("_data_loader")
    module_name = f"df_plugin_{key}"
    try:
        spec = importlib.util.spec_from_file_location(module_name, py_file)
        if spec is None or spec.loader is None:
            DISABLED_LOADERS[key] = f"plugin {py_file.name}: could not create import spec"
            return
        mod = importlib.util.module_from_spec(spec)
        # Only register in sys.modules *after* successful exec to avoid
        # leaving a half-initialized module behind on failure.
        try:
            sys.modules[module_name] = mod
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
        except BaseException:
            sys.modules.pop(module_name, None)
            raise

        candidates = [
            obj for _name, obj in inspect.getmembers(mod, inspect.isclass)
            if (
                issubclass(obj, ExternalDataLoader)
                and obj is not ExternalDataLoader
                and obj.__module__ == module_name
            )
        ]
        if not candidates:
            msg = f"plugin {py_file.name}: no ExternalDataLoader subclass found"
            _log.warning(msg)
            DISABLED_LOADERS[key] = msg
            sys.modules.pop(module_name, None)
            return
        if len(candidates) > 1:
            _log.warning(
                "Plugin %s defines multiple ExternalDataLoader subclasses (%s); "
                "registering '%s'.",
                py_file.name,
                ", ".join(c.__name__ for c in candidates),
                candidates[0].__name__,
            )
        _register_plugin_class(key, candidates[0], py_file)
        _log.info("Plugin loader '%s' registered from %s", key, py_file.name)
    except ImportError as exc:
        # Most common failure mode: plugin imports a package the user
        # hasn't installed.  Surface a useful hint to the UI.
        missing = getattr(exc, "name", None) or str(exc)
        hint = f"plugin {py_file.name}: missing dependency '{missing}' (pip install {missing})"
        DISABLED_LOADERS[key] = hint
        _log.warning("Failed to load plugin %s: %s", py_file.name, hint, exc_info=True)
    except Exception as exc:
        DISABLED_LOADERS[key] = f"plugin {py_file.name}: {type(exc).__name__}: {exc}"
        _log.warning("Failed to load plugin %s", py_file.name, exc_info=True)


def _scan_plugin_dir() -> None:
    """Scan ``PLUGIN_DIR`` for ``*_data_loader.py`` files.

    The registry key is derived from the filename:
    ``my_custom_data_loader.py`` → ``my_custom``.  Plugins override
    built-ins with the same key.
    """
    enabled, reason = _plugin_scanning_enabled()
    if not enabled:
        _log.info("Plugin scanning disabled: %s", reason)
        return

    plugin_path = Path(PLUGIN_DIR)
    if not plugin_path.is_dir():
        _log.debug("Plugin dir %s does not exist; skipping plugin scan", plugin_path)
        return

    files = sorted(plugin_path.glob("*_data_loader.py"))
    if not files:
        _log.info("Plugin dir %s contains no *_data_loader.py files", plugin_path)
        return

    for py_file in files:
        _load_plugin_file(py_file)

    _log.info(
        "Plugin scan complete: %d registered, %d failed, %d rejected (dir=%s, reason=%s)",
        len(PLUGIN_LOADERS),
        sum(1 for k in DISABLED_LOADERS if k not in {s[0] for s in _LOADER_SPECS}),
        len(PLUGIN_ERRORS),
        plugin_path,
        reason,
    )

_scan_plugin_dir()

# ---------------------------------------------------------------------------
# Deployment restrictions
# ---------------------------------------------------------------------------

def _enforce_deployment_restrictions() -> None:
    """Disable local-only loaders in multi-user mode."""
    backend = os.environ.get("WORKSPACE_BACKEND", "local")
    if backend != "local" and "local_folder" in DATA_LOADERS:
        del DATA_LOADERS["local_folder"]
        DISABLED_LOADERS["local_folder"] = (
            "local_folder connector is disabled in multi-user mode "
            "(WORKSPACE_BACKEND != 'local')"
        )
        _log.info("local_folder loader disabled: WORKSPACE_BACKEND=%s", backend)

_enforce_deployment_restrictions()

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_available_loaders() -> dict[str, type[ExternalDataLoader]]:
    """Return all registered loaders (built-in + plugins)."""
    return dict(DATA_LOADERS)

__all__ = [
    "ExternalDataLoader",
    "CatalogNode",
    "DATA_LOADERS",
    "DISABLED_LOADERS",
    "PLUGIN_LOADERS",
    "PLUGIN_DIR",
    "get_available_loaders",
]
